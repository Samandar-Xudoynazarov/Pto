/**
 * Chiroyli taxlangan Excel fayl: sarlavha, korxona va sana, rangli ustun nomlari, ramkalar,
 * son formatlari, jami qatori, muzlatilgan sarlavha, filtr va chop etish sozlamalari.
 *
 * sheets: [{
 *   name, title, subtitle?,
 *   columns: [{ header, key, width?, type?: "text"|"int"|"num"|"money"|"pct"|"date", total?: "sum", align? }],
 *   rows: [{ [key]: qiymat, _style?: "warn"|"bad"|"ok"|"bold" }],
 *   totalLabel?,             // jami qatorining nomi (birinchi ustunda)
 *   notes?: [string],        // jadval ostidagi izohlar
 * }]
 */
import { tr } from "./i18n";
import { deliver, newWorkbook } from "./excel";

const HEAD_FILL = "FF1F3A68";
const ZEBRA = "FFF4F6FA";
const TOTAL_FILL = "FFE8EFFD";
const LINE = { style: "thin", color: { argb: "FFD5DBE5" } };
const BOX = { top: LINE, left: LINE, bottom: LINE, right: LINE };
const FMT = { int: "#,##0", num: "#,##0.###", money: "#,##0", pct: "0\" %\"" };
const STYLE_FONT = { warn: { color: { argb: "FFB45309" } }, bad: { color: { argb: "FFDC2626" }, bold: true }, ok: { color: { argb: "FF15803D" } }, bold: { bold: true } };

const colLetter = (n) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const stamp = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
// Excel varaq nomi: 31 belgi, []:*?/\ taqiqlangan
const sheetName = (s, used) => {
  // «'» varaq nomida chop etish sohasini buzadi (Excel faylni «tiklash»ga urinadi) — «ʼ» bilan almashtiramiz
  let n = String(s).replace(/[[\]:*?/\\]/g, " ").replace(/'/g, "ʼ").slice(0, 31) || "Sheet";
  for (let i = 2; used.has(n); i++) n = `${n.slice(0, 28)} ${i}`;
  used.add(n);
  return n;
};

function addSheet(wb, sh, company, used) {
  const cols = sh.columns;
  const ws = wb.addWorksheet(sheetName(sh.name, used), {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: cols.length > 6 ? "landscape" : "portrait", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L${sh.title}&R&P / &N` },
  });
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width || (c.type && c.type !== "text" ? 14 : 24)));
  const last = colLetter(cols.length);

  // 1-qator: sarlavha, 2-qator: korxona · sana · izoh
  ws.mergeCells(`A1:${last}1`);
  ws.getCell("A1").value = sh.title;
  ws.getCell("A1").font = { size: 15, bold: true, color: { argb: "FF0F172A" } };
  ws.getRow(1).height = 24;
  ws.mergeCells(`A2:${last}2`);
  ws.getCell("A2").value = [company, sh.subtitle, `${tr("Tayyorlandi")}: ${stamp()}`].filter(Boolean).join("  ·  ");
  ws.getCell("A2").font = { size: 10, color: { argb: "FF64748B" } };
  ws.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  const totalWidth = cols.reduce((s, c) => s + (c.width || 14), 0);
  const subLen = String(ws.getCell("A2").value || "").length;
  ws.getRow(2).height = subLen > totalWidth * 1.1 ? 30 : 16;

  // 4-qator: ustun nomlari
  const head = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10.5 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    cell.alignment = { vertical: "middle", horizontal: c.type && c.type !== "text" && c.type !== "date" ? "right" : "left", wrapText: true, indent: 1 };
    cell.border = BOX;
  });
  head.height = 30;

  // ma'lumotlar
  const first = 5;
  sh.rows.forEach((r, ri) => {
    const row = ws.getRow(first + ri);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      let v = r[c.key];
      if (v === undefined || v === "") v = null;
      if (c.type && c.type !== "text" && c.type !== "date" && v !== null) v = Number.isFinite(+v) ? +v : v;
      cell.value = v;
      if (FMT[c.type]) cell.numFmt = FMT[c.type];
      cell.border = BOX;
      const right = c.type && c.type !== "text" && c.type !== "date";
      cell.alignment = { vertical: "middle", horizontal: c.align || (right ? "right" : "left"), wrapText: c.type === "text" || !c.type, indent: 1 };
      if (ri % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      const st = r._style && STYLE_FONT[r._style];
      if (st) cell.font = st;
      if (r._cell?.[c.key]) cell.font = STYLE_FONT[r._cell[c.key]];
    });
  });
  const lastRow = first + sh.rows.length - 1;

  // jami qatori — formulalar bilan (filtrlanganda ham to'g'ri: SUBTOTAL)
  let end = lastRow;
  if (sh.rows.length && cols.some((c) => c.total)) {
    end = lastRow + 1;
    const row = ws.getRow(end);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const L = colLetter(i + 1);
      if (i === 0) cell.value = sh.totalLabel || tr("Jami");
      else if (c.total === "sum") {
        const result = sh.rows.reduce((s, r) => s + (+r[c.key] || 0), 0);
        cell.value = { formula: `SUBTOTAL(109,${L}${first}:${L}${lastRow})`, result };
        cell.numFmt = FMT[c.type] || FMT.num;
      }
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
      cell.border = { ...BOX, top: { style: "medium", color: { argb: "FF1F3A68" } } };
      cell.alignment = { horizontal: i === 0 ? "left" : "right", indent: 1 };
    });
  }
  if (sh.rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastRow, column: cols.length } };
  if (!sh.rows.length) {
    ws.mergeCells(`A5:${last}5`);
    ws.getCell("A5").value = tr("Ma'lumot yo'q");
    ws.getCell("A5").font = { italic: true, color: { argb: "FF94A3B8" } };
  }
  (sh.notes || []).forEach((n, i) => {
    const r = end + 2 + i;
    ws.mergeCells(`A${r}:${last}${r}`);
    ws.getCell(`A${r}`).value = n;
    ws.getCell(`A${r}`).font = { size: 9.5, color: { argb: "FF64748B" } };
    ws.getCell(`A${r}`).alignment = { wrapText: true };
  });
  ws.pageSetup.printTitlesRow = "4:4";
  ws.pageSetup.printArea = `A1:${last}${end + (sh.notes?.length ? sh.notes.length + 1 : 0)}`;
  return ws;
}

/** Fayl yasab, yuklab beradi yoki (share=true) Telegram va boshqalarga ulashadi */
export async function exportSheets({ filename, sheets, company, share = false }) {
  const wb = await newWorkbook();
  const used = new Set();
  for (const sh of sheets) addSheet(wb, sh, company, used);
  // fayl nomi — faqat lotin harflari, raqam, «-», «_», «.» (har qanday telefon va Telegram'da buzilmaydi)
  return deliver(wb, filename.replace(/['’ʻ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_"), { share });
}

/** Fayl nomi uchun bugungi sana: 2026-09-25 */
export const fileDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
