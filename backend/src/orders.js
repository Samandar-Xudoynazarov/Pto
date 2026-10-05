/**
 * Ko'p mahsulotli buyurtmalar uchun yordamchilar (sof funksiyalar — DB'ga bog'liq emas).
 *
 * Buyurtma: { no, customer, date, deadline, status, note, items: [{ productId, qty, price, shippedBefore }] }
 *   shippedBefore — tizimdan oldin jo'natilgan (qo'lda kiritiladi)
 *   shipped       — shippedBefore + kunlik hisobotdagi shu buyurtma va shu mahsulotga bog'langan jo'natishlar
 */

export const MAX_ITEMS = 100;

const oid = (v) => (v === null || v === undefined ? "" : String(v));
export const shipKey = (orderId, productId) => `${oid(orderId)}:${oid(productId)}`;

/** Buyurtma qatorlari: yangi ko'rinishda items, eski buyurtmada — bitta productId/qty */
export function itemsOf(o) {
  if (Array.isArray(o?.items) && o.items.length) return o.items;
  if (o?.productId) return [{ productId: o.productId, qty: +o.qty || 0, price: +o.price || 0, shippedBefore: 0 }];
  return [];
}

/**
 * So'rovdan kelgan qatorlarni tekshiradi va tozalaydi.
 * Natija: { items } yoki { error }. Bir mahsulot ikki marta kelsa — xato (soni bitta qatorda yoziladi).
 */
export function cleanItems(raw, isId) {
  if (!Array.isArray(raw)) return { error: "Mahsulotlar ro'yxati noto'g'ri" };
  const rows = raw.filter((r) => r && typeof r === "object" && (r.productId || +r.qty));
  if (!rows.length) return { error: "Kamida bitta mahsulot qo'shing" };
  if (rows.length > MAX_ITEMS) return { error: `Bitta buyurtmada ${MAX_ITEMS} tadan ko'p mahsulot bo'lmaydi` };
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    if (!isId(r.productId)) return { error: "Mahsulot tanlanmagan" };
    const pid = String(r.productId);
    if (seen.has(pid)) return { error: "Bir mahsulot buyurtmada ikki marta bo'lmasin — sonini bitta qatorga yozing" };
    seen.add(pid);
    const qty = Math.floor(+r.qty);
    if (!(qty >= 1)) return { error: "Soni kamida 1 bo'lishi kerak" };
    const price = +r.price || 0;
    if (!(price >= 0)) return { error: "Narx manfiy bo'lmaydi" };
    const before = Math.floor(+r.shippedBefore || 0);
    if (before < 0) return { error: "Oldin jo'natilgan soni manfiy bo'lmaydi" };
    if (before > qty) return { error: "Oldin jo'natilgan soni buyurtma sonidan ko'p bo'lmaydi" };
    items.push({ productId: pid, qty, price, shippedBefore: before });
  }
  return { items };
}

/** Kunlik hisobotlardagi jo'natishlar: { "orderId:productId": soni } */
export function shippedMap(rows) {
  return new Map(rows.map((r) => [shipKey(r._id.orderId, r._id.productId), +r.qty || 0]));
}

/** API javobi: qatorlar bo'yicha jo'natilgan/qoldi va buyurtma bo'yicha jami */
export function orderView(o, shipped) {
  const id = oid(o._id ?? o.id);
  const items = itemsOf(o).map((it) => {
    const inSystem = shipped.get(shipKey(id, it.productId)) || 0;
    const before = +it.shippedBefore || 0;
    const done = before + inSystem;
    return {
      productId: oid(it.productId),
      qty: +it.qty || 0,
      price: +it.price || 0,
      shippedBefore: before,
      shippedSystem: inSystem,
      shipped: done,
      left: Math.max(0, (+it.qty || 0) - done),
    };
  });
  const sum = (k) => items.reduce((s, it) => s + it[k], 0);
  const { _id, __v, productId, qty, price, items: _old, ...rest } = o;
  return { ...rest, id, items, qty: sum("qty"), shipped: sum("shipped"), left: sum("left") };
}

/**
 * Rejalashtirish uchun: har buyurtma qatori alohida «buyurtma» bo'lib qatnashadi.
 * id = "orderId:productId", orderId saqlanadi — natijada buyurtma bo'yicha guruhlash mumkin.
 * To'liq jo'natib bo'lingan qatorlar (tizimdan oldin jo'natilganlari bilan) rejaga kirmaydi.
 */
export function planLines(orders, shipped) {
  const out = [];
  for (const o of orders) {
    const v = orderView(o, shipped);
    for (const it of v.items)
      if (it.left > 0) // to'liq jo'natilgan mahsulot rejaga kirmaydi
        out.push({ id: shipKey(v.id, it.productId), orderId: v.id, no: v.no, customer: v.customer, contractNo: v.contractNo || "", productId: it.productId, qty: it.qty, shipped: it.shipped, deadline: v.deadline, status: v.status });
  }
  return out;
}
