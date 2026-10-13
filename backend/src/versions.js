/**
 * Oyma-oy versiyalar: narx, beton retsepti, sarf normasi, kalkulyatsiya va xarajat andozalari.
 *
 * Har hujjatda `history: [{ from: "YYYY-MM", ...maydonlar }]` saqlanadi. Oy M uchun qiymat — `from <= M` bo'lgan
 * eng oxirgi versiya. Shunday qilib, oktyabrda narx o'zgartirilsa, sentyabr va undan oldingi oylar eski narxda qoladi.
 * Hujjatning yuqori darajadagi maydonlari (price, norms, …) — doim JORIY oy versiyasi (ro'yxat va tahrirlash uchun).
 *
 * Birinchi o'zgarishda eski qiymat `from: "0000-00"` bilan saqlab qo'yiladi — u «tarixdan oldingi barcha oylar» uchun.
 */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const BASE_MONTH = "0000-00";

export const MATERIAL_VER = ["price", "recipe", "writeoff"];
export const PRODUCT_VER = ["norms", "calc"];
export const SETTINGS_VER = ["costSchemes", "electrodePct"];

export const thisMonth = () => new Date(Date.now() + 5 * 36e5).toISOString().slice(0, 7); // Toshkent vaqti

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const pickF = (o, fields) => Object.fromEntries(fields.filter((f) => o?.[f] !== undefined).map((f) => [f, plain(o[f])]));

/** Oy uchun versiya (history bo'sh bo'lsa — null) */
export function versionAt(history, month) {
  if (!Array.isArray(history) || !history.length) return null;
  let best = null;
  for (const v of history) if (v.from <= month && (!best || v.from > best.from)) best = v;
  // so'ralgan oy eng birinchi versiyadan ham oldin bo'lsa — eng birinchisi
  return best || history.reduce((a, b) => (a.from <= b.from ? a : b));
}

/**
 * O'zgarishni versiya sifatida yozadi.
 * before — bazadagi hujjat (lean), data — yangi qiymatlar (faqat kelganlari), from — qaysi oydan kuchga kiradi.
 * Qaytaradi: { set, changed } — `set` ichida yangilangan history va joriy oy qiymatlari (data ga qo'shib $set qilinadi).
 */
export function applyVersion(before, data, fields, from) {
  const changed = fields.filter((f) => data[f] !== undefined && !same(data[f], versionAt(before.history, from)?.[f] ?? before[f]));
  if (!changed.length) {
    // versiyalangan maydonlar o'zgarmagan — ularni yuqori darajada ham tegmaymiz (joriy oy qiymati qoladi)
    const rest = { ...data };
    for (const f of fields) delete rest[f];
    return { set: rest, changed };
  }
  let history = plain(before.history || []);
  if (!history.length) history = [{ from: BASE_MONTH, ...pickF(before, fields) }];
  const base = versionAt(history, from);
  const entry = { ...pickF(base, fields), ...pickF(data, fields), from };
  history = history.filter((v) => v.from !== from);
  history.push(entry);
  history.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const cur = versionAt(history, thisMonth());
  const set = { ...data, ...pickF(cur, fields), history };
  return { set, changed };
}

/** Versiyani o'chirish (oldingi versiya yana kuchga kiradi). Qaytaradi: $set yoki null (topilmasa / yagona bo'lsa) */
export function removeVersion(doc, fields, from) {
  const history = plain(doc.history || []);
  if (history.length < 2 || !history.some((v) => v.from === from)) return null;
  const rest = history.filter((v) => v.from !== from);
  // eng birinchi versiya o'chirilsa, keyingisi «barcha oldingi oylar» uchun bo'ladi
  if (!rest.some((v) => v.from === BASE_MONTH)) rest[0] = { ...rest[0], from: BASE_MONTH };
  const cur = versionAt(rest, thisMonth());
  return { ...pickF(cur, fields), history: rest.length === 1 ? [] : rest }; // bitta versiya qolsa, tarix kerak emas
}

/** Joriy oy versiyasini yuqori darajaga qo'yadi (oldindan kiritilgan keyingi oy narxi o'z oyida kuchga kirishi uchun) */
export function currentView(doc, fields) {
  const o = doc?.toJSON ? doc.toJSON() : doc;
  const v = versionAt(o?.history, thisMonth());
  return v ? { ...o, ...pickF(v, fields) } : o;
}
