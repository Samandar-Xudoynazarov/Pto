/**
 * Ombor qoldig'ini hisoblash (sof funksiya — DB'ga bog'liq emas).
 *
 * opening: { date, materials: {id: qty}, products: {id: qty} } — `date` kuni BOSHIGA qoldiq
 * days:    kunlik hisobotlar (date bo'yicha istalgan tartibda) — ПТО: ishlab chiqarish sarfi (va eski kirimlar)
 * moves:   omborchi harakatlari { type: in|out, date, materialId, qty }
 * from,to: davr (YYYY-MM-DD, ikkalasi ham kiradi)
 *
 * Material: start + kirim − sarf − chiqim = end
 *   kirim  = kunlik hisobotdagi kirim + omborchi kirimi (moveIn — alohida ham beriladi)
 *   sarf   = kunlik hisobotdagi ishlab chiqarish sarfi
 *   chiqim = omborchi chiqimi (sex, texnika, shaxsga)
 */
export function stockReport(opening, days, from, to, moves = []) {
  const openDate = opening?.date || "0000-00-00";
  const mats = new Map();
  const prods = new Map();
  const m = (id) => {
    if (!mats.has(id)) mats.set(id, { start: 0, kirim: 0, sarf: 0, chiqim: 0, moveIn: 0, end: 0 });
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
  for (const mv of moves) {
    if (mv.date < openDate || mv.date > to) continue;
    const r = m(String(mv.materialId));
    const q = +mv.qty || 0;
    const inRange = mv.date >= from;
    if (mv.type === "in") {
      if (inRange) {
        r.kirim += q;
        r.moveIn += q;
      } else r.start += q;
    } else if (inRange) r.chiqim += q;
    else r.start -= q;
  }
  const round = (x) => Math.round(x * 1e6) / 1e6;
  for (const r of mats.values()) {
    r.end = round(r.start + r.kirim - r.sarf - r.chiqim);
    for (const k of ["start", "kirim", "sarf", "chiqim", "moveIn"]) r[k] = round(r[k]);
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
