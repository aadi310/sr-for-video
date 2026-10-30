"use client";

/**
 * Levi's x RDEP — Receipt redesign, Option 2: "Red Tab, Light"
 *
 * Concept: a poster on a warm light canvas. Big condensed greeting, then the marketing
 * carousel, the loyalty points section and the actual receipt as torn thermal paper (mono type,
 * dotted leaders, [+] / [−] toggles). White cards with soft shadows pop off the canvas, red is
 * used for emphasis and actions. Below the RedTab zone sits a woven care label for the store
 * (address always visible, code / phone / timing expand and collapse). The very bottom is a
 * white stub with the terms (open by default), barcode and "Powered by" logo. Popups are
 * white slips with the same torn top edge.
 *
 * Fixed layout: the receipt is designed at 400px wide. On phones (<= 520px) it is scaled with
 * CSS `zoom` to fill the screen, on larger screens it stays a centred 400px column, so it
 * looks identical everywhere.
 *
 * Colours: Levi's red, charcoal and white (plus warm neutral greys for the canvas and hairlines).
 *
 * What's in this version
 *  - Transaction history lists every receipt passed in `receipts`; tapping a row opens that
 *    receipt in place (the whole page switches to it and scrolls back to the top).
 *  - Download builds a standalone receipt document for the receipt on screen (same approach
 *    as the Y3 receipt). It has a "Save as PDF" button that opens the print dialog.
 *  - Feedback is a referral-style box with a star row that opens the Levi's feedback page.
 *  - Marketing carousel right after the greeting: an embedded YouTube video + the Levi's
 *    banner. The video autoplays (muted) when the section is on screen; once it plays, the
 *    carousel stops auto-advancing until someone swipes / taps a dot.
 *
 * Needs (in /public):
 *   customers/Levi's Logo.png
 *   rdep-dark-logo.png
 *   images/levis-banner.png (1920x1080)
 * Stack: Next.js (app router) + Tailwind. No other dependencies.
 *
 * Usage:  app/levis-receipt-2/page.tsx
 *   import LevisReceiptV2 from "@/components/LevisReceiptV2";
 *   export default function Page() { return <LevisReceiptV2 />; }
 *
 * With real data: <LevisReceiptV2 receipts={[...]} data={currentReceipt} />
 *   `receipts` = every receipt of this customer (the history popup is built from it).
 *   `data`     = the receipt to open first (defaults to the newest one in `receipts`).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import Image from "next/image";
import { Anton, Inter, JetBrains_Mono } from "next/font/google";

/* Type system: Anton for poster headlines and big numbers, Inter for readable UI copy,
 * JetBrains Mono for the printed-receipt lines. Body copy is 15px+, small print 12px. */
const display = Anton({ subsets: ["latin"], weight: "400", display: "swap" });
const body = Inter({ subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap" });

/* Brand tokens: Levi's red + charcoal on a warm light canvas. Alpha tints inline the hex. */
const theme = {
  "--lv-red": "#C41230",
  "--lv-red-dark": "#A50F28",
  "--lv-black": "#2E2E2E", // charcoal: text, outlines, buttons
  "--lv-canvas": "#F3F0EA", // the receipt column background
  "--lv-page": "#E3DFD7", // page behind the column on desktop
  "--lv-card": "#FFFFFF", // cards
  "--lv-wash": "#F3F0EA", // tiles and hovers inside white cards
  "--lv-line": "#E2DED9", // hairlines
  "--lv-gray": "#666666", // muted text
} as CSSProperties;

/* Asset + link defaults. The Levi's file name has a space and an apostrophe, so it is URL-encoded. */
const DEFAULT_LEVIS_LOGO = encodeURI("/images/levis-logo.png");
const DEFAULT_RDEP_LOGO = "/images/rdep-logo.png";
const DEFAULT_FEEDBACK_URL = "https://levis.ercollecta.com/Tably/Feedback/VoiceOfcustomers/en/Feedback.aspx";

/* Marketing carousel. Slide order = array order. The video is first so it can autoplay as soon as
 * the section is on screen; put "image" first if you want the banner to lead instead. */
const MARKETING_BANNER = "/images/levis-banner.png"; // 1920x1080
const MARKETING_VIDEO_ID = "fRXDPnzFuzQ"; // https://youtu.be/fRXDPnzFuzQ
const MARKETING_SLIDES = ["video", "image"] as const;
const MARKETING_IMAGE_MS = 4000; // how long the banner stays before the carousel moves on

/* ------------------------------- types ------------------------------------------- */
export interface ReceiptItem {
  name: string;
  qty: number;
  mrp: number;
  net: number;
  code: string;
  hsn: string;
  size: string;
  inseam?: string;
}

export interface LevisReceipt {
  invoiceNo: string;
  receiptId: string;
  /** "DD-MM-YYYY HH:mm:ss" — the date part is used to sort the history */
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
  };
  customer: { firstName: string; mobile: string };
  items: ReceiptItem[];
  subTotal: number;
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
    lines: { type: "CGST" | "SGST"; rate: number; base: number; amount: number }[];
    customerGst: string;
    placeOfSupply: string;
    reverseCharge: string;
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

export interface LevisReceiptProps {
  /** Receipt to open first. Defaults to the newest receipt in `receipts`. */
  data?: LevisReceipt;
  /** All receipts of this customer. Drives the history popup; tapping a row opens that receipt. */
  receipts?: LevisReceipt[];
  /** Real QR image URL (a placeholder is drawn if omitted) */
  qrSrc?: string;
  /** Real barcode image URL (a placeholder is drawn if omitted) */
  barcodeSrc?: string;
  logoSrc?: string;
  rdepLogoSrc?: string;
  /** Where the feedback box sends the customer */
  feedbackUrl?: string;
  /** Overrides the built-in download. Receives the receipt currently on screen. */
  onDownloadPdf?: (receipt: LevisReceipt) => void;
  onSendEmail?: (email: string, receipt: LevisReceipt) => void;
  onUpdateProfile?: (values: ProfileForm) => void;
  onFeedbackClick?: () => void;
  onRefer?: () => void;
  /** Fires when a receipt is opened from the history popup */
  onSelectReceipt?: (invoiceNo: string) => void;
}

type IconName =
  | "history" | "mail" | "download" | "star" | "users" | "coins" | "trend"
  | "gift" | "alert" | "phone" | "close" | "chevron" | "ticket" | "check"
  | "pin" | "clock" | "hash" | "store" | "arrow";
type TabId = "points" | "profile" | "coupon";
type ModalId = "history" | "email" | "tax" | null;

/* ------------------------------- helpers ----------------------------------------- */
const inr = (n: number): string => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = (n: number): string => String(Number(n.toFixed(2)));
const round2 = (n: number): number => Math.round(n * 100) / 100;

// Apparel GST slab: 5% up to ₹2,500 per piece, 18% above (matches the figures on the current receipt)
const slabFor = (item: ReceiptItem): number => (item.net / item.qty > 2500 ? 18 : 5);

function derive(item: ReceiptItem) {
  const rate = slabFor(item);
  const base = item.net / (1 + rate / 100);
  const half = rate / 2;
  const tax = (base * half) / 100;
  const gross = item.mrp * item.qty;
  const disc = gross - item.net;
  return { rate, base, half, tax, discountPct: (disc / gross) * 100, discountAmt: disc };
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
  `Hey, Use my referral code *${code}* and register for Levi's Redtab member program to enjoy exclusive benefits like earning points on every transaction, birthday surprises, special offers & more! Sign up here: ${url} We both earn ${points} reward points once you register successfully. Let's shop together! *T&C apply.`;

/** Groups items by GST slab. Base + CGST + SGST adds up exactly to the items' net amounts. */
function buildTax(items: ReceiptItem[]) {
  const by = new Map<number, { net: number; base: number }>();
  items.forEach((item) => {
    const d = derive(item);
    const row = by.get(d.rate) ?? { net: 0, base: 0 };
    row.net += item.net;
    row.base += d.base;
    by.set(d.rate, row);
  });
  const slabs = [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => {
      const base = round2(v.base);
      const tax = round2(v.net - base);
      const cgst = round2(tax / 2);
      return { rate, base, cgst, sgst: round2(tax - cgst) };
    });
  return {
    subTotal: round2(slabs.reduce((a, x) => a + x.base, 0)),
    lines: [
      ...slabs.map((x) => ({ type: "CGST" as const, rate: x.rate / 2, base: x.base, amount: x.cgst })),
      ...slabs.map((x) => ({ type: "SGST" as const, rate: x.rate / 2, base: x.base, amount: x.sgst })),
    ],
  };
}

/** "24-05-2026 20:34:17" -> timestamp (date part only), used to sort the history newest first. */
function dateValue(d: string): number {
  const [dd, mm, yyyy] = d.split(" ")[0].split("-").map(Number);
  return Date.UTC(yyyy, (mm || 1) - 1, dd || 1);
}

const shortStore = (branch: string): string => branch.replace(/^SSIPL\s*-\s*/i, "").replace(/-/g, " - ");

/* ---------------------------- downloadable receipt ------------------------------- */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Standalone, print-ready HTML for one receipt. The "Save as PDF" button inside it opens the print dialog. */
function buildReceiptHtml(r: LevisReceipt, logoSrc: string, rdepLogoSrc: string): string {
  const abs = (p: string) => (/^(https?:|data:)/.test(p) ? p : `${window.location.origin}${p}`);
  const cgst = round2(r.tax.lines.filter((l) => l.type === "CGST").reduce((a, l) => a + l.amount, 0));
  const sgst = round2(r.tax.lines.filter((l) => l.type === "SGST").reduce((a, l) => a + l.amount, 0));

  const itemRows = r.items
    .map((item) => {
      const d = derive(item);
      return `<tr>
        <td><div class="n">${esc(item.name)}</div>
          <div class="s">Code ${esc(item.code)} &middot; HSN ${esc(item.hsn)} &middot; Size ${esc(item.size)}${item.inseam ? ` &middot; Inseam ${esc(item.inseam)}` : ""}</div></td>
        <td class="r">${item.qty}</td>
        <td class="r">${inr(item.mrp * item.qty)}</td>
        <td class="r">${trim(d.discountPct)}%</td>
        <td class="r b">${inr(item.net)}</td>
      </tr>`;
    })
    .join("");

  const taxRows = r.tax.lines
    .map((l) => `<tr><td>${l.type} @ ${l.rate}%</td><td class="r">${inr(l.base)}</td><td class="r">${inr(l.amount)}</td></tr>`)
    .join("");

  const payRows = r.payments
    .map((p) => `<div class="row"><span>${esc(p.mode)}</span><strong>${inr(p.amount)}</strong></div>`)
    .join("");

  const terms = r.terms.list.map((t) => `<li>${esc(t)}</li>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Levi's Receipt ${esc(r.invoiceNo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',Arial,sans-serif;font-size:14px;color:#2E2E2E;background:#FAF9F7;max-width:780px;margin:0 auto;padding:24px;}
.bar{display:flex;justify-content:flex-end;margin-bottom:16px;}
.bar button{background:#C41230;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:600 13px 'Inter',Arial,sans-serif;cursor:pointer;}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:16px;border-bottom:4px solid #C41230;margin-bottom:20px;}
.head img{height:48px;width:auto;}
.head h1{font-size:26px;color:#C41230;text-transform:uppercase;letter-spacing:.5px;margin-top:10px;}
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
.net{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:12px 14px;background:#C41230;color:#fff;}
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

<div class="head">
  <div>
    <img src="${esc(abs(logoSrc))}" alt="Levi's" onerror="this.style.display='none'">
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
  <div>${esc(r.store.legalName)}</div>
</div>

<div class="cust"><strong>Customer:</strong> ${esc(r.customer.firstName)} &middot; ${esc(r.customer.mobile)}</div>

<table class="items">
  <thead><tr><th style="width:46%">Item</th><th class="r">Qty</th><th class="r">MRP</th><th class="r">Disc.</th><th class="r">Net amount</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="cols">
  <div class="col">
    <h3>Tax calculation</h3>
    <table class="tax">
      <thead><tr><th>Tax</th><th class="r">Base amount</th><th class="r">Tax amount</th></tr></thead>
      <tbody>${taxRows}</tbody>
    </table>
    <div class="pts">Customer GST: ${esc(r.tax.customerGst)} &middot; Place of supply: ${esc(r.tax.placeOfSupply)} &middot; Reverse charge: ${esc(r.tax.reverseCharge)}</div>
  </div>
  <div class="col">
    <h3>Summary</h3>
    <div class="row"><span>Sub total</span><strong>${inr(r.subTotal)}</strong></div>
    <div class="row"><span>CGST</span><strong>+ ${inr(cgst)}</strong></div>
    <div class="row"><span>SGST</span><strong>+ ${inr(sgst)}</strong></div>
    <div class="net"><span>Net total</span><strong>&#8377;${inr(r.netTotal)}</strong></div>
    <div class="row" style="margin-top:8px"><span>Pieces purchased</span><strong>${r.pieces}</strong></div>
    <h3 style="margin-top:16px">Payment</h3>
    ${payRows}
  </div>
</div>

<div class="pts">RedTab points &mdash; earned: ${r.points.earned} &middot; redeemed: ${r.points.redeemed} &middot; available: ${r.points.available}</div>

<div class="terms">
  <strong>Terms and conditions</strong>
  <p>${esc(r.terms.intro)}</p>
  <ol>${terms}</ol>
  <p>Customer toll free no- ${esc(r.contact.tollFree)}, ${esc(r.contact.hours)} &middot; Email &ndash; ${esc(r.contact.email)}</p>
  <p>${esc(r.terms.note)}</p>
</div>

<div class="foot">Thank you for shopping at Levi's!<br><br>Powered by <img src="${esc(abs(rdepLogoSrc))}" alt="rdep" onerror="this.style.display='none'"></div>
</body>
</html>`;
}

function downloadReceipt(r: LevisReceipt, logoSrc: string, rdepLogoSrc: string) {
  const blob = new Blob([buildReceiptHtml(r, logoSrc, rdepLogoSrc)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Levis_Receipt_${r.invoiceNo}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ----------------------------------------------------------------------------------
 * Sample data (shape mirrors the current receipt). Receipt 7019 is the real one; the other
 * two receipts (and the codes / HSN / sizes of the extra items) are SAMPLE values for the
 * history popup. Replace with the real API response.
 * -------------------------------------------------------------------------------- */
const SAMPLE_COMMON = {
  customer: { firstName: "Rashid", mobile: "9993587328" },
  rewards: { feedback: 50, refer: 100, profile: 50 },
  contact: {
    tollFree: "1800 1020 501",
    hours: "Mon-Fri, 10AM to 6 PM",
    email: "feedback@levi.com",
    callTo: "+919620921294",
    writeTo: "sagar.p@proenx.com",
  },
  referral: { code: "LEV12WU0SE", signupUrl: "https://levisredtabmemberin.erlpaas.com/" },
  terms: {
    intro:
      "We hope you love your Levi's® product. In case you are not satisfied, you may present the sale invoice and exchange the product within 14 days from the date of purchase*. Subject to the terms and conditions listed below, products can only be exchanged and under no circumstances can any amount be refunded.",
    list: [
      "Products may be exchanged only if returned in saleable condition. The store reserves the right to decide if the item is in saleable conditions and can be exchanged.",
      "Product can only be exchanged with another Product of the same or higher value, with the price difference being paid by the customer.",
      "All product hang tags including price tags and labels must be intact while requesting for exchange.",
      "Products purchased during the End of Season sale cannot be exchanged.",
      "Accessories and Innerwear cannot be exchanged.",
      "Products purchased from a Levi's exclusive store can be exchanged across any Levi's exclusive store in India.",
      "Products personalized, customized, or altered by the customer cannot be exchanged.",
      "Please follow care/ usage instructions.",
      "This Exchange and Return Policy and these Terms and Conditions are subject to applicable laws, regulations, and Govt. notifications, issued from time to time.",
      "Red Tab+ Members may exchange any product within 90 days from the date of purchase.",
    ],
    note: "Note: Any disputes will be subject to the exclusive jurisdictions of the courts in Bangalore, Karnataka.",
  },
};

const STORE_DURGAPUR: LevisReceipt["store"] = {
  name: "Levi's Exclusive Store",
  branch: "SSIPL - Durgapur-Junction Mall",
  address: "Levi's Store, UGF-12, Junction Mall, City Center, Durgapur, West Bengal",
  code: "0020043690",
  phone: "03432544257",
  timing: "10:00 AM to 10:00 PM",
  legalName: "SSIPL LIFESTYLE PRIVATE LIMITED",
};

// SAMPLE store details
const STORE_KOLKATA: LevisReceipt["store"] = {
  name: "Levi's Exclusive Store",
  branch: "SSIPL - Kolkata-Quest Mall",
  address: "Levi's Store, Quest Mall, Syed Amir Ali Avenue, Park Circus, Kolkata, West Bengal",
  code: "0020043721",
  phone: "03322878800",
  timing: "11:00 AM to 10:00 PM",
  legalName: "SSIPL LIFESTYLE PRIVATE LIMITED",
};

function makeReceipt(o: {
  invoiceNo: string;
  receiptId: string;
  date: string;
  cashier: string;
  store: LevisReceipt["store"];
  items: ReceiptItem[];
  payments: LevisReceipt["payments"];
  points: LevisReceipt["points"];
}): LevisReceipt {
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
    tax: { lines: tax.lines, customerGst: "Unregistered", placeOfSupply: "West Bengal", reverseCharge: "No" },
  };
}

export const sampleLevisReceipts: LevisReceipt[] = [
  makeReceipt({
    invoiceNo: "7019",
    receiptId: "202605244369017019",
    date: "24-05-2026 20:34:17",
    cashier: "475117",
    store: STORE_DURGAPUR,
    items: [
      { name: "BLR_MT_STANDARD FIT TEE SP VARSITY BRAND", qty: 1, mrp: 2199, net: 1889.97, code: "A797302560M", hsn: "61091000", size: "M" },
      { name: "BLR MB 511 SLIM ALOKI", qty: 1, mrp: 3789, net: 3256.52, code: "A112340071", hsn: "62034200", size: "32", inseam: "32" },
      { name: "BNG MT CL1PKT_TRIM SHRT L/S CLASSIC REGU", qty: 1, mrp: 3299, net: 2835.38, code: "A558120044", hsn: "62052000", size: "L" },
    ],
    payments: [
      { mode: "CASH", amount: 1981.87 },
      { mode: "QCLVR", amount: 6000 },
    ],
    points: { available: 1951, earned: 917, redeemed: 0, expiring: { points: 1034, on: "12 Jan 2027" } },
  }),
  makeReceipt({
    invoiceNo: "6488",
    receiptId: "202602114369016488",
    date: "11-02-2026 18:12:45",
    cashier: "475102",
    store: STORE_DURGAPUR,
    items: [
      { name: "BLR MB 512 SLIM TAPER ARMANI", qty: 1, mrp: 4999, net: 4299, code: "A346780012", hsn: "62034200", size: "32", inseam: "32" },
    ],
    payments: [{ mode: "QCLVR", amount: 4299 }],
    points: { available: 1034, earned: 430, redeemed: 0, expiring: { points: 604, on: "30 Nov 2026" } },
  }),
  makeReceipt({
    invoiceNo: "5921",
    receiptId: "202512294372015921",
    date: "29-12-2025 16:05:09",
    cashier: "475231",
    store: STORE_KOLKATA,
    items: [
      { name: "BLR MT SLIM FIT TEE CORE LOGO", qty: 1, mrp: 2299, net: 1899, code: "A203450087", hsn: "61091000", size: "L" },
      { name: "BLR MJ TRUCKER JACKET RINSE", qty: 1, mrp: 6999, net: 5998, code: "A671120931", hsn: "62019300", size: "M" },
    ],
    payments: [
      { mode: "CASH", amount: 1897 },
      { mode: "QCLVR", amount: 6000 },
    ],
    points: { available: 604, earned: 790, redeemed: 0, expiring: { points: 604, on: "05 Dec 2026" } },
  }),
];

/** Kept for backwards compatibility: the newest sample receipt. */
export const sampleLevisReceipt: LevisReceipt = sampleLevisReceipts[0];

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
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
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
  chevron: <path d="m6 9 6 6 6-6" />,
  ticket: (
    <>
      <path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
      <path d="M9 9h6M9 12h6M9 15h3" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  hash: <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />,
  store: (
    <>
      <path d="m3 9 1.5-5h15L21 9" />
      <path d="M4 9v11h16V9" />
      <path d="M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
};

function Icon({ name, className = "h-5 w-5", filled = false }: { name: IconName; className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
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
      {bars.map(([x, w]) => (
        <rect key={x} x={x} y="0" width={w} height="56" />
      ))}
    </svg>
  );
}

/* --------------------------------- shared ---------------------------------------- */
const onPaper = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lv-red)]";
const onRed = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Soft lift so white cards pop off the light canvas. */
const lift = "border border-black/5 shadow-[0_10px_28px_-14px_rgba(46,46,46,0.4)]";

/* Inputs use 16px text so iOS does not zoom the page on focus. */
const fieldInput =
  "w-full border-0 border-b-2 border-black/25 bg-transparent px-0 py-2.5 text-base text-[var(--lv-black)] outline-none transition-colors placeholder:text-black/40 focus:border-[var(--lv-red)]";
const fieldLabel = "mb-1 block text-[13px] font-medium text-[var(--lv-gray)]";
const redBtn = `w-full rounded-xl bg-[var(--lv-red)] py-4 text-sm font-bold uppercase tracking-wide text-white transition-colors active:bg-[var(--lv-red-dark)] [@media(hover:hover)]:hover:bg-[var(--lv-red-dark)] motion-reduce:transition-none ${onPaper}`;
const outlineBtn = `flex items-center justify-center gap-2 rounded-xl border-2 border-[var(--lv-black)] bg-white py-4 text-sm font-bold uppercase tracking-wide text-[var(--lv-black)] transition-colors active:border-[var(--lv-red)] [@media(hover:hover)]:hover:border-[var(--lv-red)] active:bg-[var(--lv-red)] [@media(hover:hover)]:hover:bg-[var(--lv-red)] active:text-white [@media(hover:hover)]:hover:text-white motion-reduce:transition-none ${onPaper}`;

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

/** Logo image that falls back to a text wordmark instead of a broken-image icon.
 *  `width`/`height` are the intrinsic size hints Next uses to pick sharp srcset variants,
 *  so keep them at roughly 2x the displayed size. */
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

/** Label ...... value, like a printed receipt line. */
function Leader({ label, value, strong = false, className = "" }: { label: ReactNode; value: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <dt className="flex min-w-0 flex-1 items-baseline gap-2 after:mb-[3px] after:h-0 after:min-w-3 after:flex-1 after:border-b after:border-dotted after:border-current after:opacity-40 after:content-['']">
        {label}
      </dt>
      <dd className={`shrink-0 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

/** Height-animated disclosure body (respects reduced motion). */
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

/** Popups are white slips with a torn top edge, matching the receipt paper. */
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#2E2E2E]/55 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${body.className} max-h-[88vh] w-full overflow-y-auto outline-none sm:w-[400px]`}
      >
        <div className="w-full sm:w-[400px]" style={zoomStyle(scale)}>
          <ZigZag />
          <div className="bg-white px-5 pb-7 pt-4 text-[var(--lv-black)] sm:rounded-b-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className={`${display.className} text-[28px] uppercase leading-none tracking-wide`}>
                  {title}
                </h2>
                <span aria-hidden="true" className="mt-2.5 block h-1 w-12 bg-[var(--lv-red)]" />
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--lv-black)] text-white transition-colors active:bg-[var(--lv-red)] [@media(hover:hover)]:hover:bg-[var(--lv-red)] motion-reduce:transition-none ${onPaper}`}
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
function PaperItem({ item, open, onToggle }: { item: ReceiptItem; open: boolean; onToggle: () => void }) {
  const d = useMemo(() => derive(item), [item]);
  const panelId = useId();
  const m = mono.className;
  return (
    <li className="border-b border-dashed border-black/40 py-3.5 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2.5 rounded text-left ${onPaper}`}
      >
        <span aria-hidden="true" className={`${m} text-[13px] font-bold leading-snug text-[var(--lv-red)]`}>
          [{open ? "−" : "+"}]
        </span>
        <span className="min-w-0">
          <span className={`${m} block text-[13px] font-semibold uppercase leading-snug`}>{item.name}</span>
          <span className={`${m} mt-1 block text-xs text-[var(--lv-gray)]`}>
            QTY {item.qty} &nbsp; MRP {item.mrp.toLocaleString("en-IN")}
          </span>
        </span>
        <span className={`${m} text-sm font-bold leading-snug tabular-nums`}>{inr(item.net)}</span>
      </button>

      <Collapse open={open} id={panelId}>
        <div className={`${m} ml-8 mt-3 space-y-2.5 border-l-2 border-[var(--lv-red)] pl-3 text-xs`}>
          <dl className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--lv-gray)]">Item code</dt>
            <dd className="text-[13px] font-bold tracking-wide">{item.code}</dd>
          </dl>

          <dl className="grid grid-cols-4 divide-x divide-black/15 rounded-md border border-black/15">
            {(
              [
                ["HSN", item.hsn],
                ["UoM", "Pcs"],
                ["Size", item.size],
                ["Inseam", item.inseam ?? "-"],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="min-w-0 px-1.5 py-1.5">
                <dt className="text-[var(--lv-gray)]">{k}</dt>
                <dd className="mt-0.5 font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-[#C41230]/10 px-2.5 py-1.5 text-[var(--lv-red)]">
              <dt>Discount %</dt>
              <dd className="mt-0.5 text-[13px] font-bold tabular-nums">{trim(d.discountPct)}</dd>
            </div>
            <div className="rounded-md bg-[#C41230]/10 px-2.5 py-1.5 text-[var(--lv-red)]">
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
              <tr className="text-[var(--lv-gray)]">
                <th className="pb-1 text-left font-medium">Tax</th>
                <th className="pb-1 text-right font-medium">%</th>
                <th className="pb-1 text-right font-medium">Base amount</th>
                <th className="pb-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="border-t border-black/15">
              {(["SGST", "CGST"] as const).map((t) => (
                <tr key={t} className="border-b border-black/10 last:border-b-0">
                  <td className="py-1.5 font-bold">{t}</td>
                  <td className="py-1.5 text-right">{trim(d.half)}</td>
                  <td className="py-1.5 text-right">{trim(d.base)}</td>
                  <td className="py-1.5 text-right font-bold">{trim(d.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapse>
    </li>
  );
}

/* ------------------------------- feedback ---------------------------------------- */
/** Referral-style box: a row of stars that fills in on a loop (no hover needed, so it works on
 *  phones). The whole card opens the Levi's feedback page. */
function FeedbackLink({ href, points, onClick }: { href: string; points: number; onClick?: () => void }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onClick?.()}
      aria-label={`Share your shopping experience feedback and earn ${points} RedTab points (opens in a new tab)`}
      className={`flex items-center justify-between gap-4 rounded-3xl bg-white p-5 text-[var(--lv-black)] transition active:scale-[0.99] active:border-[var(--lv-red)] motion-reduce:transition-none ${lift} ${onPaper}`}
    >
      <span className="min-w-0">
        <span className={`${display.className} block text-[32px] uppercase leading-[1.05] tracking-wide`}>Rate your visit</span>
        <span aria-hidden="true" className="mt-3 flex gap-1.5 text-[var(--lv-red)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <svg
              key={i}
              viewBox="0 0 24 24"
              strokeWidth="1.6"
              strokeLinejoin="round"
              style={{ animationDelay: `${i * 0.22}s` }}
              className="lv-star h-7 w-7 stroke-current"
            >
              {PATHS.star}
            </svg>
          ))}
        </span>
        <span className="mt-3 block text-[15px] leading-snug text-[var(--lv-gray)]">
          Tell us about your shopping experience and earn {points} RedTab points
        </span>
      </span>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--lv-red)] text-white">
        <Icon name="arrow" className="h-6 w-6" />
      </span>
    </a>
  );
}

/* --------------------------- marketing carousel ---------------------------------- */
/* Minimal typings for the YouTube IFrame Player API (loaded on demand, no npm package). */
interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number; // 1 = playing
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}
interface YtPlayerEvent {
  target: YtPlayer;
  data: number;
}
interface YtNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: (e: YtPlayerEvent) => void; onStateChange?: (e: YtPlayerEvent) => void };
    },
  ) => YtPlayer;
}
declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YtNamespace> | null = null;

/** Loads https://www.youtube.com/iframe_api once and resolves with the YT namespace. */
function loadYouTubeApi(): Promise<YtNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytApiPromise) {
    ytApiPromise = new Promise<YtNamespace>((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (window.YT) resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        ytApiPromise = null;
        reject(new Error("YouTube API failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return ytApiPromise;
}

/** True while the element is inside the viewport (expanded by `rootMargin`, needs `threshold` visible). */
function useInView<T extends Element>(ref: RefObject<T | null>, rootMargin: string, threshold: number): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin, threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, threshold]);
  return inView;
}

/** Carousel with the YouTube video (embedded, plays in place) and the Levi's banner.
 *  - The video autoplays (muted, as browsers require) as soon as its slide is on screen, and
 *    pauses when the slide or the section leaves the screen.
 *  - Once the video has played, the carousel stops auto-advancing. Swiping, or tapping a dot,
 *    turns auto-advance back on.
 *  - The video's top area is covered by a transparent layer so swipes work over the video
 *    (iframes swallow touches); a tap on it toggles play / pause. The bottom strip is left
 *    free for YouTube's own controls (volume, fullscreen, ...). */
function MarketingCarousel() {
  const count = MARKETING_SLIDES.length;
  const sectionRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [armed, setArmed] = useState(false);
  const [ready, setReady] = useState(false);

  const near = useInView(sectionRef, "300px 0px", 0); // start loading the player a little early
  const visible = useInView(sectionRef, "0px", 0.5); // "on this section" = at least half visible
  const onVideo = MARKETING_SLIDES[index] === "video";

  useEffect(() => {
    if (near) setArmed(true);
  }, [near]);

  // Create the embedded player once the section is close to the screen.
  useEffect(() => {
    const host = hostRef.current;
    if (!armed || !host) return;
    let cancelled = false;
    let player: YtPlayer | null = null;
    const mount = document.createElement("div");
    host.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(mount, {
          videoId: MARKETING_VIDEO_ID,
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 0, mute: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              playerRef.current = e.target;
              setReady(true);
            },
            // Video started playing (autoplay or a manual tap): stop the carousel from moving on.
            onStateChange: (e) => {
              if (e.data === 1) setAutoAdvance(false);
            },
          },
        });
      })
      .catch(() => {
        /* API blocked or offline: the thumbnail stays and the banner slide still works */
      });
    return () => {
      cancelled = true;
      playerRef.current = null;
      setReady(false);
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
      mount.remove();
    };
  }, [armed]);

  // Play the video while its slide is on screen, pause it otherwise.
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p) return;
    p.getIframe().tabIndex = onVideo ? 0 : -1;
    if (onVideo && visible) p.playVideo();
    else p.pauseVideo();
  }, [ready, onVideo, visible]);

  // Auto-advance only from the banner (the video slide never auto-advances) and only until the
  // video has played; swiping or tapping a dot turns it back on.
  useEffect(() => {
    if (!autoAdvance || !visible || onVideo) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % count), MARKETING_IMAGE_MS);
    return () => window.clearTimeout(t);
  }, [autoAdvance, visible, onVideo, index, count]);

  const goTo = useCallback(
    (i: number) => {
      setAutoAdvance(true);
      setIndex(((i % count) + count) % count);
    },
    [count],
  );

  const togglePlayback = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.getPlayerState() === 1) p.pauseVideo();
    else p.playVideo();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    startRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    startRef.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
      goTo(index + (dx < 0 ? 1 : -1));
      return;
    }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && (e.target as HTMLElement).dataset.tapZone !== undefined) togglePlayback();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft") goTo(index - 1);
    else if (e.key === "ArrowRight") goTo(index + 1);
  };

  return (
    <section ref={sectionRef} aria-roledescription="carousel" aria-label="Levi's highlights" onKeyDown={onKeyDown}>
      <div
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          startRef.current = null;
        }}
        className={`relative touch-pan-y select-none overflow-hidden rounded-3xl bg-black ${lift}`}
      >
        <div
          className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {MARKETING_SLIDES.map((kind, i) => (
            <div
              key={kind}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== index}
              className="relative aspect-video w-full shrink-0"
            >
              {kind === "image" ? (
                <Image
                  src={MARKETING_BANNER}
                  alt="Levi's marketing banner"
                  width={1920}
                  height={1080}
                  sizes="(max-width: 520px) 100vw, 400px"
                  draggable={false}
                  className="pointer-events-none block h-full w-full select-none object-cover"
                />
              ) : (
                <div
                  className="relative h-full w-full bg-[#111] bg-cover bg-center"
                  style={{ backgroundImage: `url(https://i.ytimg.com/vi/${MARKETING_VIDEO_ID}/hqdefault.jpg)` }}
                >
                  <div ref={hostRef} className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />
                  <div data-tap-zone="" aria-hidden="true" className="absolute inset-x-0 top-0 bottom-[20%] cursor-pointer touch-pan-y" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex justify-center gap-1">
        {MARKETING_SLIDES.map((kind, i) => (
          <button
            key={kind}
            type="button"
            aria-label={`Show ${kind === "video" ? "video" : "banner"} (slide ${i + 1} of ${count})`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => goTo(i)}
            className={`grid h-6 w-8 place-items-center rounded-full ${onPaper}`}
          >
            <span
              className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${
                i === index ? "w-6 bg-[var(--lv-red)]" : "w-2 bg-black/25"
              }`}
            />
          </button>
        ))}
      </div>
    </section>
  );
}

/* --------------------------- RedTab tabs section --------------------------------- */
/* Two lines each, always, so the three tabs line up. */
const TABS: { id: TabId; lines: [string, string] }[] = [
  { id: "points", lines: ["My RedTab", "Points"] },
  { id: "profile", lines: ["Update", "Profile"] },
  { id: "coupon", lines: ["Available", "Coupon"] },
];

function RedTabSection({
  data,
  onUpdateProfile,
}: {
  data: LevisReceipt;
  onUpdateProfile?: (values: ProfileForm) => void;
}) {
  const [tab, setTab] = useState<TabId>("points");
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<ProfileForm>({ firstName: data.customer.firstName, lastName: "", birthday: "", gender: "", email: "" });
  const set = (k: keyof ProfileForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const { points, rewards } = data;

  return (
    <section aria-label="RedTab" className="text-[var(--lv-black)]">
      <div role="tablist" aria-label="RedTab" className="grid grid-cols-3 gap-4 border-b-2 border-black/10">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`${display.className} relative pb-3.5 text-left text-lg uppercase leading-[1.15] tracking-wide transition-colors motion-reduce:transition-none ${onPaper} ${
                active ? "text-[var(--lv-black)]" : "text-[var(--lv-gray)] active:text-[var(--lv-black)] [@media(hover:hover)]:hover:text-[var(--lv-black)]"
              }`}
            >
              <span className="block">{t.lines[0]}</span>
              <span className="block">{t.lines[1]}</span>
              {active && <span aria-hidden="true" className="absolute -bottom-0.5 left-0 right-0 h-1 bg-[var(--lv-red)]" />}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === "points" && (
          <div role="tabpanel" id="panel-points" aria-labelledby="tab-points" className="space-y-3">
            <div className={`rounded-3xl bg-white p-5 ${lift}`}>
              <p className="text-sm font-medium text-[var(--lv-gray)]">Available points</p>
              <p className={`${display.className} mt-1 text-[72px] leading-[0.95] tabular-nums`}>
                {points.available.toLocaleString("en-IN")}
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--lv-line)] pt-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--lv-wash)] text-[var(--lv-red)]">
                    <Icon name="trend" className="h-5 w-5" />
                  </span>
                  <div>
                    <dd className={`${display.className} text-[30px] leading-none tabular-nums`}>{points.earned.toLocaleString("en-IN")}</dd>
                    <dt className="mt-1 text-[13px] text-[var(--lv-gray)]">Earned points</dt>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--lv-wash)] text-[var(--lv-red)]">
                    <Icon name="gift" className="h-5 w-5" />
                  </span>
                  <div>
                    <dd className={`${display.className} text-[30px] leading-none tabular-nums`}>{points.redeemed.toLocaleString("en-IN")}</dd>
                    <dt className="mt-1 text-[13px] text-[var(--lv-gray)]">Redeemed points</dt>
                  </div>
                </div>
              </dl>
            </div>
            <div className="flex items-center gap-4 rounded-3xl bg-[var(--lv-red)] p-5 text-white shadow-[0_12px_26px_-14px_rgba(196,18,48,0.9)]">
              <Icon name="alert" className="h-9 w-9 shrink-0" />
              <p className="text-[15px]">
                <span className={`${display.className} block text-[28px] leading-none tabular-nums tracking-wide`}>
                  {points.expiring.points.toLocaleString("en-IN")} points
                </span>
                <span className="mt-1.5 block">
                  Expiring on <span className="font-bold">{points.expiring.on}</span>
                </span>
              </p>
            </div>
          </div>
        )}

        {tab === "profile" && (
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
            <p className="text-lg font-semibold leading-snug">
              Update your profile now to earn{" "}
              <span className="underline decoration-[var(--lv-red)] decoration-2 underline-offset-4">{rewards.profile} RedTab points</span>, get
              personalised offers and more!
            </p>
            <div>
              <span className={fieldLabel}>Mobile</span>
              <p className="text-base font-semibold tabular-nums">{data.customer.mobile}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
              <label>
                <span className={fieldLabel}>First name</span>
                <input className={fieldInput} value={form.firstName} onChange={set("firstName")} autoComplete="given-name" />
              </label>
              <label>
                <span className={fieldLabel}>Last name</span>
                <input className={fieldInput} value={form.lastName} onChange={set("lastName")} autoComplete="family-name" />
              </label>
              <label>
                <span className={fieldLabel}>Birthday</span>
                <input type="date" className={fieldInput} value={form.birthday} onChange={set("birthday")} autoComplete="bday" />
              </label>
              <label>
                <span className={fieldLabel}>Gender</span>
                <select className={fieldInput} value={form.gender} onChange={set("gender")}>
                  <option value="">Select</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className={fieldLabel}>Email</span>
              <input type="email" className={fieldInput} value={form.email} onChange={set("email")} autoComplete="email" />
            </label>
            <button type="submit" className={redBtn}>
              Update
            </button>
            <p aria-live="polite" className="min-h-5 text-center text-sm font-semibold">
              {saved ? "Profile updated." : ""}
            </p>
          </form>
        )}

        {tab === "coupon" && (
          <div
            role="tabpanel"
            id="panel-coupon"
            aria-labelledby="tab-coupon"
            className="flex flex-col items-center rounded-3xl border-2 border-dashed border-black/25 bg-white px-6 py-12 text-center"
          >
            <Icon name="ticket" className="h-10 w-10 text-[var(--lv-red)]" />
            <p className={`${display.className} mt-3 text-[26px] uppercase leading-none tracking-wide`}>No coupons available.</p>
            <p className="mt-2 text-[15px] text-[var(--lv-gray)]">Please check this section later.</p>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------ receipt view ------------------------------------- */
interface ReceiptViewProps extends Omit<LevisReceiptProps, "data" | "receipts" | "onSelectReceipt"> {
  data: LevisReceipt;
  history: { invoiceNo: string; date: string; store: string; amount: number; current: boolean }[];
  onSelect: (invoiceNo: string) => void;
}

function ReceiptView({
  data,
  history,
  onSelect,
  qrSrc,
  barcodeSrc,
  logoSrc = DEFAULT_LEVIS_LOGO,
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

  const taxTotals = useMemo(() => {
    const sum = (t: "CGST" | "SGST") =>
      round2(data.tax.lines.filter((l) => l.type === t).reduce((acc, l) => acc + l.amount, 0));
    return { cgst: sum("CGST"), sgst: sum("SGST") };
  }, [data.tax.lines]);

  const handleDownload = () => (onDownloadPdf ? onDownloadPdf(data) : downloadReceipt(data, logoSrc, rdepLogoSrc));

  return (
    <div
      style={theme}
      onTouchStart={() => {}} /* lets :active press states fire on iOS Safari */
      className={`${body.className} min-h-screen overflow-x-hidden bg-[var(--lv-page)] text-[var(--lv-black)] antialiased [-webkit-text-size-adjust:100%] sm:py-8`}
    >
      <style>{`@keyframes lv-star{0%,10%{fill:transparent}24%,64%{fill:currentColor}80%,100%{fill:transparent}}.lv-star{fill:transparent;animation:lv-star 3.2s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.lv-star{animation:none;fill:currentColor}}`}</style>

      <main
        style={zoomStyle(scale)}
        className="mx-auto w-[400px] overflow-hidden bg-[var(--lv-canvas)] pb-0 sm:rounded-3xl sm:shadow-[0_24px_60px_-24px_rgba(46,46,46,0.35)]"
      >
        {/* ---------- Compact hero: logo left, greeting right ---------- */}
        <header className="flex items-center justify-between gap-4 px-5 pb-7 pt-5">
          <BrandImage
            src={logoSrc}
            alt="Levi's"
            width={200}
            height={80}
            priority
            className="h-15 w-auto max-w-[45%] shrink-0 object-contain object-left"
            fallbackClassName={`${display.className} inline-block bg-[var(--lv-red)] px-4 py-2 text-3xl uppercase leading-none tracking-wide text-white`}
          />
          <h1 className="min-w-0 text-right uppercase">
            <span className={`${display.className} block text-lg leading-none tracking-[0.18em] text-[var(--lv-red)]`}>Hello</span>
            <span
              className={`${display.className} mt-1 block leading-[0.95] tracking-tight [overflow-wrap:anywhere]`}
              style={{ fontSize: nameSize }}
            >
              {data.customer.firstName}!
            </span>
          </h1>
        </header>

        {/* ---------- Right after the greeting: marketing carousel, then loyalty points ---------- */}
        <div className="space-y-7 px-4">
          <MarketingCarousel />

          <RedTabSection data={data} onUpdateProfile={onUpdateProfile} />
        </div>

        {/* ---------- The receipt: thermal paper ---------- */}
        <section
          aria-label="Receipt"
          className="mx-3 mt-10 text-[var(--lv-black)]"
          style={{ filter: "drop-shadow(0 12px 14px rgba(46,46,46,0.18))" }}
        >
          <ZigZag />
          <div className="bg-white px-5 pb-6 pt-4">
            {/* heading + QR on one line, then straight into the items */}
            <div className="flex items-center justify-between gap-4">
              <h2 className={`${display.className} text-[34px] uppercase leading-none tracking-wide text-[var(--lv-red)]`}>Tax invoice</h2>
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded bg-white ring-1 ring-black/20">
                {qrSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrSrc} alt="Receipt QR code" className="h-full w-full object-contain" />
                ) : (
                  <PlaceholderQR seed={data.receiptId} />
                )}
              </div>
            </div>
            {/* items */}
            <div className={`${m} mt-4 flex justify-between border-y-2 border-[var(--lv-black)] py-2 text-xs font-semibold uppercase tracking-wide`}>
              <span>Item name</span>
              <span>Net amount</span>
            </div>
            <ul aria-label="Items purchased">
              {data.items.map((item, i) => (
                <PaperItem key={`${item.code}-${i}`} item={item} open={openItem === i} onToggle={() => setOpenItem(openItem === i ? -1 : i)} />
              ))}
            </ul>

            {/* totals */}
            <dl className={`${m} space-y-2 border-t-2 border-[var(--lv-black)] pt-3.5 text-sm`}>
              <Leader label="Sub total" value={inr(data.subTotal)} strong />
              <Leader label="CGST" value={`+ ${inr(taxTotals.cgst)}`} strong />
              <Leader label="SGST" value={`+ ${inr(taxTotals.sgst)}`} strong />
            </dl>

            <div className="mt-3.5 border-y-2 border-[var(--lv-black)] py-3.5">
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                <span className={`${display.className} text-xl uppercase leading-none tracking-wide`}>Net total</span>
                <span className={`${display.className} text-[44px] leading-none tabular-nums text-[var(--lv-red)]`}>₹{inr(data.netTotal)}</span>
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p className={`${m} text-xs text-[var(--lv-gray)]`}>Pieces purchased: {data.pieces}</p>
              <button
                type="button"
                onClick={() => setModal("tax")}
                className={`${m} rounded py-1 text-[13px] font-semibold text-[var(--lv-red)] underline underline-offset-4 active:no-underline [@media(hover:hover)]:hover:no-underline ${onPaper}`}
              >
                [ View tax calculation ]
              </button>
            </div>

            {/* invoice details */}
            <dl className={`${m} mt-5 space-y-1.5 border-t border-dashed border-black/40 pt-4 text-xs`}>
              <Leader label="Invoice no" value={data.invoiceNo} strong />
              <Leader label="Receipt ID" value={data.receiptId} strong />
              <Leader label="Date" value={data.date} strong />
              <Leader label="Cashier" value={data.cashier} strong />
            </dl>

            {/* payment */}
            <h3 className={`${display.className} mt-5 text-[22px] uppercase leading-none tracking-wide`}>Payment</h3>
            <dl className={`${m} mt-3 space-y-2 text-sm`}>
              {data.payments.map((p) => (
                <Leader key={p.mode} label={p.mode} value={inr(p.amount)} strong />
              ))}
            </dl>

            {/* actions */}
            <div className="mt-6 grid grid-cols-3 gap-2">
              {(
                [
                  { icon: "history", label: "History", onClick: () => setModal("history") },
                  { icon: "mail", label: "Email", onClick: () => setModal("email") },
                  { icon: "download", label: "Download", onClick: handleDownload },
                ] as { icon: IconName; label: string; onClick: () => void }[]
              ).map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={a.onClick}
                  className={`flex flex-col items-center gap-2 rounded-lg border-2 border-[var(--lv-black)] px-1 py-3.5 text-center text-xs font-bold uppercase leading-tight tracking-wide text-[var(--lv-black)] transition-colors active:border-[var(--lv-red)] [@media(hover:hover)]:hover:border-[var(--lv-red)] active:bg-[var(--lv-red)] [@media(hover:hover)]:hover:bg-[var(--lv-red)] active:text-white [@media(hover:hover)]:hover:text-white motion-reduce:transition-none ${onPaper}`}
                >
                  <Icon name={a.icon} className="h-5 w-5" />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <ZigZag down />
        </section>

        {/* ---------- After the receipt: RedTab zone ---------- */}
        <div className="space-y-7 px-4 pt-8">
          <FeedbackLink href={feedbackUrl} points={rewards.feedback} onClick={onFeedbackClick} />

          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onRefer?.()}
            className={`group flex items-center justify-between gap-4 rounded-3xl bg-[var(--lv-red)] p-5 text-white shadow-[0_14px_28px_-14px_rgba(196,18,48,0.9)] transition-colors active:bg-white [@media(hover:hover)]:hover:bg-white active:text-[var(--lv-red)] [@media(hover:hover)]:hover:text-[var(--lv-red)] motion-reduce:transition-none ${onRed}`}
          >
            <span>
              <span className={`${display.className} block text-[32px] uppercase leading-none tracking-wide`}>Refer a friend</span>
              <span className="mt-2.5 block text-[15px] leading-snug">Refer a friend and both of you earn {rewards.refer} RedTab points</span>
            </span>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-[var(--lv-red)] transition-colors group-active:bg-[var(--lv-red)] [@media(hover:hover)]:group-hover:bg-[var(--lv-red)] group-active:text-white [@media(hover:hover)]:group-hover:text-white motion-reduce:transition-none">
              <Icon name="arrow" className="h-6 w-6" />
            </span>
          </a>

          <section aria-label="Reach out to us">
            <h2 className={`${display.className} text-[28px] uppercase leading-none tracking-wide`}>Reach out to us</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <a href={`tel:${contact.callTo}`} className={outlineBtn}>
                <Icon name="phone" className="h-[18px] w-[18px]" />
                Talk to us
              </a>
              <a href={`mailto:${contact.writeTo}`} className={outlineBtn}>
                <Icon name="mail" className="h-[18px] w-[18px]" />
                Write to us
              </a>
            </div>
          </section>

          {/* ---------- Store: woven care label (details expand / collapse) ---------- */}
          <section
            aria-label="Store"
            className="rotate-1 bg-white p-1.5 text-[var(--lv-black)] shadow-[0_14px_30px_-14px_rgba(46,46,46,0.45)]"
          >
            <div className="border-2 border-dashed border-black/50 px-4 py-3.5">
              <h2 className={`${display.className} text-[26px] uppercase leading-none tracking-wide`}>{store.name}</h2>
              <p className={`${m} mb-3 mt-1.5 border-b border-dashed border-black/30 pb-3 text-xs font-semibold uppercase tracking-wide text-[var(--lv-red)]`}>
                {store.branch}
              </p>
              <p className="flex items-start gap-2.5 text-base font-semibold leading-snug">
                <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--lv-red)]" />
                {store.address}
              </p>

              <button
                type="button"
                onClick={() => setStoreOpen((o) => !o)}
                aria-expanded={storeOpen}
                aria-controls={storeId}
                className={`mt-3 flex w-full items-center justify-between border-t-2 border-[var(--lv-black)] pt-3 text-left transition-colors motion-reduce:transition-none ${onPaper} ${
                  storeOpen ? "text-[var(--lv-red)]" : ""
                }`}
              >
                <span className={`${m} text-sm font-semibold uppercase tracking-wide`}>Store details</span>
                <span aria-hidden="true" className={`${m} text-sm font-bold`}>
                  [{storeOpen ? "−" : "+"}]
                </span>
              </button>
              <Collapse open={storeOpen} id={storeId}>
                <dl className="space-y-2 pb-1 pt-3 text-sm">
                  <Leader label="Store code" value={store.code} strong />
                  <Leader
                    label="Phone no."
                    value={
                      <a href={`tel:${store.phone}`} className={`rounded active:text-[var(--lv-red)] [@media(hover:hover)]:hover:text-[var(--lv-red)] ${onPaper}`}>
                        {store.phone}
                      </a>
                    }
                    strong
                  />
                  <Leader label="Store timing" value={store.timing} strong />
                </dl>
              </Collapse>

              <p className="mt-3 border-t border-dashed border-black/30 pt-3 text-xs text-[var(--lv-gray)]">
                Legal name: <span className="font-semibold text-[var(--lv-black)]">{store.legalName}</span>
              </p>
            </div>
          </section>
        </div>

        {/* ---------- Bottom stub: terms, barcode, powered by ---------- */}
        <footer className="mt-10 text-[var(--lv-black)]" style={{ filter: "drop-shadow(0 -6px 10px rgba(46,46,46,0.12))" }}>
          <ZigZag />
          <div className="bg-white px-5 pb-8 pt-5">
            <h2>
              <button
                type="button"
                aria-expanded={termsOpen}
                aria-controls={termsId}
                onClick={() => setTermsOpen((o) => !o)}
                className={`flex w-full items-center justify-between py-2 text-left transition-colors motion-reduce:transition-none ${onPaper} ${
                  termsOpen ? "text-[var(--lv-red)]" : ""
                }`}
              >
                <span className={`${display.className} text-2xl uppercase leading-none tracking-wide`}>Terms and conditions</span>
                <span aria-hidden="true" className={`${m} text-sm font-bold`}>
                  [{termsOpen ? "−" : "+"}]
                </span>
              </button>
            </h2>
            <Collapse open={termsOpen} id={termsId}>
              <div className={`${m} space-y-3 pb-4 pt-3 text-xs leading-relaxed text-[var(--lv-gray)]`}>
                <p>{terms.intro}</p>
                <ol className="list-decimal space-y-2.5 pl-5">
                  {terms.list.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ol>
                <p>
                  Customer toll free no- {contact.tollFree}, {contact.hours}
                </p>
                <p>Email – {contact.email}</p>
                <p>{terms.note}</p>
              </div>
            </Collapse>

            <div className="mt-5 flex flex-col items-center gap-4 border-t border-dashed border-black/40 pt-6">
              {barcodeSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={barcodeSrc} alt="Receipt barcode" className="h-14 w-full max-w-xs object-contain" />
              ) : (
                <PlaceholderBarcode seed={data.receiptId} />
              )}
              <div className="flex items-center gap-3 text-[13px] text-[var(--lv-gray)]">
                <span>Powered by</span>
                <BrandImage
                  src={rdepLogoSrc}
                  alt="rdep"
                  width={240}
                  height={80}
                  className="h-8 w-auto"
                  fallbackClassName="text-xl font-extrabold tracking-tight text-[var(--lv-black)]"
                />
              </div>
            </div>
          </div>
        </footer>
      </main>

      {/* ---------------------------- Popups: white slips ---------------------------- */}
      {modal === "history" && (
        <Modal title="Transaction history" onClose={closeModal} scale={scale}>
          <ul className="divide-y divide-black/15">
            {history.map((h) => (
              <li key={h.invoiceNo}>
                <button
                  type="button"
                  disabled={h.current}
                  onClick={() => {
                    closeModal();
                    onSelect(h.invoiceNo);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded py-3.5 text-left transition-colors motion-reduce:transition-none ${onPaper} ${
                    h.current ? "cursor-default" : "active:bg-[var(--lv-wash)] [@media(hover:hover)]:hover:bg-[var(--lv-wash)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-base font-semibold">
                      Invoice no: <span className={`${m} font-bold`}>{h.invoiceNo}</span>
                    </span>
                    <span className="mt-0.5 block text-sm text-[var(--lv-gray)]">
                      {h.date}, {h.store}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-right">
                      <span className={`${m} block text-base font-bold tabular-nums`}>₹{inr(h.amount)}</span>
                      {h.current && (
                        <span className="mt-1 inline-block rounded-full bg-[var(--lv-red)] px-2.5 py-0.5 text-xs font-bold text-white">This receipt</span>
                      )}
                    </span>
                    {!h.current && <Icon name="arrow" className="h-4 w-4 text-[var(--lv-red)]" />}
                  </span>
                </button>
              </li>
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
            <label className="block">
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
            </label>
            <button type="submit" className={redBtn}>
              Send receipt
            </button>
            <p aria-live="polite" className="flex min-h-5 items-center justify-center gap-1.5 text-sm font-semibold">
              {sentTo && (
                <>
                  <Icon name="check" className="h-4 w-4 text-[var(--lv-red)]" /> Receipt sent to {sentTo}
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
              <tr className="border-b-2 border-[var(--lv-black)] text-xs text-[var(--lv-gray)]">
                <th className="py-2 text-left font-semibold">Tax</th>
                <th className="py-2 text-right font-semibold">Base amount</th>
                <th className="py-2 text-right font-semibold">Tax amount</th>
              </tr>
            </thead>
            <tbody>
              {data.tax.lines.map((l) => (
                <tr key={`${l.type}-${l.rate}`} className="border-b border-black/15">
                  <td className="py-3 font-bold">
                    {l.type} @ {l.rate}%
                  </td>
                  <td className="py-3 text-right">{inr(l.base)}</td>
                  <td className="py-3 text-right">{inr(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className="pt-3" colSpan={2}>
                  Total tax
                </td>
                <td className="pt-3 text-right">{inr(taxTotals.cgst + taxTotals.sgst)}</td>
              </tr>
            </tfoot>
          </table>

          <dl className="mt-5 space-y-3 rounded-2xl bg-[var(--lv-wash)] p-4 text-sm">
            {[
              ["Customer GST Registered/Unregistered", data.tax.customerGst],
              ["Place of supply", data.tax.placeOfSupply],
              ["Whether the tax is payable on Reverse Charge Basis", data.tax.reverseCharge],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4">
                <dt className="text-[var(--lv-gray)]">{k}</dt>
                <dd className="shrink-0 font-bold">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 flex items-end justify-between gap-3 rounded-2xl bg-[var(--lv-red)] px-4 py-3.5 text-white">
            <span className={`${display.className} text-xl uppercase leading-none tracking-wide`}>Net total</span>
            <span className={`${display.className} text-4xl leading-none tabular-nums`}>₹{inr(data.netTotal)}</span>
          </p>
        </Modal>
      )}
    </div>
  );
}

/* --------------------------------- main ------------------------------------------ */
/** Holds which receipt is open. Each receipt is a keyed ReceiptView, so switching resets the
 *  open item, popups, tabs and forms instead of carrying them over from the previous receipt. */
export default function LevisReceiptV2({ data, receipts, onSelectReceipt, ...rest }: LevisReceiptProps) {
  const list = useMemo(() => {
    const base = receipts ?? (data ? [data] : sampleLevisReceipts);
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
        store: shortStore(r.store.branch),
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
