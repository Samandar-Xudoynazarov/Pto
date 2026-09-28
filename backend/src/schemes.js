/**
 * Umumiy xarajat andozalari (Производственная СС va Другие затраты, marja, QQS).
 * Mahsulot kalkulyatsiyasida `calc.scheme` = andoza id — shu andozadagi qatorlar ishlatiladi.
 * Andozani bir marta o'zgartirish unga bog'langan barcha mahsulotlarga ta'sir qiladi.
 */

const r = (name, type, value) => ({ name, type, value });
const prodRows = () => [r("ФОТ", "m3", 300000), r("Единый Социальный Платёж", "pctPrev", 12)];

// ПТО tasdiqlagan ikki sxema (2026-09-28)
export const DEFAULT_SCHEMES = [
  {
    id: "fundament",
    name: "Фундамент (1-sxema)",
    prodRows: prodRows(),
    otherRows: [
      r("ФОТ Админимтрации И Гвардия", "m3", 201000),
      r("Единый Социальный Платёж", "pctPrev", 12),
      r("Электроэнергия", "m3", 35000),
      r("Вода", "m3", 150),
      r("Питание", "m3", 30000),
      r("Логистика Метала до завода", "kg", 560),
      r("Налог земля и Налог имущество", "m3", 68000),
      r("Амортизация", "pctSS", 2),
    ],
    margin: 20,
    vat: 12,
  },
  {
    id: "lotok",
    name: "Лотки и плиты (2-sxema)",
    prodRows: prodRows(),
    otherRows: [
      r("ФОТ Админимтрации И Гвардия", "m3", 150000),
      r("Единый Социальный Платёж", "pctPrev", 12),
      r("Электроэнергия", "m3", 35000),
      r("Вода", "m3", 150),
      r("Питание", "m3", 40000),
      r("Логистика Метала до завода", "kg", 560),
      r("Налог земля и Налог имущество", "m3", 113000),
      r("Амортизация", "pctSS", 3),
    ],
    margin: 20,
    vat: 12,
  },
];

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
// sxemalarni ajratib turadigan qatorlar
const KEYS = ["фот админимтрации и гвардия", "питание", "налог земля и налог имущество", "амортизация"];

/** Mahsulotning hozirgi qiymatlari qaysi andozaga aniq mos keladi (mos kelgan qatorlar soni bo'yicha) */
export function matchScheme(calc, schemes) {
  const own = new Map((calc?.otherRows || []).map((x) => [norm(x.name), +x.value]));
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const s of schemes) {
    const ref = new Map((s.otherRows || []).map((x) => [norm(x.name), +x.value]));
    const score = KEYS.filter((k) => own.has(k) && ref.has(k) && own.get(k) === ref.get(k)).length;
    if (score > bestScore) {
      best = s.id;
      bestScore = score;
      tie = false;
    } else if (score && score === bestScore) tie = true;
  }
  return bestScore && !tie ? best : null;
}

/**
 * Barcha mahsulotlarni andozalarga taqsimlash: aniq mos kelsa — o'shanga, aks holda
 * o'z guruhidagi ko'pchilik tushgan andozaga, u ham bo'lmasa — birinchi andozaga.
 * Qaytaradi: Map(productId → schemeId)
 */
export function assignSchemes(products, schemes) {
  const out = new Map();
  const byGroup = new Map();
  for (const p of products) {
    const id = matchScheme(p.calc, schemes);
    if (!id) continue;
    out.set(String(p._id), id);
    const g = byGroup.get(p.group) || new Map();
    g.set(id, (g.get(id) || 0) + 1);
    byGroup.set(p.group, g);
  }
  for (const p of products) {
    if (out.has(String(p._id))) continue;
    const g = byGroup.get(p.group);
    const top = g ? [...g.entries()].sort((a, b) => b[1] - a[1])[0][0] : schemes[0].id;
    out.set(String(p._id), top);
  }
  return out;
}
