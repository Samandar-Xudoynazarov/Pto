/**
 * Kunlik hisobotni zavoddagi Excel shakli bo'yicha yasash:
 * «Ежедневная информация о выпуске ЖБИ и об остатках основных материалов … на ДД.ММ.ГГГГ»
 * chapda xomashyo (В начала / Расход / Приход / Остатка), o'ngda mahsulot
 * (в начала / Приход / Отправка / Остатка), pastda «Отгрузка:» va imzolar.
 */
import { fmtDate } from "./calc";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const thin = { style: "thin" };
const medium = { style: "medium" };
const box = (b) => ({ top: b, left: b, bottom: b, right: b });
const NUM = "#,##0.000";

/** Metall ombor faylida tonnada yuritiladi — ilovada kg, Excel'da t */
export function xlsUnit(m) {
  if (m.group === "metall" && m.unit === "кг") return { label: "т", k: 1 / 1000 };
  if (m.unit === "т") return { label: "тонна", k: 1 };
  return { label: m.unit, k: 1 };
}

function sum(list, key) {
  const out = new Map();
  for (const l of list || []) out.set(l[key.id], (out.get(l[key.id]) || 0) + (+l[key.q] || 0));
  return out;
}

/** Bitta kun uchun raqamlar: start — kun boshidagi qoldiq (Map) */
export function dayFigures(day, matStart, prodStart) {
  const sarf = sum(day?.materials, { id: "materialId", q: "sarf" });
  const kirim = sum(day?.materials, { id: "materialId", q: "kirim" });
  const fact = sum(day?.production, { id: "productId", q: "fact" });
  const shipped = sum(day?.shipments, { id: "productId", q: "qty" });
  const matEnd = new Map();
  const ids = new Set([...matStart.keys(), ...sarf.keys(), ...kirim.keys()]);
  for (const id of ids) matEnd.set(id, (matStart.get(id) || 0) - (sarf.get(id) || 0) + (kirim.get(id) || 0));
  const prodEnd = new Map();
  const pids = new Set([...prodStart.keys(), ...fact.keys(), ...shipped.keys()]);
  for (const id of pids) prodEnd.set(id, (prodStart.get(id) || 0) + (fact.get(id) || 0) - (shipped.get(id) || 0));
  return { sarf, kirim, fact, shipped, matEnd, prodEnd };
}

/** Jo'natishlarni «qayerga + mashina» bo'yicha guruhlab, qatorga 2 tadan mahsulot */
function shipmentLines(shipments, prods) {
  const groups = [];
  for (const s of shipments || []) {
    const key = `${s.customer || ""}|${s.vehicle || ""}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, customer: s.customer || "", vehicle: s.vehicle || "", items: [] }));
    g.items.push({ name: prods.get(s.productId)?.code || "?", qty: s.qty });
  }
  const lines = [];
  for (const g of groups) for (let i = 0; i < g.items.length; i += 2) lines.push({ customer: g.customer, vehicle: g.vehicle, items: g.items.slice(i, i + 2) });
  return lines;
}

/**
 * Ishchi kitobga bitta kun varag'ini qo'shadi.
 * matList / prodList — qatorlar tartibi (oylik faylda barcha varaqlarda bir xil, formulalar oldingi varaqqa bog'lanadi).
 */
export function addDaySheet(wb, { date, company, signers, matList, prodList, prods, day, matStart, prodStart, prevSheet }) {
  const ws = wb.addWorksheet(date.slice(8, 10), {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.4, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  });
  const widths = { A: 2, B: 5, C: 40, D: 11, E: 10, F: 10, G: 11, H: 8, I: 5, J: 20, K: 10, L: 9, M: 11, N: 10 };
  for (const [c, w] of Object.entries(widths)) ws.getColumn(c).width = w;
  const F = dayFigures(day, matStart, prodStart);
  const font = { name: "Calibri", size: 11 };

  // sarlavha
  ws.mergeCells("B2:N3");
  const t = ws.getCell("B2");
  t.value = `Ежедневная информация о выпуске ЖБИ и об остатках основных материалов${company ? ` по ${company}` : ""} на ${fmtDate(date)}`;
  t.font = { ...font, size: 14, bold: true };
  t.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  t.border = box(medium);
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 18;

  ws.mergeCells("B5:G6");
  ws.mergeCells("I5:N6");
  for (const [addr, text] of [["B5", "Сирё Материал"], ["I5", "Махсулот"]]) {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { ...font, bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = box(medium);
  }
  const heads = { B: "№", C: "Наимования", D: "В начала", E: "Расход", F: "Приход", G: "Остатка", I: "№", J: "Наимования", K: "в начала", L: "Приход", M: "Отправка", N: "Остатка" };
  for (const [col, text] of Object.entries(heads)) {
    const c = ws.getCell(`${col}7`);
    c.value = text;
    c.font = { ...font, bold: true };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = box(thin);
  }

  const first = 8;
  const rows = Math.max(matList.length, prodList.length);
  const num = (v) => (Math.abs(v) < 1e-12 ? null : Math.round(v * 1e6) / 1e6);
  matList.forEach((m, i) => {
    const r = first + i;
    const u = xlsUnit(m);
    const start = (matStart.get(m.id) || 0) * u.k;
    const s = (F.sarf.get(m.id) || 0) * u.k;
    const k = (F.kirim.get(m.id) || 0) * u.k;
    ws.getCell(`B${r}`).value = i + 1;
    const name = ws.getCell(`C${r}`);
    name.value = `${m.name} (${u.label})`;
    name.font = { name: "Arial", size: 10, bold: true };
    name.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    ws.getCell(`D${r}`).value = prevSheet ? { formula: `'${prevSheet}'!G${r}`, result: start } : num(start) ?? 0;
    ws.getCell(`E${r}`).value = num(s);
    ws.getCell(`F${r}`).value = num(k);
    ws.getCell(`G${r}`).value = { formula: `D${r}-E${r}+F${r}`, result: start - s + k };
    for (const col of "BCDEFG") ws.getCell(`${col}${r}`).border = box(thin);
    const fmtCell = u.label === "шт" ? "#,##0" : u.label === "п/м" || u.label === "л" ? "#,##0.0#" : NUM;
    for (const col of "DEFG") {
      ws.getCell(`${col}${r}`).numFmt = fmtCell;
      ws.getCell(`${col}${r}`).alignment = { horizontal: "center", vertical: "middle" };
    }
    ws.getCell(`G${r}`).font = { ...font, bold: true };
    ws.getCell(`B${r}`).alignment = { horizontal: "center" };
  });
  prodList.forEach((p, i) => {
    const r = first + i;
    const start = prodStart.get(p.id) || 0;
    const f = F.fact.get(p.id) || 0;
    const sh = F.shipped.get(p.id) || 0;
    ws.getCell(`I${r}`).value = i + 1;
    ws.getCell(`J${r}`).value = p.code;
    ws.getCell(`K${r}`).value = prevSheet ? { formula: `'${prevSheet}'!N${r}`, result: start } : start;
    ws.getCell(`L${r}`).value = f || null;
    ws.getCell(`M${r}`).value = sh || null;
    ws.getCell(`N${r}`).value = { formula: `K${r}+L${r}-M${r}`, result: start + f - sh };
    for (const col of "IJKLMN") ws.getCell(`${col}${r}`).border = box(thin);
    for (const col of "IKLMN") ws.getCell(`${col}${r}`).alignment = { horizontal: "center" };
    ws.getCell(`N${r}`).font = { ...font, bold: true };
  });

  // Отгрузка
  let r = first + rows + 1;
  const lines = shipmentLines(day?.shipments, prods);
  const lbl = ws.getCell(`C${r}`);
  lbl.value = "Отгрузка:";
  lbl.font = { ...font, bold: true };
  if (!lines.length) r += 1;
  lines.forEach((l, i) => {
    const row = r + i;
    ws.getRow(row).height = 21.75;
    ws.mergeCells(`D${row}:E${row}`);
    ws.getCell(`D${row}`).value = l.customer;
    const [a, b] = l.items;
    if (a) {
      ws.getCell(`G${row}`).value = a.name;
      ws.getCell(`H${row}`).value = `${a.qty} шт`;
      ws.getCell(`H${row}`).alignment = { horizontal: "right" };
    }
    if (b) {
      ws.getCell(`J${row}`).value = b.name;
      ws.getCell(`K${row}`).value = `${b.qty} шт`;
      ws.getCell(`K${row}`).alignment = { horizontal: "right" };
    }
    ws.mergeCells(`M${row}:N${row}`);
    ws.getCell(`M${row}`).value = l.vehicle;
    for (const col of "DGHJKM") ws.getCell(`${col}${row}`).alignment = { ...(ws.getCell(`${col}${row}`).alignment || {}), vertical: "middle" };
  });
  r += Math.max(lines.length, 1) + 1;

  for (const s of signers || []) {
    ws.getRow(r).height = 24;
    const c = ws.getCell(`C${r}`);
    c.value = s;
    c.font = { ...font, size: 11 };
    c.alignment = { horizontal: "left", vertical: "middle" };
    ws.getCell(`G${r}`).value = "____________";
    r += 1;
  }
  // Chop etish sohasi imzolar bilan birga: oxirgi qatordan bitta keyin tugaydi.
  // (printArea qisqa bo'lsa, oxirgi imzo qog'ozga tushmay qoladi.)
  const lastRow = r;
  ws.pageSetup.printArea = `B2:N${lastRow}`;
  ws.pageSetup.horizontalCentered = true;
  return ws;
}

/** Qatorga chiqadigan materiallar: omborda hisobga olinadigan va qiymati bor */
export function pickRows(materials, products, matMaps, prodMaps) {
  const nz = (maps, id) => maps.some((mp) => Math.abs(mp.get(id) || 0) > 1e-9);
  return {
    matList: materials.filter((m) => m.stock && nz(matMaps, m.id)),
    prodList: products.filter((p) => nz(prodMaps, p.id)),
  };
}

export async function newWorkbook() {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ПТО ish stoli";
  wb.created = new Date();
  return wb;
}

/** Faylni yuklab olish yoki (telefonda) Telegram va boshqalarga ulashish */
export async function deliver(wb, filename, { share = false } = {}) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: XLSX_MIME });
  if (share) {
    const file = new File([blob], filename, { type: XLSX_MIME });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      } catch (e) {
        if (e?.name === "AbortError") return "cancelled";
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.rel = "noopener";
  a.style.display = "none";
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
  return share ? "downloaded-fallback" : "downloaded";
}

/**
 * Ombor harakatlarini kunlik hisobotlarga qo'shadi (Excel shakli uchun):
 * Приход += ombor kirimi, Расход += ombor chiqimi. Faqat harakat bo'lgan kunlar ham varaq bo'ladi.
 */
export function mergeMoves(days, moves) {
  const map = new Map(days.map((d) => [d.date, { ...d, materials: (d.materials || []).map((l) => ({ ...l })) }]));
  for (const mv of moves || []) {
    if (!map.has(mv.date)) map.set(mv.date, { date: mv.date, production: [], materials: [], shipments: [] });
    const d = map.get(mv.date);
    let l = d.materials.find((x) => x.materialId === mv.materialId);
    if (!l) d.materials.push((l = { materialId: mv.materialId, sarf: 0, kirim: 0 }));
    if (mv.type === "in") l.kirim = (+l.kirim || 0) + mv.qty;
    else l.sarf = (+l.sarf || 0) + mv.qty;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Oylik fayl: har bir kunlik hisobot alohida varaqda (02, 03, …), «В начала» oldingi varaqning «Остатка»siga formula bilan bog'lanadi.
 * startMat/startProd — birinchi kun boshidagi qoldiq (Map).
 */
export function addMonthSheets(wb, { days, startMat, startProd, materials, products, prods, company, signers }) {
  // barcha varaqlarda qatorlar bir xil bo'lishi uchun oldindan hisoblab olamiz
  let mS = new Map(startMat);
  let pS = new Map(startProd);
  const snaps = [];
  for (const d of days) {
    const F = dayFigures(d, mS, pS);
    snaps.push({ d, mS, pS, F });
    mS = F.matEnd;
    pS = F.prodEnd;
  }
  const matMaps = snaps.flatMap((s) => [s.mS, s.F.sarf, s.F.kirim]);
  const prodMaps = snaps.flatMap((s) => [s.pS, s.F.fact, s.F.shipped]);
  const { matList, prodList } = pickRows(materials, products, matMaps, prodMaps);
  let prev = null;
  for (const s of snaps) {
    const ws = addDaySheet(wb, { date: s.d.date, company, signers, matList, prodList, prods, day: s.d, matStart: s.mS, prodStart: s.pS, prevSheet: prev });
    prev = ws.name;
  }
  return snaps.length;
}
