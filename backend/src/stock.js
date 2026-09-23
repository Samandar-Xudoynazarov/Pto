/**
 * Ombor qoldig'ini hisoblash (sof funksiya — DB'ga bog'liq emas).
 *
 * opening: { date, materials: {id: qty}, products: {id: qty} } — `date` kuni BOSHIGA qoldiq
 * days:    kunlik hisobotlar (date bo'yicha istalgan tartibda)
 * from,to: davr (YYYY-MM-DD, ikkalasi ham kiradi)
 *
 * Natija: har bir material va mahsulot uchun davr boshidagi qoldiq, harakatlar va oxirgi qoldiq.
 */
export function stockReport(opening, days, from, to) {
  const openDate = opening?.date || "0000-00-00";
  const mats = new Map();
  const prods = new Map();
  const m = (id) => {
    if (!mats.has(id)) mats.set(id, { start: 0, kirim: 0, sarf: 0, end: 0 });
    return mats.get(id);
  };
  const p = (id) => {
    if (!prods.has(id)) prods.set(id, { start: 0, fact: 0, shipped: 0, end: 0 });
    return prods.get(id);
  };

  for (const [id, q] of Object.entries(opening?.materials || {})) m(id).start += +q || 0;
  for (const [id, q] of Object.entries(opening?.products || {})) p(id).start += +q || 0;

  for (const d of days) {
    if (d.date < openDate || d.date > to) continue;
    const inRange = d.date >= from;
    for (const l of d.materials || []) {
      const r = m(String(l.materialId));
      const delta = (+l.kirim || 0) - (+l.sarf || 0);
      if (inRange) {
        r.kirim += +l.kirim || 0;
        r.sarf += +l.sarf || 0;
      } else r.start += delta;
    }
    for (const l of d.production || []) {
      const r = p(String(l.productId));
      if (inRange) r.fact += +l.fact || 0;
      else r.start += +l.fact || 0;
    }
    for (const l of d.shipments || []) {
      const r = p(String(l.productId));
      if (inRange) r.shipped += +l.qty || 0;
      else r.start -= +l.qty || 0;
    }
  }
  const round = (x) => Math.round(x * 1e6) / 1e6;
  for (const r of mats.values()) {
    r.end = round(r.start + r.kirim - r.sarf);
    r.start = round(r.start);
    r.kirim = round(r.kirim);
    r.sarf = round(r.sarf);
  }
  for (const r of prods.values()) r.end = r.start + r.fact - r.shipped;

  return {
    openingDate: opening?.date || "",
    from,
    to,
    beforeOpening: Boolean(opening?.date) && from < opening.date,
    materials: Object.fromEntries(mats),
    products: Object.fromEntries(prods),
  };
}
