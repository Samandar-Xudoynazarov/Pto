/**
 * Mahsulot kalkulyatsiyasi PDF («Kalkulyatsiya» bo'limidagi karta bilan bir xil tartibda):
 * materiallar → Производственная СС → Другие затраты → Итого → Маржа → Цена без НДС → НДС → Цена с НДС.
 * pdfmake va shrift plan-pdf.js orqali yuklanadi.
 */
import { costCard } from "./calc";

const money = (n, d = 0) => (Number.isFinite(+n) ? +n : 0).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (n, max = 3) => (Number.isFinite(+n) ? +n : 0).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: max });
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const monthRu = (ym) => (ym ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)} г.` : "");
const dateRu = (iso) => (iso ? iso.split("-").reverse().join(".") : "");

function hint(r, c) {
  if (r.type === "m3") return `${money(r.value)} × ${num(c.V, 3)} м³`;
  if (r.type === "kg") return `${money(r.value)} × ${num(c.kg, 2)} кг`;
  if (r.type === "pctPrev" || r.type === "pctSS") return `${num(r.value, 2)} %`;
  return "";
}

/**
 * product — andoza qo'llangan mahsulot (data.prods dan), mats — shu oy narxlari bilan (data.at(month).mats)
 * ctx: { company, month: "YYYY-MM", date: "YYYY-MM-DD", scheme: andoza nomi, signers: [..] }
 */
export function costPdfDefinition(product, mats, ctx = {}) {
  const c = costCard(product, mats);
  const cell = (text, o = {}) => ({ text: text ?? "", fontSize: 9.5, ...o });
  const right = (text, o = {}) => cell(text, { alignment: "right", ...o });
  const body = [
    ["№", "Наименование", "Ед. изм.", "Норма", "Цена, сум", "Сумма, сум"].map((h) => cell(h, { bold: true, alignment: "center", fillColor: "#E9E9E9" })),
  ];
  // materiallar
  c.items.forEach((it, i) =>
    body.push([
      cell(String(i + 1), { alignment: "center" }),
      cell(it.m?.name || "— удалён —"),
      cell(it.m?.unit || "", { alignment: "center" }),
      right(num(it.norm, 3)),
      right(money(it.price, it.price % 1 ? 1 : 0)),
      right(money(it.sum)),
    ])
  );
  const wide = (label, note, amount, o = {}) => [cell(""), cell(label, o), cell(note, { colSpan: 3, color: "#555", ...o }), "", "", right(money(amount), o)];
  const total = (label, amount, o = {}) => [cell(label, { colSpan: 5, bold: true, ...o }), "", "", "", "", right(money(amount), { bold: true, ...o })];
  const fill = { fillColor: "#F4F4F4" };
  body.push(total("Итого СС. материалов", c.materials, fill));
  for (const r of c.prodRows) body.push(wide(r.name, hint(r, c), r.amount));
  body.push(total("Производственная СС.", c.prodSS, fill));
  for (const r of c.otherRows) body.push(wide(r.name, hint(r, c), r.amount));
  body.push(total("Другие затраты, всего", c.other, fill));
  body.push(total("Итого (себестоимость)", c.itogo, fill));
  body.push(wide("Маржа", `${num(c.margin, 2)} %`, c.marginAmt));
  body.push(total("Цена без НДС", c.noVat, fill));
  body.push(wide("НДС", `${num(c.vat, 2)} %`, c.vatAmt));
  body.push(total("Цена с НДС", c.final, { fillColor: "#DDDDDD", fontSize: 11 }));

  const facts = [
    c.V ? `Объём бетона: ${num(c.V, 3)} м³` : "",
    c.kg ? `Металл: ${num(c.kg, 2)} кг` : "",
    ctx.scheme ? `Шаблон затрат: ${ctx.scheme}` : "",
  ].filter(Boolean);

  const signers = (ctx.signers || []).filter(Boolean);
  const signRows = (signers.length ? signers : ["Составил"]).map((s) => ({
    columns: [
      { text: s, width: 200, fontSize: 10 },
      { canvas: [{ type: "line", x1: 0, y1: 10, x2: 150, y2: 10, lineWidth: 0.6 }], width: 160 },
      { text: "(подпись)", fontSize: 8, italics: true, color: "#555", margin: [0, 4, 0, 0] },
    ],
    margin: [0, 10, 0, 0],
  }));

  return {
    pageSize: "A4",
    pageMargins: [40, 36, 40, 40],
    info: { title: `Калькуляция ${product.code || ""}` },
    defaultStyle: { font: "Roboto", fontSize: 10 },
    content: [
      ctx.company ? { text: ctx.company, bold: true, fontSize: 11, margin: [0, 0, 0, 2] } : null,
      {
        columns: [
          { text: "КАЛЬКУЛЯЦИЯ", bold: true, fontSize: 16 },
          { text: [ctx.month ? `Цены: ${monthRu(ctx.month)}\n` : "", ctx.date ? `Дата: ${dateRu(ctx.date)}` : ""].join(""), alignment: "right", fontSize: 9.5, color: "#333" },
        ],
        margin: [0, 6, 0, 4],
      },
      { text: `${product.name || ""} ${product.code || ""}`.trim(), bold: true, fontSize: 13, margin: [0, 0, 0, 2] },
      { text: [product.group, ...facts].filter(Boolean).join("  ·  "), fontSize: 9.5, color: "#333", margin: [0, 0, 0, 10] },
      { text: "на 1 шт. изделия", fontSize: 9, italics: true, color: "#555", margin: [0, 0, 0, 4] },
      {
        table: { headerRows: 1, widths: [20, "*", 42, 52, 70, 80], body },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => "#888", vLineColor: () => "#888", paddingTop: () => 3, paddingBottom: () => 3 },
      },
      { stack: signRows, margin: [0, 24, 0, 0] },
    ].filter(Boolean),
  };
}

export const costPdfName = (product, month) =>
  `Kalkulyatsiya_${String(product?.code || "mahsulot").replace(/[\\/:*?"<>|\s]+/g, "_")}${month ? `_${month}` : ""}.pdf`;
