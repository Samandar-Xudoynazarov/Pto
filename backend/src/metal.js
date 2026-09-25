/**
 * Metall prokatining 1 metr og'irligi (kg/m) — omborchi metrda yozganda kg ga aylantirish uchun.
 * Bu fayl frontend/lib/metal.js bilan bir xil (ikkalasini birga o'zgartiring).
 *
 *  - Armatura, prutok, krug (dumaloq kesim): GOST 5781 jadvali, jadvalda yo'q diametr — π·d²/4 × 7850 kg/m³
 *  - Teng tomonli burchak (уголок) b×t: GOST 8509 jadvali, yo'q bo'lsa — t·(2b − t) × 7,85 g/sm³
 *  - Teng bo'lmagan burchak b1×b2×t: t·(b1 + b2 − t) × 7,85
 * Diametr nomdagi «мм» oldidagi sondan olinadi («Арматура А500 - 12мм» → 12, «А500» sinfi hisobga olinmaydi).
 */

const ROUND = { 6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888, 14: 1.21, 16: 1.58, 18: 2.0, 20: 2.47, 22: 2.98, 25: 3.85, 28: 4.83, 32: 6.31, 36: 7.99, 40: 9.87 };
const ANGLE = {
  "25x3": 1.12, "25x4": 1.46, "32x3": 1.46, "32x4": 1.91, "35x4": 2.1, "40x3": 1.85, "40x4": 2.42, "40x5": 2.98,
  "45x4": 2.73, "45x5": 3.37, "50x4": 3.05, "50x5": 3.77, "50x6": 4.47, "56x5": 4.25, "63x5": 4.81, "63x6": 5.72,
  "70x6": 6.39, "70x7": 7.39, "75x6": 6.89, "75x8": 9.02, "80x6": 7.36, "80x8": 9.65, "90x7": 9.64, "90x8": 10.93,
  "100x7": 10.79, "100x8": 12.25, "100x10": 15.1, "110x8": 13.5, "125x8": 15.46, "125x10": 19.1, "140x9": 19.41,
  "140x10": 21.45, "160x10": 24.67, "160x12": 29.35, "180x12": 33.12, "200x12": 36.97, "200x14": 42.8,
};
const r3 = (x) => Math.round(x * 1000) / 1000;
const num = (s) => parseFloat(String(s).replace(",", "."));

/** Nomdan kg/m ni topadi. Natija: { kgPerM, how } yoki null */
export function autoKgPerM(name) {
  const s = String(name || "").toLowerCase().replace(/[х×*]/g, "x");
  if (/уголок|ugolok|burchak/.test(s)) {
    const m = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))?/.exec(s);
    if (!m) return null;
    if (m[3]) {
      const [b1, b2, t] = [num(m[1]), num(m[2]), num(m[3])];
      return { kgPerM: r3(t * (b1 + b2 - t) * 0.00785), how: `${b1}×${b2}×${t}` };
    }
    const [b, t] = [num(m[1]), num(m[2])];
    const key = `${b}x${t}`;
    if (ANGLE[key]) return { kgPerM: ANGLE[key], how: `ГОСТ 8509: ${b}×${t}` };
    return { kgPerM: r3(t * (2 * b - t) * 0.00785), how: `${b}×${t}` };
  }
  if (/арматур|пруток|круг|катанк|armatura|prutok|krug/.test(s)) {
    const m = /(\d+(?:[.,]\d+)?)\s*(?:мм|mm)/.exec(s);
    if (!m) return null;
    const d = num(m[1]);
    if (!(d > 0 && d < 100)) return null;
    if (ROUND[d]) return { kgPerM: ROUND[d], how: `ГОСТ 5781: Ø${d}` };
    return { kgPerM: r3((Math.PI * d * d) / 4 * 0.00785), how: `Ø${d}` };
  }
  return null;
}

/**
 * Material uchun «1 metr = ? (material birligida)». Faqat kg yoki t da yuritiladigan materiallar uchun.
 * Qo'lda kiritilgan kgPerM ustun, bo'lmasa nomdan avtomatik.
 * Natija: { perM (material birligida), kgPerM, auto: true|false, how } yoki null
 */
export function meterFactor(m) {
  if (!m) return null;
  const unit = String(m.unit || "").trim().toLowerCase();
  const k = unit === "кг" || unit === "kg" ? 1 : unit === "т" || unit === "t" || unit === "тонна" ? 1 / 1000 : 0;
  if (!k) return null;
  const manual = +m.kgPerM > 0 ? +m.kgPerM : 0;
  const auto = manual ? null : autoKgPerM(m.name);
  const kgPerM = manual || auto?.kgPerM;
  if (!kgPerM) return null;
  return { perM: kgPerM * k, kgPerM, auto: !manual, how: manual ? "" : auto.how };
}
