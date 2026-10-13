/**
 * Oyma-oy versiyalar (backend/src/versions.js bilan bir xil qoida).
 * Material: price, recipe, writeoff · Mahsulot: norms, calc · Sozlamalar: costSchemes, electrodePct.
 * Oy M uchun qiymat — `history` dagi `from <= M` bo'lgan eng oxirgi versiya; tarix bo'lmasa — hujjatning o'zi.
 * Shu tufayli yangi narx yoki norma faqat o'zi kiritilgan oydan boshlab ta'sir qiladi, o'tgan oylar o'zgarmaydi.
 */
import { today } from "./calc";

export const MATERIAL_VER = ["price", "recipe", "writeoff"];
export const PRODUCT_VER = ["norms", "calc"];
export const SETTINGS_VER = ["costSchemes", "electrodePct"];
export const BASE_MONTH = "0000-00";

export const thisMonth = () => today().slice(0, 7);

export function versionAt(history, month) {
  if (!Array.isArray(history) || !history.length || !month) return null;
  let best = null;
  for (const v of history) if (v.from <= month && (!best || v.from > best.from)) best = v;
  return best || history.reduce((a, b) => (a.from <= b.from ? a : b));
}

/** Hujjatning shu oydagi ko'rinishi */
export function atMonth(doc, month, fields) {
  const v = doc && versionAt(doc.history, month);
  if (!v) return doc;
  const out = { ...doc };
  for (const f of fields) if (v[f] !== undefined) out[f] = v[f];
  return out;
}

/** «0000-00» → «boshidan», «2026-10» → «10.2026» */
export const monthText = (ym) => (!ym || ym === BASE_MONTH ? "" : `${ym.slice(5, 7)}.${ym.slice(0, 4)}`);
