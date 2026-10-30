"use client";

/**
 * RDEP Smart Receipt: generic, fully animated, Australian (AUD, GST) version.
 *
 * Sections, top to bottom: greeting, rewards (points / profile), the receipt (purchase details),
 * 2-image banner slider, coupons (ticket style), feedback, refer a friend, reach out, store label,
 * terms + barcode + "Powered by".
 *
 * Animation: every element reveals when it scrolls into view and replays each time it comes back
 * into view (handy for screen-recording one section at a time). Text types in letter by letter,
 * numbers count up, leader lines draw, barcode bars grow.
 *   REPLAY_ON_SCROLL = false  -> animate only the first time
 *   RESPECT_REDUCED_MOTION    -> set false if your OS has "reduce motion" on and you still want to record
 *
 * Needs in /public/images:  rdep-logo.png, banner-1.png, banner-2.png (1920x1080)
 * Stack: Next.js (app router) + Tailwind. No other dependencies.
 *
 * Usage:  app/receipt/page.tsx
 *   import RdepReceipt from "@/components/RdepReceipt";
 *   export default function Page() { return <RdepReceipt />; }
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ElementType,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import Image from "next/image";
import { Anton, Inter, JetBrains_Mono } from "next/font/google";

const display = Anton({ subsets: ["latin"], weight: "400", display: "swap" });
const body = Inter({ subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap" });

/* Brand tokens. Change --rd-accent (and the soft tint) to recolour everything. */
const theme = {
  "--rd-accent": "#1800AD",
  "--rd-accent-dark": "#13008A",
  "--rd-accent-soft": "rgba(24,0,173,0.1)",
  "--rd-ink": "#2E2E2E",
  "--rd-canvas": "#F3F0EA",
  "--rd-page": "#E3DFD7",
  "--rd-wash": "#F3F0EA",
  "--rd-line": "#E2DED9",
  "--rd-gray": "#666666",
} as CSSProperties;

/* ------------------------------- config ------------------------------------------ */
const BRAND = "Urban Loom"; // demo fashion brand
const PROGRAM = "RDEP Rewards";
const GST_RATE = 10; // Australian GST, prices are GST-inclusive
const DEFAULT_RDEP_LOGO = "/images/rdep-logo.png";
const DEFAULT_FEEDBACK_URL = "https://example.com/feedback";

const BANNERS = [
  { src: "/images/banner-1.png", alt: `${BRAND} banner 1` },
  { src: "/images/banner-2.png", alt: `${BRAND} banner 2` },
];
const BANNER_MS = 4000;

const REPLAY_ON_SCROLL = true;
const RESPECT_REDUCED_MOTION = true;

/* ------------------------------- types ------------------------------------------- */
export interface ReceiptItem {
  name: string;
  qty: number;
  /** Recommended retail price (per piece, GST-inclusive) */
  rrp: number;
  /** Amount paid for the line, GST-inclusive */
  net: number;
  code: string;
  colour: string;
  size: string;
  inseam?: string;
}

export interface Coupon {
  code: string;
  /** Big number on the ticket, e.g. "20%" or "$15" */
  value: string;
  title: string;
  detail: string;
  validTill: string;
}

export interface Receipt {
  invoiceNo: string;
  receiptId: string;
  /** "DD-MM-YYYY HH:mm:ss", the date part is used to sort the history */
  date: string;
  cashier: string;
  store: {
    name: string;
    branch: string;
    address: string;
    code: string;
    phone: string;
    timing: string;
    legalName: string;
    abn: string;
  };
  customer: { firstName: string; mobile: string };
  items: ReceiptItem[];
  /** Total excluding GST */
  subTotal: number;
  /** Total paid, including GST */
  netTotal: number;
  pieces: number;
  payments: { mode: string; amount: number }[];
  points: {
    available: number;
    earned: number;
    redeemed: number;
    expiring: { points: number; on: string };
  };
  rewards: { feedback: number; refer: number; profile: number };
  coupons: Coupon[];
  contact: {
    tollFree: string;
    hours: string;
    email: string;
    /** Number opened by "Talk to us" */
    callTo: string;
    /** Address opened by "Write to us" */
    writeTo: string;
  };
  referral: { code: string; signupUrl: string };
  tax: {
    lines: { type: "GST"; rate: number; base: number; amount: number }[];
    state: string;
  };
  terms: { intro: string; list: string[]; note: string };
}

export interface ProfileForm {
  firstName: string;
  lastName: string;
  birthday: string;
  gender: string;
  email: string;
}

export interface RdepReceiptProps {
  /** Receipt to open first. Defaults to the newest receipt in `receipts`. */
  data?: Receipt;
  /** All receipts of this customer. Drives the history popup. */
  receipts?: Receipt[];
  qrSrc?: string;
  barcodeSrc?: string;
  rdepLogoSrc?: string;
  feedbackUrl?: string;
  /** Overrides the built-in download. Receives the receipt currently on screen. */
  onDownloadPdf?: (receipt: Receipt) => void;
  onSendEmail?: (email: string, receipt: Receipt) => void;
  onUpdateProfile?: (values: ProfileForm) => void;
  onFeedbackClick?: () => void;
  onRefer?: () => void;
  onSelectReceipt?: (invoiceNo: string) => void;
}

type IconName =
  | "history" | "mail" | "download" | "star" | "trend" | "gift" | "alert"
  | "phone" | "close" | "ticket" | "check" | "pin" | "arrow" | "copy";
type TabId = "points" | "profile";
type ModalId = "history" | "email" | "tax" | null;

/* ------------------------------- helpers ----------------------------------------- */
const money = (n: number): string => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-AU");
const plus = (n: number): string => `+ ${money(n)}`;
const trim = (n: number): string => String(Number(n.toFixed(2)));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Prices include GST, so the GST part of a line is net - net / 1.1 */
function derive(item: ReceiptItem) {
  const base = item.net / (1 + GST_RATE / 100);
  const tax = item.net - base;
  const gross = item.rrp * item.qty;
  const disc = gross - item.net;
  return { rate: GST_RATE, base, tax, discountPct: (disc / gross) * 100, discountAmt: disc };
}

function seeded(seed: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    s ^= seed.charCodeAt(i);
    s = Math.imul(s, 16777619);
  }
  s = s || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const buildReferralMessage = (code: string, url: string, points: number): string =>
  `Hey, use my referral code *${code}* and join ${PROGRAM} to enjoy exclusive benefits like earning points on every purchase, birthday surprises, special offers & more! Sign up here: ${url} We both earn ${points} reward points once you register successfully. Let's shop together! *T&C apply.`;

/** One GST line. Sub total + GST adds up exactly to the items' net amounts. */
function buildTax(items: ReceiptItem[]) {
  const net = items.reduce((a, i) => a + i.net, 0);
  const base = round2(net / (1 + GST_RATE / 100));
  const amount = round2(net - base);
  return {
    subTotal: base,
    lines: [{ type: "GST" as const, rate: GST_RATE, base, amount }],
  };
}

/** "24-05-2026 20:34:17" -> timestamp (date part only), used to sort the history newest first. */
function dateValue(d: string): number {
  const [dd, mm, yyyy] = d.split(" ")[0].split("-").map(Number);
  return Date.UTC(yyyy, (mm || 1) - 1, dd || 1);
}

const reducedMotion = (): boolean =>
  RESPECT_REDUCED_MOTION && typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------------------- downloadable receipt ------------------------------- */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Standalone, print-ready HTML for one receipt. The "Save as PDF" button inside it opens the print dialog. */
function buildReceiptHtml(r: Receipt, rdepLogoSrc: string): string {
  const abs = (p: string) => (/^(https?:|data:)/.test(p) ? p : `${window.location.origin}${p}`);
  const gst = round2(r.tax.lines.reduce((a, l) => a + l.amount, 0));

  const itemRows = r.items
    .map((item) => {
      const d = derive(item);
      return `<tr>
        <td><div class="n">${esc(item.name)}</div>
          <div class="s">Code ${esc(item.code)} &middot; Colour ${esc(item.colour)} &middot; Size ${esc(item.size)}${item.inseam ? ` &middot; Inseam ${esc(item.inseam)}` : ""}</div></td>
        <td class="r">${item.qty}</td>
        <td class="r">${money(item.rrp * item.qty)}</td>
        <td class="r">${trim(d.discountPct)}%</td>
        <td class="r b">${money(item.net)}</td>
      </tr>`;
    })
    .join("");

  const taxRows = r.tax.lines
    .map((l) => `<tr><td>${l.type} @ ${l.rate}%</td><td class="r">${money(l.base)}</td><td class="r">${money(l.amount)}</td></tr>`)
    .join("");

  const payRows = r.payments
    .map((p) => `<div class="row"><span>${esc(p.mode)}</span><strong>${money(p.amount)}</strong></div>`)
    .join("");

  const terms = r.terms.list.map((t) => `<li>${esc(t)}</li>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(BRAND)} Tax Invoice ${esc(r.invoiceNo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',Arial,sans-serif;font-size:14px;color:#2E2E2E;background:#FAF9F7;max-width:780px;margin:0 auto;padding:24px;}
.bar{display:flex;justify-content:flex-end;margin-bottom:16px;}
.bar button{background:#1800AD;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:600 13px 'Inter',Arial,sans-serif;cursor:pointer;}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:16px;border-bottom:4px solid #1800AD;margin-bottom:20px;}
.head img{height:48px;width:auto;}
.head h1{font-size:26px;color:#1800AD;text-transform:uppercase;letter-spacing:.5px;margin-top:10px;}
.meta{text-align:right;font-size:12px;line-height:1.7;}
.store{background:#F0EEEB;border-left:4px solid #2E2E2E;padding:12px 14px;margin-bottom:20px;font-size:12px;line-height:1.6;color:#666666;}
.store h2{font-size:15px;color:#2E2E2E;}
.cust{margin-bottom:18px;font-size:13px;}
table{width:100%;border-collapse:collapse;}
.items th{background:#2E2E2E;color:#fff;text-align:left;padding:9px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
.items td{padding:11px 8px;border-bottom:1px solid #E2DED9;vertical-align:top;font-size:12px;}
.r{text-align:right;} .b{font-weight:700;}
.items th.r{text-align:right;}
.n{font-weight:600;text-transform:uppercase;} .s{font-size:11px;color:#666666;margin-top:3px;}
.cols{display:flex;gap:28px;margin-top:22px;align-items:flex-start;}
.col{flex:1;}
.col h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid #2E2E2E;padding-bottom:6px;margin-bottom:8px;}
.row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;}
.tax th{text-align:left;font-size:11px;color:#666666;padding:4px 0;border-bottom:1px solid #E2DED9;}
.tax th.r{text-align:right;} .tax td{padding:5px 0;font-size:12px;}
.net{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:12px 14px;background:#1800AD;color:#fff;}
.net span{font-size:14px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;} .net strong{font-size:24px;}
.pts{margin-top:18px;font-size:12px;color:#666666;}
.terms{margin-top:26px;padding-top:14px;border-top:1px dashed #E2DED9;font-size:10px;color:#666666;line-height:1.6;}
.terms ol{padding-left:16px;margin:6px 0;}
.foot{margin-top:24px;padding-top:16px;border-top:1px dashed #E2DED9;text-align:center;font-size:12px;color:#666666;}
.foot img{height:20px;width:auto;vertical-align:middle;margin-left:6px;}
@media print{.bar{display:none;} body{-webkit-print-color-adjust:exact;print-color-adjust:exact;max-width:none;padding:0;}}
</style>
</head>
<body>

<div class="bar"><button onclick="window.print()">Save as PDF</button></div>

<div class="head">
  <div>
    <img src="${esc(abs(rdepLogoSrc))}" alt="RDEP" onerror="this.style.display='none'">
    <h1>Tax invoice</h1>
  </div>
  <div class="meta">
    <div><strong>Invoice no:</strong> ${esc(r.invoiceNo)}</div>
    <div><strong>Receipt ID:</strong> ${esc(r.receiptId)}</div>
    <div><strong>Date:</strong> ${esc(r.date)}</div>
    <div><strong>Cashier:</strong> ${esc(r.cashier)}</div>
  </div>
</div>

<div class="store">
  <h2>${esc(r.store.name)} &ndash; ${esc(r.store.branch)}</h2>
  <div>${esc(r.store.address)}</div>
  <div>Store code ${esc(r.store.code)} &middot; Phone ${esc(r.store.phone)} &middot; ${esc(r.store.timing)}</div>
  <div>${esc(r.store.legalName)} &middot; ABN ${esc(r.store.abn)}</div>
</div>

<div class="cust"><strong>Customer:</strong> ${esc(r.customer.firstName)} &middot; ${esc(r.customer.mobile)}</div>

<table class="items">
  <thead><tr><th style="width:46%">Item</th><th class="r">Qty</th><th class="r">RRP</th><th class="r">Disc.</th><th class="r">Amount (AUD)</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="cols">
  <div class="col">
    <h3>Tax calculation</h3>
    <table class="tax">
      <thead><tr><th>Tax</th><th class="r">Base amount</th><th class="r">Tax amount</th></tr></thead>
      <tbody>${taxRows}</tbody>
    </table>
    <div class="pts">All prices include GST &middot; State: ${esc(r.tax.state)}</div>
  </div>
  <div class="col">
    <h3>Summary</h3>
    <div class="row"><span>Sub total (ex GST)</span><strong>${money(r.subTotal)}</strong></div>
    <div class="row"><span>GST</span><strong>+ ${money(gst)}</strong></div>
    <div class="net"><span>Total (inc GST)</span><strong>$${money(r.netTotal)}</strong></div>
    <div class="row" style="margin-top:8px"><span>Pieces purchased</span><strong>${r.pieces}</strong></div>
    <h3 style="margin-top:16px">Payment</h3>
    ${payRows}
  </div>
</div>

<div class="pts">${esc(PROGRAM)} &mdash; earned: ${r.points.earned} &middot; redeemed: ${r.points.redeemed} &middot; available: ${r.points.available}</div>

<div class="terms">
  <strong>Terms and conditions</strong>
  <p>${esc(r.terms.intro)}</p>
  <ol>${terms}</ol>
  <p>Customer care (free call): ${esc(r.contact.tollFree)}, ${esc(r.contact.hours)} &middot; Email &ndash; ${esc(r.contact.email)}</p>
  <p>${esc(r.terms.note)}</p>
</div>

<div class="foot">Thank you for shopping at ${esc(BRAND)}!<br><br>Powered by <img src="${esc(abs(rdepLogoSrc))}" alt="rdep" onerror="this.style.display='none'"></div>
</body>
</html>`;
}

function downloadReceipt(r: Receipt, rdepLogoSrc: string) {
  const blob = new Blob([buildReceiptHtml(r, rdepLogoSrc)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Receipt_${r.invoiceNo}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ----------------------------------------------------------------------------------
 * Sample data (all fictional). Replace with the real API response.
 * -------------------------------------------------------------------------------- */
const SAMPLE_COMMON = {
  customer: { firstName: "Liam", mobile: "0412 345 678" },
  rewards: { feedback: 50, refer: 100, profile: 50 },
  coupons: [
    { code: "LOOM20", value: "20%", title: "Next purchase", detail: "Min. spend $100. In store only.", validTill: "31 Dec 2026" },
    { code: "RDEP15", value: "$15", title: "Welcome back", detail: "Min. spend $75. In store and online.", validTill: "15 Jan 2027" },
  ] as Coupon[],
  contact: {
    tollFree: "1800 555 012",
    hours: "Mon-Fri, 9AM to 5PM AEST",
    email: "care@urbanloom.example",
    callTo: "1800555012",
    writeTo: "care@urbanloom.example",
  },
  referral: { code: "RDEP7XQ2LM", signupUrl: "https://rdep.io" },
  terms: {
    intro: `We hope you love your ${BRAND} purchase. If you change your mind, present this tax invoice and exchange the product within 30 days of purchase*, subject to the conditions below. Nothing in this policy limits your rights under the Australian Consumer Law.`,
    list: [
      "Change-of-mind exchanges must be made within 30 days of purchase with this tax invoice.",
      "Products must be unworn, unwashed and in saleable condition with all tags attached.",
      "Exchanges are for products of the same or higher value, with any price difference paid by the customer.",
      "Products bought in a clearance sale can be exchanged but not refunded.",
      "Accessories and innerwear cannot be exchanged for change of mind.",
      `Products can be exchanged at any ${BRAND} store in Australia.`,
      "Personalised, customised or altered products cannot be exchanged for change of mind.",
      "Please follow the care instructions on the label.",
      "Faulty products will be repaired, replaced or refunded in line with the Australian Consumer Law.",
      `${PROGRAM} members get an extended 45-day exchange window.`,
    ],
    note: "Note: This policy is governed by the laws of New South Wales, Australia.",
  },
};

const STORE_SURRY_HILLS: Receipt["store"] = {
  name: `${BRAND} Store`,
  branch: "Surry Hills, Sydney",
  address: "Shop 3, 412 Crown St, Surry Hills NSW 2010",
  code: "UL-SYD-0012",
  phone: "0255501234",
  timing: "9:00 AM to 6:00 PM",
  legalName: "URBAN LOOM RETAIL PTY LTD",
  abn: "12 345 678 901",
};

const STORE_FITZROY: Receipt["store"] = {
  name: `${BRAND} Store`,
  branch: "Fitzroy, Melbourne",
  address: "86 Brunswick St, Fitzroy VIC 3065",
  code: "UL-MEL-0027",
  phone: "0355501234",
  timing: "10:00 AM to 6:00 PM",
  legalName: "URBAN LOOM RETAIL PTY LTD",
  abn: "12 345 678 901",
};

const STORE_VALLEY: Receipt["store"] = {
  name: `${BRAND} Store`,
  branch: "Fortitude Valley, Brisbane",
  address: "Shop 11, 245 Brunswick St, Fortitude Valley QLD 4006",
  code: "UL-BNE-0041",
  phone: "0755501234",
  timing: "9:30 AM to 5:30 PM",
  legalName: "URBAN LOOM RETAIL PTY LTD",
  abn: "12 345 678 901",
};

function makeReceipt(o: {
  invoiceNo: string;
  receiptId: string;
  date: string;
  cashier: string;
  store: Receipt["store"];
  state: string;
  items: ReceiptItem[];
  payments: Receipt["payments"];
  points: Receipt["points"];
}): Receipt {
  const tax = buildTax(o.items);
  return {
    ...SAMPLE_COMMON,
    invoiceNo: o.invoiceNo,
    receiptId: o.receiptId,
    date: o.date,
    cashier: o.cashier,
    store: o.store,
    items: o.items,
    subTotal: tax.subTotal,
    netTotal: round2(o.items.reduce((s, i) => s + i.net, 0)),
    pieces: o.items.reduce((s, i) => s + i.qty, 0),
    payments: o.payments,
    points: o.points,
    tax: { lines: tax.lines, state: o.state },
  };
}

export const sampleReceipts: Receipt[] = [
  makeReceipt({
    invoiceNo: "1042",
    receiptId: "202610280012001042",
    date: "28-10-2026 14:42:10",
    cashier: "UL2047",
    store: STORE_SURRY_HILLS,
    state: "New South Wales",
    items: [
      { name: "Relaxed Linen Shirt - Sage", qty: 1, rrp: 129.95, net: 110.46, code: "UL240118", colour: "Sage", size: "M" },
      { name: "Pleated Wide-Leg Trousers - Ecru", qty: 1, rrp: 159.95, net: 135.96, code: "UL310562", colour: "Ecru", size: "10", inseam: "30" },
      { name: "Organic Cotton Crew Tee - Charcoal", qty: 1, rrp: 59.95, net: 50.96, code: "UL180934", colour: "Charcoal", size: "L" },
    ],
    payments: [
      { mode: "CARD", amount: 197.38 },
      { mode: "GIFT CARD", amount: 100 },
    ],
    points: { available: 1240, earned: 297, redeemed: 0, expiring: { points: 420, on: "15 Jan 2027" } },
  }),
  makeReceipt({
    invoiceNo: "0987",
    receiptId: "202609140027000987",
    date: "14-09-2026 12:18:45",
    cashier: "UL2051",
    store: STORE_FITZROY,
    state: "Victoria",
    items: [
      { name: "Heritage Block-Print Shirt - Indigo", qty: 1, rrp: 119.95, net: 101.96, code: "UL420771", colour: "Indigo", size: "M" },
      { name: "Everyday Denim Jacket - Washed Blue", qty: 1, rrp: 219.95, net: 186.96, code: "UL550209", colour: "Washed Blue", size: "L" },
    ],
    payments: [{ mode: "CARD", amount: 288.92 }],
    points: { available: 943, earned: 289, redeemed: 0, expiring: { points: 300, on: "30 Dec 2026" } },
  }),
  makeReceipt({
    invoiceNo: "0931",
    receiptId: "202608020041000931",
    date: "02-08-2026 16:05:09",
    cashier: "UL3012",
    store: STORE_VALLEY,
    state: "Queensland",
    items: [{ name: "Merino Blend Scarf - Camel", qty: 1, rrp: 89.95, net: 76.46, code: "UL730415", colour: "Camel", size: "One size" }],
    payments: [{ mode: "CARD", amount: 76.46 }],
    points: { available: 654, earned: 76, redeemed: 0, expiring: { points: 250, on: "05 Dec 2026" } },
  }),
];

export const sampleReceipt: Receipt = sampleReceipts[0];

/* -------------------------------- icons ------------------------------------------ */
const PATHS: Record<IconName, ReactNode> = {
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  star: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z" />,
  trend: (
    <>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v9h14v-9" />
      <path d="M12 8v13" />
      <path d="M12 8c-1-3-5-4-5-1.5S10 8 12 8Zm0 0c1-3 5-4 5-1.5S14 8 12 8Z" />
    </>
  ),
  alert: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="M12 13v3M12 18.5h.01" />
    </>
  ),
  phone: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  ticket: (
    <>
      <path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
      <path d="M9 9h6M9 12h6M9 15h3" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
};

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/* ------------------------------ animation kit ------------------------------------ */
const CSS = `
.rd{opacity:0}
.rd.rd-on{animation-duration:var(--rd-t,.75s);animation-timing-function:cubic-bezier(.2,.8,.2,1);animation-fill-mode:both;animation-delay:var(--rd-d,0ms)}
.rd-up.rd-on{animation-name:rd-up}.rd-down.rd-on{animation-name:rd-down}
.rd-left.rd-on{animation-name:rd-left}.rd-right.rd-on{animation-name:rd-right}
.rd-zoom.rd-on{animation-name:rd-zoom}.rd-pop.rd-on{animation-name:rd-pop}
.rd-blur.rd-on{animation-name:rd-blur}.rd-fade.rd-on{animation-name:rd-fade}.rd-wipe.rd-on{animation-name:rd-wipe}
@keyframes rd-up{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes rd-down{from{opacity:0;transform:translateY(-26px)}to{opacity:1;transform:none}}
@keyframes rd-left{from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:none}}
@keyframes rd-right{from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:none}}
@keyframes rd-zoom{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:none}}
@keyframes rd-pop{0%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:none}}
@keyframes rd-blur{from{opacity:0;filter:blur(14px);transform:scale(1.04)}to{opacity:1;filter:none;transform:none}}
@keyframes rd-fade{from{opacity:0}to{opacity:1}}
@keyframes rd-wipe{from{opacity:1;clip-path:inset(0 100% 0 0)}to{opacity:1;clip-path:inset(0 0 0 0)}}

.rd-ch{display:inline-block;opacity:0}
.rd-on .rd-ch{animation:rd-ch .6s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--rd-d,0ms) + var(--i,0) * var(--rd-s,35ms))}
@keyframes rd-ch{from{opacity:0;transform:translateY(.7em) rotate(6deg)}to{opacity:1;transform:none}}

.rd-lead::after{content:"";flex:1;min-width:12px;height:0;margin-bottom:3px;border-bottom:1px dotted currentColor;opacity:.4;transform:scaleX(0);transform-origin:left}
.rd-on .rd-lead::after{animation:rd-line .9s ease-out forwards;animation-delay:calc(var(--rd-d,0ms) + 250ms)}
@keyframes rd-line{to{transform:scaleX(1)}}

.rd-bar-y{transform-box:fill-box;transform-origin:50% 100%;transform:scaleY(0)}
.rd-on .rd-bar-y{animation:rd-y .45s ease-out forwards;animation-delay:calc(var(--rd-d,0ms) + var(--i,0) * 14ms)}
@keyframes rd-y{to{transform:scaleY(1)}}

.rd-bar{transform-origin:left;animation:rd-bar .45s ease-out both}
@keyframes rd-bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.rd-fill{transform-origin:left;animation:rd-bar linear forwards}
.rd-kb{animation:rd-kb 8s ease-in-out infinite alternate}
@keyframes rd-kb{from{transform:scale(1)}to{transform:scale(1.09)}}
.rd-sheet{animation:rd-sheet .45s cubic-bezier(.2,.8,.2,1) both}
@keyframes rd-sheet{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:none}}
.rd-bg{animation:rd-fade .3s ease-out both}

.rd-nudge{animation:rd-nudge 1.4s ease-in-out infinite}
@keyframes rd-nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(5px)}}
.rd-float{animation:rd-float 3s ease-in-out infinite}
@keyframes rd-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.rd-shake{transform-origin:50% 10%;animation:rd-shake 2.6s ease-in-out infinite}
@keyframes rd-shake{0%,60%,100%{transform:rotate(0)}66%{transform:rotate(-14deg)}72%{transform:rotate(12deg)}78%{transform:rotate(-8deg)}84%{transform:rotate(5deg)}90%{transform:rotate(0)}}
.rd-shine{position:relative;overflow:hidden}
.rd-shine::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.28) 50%,transparent 65%);transform:translateX(-120%);animation:rd-shine 3.4s ease-in-out infinite}
@keyframes rd-shine{0%,55%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
.rd-star{fill:transparent;animation:rd-star 3.2s ease-in-out infinite}
@keyframes rd-star{0%,10%{fill:transparent}24%,64%{fill:currentColor}80%,100%{fill:transparent}}
${
  RESPECT_REDUCED_MOTION
    ? `@media (prefers-reduced-motion:reduce){.rd,.rd-ch{opacity:1!important;transform:none!important;animation:none!important}.rd-lead::after,.rd-bar-y{transform:none!important;animation:none!important}.rd-bar,.rd-fill,.rd-kb,.rd-sheet,.rd-bg,.rd-nudge,.rd-float,.rd-shake,.rd-shine::after,.rd-star{animation:none!important}.rd-star{fill:currentColor}}`
    : ""
}
`;

/** True while the element is on screen. With REPLAY_ON_SCROLL it turns off again once the element
 *  has fully left the screen, so the animation plays again next time it scrolls into view. */
function useShown<T extends Element>(ref: RefObject<T | null>): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || reducedMotion()) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.intersectionRatio >= 0.15) setShown(true);
          else if (!e.isIntersecting && REPLAY_ON_SCROLL) setShown(false);
        }
      },
      { threshold: [0, 0.15] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return shown;
}

type Variant = "up" | "down" | "left" | "right" | "zoom" | "pop" | "blur" | "fade" | "wipe";

/** Wrapper that animates its children in when it scrolls into view. d = delay (ms), t = duration (ms). */
function Reveal({
  as,
  v = "up",
  d = 0,
  t,
  className = "",
  style,
  children,
}: {
  as?: ElementType;
  v?: Variant;
  d?: number;
  t?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const Tag: ElementType = as ?? "div";
  const ref = useRef<HTMLElement>(null);
  const shown = useShown(ref);
  const vars = { "--rd-d": `${d}ms`, ...(t ? { "--rd-t": `${t}ms` } : {}), ...style } as CSSProperties;
  return (
    <Tag ref={ref} className={`rd rd-${v} ${shown ? "rd-on" : ""} ${className}`} style={vars}>
      {children}
    </Tag>
  );
}

/** Types text in letter by letter. */
function SplitText({
  text,
  d = 0,
  step = 35,
  as,
  className = "",
}: {
  text: string;
  d?: number;
  step?: number;
  as?: ElementType;
  className?: string;
}) {
  const Tag: ElementType = as ?? "span";
  const ref = useRef<HTMLElement>(null);
  const shown = useShown(ref);
  const words = text.split(" ");
  let n = 0;
  return (
    <Tag
      ref={ref}
      className={`${shown ? "rd-on" : ""} ${className}`}
      style={{ "--rd-d": `${d}ms`, "--rd-s": `${step}ms` } as CSSProperties}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, w) => (
          <Fragment key={w}>
            {w > 0 && " "}
            <span className="inline-block whitespace-nowrap">
              {Array.from(word).map((ch) => {
                const idx = n++;
                return (
                  <span key={idx} className="rd-ch" style={{ "--i": idx } as CSSProperties}>
                    {ch}
                  </span>
                );
              })}
            </span>
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}

/** Counts a number up from 0 when it scrolls into view. */
function CountUp({
  to,
  format = fmtInt,
  d = 0,
  dur = 1400,
  className,
}: {
  to: number;
  format?: (n: number) => string;
  d?: number;
  dur?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useShown(ref);
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!shown) {
      setVal(0);
      return;
    }
    if (reducedMotion()) {
      setVal(to);
      return;
    }
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / dur);
      setVal(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, d);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [shown, to, d, dur]);
  return (
    <span ref={ref} className={className}>
      {format(val)}
    </span>
  );
}

/* ------------------------- placeholder QR + barcode ------------------------------ */
function PlaceholderQR({ seed }: { seed: string }) {
  const N = 25;
  const cells = useMemo(() => {
    const rnd = seeded(seed);
    const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
    const out: [number, number][] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!inFinder(x, y) && rnd() > 0.5) out.push([x, y]);
    return out;
  }, [seed]);
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${N + 2} ${N + 2}`} fill="#111111" shapeRendering="crispEdges" role="img" aria-label="Receipt QR code" className="h-full w-full">
      <rect x="-1" y="-1" width={N + 2} height={N + 2} fill="#fff" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />
      ))}
      {finder(0, 0)}
      {finder(N - 7, 0)}
      {finder(0, N - 7)}
    </svg>
  );
}

function PlaceholderBarcode({ seed }: { seed: string }) {
  const bars = useMemo(() => {
    const rnd = seeded(seed);
    const out: [number, number][] = [];
    let x = 0;
    while (x < 240) {
      const w = 1 + Math.floor(rnd() * 3);
      out.push([x, w]);
      x += w + 1 + Math.floor(rnd() * 2);
    }
    return out;
  }, [seed]);
  return (
    <svg viewBox="0 0 244 56" fill="#111111" shapeRendering="crispEdges" role="img" aria-label="Receipt barcode" className="h-14 w-full max-w-xs">
      {bars.map(([x, w], i) => (
        <rect key={x} x={x} y="0" width={w} height="56" className="rd-bar-y" style={{ "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}

/* --------------------------------- shared ---------------------------------------- */
const onPaper = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rd-accent)]";
const onAccent = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Soft lift so white cards pop off the light canvas. */
const lift = "border border-black/5 shadow-[0_10px_28px_-14px_rgba(46,46,46,0.4)]";

/* Inputs use 16px text so iOS does not zoom the page on focus. */
const fieldInput =
  "w-full border-0 border-b-2 border-black/25 bg-transparent px-0 py-2.5 text-base text-[var(--rd-ink)] outline-none transition-colors placeholder:text-black/40 focus:border-[var(--rd-accent)]";
const fieldLabel = "mb-1 block text-[13px] font-medium text-[var(--rd-gray)]";
const accentBtn = `w-full rounded-xl bg-[var(--rd-accent)] py-4 text-sm font-bold uppercase tracking-wide text-white transition-colors active:bg-[var(--rd-accent-dark)] [@media(hover:hover)]:hover:bg-[var(--rd-accent-dark)] motion-reduce:transition-none ${onPaper}`;
const outlineBtn = `flex items-center justify-center gap-2 rounded-xl border-2 border-[var(--rd-ink)] bg-white py-4 text-sm font-bold uppercase tracking-wide text-[var(--rd-ink)] transition-colors active:border-[var(--rd-accent)] [@media(hover:hover)]:hover:border-[var(--rd-accent)] active:bg-[var(--rd-accent)] [@media(hover:hover)]:hover:bg-[var(--rd-accent)] active:text-white [@media(hover:hover)]:hover:text-white motion-reduce:transition-none ${onPaper}`;

/* ---------- fixed-width scaling ---------- */
const DESIGN_W = 400;
const PHONE_MAX = 520;
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** 1 on tablets/desktop (centred 400px column); viewport/400 on phones so the layout is identical. */
function useFitScale(): number {
  const [scale, setScale] = useState(1);
  useIsoLayoutEffect(() => {
    const update = () => {
      const w = document.documentElement.clientWidth;
      setScale(w <= PHONE_MAX ? w / DESIGN_W : 1);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return scale;
}
const zoomStyle = (scale: number): CSSProperties | undefined => (scale === 1 ? undefined : { zoom: scale });

/** Logo image that falls back to a text wordmark instead of a broken-image icon. */
function BrandImage({
  src,
  alt,
  width,
  height,
  className,
  fallbackClassName,
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className: string;
  fallbackClassName: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={fallbackClassName}>{alt}</span>;
  return (
    <Image
      ref={(img: HTMLImageElement | null) => {
        if (img && img.complete && img.naturalWidth === 0) setFailed(true);
      }}
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

/** Label ...... value, like a printed receipt line. The dotted leader draws itself in. */
function Leader({
  label,
  value,
  strong = false,
  className = "",
  d = 0,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  className?: string;
  d?: number;
}) {
  return (
    <Reveal v="left" d={d} className={`flex items-baseline gap-2 ${className}`}>
      <dt className="rd-lead flex min-w-0 flex-1 items-baseline gap-2">{label}</dt>
      <dd className={`shrink-0 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </Reveal>
  );
}

/** Height-animated disclosure body. */
function Collapse({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return (
    <div
      id={id}
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/** Torn-paper edge (white teeth). */
function ZigZag({ down = false }: { down?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg aria-hidden="true" className="block h-2.5 w-full">
      <defs>
        <pattern id={id} width="16" height="10" patternUnits="userSpaceOnUse">
          <path d={down ? "M0 0 L8 10 L16 0 Z" : "M0 10 L8 0 L16 10 Z"} fill="#fff" />
        </pattern>
      </defs>
      <rect width="100%" height="10" fill={`url(#${id})`} />
    </svg>
  );
}

/** Popups are white slips with a torn top edge. They slide up and their content types in. */
function Modal({ title, onClose, scale, children }: { title: string; onClose: () => void; scale: number; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      (previous as HTMLElement | null)?.focus?.();
    };
  }, []);

  return (
    <div
      className="rd-bg fixed inset-0 z-50 flex items-end justify-center bg-[#2E2E2E]/55 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${body.className} rd-sheet max-h-[88vh] w-full overflow-y-auto overflow-x-hidden outline-none sm:w-[400px]`}
      >
        <div className="w-full sm:w-[400px]" style={zoomStyle(scale)}>
          <ZigZag />
          <div className="bg-white px-5 pb-7 pt-4 text-[var(--rd-ink)] sm:rounded-b-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className={`${display.className} text-[28px] uppercase leading-none tracking-wide`}>
                  <SplitText text={title} step={40} d={150} />
                </h2>
                <Reveal as="span" v="wipe" d={450} className="mt-2.5 block h-1 w-12 bg-[var(--rd-accent)]" />
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--rd-ink)] text-white transition-colors active:bg-[var(--rd-accent)] [@media(hover:hover)]:hover:bg-[var(--rd-accent)] motion-reduce:transition-none ${onPaper}`}
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ paper item row ----------------------------------- */
function PaperItem({ item, index, open, onToggle }: { item: ReceiptItem; index: number; open: boolean; onToggle: () => void }) {
  const d = useMemo(() => derive(item), [item]);
  const panelId = useId();
  const m = mono.className;
  const delay = 150 + index * 140;
  return (
    <Reveal as="li" v="left" d={delay} className="border-b border-dashed border-black/40 py-3.5 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2.5 rounded text-left ${onPaper}`}
      >
        <span aria-hidden="true" className={`${m} text-[13px] font-bold leading-snug text-[var(--rd-accent)]`}>
          [{open ? "−" : "+"}]
        </span>
        <span className="min-w-0">
          <span className={`${m} block text-[13px] font-semibold uppercase leading-snug`}>{item.name}</span>
          <span className={`${m} mt-1 block text-xs text-[var(--rd-gray)]`}>
            QTY {item.qty} &nbsp; RRP {money(item.rrp)}
          </span>
        </span>
        <span className={`${m} text-sm font-bold leading-snug tabular-nums`}>
          <CountUp to={item.net} format={money} d={delay + 150} />
        </span>
      </button>

      <Collapse open={open} id={panelId}>
        <div className={`${m} ml-8 mt-3 space-y-2.5 border-l-2 border-[var(--rd-accent)] pl-3 text-xs`}>
          <dl className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--rd-gray)]">Item code</dt>
            <dd className="text-[13px] font-bold tracking-wide">{item.code}</dd>
          </dl>

          <dl className="grid grid-cols-3 divide-x divide-black/15 rounded-md border border-black/15">
            {(
              [
                ["Colour", item.colour],
                ["Size", item.size],
                ["Inseam", item.inseam ?? "-"],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="min-w-0 px-1.5 py-1.5">
                <dt className="text-[var(--rd-gray)]">{k}</dt>
                <dd className="mt-0.5 break-words font-bold">{v}</dd>
              </div>
            ))}
          </dl>

          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-[var(--rd-accent-soft)] px-2.5 py-1.5 text-[var(--rd-accent)]">
              <dt>Discount %</dt>
              <dd className="mt-0.5 text-[13px] font-bold tabular-nums">{trim(d.discountPct)}</dd>
            </div>
            <div className="rounded-md bg-[var(--rd-accent-soft)] px-2.5 py-1.5 text-[var(--rd-accent)]">
              <dt>Discount amount</dt>
              <dd className="mt-0.5 text-[13px] font-bold tabular-nums">{trim(d.discountAmt)}</dd>
            </div>
          </dl>

          <table className="w-full table-fixed tabular-nums">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[14%]" />
              <col />
              <col className="w-[24%]" />
            </colgroup>
            <thead>
              <tr className="text-[var(--rd-gray)]">
                <th className="pb-1 text-left font-medium">Tax</th>
                <th className="pb-1 text-right font-medium">%</th>
                <th className="pb-1 text-right font-medium">Base amount</th>
                <th className="pb-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="border-t border-black/15">
              <tr>
                <td className="py-1.5 font-bold">GST</td>
                <td className="py-1.5 text-right">{d.rate}</td>
                <td className="py-1.5 text-right">{trim(d.base)}</td>
                <td className="py-1.5 text-right font-bold">{trim(d.tax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Collapse>
    </Reveal>
  );
}

/* ------------------------------- feedback ---------------------------------------- */
function FeedbackLink({ href, points, onClick }: { href: string; points: number; onClick?: () => void }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onClick?.()}
      aria-label={`Share your shopping experience feedback and earn ${points} reward points (opens in a new tab)`}
      className={`flex items-center justify-between gap-4 rounded-3xl bg-white p-5 text-[var(--rd-ink)] transition active:scale-[0.99] active:border-[var(--rd-accent)] motion-reduce:transition-none ${lift} ${onPaper}`}
    >
      <span className="min-w-0">
        <span className={`${display.className} block text-[32px] uppercase leading-[1.05] tracking-wide`}>
          <SplitText text="Rate your visit" step={38} d={150} />
        </span>
        <span aria-hidden="true" className="mt-3 flex gap-1.5 text-[var(--rd-accent)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <Reveal as="span" key={i} v="pop" d={500 + i * 120} className="inline-block">
              <svg
                viewBox="0 0 24 24"
                strokeWidth="1.6"
                strokeLinejoin="round"
                style={{ animationDelay: `${i * 0.22}s` }}
                className="rd-star h-7 w-7 stroke-current"
              >
                {PATHS.star}
              </svg>
            </Reveal>
          ))}
        </span>
        <Reveal as="span" v="up" d={900} className="mt-3 block text-[15px] leading-snug text-[var(--rd-gray)]">
          Tell us about your shopping experience and earn {points} reward points
        </Reveal>
      </span>
      <Reveal as="span" v="pop" d={700} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--rd-accent)] text-white">
        <Icon name="arrow" className="rd-nudge h-6 w-6" />
      </Reveal>
    </a>
  );
}

/* ----------------------------- banner slider (2 images) -------------------------- */
function BannerImage({ src, alt, n }: { src: string; alt: string; n: number }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div
        className={`${display.className} grid h-full w-full place-items-center text-3xl uppercase tracking-widest text-white`}
        style={{ background: "linear-gradient(135deg, var(--rd-ink), var(--rd-accent))" }}
      >
        Banner {n}
      </div>
    );
  return (
    <Image
      ref={(img: HTMLImageElement | null) => {
        if (img && img.complete && img.naturalWidth === 0) setFailed(true);
      }}
      src={src}
      alt={alt}
      width={1920}
      height={1080}
      sizes="(max-width: 520px) 100vw, 400px"
      draggable={false}
      onError={() => setFailed(true)}
      className="rd-kb pointer-events-none block h-full w-full select-none object-cover"
    />
  );
}

/** Two banners. Auto-advances while on screen, swipe or tap a dot to change. The active dot fills
 *  up over the time left until the next slide. */
function BannerSlider() {
  const count = BANNERS.length;
  const ref = useRef<HTMLElement>(null);
  const on = useShown(ref);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (!on || reducedMotion()) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % count), BANNER_MS);
    return () => window.clearTimeout(t);
  }, [on, index, bump, count]);

  const goTo = useCallback(
    (i: number) => {
      setIndex(((i % count) + count) % count);
      setBump((b) => b + 1);
    },
    [count],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    startRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    startRef.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) goTo(index + (dx < 0 ? 1 : -1));
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft") goTo(index - 1);
    else if (e.key === "ArrowRight") goTo(index + 1);
  };

  return (
    <section ref={ref} aria-roledescription="carousel" aria-label={`${BRAND} offers`} onKeyDown={onKeyDown}>
      <Reveal v="zoom">
        <div
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            startRef.current = null;
          }}
          className={`relative touch-pan-y select-none overflow-hidden rounded-3xl bg-black ${lift}`}
        >
          <div className="flex transition-transform duration-700 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${index * 100}%)` }}>
            {BANNERS.map((b, i) => (
              <div
                key={b.src}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}`}
                aria-hidden={i !== index}
                className="relative aspect-video w-full shrink-0 overflow-hidden"
              >
                <BannerImage src={b.src} alt={b.alt} n={i + 1} />
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal v="up" d={300} className="mt-3 flex justify-center gap-1">
        {BANNERS.map((b, i) => (
          <button
            key={b.src}
            type="button"
            aria-label={`Show banner ${i + 1} of ${count}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => goTo(i)}
            className={`grid h-6 w-8 place-items-center rounded-full ${onPaper}`}
          >
            <span
              className={`relative block h-2 overflow-hidden rounded-full transition-all duration-500 motion-reduce:transition-none ${
                i === index ? "w-6 bg-black/20" : "w-2 bg-black/25"
              }`}
            >
              {i === index && on && (
                <span
                  key={`${index}-${bump}`}
                  className="rd-fill absolute inset-0 rounded-full bg-[var(--rd-accent)]"
                  style={{ animationDuration: `${BANNER_MS}ms` }}
                />
              )}
            </span>
          </button>
        ))}
      </Reveal>
    </section>
  );
}

/* ----------------------------- coupons (ticket style) ---------------------------- */
/** A ticket: value + details on a white body, perforated edge with two notches, and a coloured
 *  stub that copies the code when tapped. */
function CouponTicket({ coupon, index }: { coupon: Coupon; index: number }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const d = index * 220;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
    } catch {
      /* clipboard blocked: still show the confirmation */
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Reveal v="up" d={d}>
      <div className={`rd-shine flex rounded-2xl bg-white ${lift}`}>
        <div className="flex min-w-0 flex-1 items-center gap-4 p-5">
          <div className="shrink-0 text-center text-[var(--rd-accent)]">
            <Reveal as="span" v="pop" d={d + 250} className={`${display.className} block text-[44px] leading-[0.9] tabular-nums`}>
              {coupon.value}
            </Reveal>
            <span className={`${display.className} mt-1 block text-lg leading-none tracking-[0.18em]`}>OFF</span>
          </div>
          <div className="min-w-0">
            <Reveal as="p" v="left" d={d + 350} className={`${display.className} text-xl uppercase leading-none tracking-wide`}>
              {coupon.title}
            </Reveal>
            <Reveal as="p" v="up" d={d + 500} className="mt-1.5 text-[13px] leading-snug text-[var(--rd-gray)]">
              {coupon.detail}
            </Reveal>
            <Reveal as="p" v="fade" d={d + 650} className={`${mono.className} mt-2 text-xs font-semibold`}>
              Valid till {coupon.validTill}
            </Reveal>
          </div>
        </div>

        <button
          type="button"
          onClick={copy}
          aria-label={`Copy coupon code ${coupon.code}`}
          className={`relative flex w-[108px] shrink-0 flex-col items-center justify-center gap-1.5 border-l-2 border-dashed border-white/60 bg-[var(--rd-accent)] px-2 py-4 text-white transition-colors active:bg-[var(--rd-accent-dark)] [@media(hover:hover)]:hover:bg-[var(--rd-accent-dark)] motion-reduce:transition-none ${onAccent}`}
        >
          {/* the two notches that make it look like a torn ticket */}
          <span aria-hidden="true" className="absolute -left-[13px] -top-3 h-6 w-6 rounded-full bg-[var(--rd-canvas)]" />
          <span aria-hidden="true" className="absolute -bottom-3 -left-[13px] h-6 w-6 rounded-full bg-[var(--rd-canvas)]" />
          <Icon name={copied ? "check" : "copy"} className="h-5 w-5" />
          <span className={`${mono.className} text-[13px] font-bold tracking-wider`}>{coupon.code}</span>
          <span aria-live="polite" className="text-[11px] font-bold uppercase tracking-wide">
            {copied ? "Copied!" : "Tap to copy"}
          </span>
        </button>
      </div>
    </Reveal>
  );
}

function CouponSection({ coupons }: { coupons: Coupon[] }) {
  return (
    <section aria-label="Coupons">
      <h2 className={`${display.className} text-[28px] uppercase leading-none tracking-wide`}>
        <SplitText text="Your coupons" step={34} />
      </h2>
      <div className="mt-5 space-y-4">
        {coupons.length === 0 ? (
          <Reveal v="zoom" className="flex flex-col items-center rounded-3xl border-2 border-dashed border-black/25 bg-white px-6 py-10 text-center">
            <Reveal v="pop" d={200}>
              <span className="rd-float block text-[var(--rd-accent)]">
                <Icon name="ticket" className="h-10 w-10" />
              </span>
            </Reveal>
            <p className={`${display.className} mt-3 text-[26px] uppercase leading-none tracking-wide`}>
              <SplitText text="No coupons available." step={30} d={350} />
            </p>
            <Reveal as="p" v="up" d={900} className="mt-2 text-[15px] text-[var(--rd-gray)]">
              Please check this section later.
            </Reveal>
          </Reveal>
        ) : (
          coupons.map((c, i) => <CouponTicket key={c.code} coupon={c} index={i} />)
        )}
      </div>
    </section>
  );
}

/* ----------------------------- rewards tabs section ------------------------------ */
const TABS: { id: TabId; lines: [string, string] }[] = [
  { id: "points", lines: ["My Reward", "Points"] },
  { id: "profile", lines: ["Update", "Profile"] },
];

function RewardsSection({ data, onUpdateProfile }: { data: Receipt; onUpdateProfile?: (values: ProfileForm) => void }) {
  const [tab, setTab] = useState<TabId>("points");
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<ProfileForm>({ firstName: data.customer.firstName, lastName: "", birthday: "", gender: "", email: "" });
  const set = (k: keyof ProfileForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const { points, rewards } = data;

  return (
    <section aria-label={PROGRAM} className="text-[var(--rd-ink)]">
      <div role="tablist" aria-label={PROGRAM} className="grid grid-cols-2 gap-4 border-b-2 border-black/10">
        {TABS.map((t, i) => {
          const active = tab === t.id;
          return (
            <Reveal key={t.id} v="down" d={i * 120}>
              <button
                role="tab"
                type="button"
                id={`tab-${t.id}`}
                aria-selected={active}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`${display.className} relative block w-full pb-3.5 text-left text-lg uppercase leading-[1.15] tracking-wide transition-colors motion-reduce:transition-none ${onPaper} ${
                  active ? "text-[var(--rd-ink)]" : "text-[var(--rd-gray)] active:text-[var(--rd-ink)] [@media(hover:hover)]:hover:text-[var(--rd-ink)]"
                }`}
              >
                <span className="block">{t.lines[0]}</span>
                <span className="block">{t.lines[1]}</span>
                {active && <span aria-hidden="true" className="rd-bar absolute -bottom-0.5 left-0 right-0 h-1 bg-[var(--rd-accent)]" />}
              </button>
            </Reveal>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === "points" && (
          <div role="tabpanel" id="panel-points" aria-labelledby="tab-points" className="space-y-3">
            <Reveal v="up" className={`rounded-3xl bg-white p-5 ${lift}`}>
              <p className="text-sm font-medium text-[var(--rd-gray)]">Available points</p>
              <p className={`${display.className} mt-1 text-[72px] leading-[0.95] tabular-nums`}>
                <CountUp to={points.available} d={200} dur={1600} />
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--rd-line)] pt-5">
                <div className="flex items-center gap-3">
                  <Reveal as="span" v="pop" d={500} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--rd-wash)] text-[var(--rd-accent)]">
                    <Icon name="trend" className="h-5 w-5" />
                  </Reveal>
                  <div>
                    <dd className={`${display.className} text-[30px] leading-none tabular-nums`}>
                      <CountUp to={points.earned} d={650} />
                    </dd>
                    <dt className="mt-1 text-[13px] text-[var(--rd-gray)]">Earned points</dt>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Reveal as="span" v="pop" d={650} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--rd-wash)] text-[var(--rd-accent)]">
                    <Icon name="gift" className="h-5 w-5" />
                  </Reveal>
                  <div>
                    <dd className={`${display.className} text-[30px] leading-none tabular-nums`}>
                      <CountUp to={points.redeemed} d={800} />
                    </dd>
                    <dt className="mt-1 text-[13px] text-[var(--rd-gray)]">Redeemed points</dt>
                  </div>
                </div>
              </dl>
            </Reveal>
            <Reveal
              v="right"
              d={300}
              className="rd-shine flex items-center gap-4 rounded-3xl bg-[var(--rd-accent)] p-5 text-white shadow-[0_12px_26px_-14px_rgba(194,65,12,0.9)]"
            >
              <Icon name="alert" className="rd-shake h-9 w-9 shrink-0" />
              <p className="text-[15px]">
                <span className={`${display.className} block text-[28px] leading-none tabular-nums tracking-wide`}>
                  <CountUp to={points.expiring.points} d={600} /> points
                </span>
                <span className="mt-1.5 block">
                  Expiring on <span className="font-bold">{points.expiring.on}</span>
                </span>
              </p>
            </Reveal>
          </div>
        )}

        {tab === "profile" && (
          <Reveal v="up">
            <form
              role="tabpanel"
              id="panel-profile"
              aria-labelledby="tab-profile"
              className={`space-y-6 rounded-3xl bg-white p-5 ${lift}`}
              onSubmit={(e) => {
                e.preventDefault();
                onUpdateProfile?.(form);
                setSaved(true);
              }}
            >
              <Reveal as="p" v="up" d={150} className="text-lg font-semibold leading-snug">
                Update your profile now to earn{" "}
                <span className="underline decoration-[var(--rd-accent)] decoration-2 underline-offset-4">{rewards.profile} reward points</span>, get
                personalised offers and more!
              </Reveal>
              <Reveal v="left" d={250}>
                <span className={fieldLabel}>Mobile</span>
                <p className="text-base font-semibold tabular-nums">{data.customer.mobile}</p>
              </Reveal>
              <div className="grid grid-cols-2 gap-x-4 gap-y-6">
                <Reveal as="label" v="left" d={350}>
                  <span className={fieldLabel}>First name</span>
                  <input className={fieldInput} value={form.firstName} onChange={set("firstName")} autoComplete="given-name" />
                </Reveal>
                <Reveal as="label" v="left" d={450}>
                  <span className={fieldLabel}>Last name</span>
                  <input className={fieldInput} value={form.lastName} onChange={set("lastName")} autoComplete="family-name" />
                </Reveal>
                <Reveal as="label" v="left" d={550}>
                  <span className={fieldLabel}>Birthday</span>
                  <input type="date" className={fieldInput} value={form.birthday} onChange={set("birthday")} autoComplete="bday" />
                </Reveal>
                <Reveal as="label" v="left" d={650}>
                  <span className={fieldLabel}>Gender</span>
                  <select className={fieldInput} value={form.gender} onChange={set("gender")}>
                    <option value="">Select</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </Reveal>
              </div>
              <Reveal as="label" v="left" d={750} className="block">
                <span className={fieldLabel}>Email</span>
                <input type="email" className={fieldInput} value={form.email} onChange={set("email")} autoComplete="email" />
              </Reveal>
              <Reveal v="pop" d={850}>
                <button type="submit" className={accentBtn}>
                  Update
                </button>
              </Reveal>
              <p aria-live="polite" className="min-h-5 text-center text-sm font-semibold">
                {saved ? "Profile updated." : ""}
              </p>
            </form>
          </Reveal>
        )}
      </div>
    </section>
  );
}

/* ------------------------------ receipt view ------------------------------------- */
interface ReceiptViewProps extends Omit<RdepReceiptProps, "data" | "receipts" | "onSelectReceipt"> {
  data: Receipt;
  history: { invoiceNo: string; date: string; store: string; amount: number; current: boolean }[];
  onSelect: (invoiceNo: string) => void;
}

function ReceiptView({
  data,
  history,
  onSelect,
  qrSrc,
  barcodeSrc,
  rdepLogoSrc = DEFAULT_RDEP_LOGO,
  feedbackUrl = DEFAULT_FEEDBACK_URL,
  onDownloadPdf,
  onSendEmail,
  onUpdateProfile,
  onFeedbackClick,
  onRefer,
}: ReceiptViewProps) {
  const [openItem, setOpenItem] = useState(-1);
  const [modal, setModal] = useState<ModalId>(null);
  const [termsOpen, setTermsOpen] = useState(true);
  const [storeOpen, setStoreOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const closeModal = useCallback(() => setModal(null), []);
  const termsId = useId();
  const storeId = useId();
  const scale = useFitScale();

  const { store, rewards, contact, terms, referral } = data;
  const nameSize = Math.min(46, Math.max(26, Math.floor(176 / (0.5 * (data.customer.firstName.length + 1)))));
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(buildReferralMessage(referral.code, referral.signupUrl, rewards.refer))}`;
  const m = mono.className;

  const gstTotal = useMemo(() => round2(data.tax.lines.reduce((acc, l) => acc + l.amount, 0)), [data.tax.lines]);

  const handleDownload = () => (onDownloadPdf ? onDownloadPdf(data) : downloadReceipt(data, rdepLogoSrc));

  return (
    <div
      style={theme}
      onTouchStart={() => {}} /* lets :active press states fire on iOS Safari */
      className={`${body.className} min-h-screen overflow-x-hidden bg-[var(--rd-page)] text-[var(--rd-ink)] antialiased [-webkit-text-size-adjust:100%] sm:py-8`}
    >
      <style>{CSS}</style>

      <main
        style={zoomStyle(scale)}
        className="mx-auto w-[400px] overflow-hidden bg-[var(--rd-canvas)] pb-0 sm:rounded-3xl sm:shadow-[0_24px_60px_-24px_rgba(46,46,46,0.35)]"
      >
        {/* ---------- Hero: RDEP logo left, greeting right ---------- */}
        <header className="flex items-center justify-between gap-4 px-5 pb-7 pt-5">
          <Reveal v="pop" d={100} className="max-w-[45%] shrink-0">
            <BrandImage
              src={rdepLogoSrc}
              alt="RDEP"
              width={240}
              height={80}
              priority
              className="h-12 w-auto object-contain object-left"
              fallbackClassName={`${display.className} inline-block bg-[var(--rd-accent)] px-4 py-2 text-3xl uppercase leading-none tracking-wide text-white`}
            />
          </Reveal>
          <h1 className="min-w-0 text-right uppercase">
            <span className={`${display.className} block text-lg leading-none tracking-[0.18em] text-[var(--rd-accent)]`}>
              <SplitText text="Hello" d={300} step={80} />
            </span>
            <span
              className={`${display.className} mt-1 block leading-[0.95] tracking-tight [overflow-wrap:anywhere]`}
              style={{ fontSize: nameSize }}
            >
              <SplitText text={`${data.customer.firstName}!`} d={650} step={70} />
            </span>
          </h1>
        </header>

        {/* ---------- Rewards ---------- */}
        <div className="px-4">
          <RewardsSection data={data} onUpdateProfile={onUpdateProfile} />
        </div>

        {/* ---------- The receipt (purchase details): thermal paper ---------- */}
        <section
          aria-label="Purchase details"
          className="mx-3 mt-10 text-[var(--rd-ink)]"
          style={{ filter: "drop-shadow(0 12px 14px rgba(46,46,46,0.18))" }}
        >
          <ZigZag />
          <div className="bg-white px-5 pb-6 pt-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className={`${display.className} text-[34px] uppercase leading-none tracking-wide text-[var(--rd-accent)]`}>
                <SplitText text="Tax invoice" step={45} d={100} />
              </h2>
              <Reveal v="pop" d={300} className="h-11 w-11 shrink-0 overflow-hidden rounded bg-white ring-1 ring-black/20">
                {qrSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrSrc} alt="Receipt QR code" className="h-full w-full object-contain" />
                ) : (
                  <PlaceholderQR seed={data.receiptId} />
                )}
              </Reveal>
            </div>

            <Reveal
              v="wipe"
              d={150}
              className={`${m} mt-4 flex justify-between border-y-2 border-[var(--rd-ink)] py-2 text-xs font-semibold uppercase tracking-wide`}
            >
              <span>Item name</span>
              <span>Amount (AUD)</span>
            </Reveal>
            <ul aria-label="Items purchased">
              {data.items.map((item, i) => (
                <PaperItem key={`${item.code}-${i}`} item={item} index={i} open={openItem === i} onToggle={() => setOpenItem(openItem === i ? -1 : i)} />
              ))}
            </ul>

            <dl className={`${m} space-y-2 border-t-2 border-[var(--rd-ink)] pt-3.5 text-sm`}>
              <Leader label="Sub total (ex GST)" value={<CountUp to={data.subTotal} format={money} />} strong />
              <Leader label="GST (10%)" value={<CountUp to={gstTotal} format={plus} d={120} />} strong d={120} />
            </dl>

            <Reveal v="zoom" className="mt-3.5 border-y-2 border-[var(--rd-ink)] py-3.5">
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                <span className={`${display.className} text-xl uppercase leading-none tracking-wide`}>
                  <SplitText text="Total" step={45} d={150} />
                </span>
                <span className={`${display.className} text-[44px] leading-none tabular-nums text-[var(--rd-accent)]`}>
                  $<CountUp to={data.netTotal} format={money} d={250} dur={1800} />
                </span>
              </div>
            </Reveal>

            <Reveal v="up" d={100} className="mt-2.5 flex items-center justify-between gap-3">
              <p className={`${m} text-xs text-[var(--rd-gray)]`}>Pieces purchased: {data.pieces}</p>
              <button
                type="button"
                onClick={() => setModal("tax")}
                className={`${m} rounded py-1 text-[13px] font-semibold text-[var(--rd-accent)] underline underline-offset-4 active:no-underline [@media(hover:hover)]:hover:no-underline ${onPaper}`}
              >
                [ View tax calculation ]
              </button>
            </Reveal>

            <dl className={`${m} mt-5 space-y-1.5 border-t border-dashed border-black/40 pt-4 text-xs`}>
              <Leader label="Invoice no" value={data.invoiceNo} strong d={0} />
              <Leader label="Receipt ID" value={data.receiptId} strong d={100} />
              <Leader label="Date" value={data.date} strong d={200} />
              <Leader label="Cashier" value={data.cashier} strong d={300} />
            </dl>

            <h3 className={`${display.className} mt-5 text-[22px] uppercase leading-none tracking-wide`}>
              <SplitText text="Payment" step={45} />
            </h3>
            <dl className={`${m} mt-3 space-y-2 text-sm`}>
              {data.payments.map((p, i) => (
                <Leader key={p.mode} label={p.mode} value={<CountUp to={p.amount} format={money} d={i * 120} />} strong d={i * 120} />
              ))}
            </dl>

            <div className="mt-6 grid grid-cols-3 gap-2">
              {(
                [
                  { icon: "history", label: "History", onClick: () => setModal("history") },
                  { icon: "mail", label: "Email", onClick: () => setModal("email") },
                  { icon: "download", label: "Download", onClick: handleDownload },
                ] as { icon: IconName; label: string; onClick: () => void }[]
              ).map((a, i) => (
                <Reveal key={a.label} v="pop" d={i * 130}>
                  <button
                    type="button"
                    onClick={a.onClick}
                    className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-[var(--rd-ink)] px-1 py-3.5 text-center text-xs font-bold uppercase leading-tight tracking-wide text-[var(--rd-ink)] transition-colors active:border-[var(--rd-accent)] [@media(hover:hover)]:hover:border-[var(--rd-accent)] active:bg-[var(--rd-accent)] [@media(hover:hover)]:hover:bg-[var(--rd-accent)] active:text-white [@media(hover:hover)]:hover:text-white motion-reduce:transition-none ${onPaper}`}
                  >
                    <Icon name={a.icon} className="h-5 w-5" />
                    {a.label}
                  </button>
                </Reveal>
              ))}
            </div>
          </div>
          <ZigZag down />
        </section>

        {/* ---------- Below the purchase details ---------- */}
        <div className="space-y-7 px-4 pt-8">
          <BannerSlider />

          <CouponSection coupons={data.coupons} />

          <Reveal v="up">
            <FeedbackLink href={feedbackUrl} points={rewards.feedback} onClick={onFeedbackClick} />
          </Reveal>

          <Reveal v="right">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onRefer?.()}
              className={`rd-shine group flex items-center justify-between gap-4 rounded-3xl bg-[var(--rd-accent)] p-5 text-white shadow-[0_14px_28px_-14px_rgba(194,65,12,0.9)] transition-colors active:bg-white [@media(hover:hover)]:hover:bg-white active:text-[var(--rd-accent)] [@media(hover:hover)]:hover:text-[var(--rd-accent)] motion-reduce:transition-none ${onAccent}`}
            >
              <span>
                <span className={`${display.className} block text-[32px] uppercase leading-none tracking-wide`}>
                  <SplitText text="Refer a friend" step={38} d={150} />
                </span>
                <Reveal as="span" v="up" d={700} className="mt-2.5 block text-[15px] leading-snug">
                  Refer a friend and both of you earn {rewards.refer} reward points
                </Reveal>
              </span>
              <Reveal
                as="span"
                v="pop"
                d={600}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-[var(--rd-accent)] transition-colors group-active:bg-[var(--rd-accent)] [@media(hover:hover)]:group-hover:bg-[var(--rd-accent)] group-active:text-white [@media(hover:hover)]:group-hover:text-white motion-reduce:transition-none"
              >
                <Icon name="arrow" className="rd-nudge h-6 w-6" />
              </Reveal>
            </a>
          </Reveal>

          <section aria-label="Reach out to us">
            <h2 className={`${display.className} text-[28px] uppercase leading-none tracking-wide`}>
              <SplitText text="Reach out to us" step={34} />
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Reveal v="left" d={300}>
                <a href={`tel:${contact.callTo}`} className={outlineBtn}>
                  <Icon name="phone" className="h-[18px] w-[18px]" />
                  Talk to us
                </a>
              </Reveal>
              <Reveal v="right" d={450}>
                <a href={`mailto:${contact.writeTo}`} className={outlineBtn}>
                  <Icon name="mail" className="h-[18px] w-[18px]" />
                  Write to us
                </a>
              </Reveal>
            </div>
          </section>

          {/* ---------- Store: woven care label ---------- */}
          <Reveal v="up">
            <section
              aria-label="Store"
              className="rotate-1 bg-white p-1.5 text-[var(--rd-ink)] shadow-[0_14px_30px_-14px_rgba(46,46,46,0.45)]"
            >
              <div className="border-2 border-dashed border-black/50 px-4 py-3.5">
                <h2 className={`${display.className} text-[26px] uppercase leading-none tracking-wide`}>
                  <SplitText text={store.name} step={30} d={200} />
                </h2>
                <Reveal
                  as="p"
                  v="left"
                  d={500}
                  className={`${m} mb-3 mt-1.5 border-b border-dashed border-black/30 pb-3 text-xs font-semibold uppercase tracking-wide text-[var(--rd-accent)]`}
                >
                  {store.branch}
                </Reveal>
                <p className="flex items-start gap-2.5 text-base font-semibold leading-snug">
                  <Reveal as="span" v="pop" d={650} className="mt-0.5 shrink-0 text-[var(--rd-accent)]">
                    <Icon name="pin" className="h-5 w-5" />
                  </Reveal>
                  <Reveal as="span" v="up" d={750} className="min-w-0">
                    {store.address}
                  </Reveal>
                </p>

                <button
                  type="button"
                  onClick={() => setStoreOpen((o) => !o)}
                  aria-expanded={storeOpen}
                  aria-controls={storeId}
                  className={`mt-3 flex w-full items-center justify-between border-t-2 border-[var(--rd-ink)] pt-3 text-left transition-colors motion-reduce:transition-none ${onPaper} ${
                    storeOpen ? "text-[var(--rd-accent)]" : ""
                  }`}
                >
                  <span className={`${m} text-sm font-semibold uppercase tracking-wide`}>Store details</span>
                  <span aria-hidden="true" className={`${m} text-sm font-bold`}>
                    [{storeOpen ? "−" : "+"}]
                  </span>
                </button>
                <Collapse open={storeOpen} id={storeId}>
                  <dl className="space-y-2 pb-1 pt-3 text-sm">
                    <Leader label="Store code" value={store.code} strong d={0} />
                    <Leader
                      label="Phone no."
                      value={
                        <a href={`tel:${store.phone}`} className={`rounded active:text-[var(--rd-accent)] [@media(hover:hover)]:hover:text-[var(--rd-accent)] ${onPaper}`}>
                          {store.phone}
                        </a>
                      }
                      strong
                      d={120}
                    />
                    <Leader label="Store timing" value={store.timing} strong d={240} />
                    <Leader label="ABN" value={store.abn} strong d={360} />
                  </dl>
                </Collapse>

                <Reveal as="p" v="fade" d={900} className="mt-3 border-t border-dashed border-black/30 pt-3 text-xs text-[var(--rd-gray)]">
                  Legal name: <span className="font-semibold text-[var(--rd-ink)]">{store.legalName}</span>
                </Reveal>
              </div>
            </section>
          </Reveal>
        </div>

        {/* ---------- Bottom stub: terms, barcode, powered by ---------- */}
        <footer className="mt-10 text-[var(--rd-ink)]" style={{ filter: "drop-shadow(0 -6px 10px rgba(46,46,46,0.12))" }}>
          <ZigZag />
          <div className="bg-white px-5 pb-8 pt-5">
            <h2>
              <button
                type="button"
                aria-expanded={termsOpen}
                aria-controls={termsId}
                onClick={() => setTermsOpen((o) => !o)}
                className={`flex w-full items-center justify-between py-2 text-left transition-colors motion-reduce:transition-none ${onPaper} ${
                  termsOpen ? "text-[var(--rd-accent)]" : ""
                }`}
              >
                <span className={`${display.className} text-2xl uppercase leading-none tracking-wide`}>
                  <SplitText text="Terms and conditions" step={28} />
                </span>
                <span aria-hidden="true" className={`${m} text-sm font-bold`}>
                  [{termsOpen ? "−" : "+"}]
                </span>
              </button>
            </h2>
            <Collapse open={termsOpen} id={termsId}>
              <div className={`${m} space-y-3 pb-4 pt-3 text-xs leading-relaxed text-[var(--rd-gray)]`}>
                <Reveal as="p" v="up">
                  {terms.intro}
                </Reveal>
                <ol className="list-decimal space-y-2.5 pl-5">
                  {terms.list.map((t, i) => (
                    <Reveal as="li" key={t} v="left" d={i * 60}>
                      {t}
                    </Reveal>
                  ))}
                </ol>
                <Reveal as="p" v="up">
                  Customer care (free call): {contact.tollFree}, {contact.hours}
                </Reveal>
                <Reveal as="p" v="up">
                  Email – {contact.email}
                </Reveal>
                <Reveal as="p" v="up">
                  {terms.note}
                </Reveal>
              </div>
            </Collapse>

            <div className="mt-5 flex flex-col items-center gap-4 border-t border-dashed border-black/40 pt-6">
              <Reveal v="fade" className="flex w-full justify-center">
                {barcodeSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={barcodeSrc} alt="Receipt barcode" className="h-14 w-full max-w-xs object-contain" />
                ) : (
                  <PlaceholderBarcode seed={data.receiptId} />
                )}
              </Reveal>
              <div className="flex items-center gap-3 text-[13px] text-[var(--rd-gray)]">
                <Reveal as="span" v="right" d={300}>
                  Powered by
                </Reveal>
                <Reveal v="pop" d={600}>
                  <BrandImage
                    src={rdepLogoSrc}
                    alt="rdep"
                    width={240}
                    height={80}
                    className="h-8 w-auto"
                    fallbackClassName="text-xl font-extrabold tracking-tight text-[var(--rd-ink)]"
                  />
                </Reveal>
              </div>
            </div>
          </div>
        </footer>
      </main>

      {/* ---------------------------- Popups: white slips ---------------------------- */}
      {modal === "history" && (
        <Modal title="Transaction history" onClose={closeModal} scale={scale}>
          <ul className="divide-y divide-black/15">
            {history.map((h, i) => (
              <Reveal as="li" key={h.invoiceNo} v="left" d={250 + i * 90}>
                <button
                  type="button"
                  disabled={h.current}
                  onClick={() => {
                    closeModal();
                    onSelect(h.invoiceNo);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded py-3.5 text-left transition-colors motion-reduce:transition-none ${onPaper} ${
                    h.current ? "cursor-default" : "active:bg-[var(--rd-wash)] [@media(hover:hover)]:hover:bg-[var(--rd-wash)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-base font-semibold">
                      Invoice no: <span className={`${m} font-bold`}>{h.invoiceNo}</span>
                    </span>
                    <span className="mt-0.5 block text-sm text-[var(--rd-gray)]">
                      {h.date}, {h.store}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-right">
                      <span className={`${m} block text-base font-bold tabular-nums`}>${money(h.amount)}</span>
                      {h.current && (
                        <span className="mt-1 inline-block rounded-full bg-[var(--rd-accent)] px-2.5 py-0.5 text-xs font-bold text-white">This receipt</span>
                      )}
                    </span>
                    {!h.current && <Icon name="arrow" className="rd-nudge h-4 w-4 text-[var(--rd-accent)]" />}
                  </span>
                </button>
              </Reveal>
            ))}
          </ul>
        </Modal>
      )}

      {modal === "email" && (
        <Modal title="Email this receipt" onClose={closeModal} scale={scale}>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              onSendEmail?.(email, data);
              setSentTo(email);
            }}
          >
            <Reveal as="label" v="left" d={300} className="block">
              <span className={fieldLabel}>Email address</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setSentTo("");
                  setEmail(e.target.value);
                }}
                className={fieldInput}
                autoComplete="email"
              />
            </Reveal>
            <Reveal v="pop" d={450}>
              <button type="submit" className={accentBtn}>
                Send receipt
              </button>
            </Reveal>
            <p aria-live="polite" className="flex min-h-5 items-center justify-center gap-1.5 text-sm font-semibold">
              {sentTo && (
                <>
                  <Icon name="check" className="h-4 w-4 text-[var(--rd-accent)]" /> Receipt sent to {sentTo}
                </>
              )}
            </p>
          </form>
        </Modal>
      )}

      {modal === "tax" && (
        <Modal title="Tax calculation" onClose={closeModal} scale={scale}>
          <table className={`${m} w-full text-sm tabular-nums`}>
            <thead>
              <tr className="border-b-2 border-[var(--rd-ink)] text-xs text-[var(--rd-gray)]">
                <th className="py-2 text-left font-semibold">Tax</th>
                <th className="py-2 text-right font-semibold">Base amount</th>
                <th className="py-2 text-right font-semibold">Tax amount</th>
              </tr>
            </thead>
            <tbody>
              {data.tax.lines.map((l, i) => (
                <Reveal as="tr" key={`${l.type}-${l.rate}`} v="fade" d={300 + i * 110} className="border-b border-black/15">
                  <td className="py-3 font-bold">
                    {l.type} @ {l.rate}%
                  </td>
                  <td className="py-3 text-right">{money(l.base)}</td>
                  <td className="py-3 text-right">{money(l.amount)}</td>
                </Reveal>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className="pt-3" colSpan={2}>
                  Total GST
                </td>
                <td className="pt-3 text-right">
                  <CountUp to={gstTotal} format={money} d={600} />
                </td>
              </tr>
            </tfoot>
          </table>

          <dl className="mt-5 space-y-3 rounded-2xl bg-[var(--rd-wash)] p-4 text-sm">
            {[
              ["Store ABN", store.abn],
              ["State", data.tax.state],
              ["Prices include GST", "Yes"],
            ].map(([k, v], i) => (
              <Reveal key={k} v="left" d={600 + i * 120} className="flex items-baseline justify-between gap-4">
                <dt className="text-[var(--rd-gray)]">{k}</dt>
                <dd className="shrink-0 font-bold">{v}</dd>
              </Reveal>
            ))}
          </dl>

          <Reveal v="zoom" d={1000} className="rd-shine mt-5 flex items-end justify-between gap-3 rounded-2xl bg-[var(--rd-accent)] px-4 py-3.5 text-white">
            <span className={`${display.className} text-xl uppercase leading-none tracking-wide`}>Total</span>
            <span className={`${display.className} text-4xl leading-none tabular-nums`}>
              $<CountUp to={data.netTotal} format={money} d={1100} dur={1600} />
            </span>
          </Reveal>
        </Modal>
      )}
    </div>
  );
}

/* --------------------------------- main ------------------------------------------ */
/** Holds which receipt is open. Each receipt is a keyed ReceiptView, so switching resets the
 *  open item, popups, tabs, forms and replays every animation. */
export default function RdepReceipt({ data, receipts, onSelectReceipt, ...rest }: RdepReceiptProps) {
  const list = useMemo(() => {
    const base = receipts ?? (data ? [data] : sampleReceipts);
    const merged = data && !base.some((r) => r.invoiceNo === data.invoiceNo) ? [data, ...base] : base;
    return [...merged].sort((a, b) => dateValue(b.date) - dateValue(a.date));
  }, [data, receipts]);

  const [currentId, setCurrentId] = useState(data?.invoiceNo ?? list[0].invoiceNo);
  const current = list.find((r) => r.invoiceNo === currentId) ?? list[0];

  const history = useMemo(
    () =>
      list.map((r) => ({
        invoiceNo: r.invoiceNo,
        date: r.date.split(" ")[0],
        store: r.store.branch,
        amount: r.netTotal,
        current: r.invoiceNo === current.invoiceNo,
      })),
    [list, current.invoiceNo],
  );

  const select = useCallback(
    (invoiceNo: string) => {
      setCurrentId(invoiceNo);
      onSelectReceipt?.(invoiceNo);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [onSelectReceipt],
  );

  return <ReceiptView key={current.invoiceNo} data={current} history={history} onSelect={select} {...rest} />;
}
