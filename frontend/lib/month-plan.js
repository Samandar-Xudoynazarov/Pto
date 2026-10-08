/**
 * Oylik ishlab chiqarish rejasi (tasdiqlangan reja): Excel'dan o'qish, katalog bilan bog'lash,
 * hisoblar va rahbar shaklidagi Excel faylni tuzish.
 *
 * Reja: { month, customers: [nom], extraCols: [nom], rows: [{ productId, name, unit, orders: [], shipped, extra: [], days: [], m3 }] }
 * Qoldiq (Остаток заказа) = Σ buyurtma − jo'natildi − Σ qo'shimcha ustunlar − Σ kunlar (rahbar Excel'idagi formula)
 */
import { concreteVolume, monthDays } from "./calc";
import { deliver, newWorkbook } from "./excel";
import { tr } from "./i18n";

export const sum = (a) => (a || []).reduce((s, x) => s + (+x || 0), 0);
export const rowOrdered = (r) => sum(r.orders);
export const rowTotal = (r) => sum(r.days);
export const rowLeft = (r) => rowOrdered(r) - (+r.shipped || 0) - sum(r.extra) - rowTotal(r);

export const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_UZ = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
// «Остаток от Августа» → август (кирилл ва лотин, келишик қўшимчаси билан)
const MONTH_STEMS = [
  ["январ", "yanvar"], ["феврал", "fevral"], ["март", "mart"], ["апрел", "aprel"], ["ма[йя]", "may"], ["июн", "iyun"],
  ["июл", "iyul"], ["август", "avgust"], ["сентябр", "sentyabr"], ["октябр", "oktyabr"], ["ноябр", "noyabr"], ["декабр", "dekabr"],
];

export const monthTitle = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `${tr(MONTHS_UZ[m - 1])} ${y}`;
};
export const shiftMonth = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
export const emptyRow = (nDays) => ({ productId: "", name: "", unit: "шт", orders: [], shipped: 0, extra: [], days: Array(nDays).fill(0), m3: 0 });

/** Reja qatorlarini oyning kunlar soniga va ustunlar soniga moslash */
export function normalizePlan(p, month) {
  const n = monthDays(month);
  const customers = [...(p?.customers || [])];
  const extraCols = [...(p?.extraCols || [])];
  return {
    ...p,
    month,
    customers,
    extraCols,
    rows: (p?.rows || []).map((r) => ({
      productId: r.productId ? String(r.productId) : "",
      name: r.name || "",
      unit: r.unit || "шт",
      orders: customers.map((_, i) => +r.orders?.[i] || 0),
      shipped: +r.shipped || 0,
      extra: extraCols.map((_, i) => +r.extra?.[i] || 0),
      days: Array.from({ length: n }, (_, i) => +r.days?.[i] || 0),
      m3: +r.m3 || 0,
      note: r.note || "",
    })),
  };
}

/* ================= katalog bilan bog'lash ================= */
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/,/g, ".")
    .replace(/[\s_]+/g, "");

/** Excel'dagi nom (masalan «Фундамент Ф5-Усу(250)») → katalogdagi mahsulot: nom ichida marka bo'lsa, eng uzun mos keladigani */
export function matchProduct(name, products) {
  const n = norm(name);
  if (!n) return null;
  let best = null;
  let bestLen = 0;
  for (const p of products) {
    const c = norm(p.code);
    if (c.length < 2 || !n.includes(c)) continue;
    // marka nomning oxirida bo'lsa — ishonchliroq
    const score = c.length + (n.endsWith(c) ? 0.5 : 0);
    if (score > bestLen) {
      best = p;
      bestLen = score;
    }
  }
  return best;
}

/* ================= Excel'dan o'qish ================= */
const cellVal = (v) => {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) return v.result ?? null; // formula
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join("");
    if ("text" in v) return v.text;
    return null;
  }
  return v;
};
const txt = (v) => String(cellVal(v) ?? "").replace(/\s+/g, " ").trim();
const numv = (v) => {
  const x = cellVal(v);
  if (typeof x === "number") return x;
  const n = parseFloat(String(x ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Rahbar Excel'ini o'qiydi. Sarlavha qatori «Наименование» so'zi bo'yicha topiladi:
 *  kunlar — 1..31 raqamli ustunlar; «Отгружено» — jo'natildi; «Остаток от …» — qo'shimcha ustunlar;
 *  «м3 за 1шт» — hajm; «Производство», «Остаток заказа», «Общая м3» — hisoblanadi (o'qilmaydi);
 *  qolgan matnli ustunlar (birlik va kunlar orasida) — buyurtmachilar.
 * Qaytaradi: { customers, extraCols, rows, guessMonth, sheet, warnings }
 */
export async function parseBossExcel(buffer, products, mats) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  let found = null;
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (found || rn > 30) return;
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        if (!found && /наим|nomi|mahsulot/i.test(txt(cell.value))) found = { ws, rn, nameCol: cn };
      });
    });
    if (found) break;
  }
  if (!found) throw new Error("Excel'da «Наименование» ustuni topilmadi — oylik reja shaklidagi faylni tanlang");
  const { ws, rn, nameCol } = found;
  const head = ws.getRow(rn);
  const cols = { day: new Map(), customers: [], extra: [], unit: 0, shipped: 0, m3: 0, no: 0 };
  const lastCol = Math.max(ws.columnCount, head.cellCount);
  let firstDay = Infinity;
  const info = [];
  for (let c = 1; c <= lastCol; c++) {
    const raw = cellVal(head.getCell(c).value);
    const t = txt(raw).toLowerCase();
    const dn = typeof raw === "number" ? raw : /^\d{1,2}$/.test(t) ? +t : NaN;
    if (Number.isInteger(dn) && dn >= 1 && dn <= 31 && c > nameCol) {
      cols.day.set(c, dn);
      firstDay = Math.min(firstDay, c);
      continue;
    }
    info.push([c, t, txt(raw)]);
  }
  if (!cols.day.size) throw new Error("Excel'da kunlar (1, 2, 3 …) ustunlari topilmadi");
  for (const [c, t, label] of info) {
    if (!t || c === nameCol) continue;
    if (c < nameCol && (t === "№" || t === "n" || t.startsWith("№"))) cols.no = c;
    else if (/изм[еиа]р|ед\.?\s*изм|^ед\.?$|birlik|o'lchov/.test(t)) cols.unit = c;
    else if (/отгруж|jo'nat/.test(t)) cols.shipped = c;
    else if (/м3\s*за|m3\s*1|1\s*шт|м³\s*за|hajm/.test(t)) cols.m3 = c;
    else if (/производ|итого|общая|остаток\s*заказ|qoldiq\s*buyurtma|jami/.test(t)) continue;
    else if (/остаток|qoldiq|ostatok/.test(t)) cols.extra.push([c, label]);
    else if (c > nameCol && c < firstDay) cols.customers.push([c, label]);
  }

  const rows = [];
  const warnings = [];
  for (let r = rn + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = txt(row.getCell(nameCol).value);
    const first = txt(row.getCell(1).value);
    if (/итог|jami|всего/i.test(name) || /итог|jami|всего/i.test(first)) break;
    if (!name) continue;
    const days = Array(31).fill(0);
    for (const [c, d] of cols.day) days[d - 1] = Math.max(0, numv(row.getCell(c).value));
    const p = matchProduct(name, products);
    const m3x = cols.m3 ? numv(row.getCell(cols.m3).value) : 0;
    rows.push({
      productId: p?.id || "",
      name,
      unit: cols.unit ? txt(row.getCell(cols.unit).value) || "шт" : "шт",
      orders: cols.customers.map(([c]) => Math.max(0, numv(row.getCell(c).value))),
      shipped: cols.shipped ? Math.max(0, numv(row.getCell(cols.shipped).value)) : 0,
      extra: cols.extra.map(([c]) => numv(row.getCell(c).value)),
      days,
      m3: m3x > 0 ? m3x : p && mats ? Math.round(concreteVolume(p, mats) * 1000) / 1000 : 0,
      note: "",
      _excelRow: r,
    });
  }
  if (!rows.length) throw new Error("Excel'da mahsulot qatorlari topilmadi");

  // oyni taxmin qilish: «Остаток от Августа» → keyingi oy (sentyabr)
  let guessPrev = -1;
  for (const [, label] of cols.extra) {
    const l = label.toLowerCase();
    const i = MONTH_STEMS.findIndex(([ru, uz]) => new RegExp(ru).test(l) || l.includes(uz));
    if (i >= 0) guessPrev = i;
  }
  const maxDay = Math.max(...cols.day.values());
  return {
    sheet: ws.name,
    customers: cols.customers.map(([, l]) => l),
    extraCols: cols.extra.map(([, l]) => l),
    rows,
    prevMonthIdx: guessPrev, // 0..11 yoki -1
    maxDay,
    warnings,
  };
}

/** Taxminiy oy: «Остаток от Августа» bo'lsa — sentyabr; yil — joriy oyga eng yaqini */
export function guessMonth(prevMonthIdx, fallback) {
  if (prevMonthIdx < 0) return fallback;
  const m = (prevMonthIdx + 1) % 12; // 0..11
  const [fy] = fallback.split("-").map(Number);
  const cands = [fy - 1, fy, fy + 1].map((y) => `${y}-${String(m + 1).padStart(2, "0")}`);
  const dist = (a) => Math.abs((+a.slice(0, 4) * 12 + +a.slice(5, 7)) - (+fallback.slice(0, 4) * 12 + +fallback.slice(5, 7)));
  return cands.sort((a, b) => dist(a) - dist(b))[0];
}

/* ================= faol buyurtmalar va dastur taklifidan reja ================= */
/** Faol buyurtmalardan qatorlar: buyurtmachi — ustun, mahsulot — qator */
export function rowsFromOrders(orders, products, mats, month, base = { customers: [], extraCols: [], rows: [] }) {
  const n = monthDays(month);
  const prods = new Map(products.map((p) => [p.id, p]));
  const customers = [...base.customers];
  const rows = base.rows.map((r) => ({ ...r, orders: [...r.orders] }));
  const colOf = (name) => {
    const k = customers.findIndex((c) => c.trim().toLowerCase() === name.trim().toLowerCase());
    if (k >= 0) return k;
    customers.push(name);
    for (const r of rows) r.orders.push(0);
    return customers.length - 1;
  };
  const active = orders.filter((o) => o.status !== "tayyor" && o.status !== "topshirildi" && (o.left ?? 1) > 0);
  let added = 0;
  for (const o of active) {
    for (const it of o.items || []) {
      if (!(it.left > 0)) continue;
      const ci = colOf(o.customer || "—");
      let r = rows.find((x) => x.productId === it.productId);
      if (!r) {
        const p = prods.get(it.productId);
        r = {
          ...emptyRow(n),
          productId: it.productId,
          name: p ? `${p.name ? p.name + " " : ""}${p.code}` : "",
          orders: customers.map(() => 0),
          extra: base.extraCols.map(() => 0),
          m3: p ? Math.round(concreteVolume(p, mats) * 1000) / 1000 : 0,
        };
        rows.push(r);
        added++;
      }
      r.orders[ci] = (r.orders[ci] || 0) + it.qty;
      r.shipped = (+r.shipped || 0) + (it.shipped || 0);
    }
  }
  return { customers, extraCols: base.extraCols, rows, added };
}

/** O'tgan kunlar (bugundan oldingi) — kunlik hisobotdagi faktdan. facts: Map(mahsulot → [kunlar]) */
export function applyPastFacts(plan, facts, todayIdx, products, mats) {
  const upto = Math.min(todayIdx, plan.rows[0]?.days.length ?? 31);
  if (!(upto > 0) || !facts) return { ...plan, pastCells: 0 };
  const prods = new Map(products.map((p) => [p.id, p]));
  const n = plan.rows[0]?.days.length ?? monthDays(plan.month);
  const rows = plan.rows.map((r) => ({ ...r, days: [...r.days] }));
  let pastCells = 0;
  for (const r of rows) if (r.productId) for (let i = 0; i < upto; i++) r.days[i] = 0;
  for (const [pid, arr] of facts) {
    if (!arr.slice(0, upto).some((v) => v > 0)) continue;
    let r = rows.find((x) => x.productId === pid);
    if (!r) {
      const p = prods.get(pid);
      if (!p) continue;
      r = { ...emptyRow(n), productId: pid, name: `${p.name ? p.name + " " : ""}${p.code}`, orders: plan.customers.map(() => 0), extra: plan.extraCols.map(() => 0), m3: Math.round(concreteVolume(p, mats) * 1000) / 1000 };
      rows.push(r);
    }
    for (let i = 0; i < upto; i++) if (arr[i] > 0) (r.days[i] = arr[i]), pastCells++;
  }
  return { ...plan, rows, pastCells };
}

/** Dastur taklifi (/plan) kunlarini shu oy jadvaliga ko'chirish */
export function applyProgramDays(plan, programDays, month) {
  const rows = plan.rows.map((r) => ({ ...r, days: [...r.days] }));
  let cells = 0;
  for (const d of programDays || []) {
    if (d.date.slice(0, 7) !== month) continue;
    const di = +d.date.slice(8, 10) - 1;
    for (const it of d.items) {
      const r = rows.find((x) => x.productId === it.productId);
      if (!r) continue;
      r.days[di] = (r.days[di] || 0) + it.qty;
      cells++;
    }
  }
  return { ...plan, rows, cells };
}

/**
 * Qatorning qoldig'ini tanlangan ish kunlariga teng taqsimlash (oldingi qiymatlar tozalanadi).
 * batch — lotok qopqog'i: kuniga yo butun partiya (masalan 4), yo 0 — partiyalar ketma-ket ish kunlariga
 */
export function spreadRow(row, workDayIdx, batch = 0) {
  const need = Math.max(0, rowOrdered(row) - (+row.shipped || 0) - sum(row.extra) - row.days.reduce((s, x, i) => s + (workDayIdx.includes(i) ? 0 : +x || 0), 0));
  const days = row.days.map((x, i) => (workDayIdx.includes(i) ? 0 : x));
  if (!need || !workDayIdx.length) return { ...row, days };
  if (batch > 0) {
    let left = need;
    for (const i of workDayIdx) {
      if (left <= 0) break;
      days[i] = batch;
      left -= batch;
    }
    return { ...row, days };
  }
  const base = Math.floor(need / workDayIdx.length);
  let rest = need - base * workDayIdx.length;
  for (const i of workDayIdx) {
    days[i] = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
  }
  return { ...row, days };
}

/* ================= rahbar shaklidagi Excel ================= */
const colL = (n) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/**
 * Rahbar Excel'i ko'rinishida (formulalar bilan) fayl: 1-varaq — reja, 2-varaq (bo'lsa) — fakt.
 * facts: Map(productId → [kun bo'yicha fakt]) yoki null
 */
export async function exportMonthPlanXlsx(plan, { company, facts, isOff, share = false } = {}) {
  const wb = await newWorkbook();
  const n = monthDays(plan.month);
  const [y, m] = plan.month.split("-").map(Number);
  const title = `${tr("Ishlab chiqarish rejasi")} — ${MONTHS_RU[m - 1]} ${y}`;
  const sheets = [[tr("Reja"), (r) => r.days]];
  if (facts) sheets.push([tr("Fakt"), (r) => (r.productId && facts.get(r.productId)) || Array(n).fill(0)]);
  const LINE = { style: "thin", color: { argb: "FFB8C2D1" } };
  const BOX = { top: LINE, left: LINE, bottom: LINE, right: LINE };
  for (const [name, getDays] of sheets) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", xSplit: 3, ySplit: 3, showGridLines: false }],
      pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    });
    const C = plan.customers.length;
    const E = plan.extraCols.length;
    // ustunlar: № | Наименование | Изм | buyurtmachilar | Отгружено | qo'shimcha | 1..n | Производство | Остаток заказа | м3 за 1шт | Общая м3
    const cNo = 1, cName = 2, cUnit = 3, cCust = 4, cShip = cCust + C, cExtra = cShip + 1, cDay = cExtra + E, cProd = cDay + n, cLeft = cProd + 1, cM3 = cLeft + 1, cTotM3 = cM3 + 1;
    const head = ["№", "Наименования", "Измерения", ...plan.customers, "Отгружено", ...plan.extraCols, ...Array.from({ length: n }, (_, i) => i + 1), "Производство", "Остаток Заказа", "м3 за 1шт", "Общая м3"];
    ws.mergeCells(1, 1, 1, cTotM3);
    ws.getCell(1, 1).value = company ? `${company} · ${title}` : title;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getRow(1).height = 22;
    ws.getCell(2, 1).value = name === tr("Fakt") ? tr("Kunlik hisobotdagi fakt (sifatli dona)") : plan.title || "";
    ws.getCell(2, 1).font = { size: 10, color: { argb: "FF64748B" } };
    const hr = ws.getRow(3);
    head.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A68" } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BOX;
    });
    hr.height = 36;
    for (let d = 0; d < n; d++) {
      const date = `${plan.month}-${String(d + 1).padStart(2, "0")}`;
      if (isOff?.(date)) hr.getCell(cDay + d).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8A94A6" } };
    }
    ws.getColumn(cNo).width = 5;
    ws.getColumn(cName).width = 30;
    ws.getColumn(cUnit).width = 7;
    for (let i = cCust; i < cDay; i++) ws.getColumn(i).width = 10;
    for (let i = cDay; i < cProd; i++) ws.getColumn(i).width = 4.6;
    for (const i of [cProd, cLeft, cM3, cTotM3]) ws.getColumn(i).width = 11;
    const first = 4;
    plan.rows.forEach((r, k) => {
      const rn = first + k;
      const row = ws.getRow(rn);
      const days = getDays(r);
      row.getCell(cNo).value = k + 1;
      row.getCell(cName).value = r.name;
      row.getCell(cUnit).value = r.unit || "шт";
      plan.customers.forEach((_, i) => (row.getCell(cCust + i).value = r.orders[i] || null));
      row.getCell(cShip).value = +r.shipped || 0;
      plan.extraCols.forEach((_, i) => (row.getCell(cExtra + i).value = r.extra[i] || null));
      for (let d = 0; d < n; d++) row.getCell(cDay + d).value = +days[d] || null;
      const L = colL;
      row.getCell(cProd).value = { formula: `SUM(${L(cDay)}${rn}:${L(cDay + n - 1)}${rn})` };
      const ord = C ? `SUM(${L(cCust)}${rn}:${L(cCust + C - 1)}${rn})` : "0";
      const ext = E ? `-SUM(${L(cExtra)}${rn}:${L(cExtra + E - 1)}${rn})` : "";
      row.getCell(cLeft).value = { formula: `${ord}-${L(cShip)}${rn}${ext}-${L(cProd)}${rn}` };
      row.getCell(cM3).value = +r.m3 || 0;
      row.getCell(cTotM3).value = { formula: `${L(cM3)}${rn}*${L(cProd)}${rn}` };
      for (let c = 1; c <= cTotM3; c++) {
        const cell = row.getCell(c);
        cell.border = BOX;
        cell.font = { size: 10, bold: c === cProd };
        if (c >= cCust) cell.alignment = { horizontal: "center" };
        if (c === cM3 || c === cTotM3) cell.numFmt = "0.0##";
      }
      for (let d = 0; d < n; d++) {
        const date = `${plan.month}-${String(d + 1).padStart(2, "0")}`;
        if (isOff?.(date)) row.getCell(cDay + d).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F6" } };
      }
    });
    const tr2 = first + plan.rows.length;
    const tot = ws.getRow(tr2);
    ws.mergeCells(tr2, 1, tr2, 3);
    tot.getCell(1).value = "ИТОГО";
    const last = tr2 - 1;
    const sumCols = [...Array.from({ length: C }, (_, i) => cCust + i), cShip, ...Array.from({ length: E }, (_, i) => cExtra + i), ...Array.from({ length: n }, (_, i) => cDay + i), cProd, cLeft, cTotM3];
    if (plan.rows.length) for (const c of sumCols) tot.getCell(c).value = { formula: `SUM(${colL(c)}${first}:${colL(c)}${last})` };
    for (let c = 1; c <= cTotM3; c++) {
      const cell = tot.getCell(c);
      cell.border = BOX;
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EFFD" } };
      if (c >= cCust) cell.alignment = { horizontal: "center" };
      if (c === cTotM3) cell.numFmt = "0.0##";
    }
  }
  return deliver(wb, `Oylik_reja_${plan.month}.xlsx`, { share });
}
