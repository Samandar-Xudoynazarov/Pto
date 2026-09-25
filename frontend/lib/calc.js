/* ================= umumiy ================= */
export const STATUSES = [
  ["yangi", "Yangi"],
  ["jarayonda", "Jarayonda"],
  ["tayyor", "Tayyor"],
  ["topshirildi", "Topshirildi"],
];
export const GROUPS = [
  ["beton", "Beton"],
  ["xomashyo", "Xomashyo"],
  ["metall", "Metall"],
  ["zaklad", "Zakladnoy detallar"],
  ["yoqilgi", "Yoqilg'i va moylar"],
  ["ehtiyot", "Ehtiyot qismlar"],
  ["boshqa", "Boshqa"],
  ["xizmat", "Xizmat / energiya"],
];
export const ROW_TYPES = [
  ["m3", "so'm × m³ beton"],
  ["kg", "so'm × kg metall"],
  ["pctPrev", "% oldingi qatordan"],
  ["pctSS", "% ishlab chiqarish tannarxidan"],
  ["fixed", "so'm (qat'iy)"],
];

export const fmt = (n, d = 0) =>
  (Number.isFinite(+n) ? +n : 0).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
/** 0 dan `max` gacha kasr — ortiqcha nollarsiz */
export const fmtN = (n, max = 3) =>
  (Number.isFinite(+n) ? +n : 0).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: max });
export const fmtDate = (s) => (s ? s.split("-").reverse().join(".") : "—");
export const round = (x, d = 6) => Math.round((+x || 0) * 10 ** d) / 10 ** d;

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function shiftDate(s, days) {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
export function monthDays(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function lsGet(k, d) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
}
export function lsSet(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export const byId = (list) => new Map(list.map((x) => [x.id, x]));
export const productLabel = (p) => (p ? `${p.code}${p.name ? " — " + p.name : ""}` : "— o'chirilgan —");
export const productOptions = (products) => products.map((p) => [p.id, productLabel(p)]);
export const materialOptions = (materials, filter = () => true) =>
  materials.filter(filter).map((m) => [m.id, `${m.name} (${m.unit})`]);

/* ================= narxlar ================= */
/** Material narxi: beton uchun retsept bo'yicha, qolganlari — kiritilgan narx */
export function priceOf(m, mats, depth = 0) {
  if (!m) return 0;
  if (m.group === "beton" && m.recipe?.length && depth < 3) {
    return m.recipe.reduce((s, l) => s + (+l.norm || 0) * priceOf(mats.get(l.materialId), mats, depth + 1), 0);
  }
  return +m.price || 0;
}

/* ================= sarf normasi ================= */
/**
 * 1 dona mahsulot uchun to'liq sarf: to'g'ridan-to'g'ri normalar + hosila qatorlar:
 *  - beton → qum, sement, sheben (betonning «yozib chiqarish» koeffitsiyentlari)
 *  - elektrod = metall (electrodeBase) og'irligi × electrodePct %, 3 xonagacha yaxlitlanadi
 * Natija: Map(materialId → { qty, derived })
 */
export function expandNorms(product, mats, settings) {
  const out = new Map();
  const add = (id, q, derived) => {
    const r = out.get(id) || { qty: 0, derived };
    r.qty += q;
    r.derived = r.derived && derived;
    out.set(id, r);
  };
  let metal = 0;
  for (const l of product?.norms || []) {
    const m = mats.get(l.materialId);
    const q = +l.norm || 0;
    add(l.materialId, q, false);
    if (m?.group === "beton") for (const w of m.writeoff || []) add(w.materialId, q * (+w.norm || 0), true);
    if (m?.electrodeBase) metal += q;
  }
  const pct = +settings?.electrodePct || 0;
  const all = [...mats.values()];
  // «Elektrod» belgisi qo'yilgan material; eski ma'lumotlar uchun — nomi bo'yicha
  const electrode = all.find((m) => m.isElectrode) || all.find((m) => m.name?.trim().toLowerCase() === "электрод");
  if (electrode && pct && metal) {
    const hasManual = (product?.norms || []).some((l) => l.materialId === electrode.id);
    if (!hasManual) add(electrode.id, Math.round(((pct / 100) * metal + 1e-9) * 1000) / 1000, true); // Excel ROUND(…;3)
  }
  return out;
}

/** Bir necha mahsulot × soni uchun jami sarf: Map(materialId → qty) */
export function consumption(lines, products, mats, settings) {
  const total = new Map();
  for (const { productId, qty } of lines) {
    if (!qty) continue;
    const p = products.get(productId);
    if (!p) continue;
    for (const [id, r] of expandNorms(p, mats, settings)) total.set(id, (total.get(id) || 0) + r.qty * qty);
  }
  return total;
}

/** Mahsulotning beton hajmi (m³/dona) — sarf normasidan */
export function concreteVolume(product, mats) {
  return (product?.norms || []).reduce((s, l) => s + (mats.get(l.materialId)?.group === "beton" ? +l.norm || 0 : 0), 0);
}

/* ================= kalkulyatsiya ================= */
/**
 * Excel kalkulyatsiya varag'idagi tartib:
 * materiallar → ФОТ, ЕСП → Производственная СС → Другие затраты → Итого → Маржа → Цена без НДС → НДС → Цена с НДС
 */
export function costCard(product, mats) {
  const c = product?.calc || {};
  const items = (c.items || []).map((l) => {
    const m = mats.get(l.materialId);
    const price = priceOf(m, mats);
    return { materialId: l.materialId, m, norm: +l.norm || 0, price, sum: price * (+l.norm || 0) };
  });
  const V = items.reduce((s, it) => s + (it.m?.group === "beton" ? it.norm : 0), 0);
  const materials = items.reduce((s, it) => s + it.sum, 0);
  const kg = +c.metalKg || 0;

  const calcRows = (rows, base, ss) => {
    let prev = base;
    return (rows || []).map((r) => {
      const v = +r.value || 0;
      let amount = 0;
      if (r.type === "m3") amount = v * V;
      else if (r.type === "kg") amount = v * kg;
      else if (r.type === "pctPrev") amount = (prev * v) / 100;
      else if (r.type === "pctSS") amount = ((ss || 0) * v) / 100;
      else amount = v;
      prev = amount;
      return { ...r, amount };
    });
  };
  const prodRows = calcRows(c.prodRows, materials, 0);
  const prodSS = materials + prodRows.reduce((s, r) => s + r.amount, 0);
  const otherRows = calcRows(c.otherRows, 0, prodSS);
  const other = otherRows.reduce((s, r) => s + r.amount, 0);
  const itogo = prodSS + other;
  const marginAmt = (itogo * (+c.margin || 0)) / 100;
  const noVat = itogo + marginAmt;
  const vatAmt = (noVat * (+c.vat || 0)) / 100;
  const final = noVat + vatAmt;
  return { items, V, kg, materials, prodRows, prodSS, otherRows, other, itogo, marginAmt, noVat, vatAmt, final, margin: +c.margin || 0, vat: +c.vat || 0 };
}

/** Kalkulyatsiyadagi metall og'irligi (Логистика метала uchun) — metall guruhidagi qatorlar */
export function calcMetalKg(product, mats) {
  return (product?.calc?.items || []).reduce((s, l) => {
    const m = mats.get(l.materialId);
    return s + (m?.group === "metall" && m.unit === "кг" ? +l.norm || 0 : 0);
  }, 0);
}
