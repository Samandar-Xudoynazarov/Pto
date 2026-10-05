/**
 * Tijorat taklifi (коммерческое предложение) — tanlangan mahsulotlar va 1 dona narxi (QQSsiz), Word (DOCX).
 * Shablon: public/templates/tijorat-taklifi.docx — korxona blanki; qiymatlar o'rnida {{…}} belgilar.
 * Shablonni Word'da ochib bezagini (rekvizitlar, shrift, logotip) o'zgartirish mumkin — faqat {{…}} belgilarini o'chirmang.
 */
import JSZip from "jszip";
import { money } from "./acct-docx";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const OFFER_TEMPLATE_URL = "/templates/tijorat-taklifi.docx";

// hujjatdagi oy nomlari (asl xatdagidek: «17» сентябрь 2026 г)
export const OY_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export const OFFER_DEFAULTS = {
  to: "Руководителю предприятия",
  text: "На ваш запрос о предоставление коммерческого предложения на нижеперечисленные ж/б изделия сообщаем следующее.",
  priceHead: "Цена за 1 шт (без НДС)",
  note: "Примечание: Цена указана без учёта НДС, с учётом всех максимальных скидок.",
  director: "Ф.Махмудов",
};

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const fill = (xml, map) => xml.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in map ? esc(map[k]) : m));

/** {{marker}} turgan butun elementni (<w:tr> yoki <w:p>) topadi: [boshi, oxiri] */
function around(xml, marker, tag) {
  const at = xml.indexOf(marker);
  if (at < 0) return null;
  const open = Math.max(xml.lastIndexOf(`<${tag} `, at), xml.lastIndexOf(`<${tag}>`, at));
  const close = xml.indexOf(`</${tag}>`, at) + tag.length + 3;
  return open < 0 || close < tag.length + 3 ? null : [open, close];
}

/**
 * o: { date: "2026-09-17", number, to, text, priceHead, note, director, rows: [{ name, unit, qty, price }] }
 * Natija — Blob
 */
export async function buildOfferDocx(o) {
  const res = await fetch(OFFER_TEMPLATE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Tijorat taklifi shablonini yuklab bo'lmadi");
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  let xml = await zip.file("word/document.xml").async("string");

  const span = around(xml, "{{NOMI}}", "w:tr");
  if (!span) throw new Error("Shablon buzilgan: mahsulot qatori topilmadi");
  const rowXml = xml.slice(span[0], span[1]).replace(/ w14:(paraId|textId)="[^"]*"/g, "");
  const body = o.rows
    .map((r, i) => fill(rowXml, { N: String(i + 1), NOMI: r.name, BIRLIK: r.unit || "Шт", SONI: String(+r.qty || 1), NARX: money(r.price) }))
    .join("");
  xml = xml.slice(0, span[0]) + body + xml.slice(span[1]);

  // bo'sh izoh — paragraf olib tashlanadi
  if (!String(o.note || "").trim()) {
    const p = around(xml, "{{IZOH}}", "w:p");
    if (p) xml = xml.slice(0, p[0]) + xml.slice(p[1]);
  }

  const [y, m, d] = (o.date || "").split("-");
  xml = fill(xml, {
    KUN: d ? String(+d) : "",
    OY: m ? OY_RU[+m - 1] : "",
    YIL: y || "",
    RAQAM: o.number || "",
    KIMGA: o.to || "",
    MATN: o.text || "",
    NARX_SARLAVHA: o.priceHead || OFFER_DEFAULTS.priceHead,
    IZOH: o.note || "",
    DIREKTOR: o.director || "",
  });
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
}

export const offerFileName = (date) => `Tijorat_taklifi_${(date || "").split("-").reverse().join(".")}.docx`;
