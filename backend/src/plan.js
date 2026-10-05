/**
 * Buyurtmalarni rejalashtirish (sof funksiya — DB'ga bog'liq emas).
 *
 * Kunlik quvvat:
 *   mahsulot bo'yicha = qoliplar soni ÷ aylanish muddati (kun)  — masalan 10 qolip, 1 kunda aylanadi → 10 dona/kun
 *   qolip kiritilmagan bo'lsa — oxirgi 60 kundagi haqiqiy o'rtacha (fakt > 0 bo'lgan kunlar)
 *   umumiy cheklov = kuniga qorish mumkin bo'lgan beton, m³ (0 — cheklanmagan)
 *
 * Tartib: muddati yaqin buyurtma birinchi (muddatsizlari oxirida, keyin № bo'yicha).
 * Avval ombordagi tayyor mahsulot buyurtmalarga taqsimlanadi, qolgani ishlab chiqariladi.
 */

const DAY_MS = 86400000;
const toUTC = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => fromUTC(toUTC(s) + n * DAY_MS);
export const dayDiff = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS); // b − a, kun
const weekday = (s) => new Date(toUTC(s)).getUTCDay(); // 0 = yakshanba

export const DEFAULT_PLAN = { concretePerDay: 0, workDays: [1, 2, 3, 4, 5, 6], holidays: [] };
const ACTIVE = (o) => o.status !== "tayyor" && o.status !== "topshirildi";
const HORIZON = 730; // kalendar kun — undan uzoqqa rejalashtirilmaydi
const RISK_SLACK = 1; // muddatdan oldin shuncha ish kunidan kam zaxira qolsa — «xavf»

export function planConfig(p) {
  const days = Array.isArray(p?.workDays) ? [...new Set(p.workDays.map(Number).filter((d) => d >= 0 && d <= 6))] : null;
  return {
    concretePerDay: Math.max(0, +p?.concretePerDay || 0),
    workDays: days && days.length ? days.sort() : DEFAULT_PLAN.workDays,
    holidays: Array.isArray(p?.holidays) ? p.holidays.filter((d) => typeof d === "string") : [],
  };
}

export function isWorkDay(date, cfg) {
  return cfg.workDays.includes(weekday(date)) && !cfg.holidays.includes(date);
}

/** from..to (ikkalasi ham) oralig'idagi ish kunlari soni */
export function workDaysBetween(from, to, cfg) {
  let n = 0;
  for (let d = from; d <= to && n < 5000; d = addDays(d, 1)) if (isWorkDay(d, cfg)) n++;
  return n;
}

/**
 * input:
 *   today      "YYYY-MM-DD"
 *   orders     [{ id, orderId, no, customer, productId, qty, shipped, deadline, status }] — buyurtma qatorlari (bitta buyurtmada bir nechta mahsulot bo'lsa — har biri alohida)
 *   products   [{ id, code, name, forms, cycleDays, volume }]  (volume — m³/dona)
 *   stock      { productId: tayyor mahsulot qoldig'i }
 *   history    { productId: o'rtacha dona/kun }
 *   todayFact  { productId: bugun allaqachon ishlab chiqarilgan }
 *   settings   { concretePerDay, workDays, holidays }
 *   extra      qo'shimcha (taxminiy) buyurtma — «olsak ulguramizmi?» uchun
 *   showDays   kunlik jadvalda nechta ish kuni qaytarilsin
 */
export function planOrders({ today, orders = [], products = [], stock = {}, history = {}, todayFact = {}, settings, extra = null, showDays = 24 }) {
  const cfg = planConfig(settings);
  const prod = new Map(products.map((p) => [String(p.id), p]));

  // mahsulot bo'yicha kunlik quvvat
  const capacity = {};
  for (const p of products) {
    const id = String(p.id);
    const forms = +p.forms || 0;
    const cycle = Math.max(0.1, +p.cycleDays || 1);
    if (forms > 0) capacity[id] = { perDay: forms / cycle, basis: "qolip", forms, cycleDays: cycle };
    else if (+history[id] > 0) capacity[id] = { perDay: +history[id], basis: "tarix" };
    else capacity[id] = { perDay: 0, basis: null };
  }

  const list = orders.filter(ACTIVE).map((o) => ({ ...o, productId: String(o.productId), extra: false }));
  if (extra) list.push({ id: "_new", no: Infinity, customer: extra.customer || "", productId: String(extra.productId), qty: +extra.qty || 0, shipped: 0, deadline: extra.deadline || "", status: "yangi", extra: true });
  list.sort((a, b) => (a.deadline || "9999-99-99").localeCompare(b.deadline || "9999-99-99") || a.no - b.no);

  // 1) ombordagi tayyor mahsulot
  const free = Object.fromEntries(Object.entries(stock).map(([k, v]) => [String(k), Math.max(0, Math.floor(+v || 0))]));
  const rows = list.map((o) => {
    const remaining = Math.max(0, (+o.qty || 0) - (+o.shipped || 0));
    const fromStock = Math.min(remaining, free[o.productId] || 0);
    free[o.productId] = (free[o.productId] || 0) - fromStock;
    return { o, remaining, fromStock, left: remaining - fromStock, made: 0, first: null, finish: remaining - fromStock === 0 ? today : null, limit: { qolip: 0, beton: 0 } };
  });

  // 2) kunma-kun taqsimlash
  // Har kuni ikki bosqich:
  //   a) har buyurtmaga muddatiga ulgurishi uchun BUGUN kamida kerak bo'lgan miqdor (muddati yaqini birinchi);
  //   b) ortib qolgan quvvat — yana muddati yaqin tartibida (oldindan ishlab qo'yish).
  // Shunda vaqti bor buyurtma quvvatni oldindan egallab, boshqasini kechiktirib qo'ymaydi,
  // quvvat yetmaganda esa muddati yaqin buyurtmalar birinchi himoyalanadi.
  const lastDate = rows.reduce((m, r) => (r.o.deadline > m ? r.o.deadline : m), addDays(today, HORIZON));
  const wdIdx = new Map(); // sana → bugundan shu kungacha (shu kun ham) ish kunlari soni
  for (let d = today, n = 0; d <= lastDate; d = addDays(d, 1)) {
    if (isWorkDay(d, cfg)) n++;
    wdIdx.set(d, n);
  }
  const byDeadline = (a, b) => (a.o.deadline || "9999-99-99").localeCompare(b.o.deadline || "9999-99-99") || a.o.no - b.o.no;
  rows.sort(byDeadline);
  // mahsulot qoliplarining date'dan keyingi (date kirmaydi) ish kunlaridagi quvvati, muddatgacha
  const futureCap = (pid, date, dl) => (!dl || dl <= date ? 0 : Math.floor((capacity[pid]?.perDay || 0) * (wdIdx.get(dl) - wdIdx.get(date)) + 1e-9));
  const minimums = (date) => {
    const need = new Map();
    const cum = {};
    const given = {};
    for (const r of rows) {
      if (r.left <= 0 || !r.o.deadline) continue;
      const pid = r.o.productId;
      cum[pid] = (cum[pid] || 0) + r.left;
      const req = Math.max(0, cum[pid] - futureCap(pid, date, r.o.deadline) - (given[pid] || 0));
      need.set(r, req);
      given[pid] = (given[pid] || 0) + req;
    }
    return need;
  };
  const acc = {}; // qolip quvvatining kasr qismi (masalan 2,5 dona/kun → 2, 3, 2, 3…)
  const days = [];
  let pending = rows.filter((r) => r.left > 0 && capacity[r.o.productId]?.perDay > 0).length;
  for (let i = 0, date = today; i < HORIZON && pending > 0; i++, date = addDays(date, 1)) {
    if (!isWorkDay(date, cfg)) continue;
    const cap = {};
    let concrete = cfg.concretePerDay > 0 ? cfg.concretePerDay : Infinity;
    for (const [id, c] of Object.entries(capacity)) {
      if (!(c.perDay > 0)) continue;
      acc[id] = (acc[id] || 0) + c.perDay;
      cap[id] = Math.floor(acc[id] + 1e-9);
      acc[id] -= cap[id];
      if (date === today) cap[id] = Math.max(0, cap[id] - (+todayFact[id] || 0));
    }
    if (date === today && concrete !== Infinity) {
      for (const [id, q] of Object.entries(todayFact)) concrete -= (+prod.get(id)?.volume || 0) * (+q || 0);
      concrete = Math.max(0, concrete);
    }
    const made = new Map();
    let used = 0;
    const give = (r, want, note) => {
      const pid = r.o.productId;
      const vol = +prod.get(pid)?.volume || 0;
      const byConcrete = vol > 0 && concrete !== Infinity ? Math.floor(concrete / vol + 1e-9) : Infinity;
      const take = Math.max(0, Math.min(want, r.left, cap[pid] || 0, byConcrete));
      if (note && take < r.left) r.limit[byConcrete < (cap[pid] || 0) ? "beton" : "qolip"]++;
      if (take <= 0) return;
      r.left -= take;
      r.first ||= date;
      cap[pid] -= take;
      if (concrete !== Infinity) concrete -= take * vol;
      used += take * vol;
      made.set(r, (made.get(r) || 0) + take);
      if (r.left <= 0) {
        r.finish = date;
        pending--;
      }
    };
    for (const [r, q] of minimums(date)) if (q > 0) give(r, q, false);
    for (const r of rows) if (r.left > 0) give(r, r.left, true);
    const items = [...made].map(([r, qty]) => ({ orderId: r.o.orderId || r.o.id, lineId: r.o.id, no: r.o.no, productId: r.o.productId, qty, extra: r.o.extra }));
    if (days.length < showDays) days.push({ date, items, concrete: Math.round(used * 1000) / 1000 });
  }

  // 3) natija
  const out = rows.map((r) => {
    const { o } = r;
    const c = capacity[o.productId] || { perDay: 0, basis: null };
    const deadline = o.deadline || "";
    const toProduce = r.remaining - r.fromStock;
    let status = "ok";
    let lateDays = 0;
    let slack = null;
    const daysLeft = deadline && deadline >= today ? workDaysBetween(today, deadline, cfg) : 0;
    if (toProduce === 0) status = "stock";
    else if (!r.finish) status = c.perDay > 0 ? "far" : "nocap";
    else if (deadline) {
      if (r.finish > deadline) {
        status = "late";
        lateDays = dayDiff(deadline, r.finish);
      } else {
        slack = workDaysBetween(addDays(r.finish, 1), deadline, cfg);
        if (slack < RISK_SLACK) status = "risk";
      }
    }
    return {
      id: o.id,
      orderId: o.orderId || o.id,
      no: o.extra ? null : o.no,
      extra: o.extra,
      customer: o.customer,
      productId: o.productId,
      qty: +o.qty || 0,
      shipped: +o.shipped || 0,
      remaining: r.remaining,
      fromStock: r.fromStock,
      toProduce,
      start: r.first,
      finish: r.finish,
      deadline,
      daysLeft,
      needPerDay: deadline && daysLeft > 0 && toProduce > 0 ? Math.ceil(toProduce / daysLeft) : null,
      perDay: Math.round(c.perDay * 100) / 100,
      basis: c.basis,
      status,
      lateDays,
      slack,
      bottleneck: r.limit.beton > r.limit.qolip ? "beton" : r.limit.qolip > 0 ? "qolip" : null,
    };
  });

  return { today, settings: cfg, capacity, orders: out, days };
}

/** «Shu buyurtmani olsak nima bo'ladi?» — yangi buyurtma natijasi va boshqalarga ta'siri */
export function checkNewOrder(input, extra) {
  const base = planOrders({ ...input, showDays: 0 });
  const withNew = planOrders({ ...input, extra });
  const before = new Map(base.orders.map((o) => [o.id, o]));
  const affected = withNew.orders
    .filter((o) => !o.extra)
    .map((o) => ({ o, b: before.get(o.id) }))
    .filter(({ o, b }) => b && (o.finish || "9999") > (b.finish || "9999"))
    .map(({ o, b }) => ({ id: o.id, no: o.no, customer: o.customer, productId: o.productId, deadline: o.deadline, finishBefore: b.finish, finishAfter: o.finish, becomesLate: o.status === "late" && b.status !== "late" }));
  // hech kimni surmasdan eng erta tugash: yangi buyurtma navbatning oxirida
  const last = planOrders({ ...input, extra: { ...extra, deadline: "" }, showDays: 0 }).orders.find((o) => o.extra);
  const mine = withNew.orders.find((o) => o.extra);
  return { order: mine, affected, finishWithoutDelay: last?.finish || null, days: withNew.days, capacity: withNew.capacity, settings: withNew.settings };
}
