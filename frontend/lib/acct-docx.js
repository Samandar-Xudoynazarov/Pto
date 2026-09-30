/**
 * Buxgalteriya: «…ойида куйилган махсулотлар руйхати» — material hisoboti (DOCX).
 * Shablon: public/templates/material-hisobot.docx (asl Word hujjatning o'zi, qiymatlar o'rnida {{…}} belgilar).
 * Blank, shriftlar, jadval chegaralari va joylashuv shablondan o'zgarishsiz olinadi — faqat qiymatlar yoziladi.
 */
import JSZip from "jszip";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const TEMPLATE_URL = "/templates/material-hisobot.docx";

// Hujjatdagi oy nomlari (o'zbekcha kirill, asl hujjatdagidek)
export const OY = ["Январ", "Феврал", "Март", "Апрел", "Май", "Июн", "Июл", "Август", "Сентябр", "Октябр", "Ноябр", "Декабр"];

const NB = " ";
const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, NB);
/** 328412140 → «328 412 140» (asl hujjatdagidek bo'sh joy bilan) */
export function money(n) {
  const v = Math.round(+n || 0);
  return (v < 0 ? "-" : "") + group(String(Math.abs(v)));
}
/** 66.15 → «66,15»; d — kasr xonalari soni (ortiqcha nollar olib tashlanadi, lekin kamida `min`) */
export function dec(n, d = 2, min = 0) {
  const v = +n || 0;
  let s = v.toFixed(d);
  if (d > min) s = s.replace(new RegExp(`0{1,${d - min}}$`), "").replace(/\.$/, "");
  const [i, f] = s.split(".");
  return group(i) + (f ? "," + f : "");
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** XML ichidagi {{KEY}} larni almashtiradi */
function fill(xml, map) {
  return xml.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in map ? esc(map[k]) : m));
}

/** {{marker}} turgan butun elementni (<w:tr> yoki <w:p>) topadi: [boshi, oxiri] */
function around(xml, marker, tag) {
  const at = xml.indexOf(marker);
  if (at < 0) return null;
  const open = Math.max(xml.lastIndexOf(`<${tag} `, at), xml.lastIndexOf(`<${tag}>`, at));
  const close = xml.indexOf(`</${tag}>`, at) + tag.length + 3;
  return open < 0 || close < tag.length + 3 ? null : [open, close];
}

/**
 * Hisobot jami qiymatlari
 * rows: [{ name, unit, m3, qty, unitCost }]
 */
export function totals(rows) {
  let m3 = 0, sum = 0, qty = 0;
  for (const r of rows) {
    m3 += +r.m3 || 0;
    qty += +r.qty || 0;
    sum += Math.round(+r.unitCost || 0) * (+r.qty || 0);
  }
  return { m3, sum, qty };
}

/**
 * DOCX faylni yaratadi va Blob qaytaradi.
 * r: { month: "2026-09", date: "2026-10-02", rows, otherCosts, director, chief, accountant }
 */
export async function buildAcctDocx(r) {
  const res = await fetch(TEMPLATE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Hisobot shablonini yuklab bo'lmadi");
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  let xml = await zip.file("word/document.xml").async("string");

  // 1) mahsulot qatorlari: shablondagi qator har bir mahsulot uchun nusxalanadi
  const span = around(xml, "{{NOMI}}", "w:tr");
  if (!span) throw new Error("Shablon buzilgan: mahsulot qatori topilmadi");
  // w14:paraId har bir paragrafda yagona bo'lishi kerak — nusxalarda olib tashlanadi (Word o'zi beradi)
  const rowXml = xml.slice(span[0], span[1]).replace(/ w14:(paraId|textId)="[^"]*"/g, "");
  const body = r.rows
    .map((x, i) =>
      fill(rowXml, {
        N: String(i + 1),
        NOMI: x.name,
        BIRLIK: x.unit || "м3",
        M3: dec(x.m3, 2, 1),
        NARX: money(x.unitCost),
        SUMMA: money(Math.round(+x.unitCost || 0) * (+x.qty || 0)),
        SONI: String(+x.qty || 0),
      })
    )
    .join("");
  xml = xml.slice(0, span[0]) + body + xml.slice(span[1]);

  // 2) imzo qo'yuvchi bo'sh bo'lsa — o'sha qator (paragraf) olib tashlanadi
  for (const [key, val] of [["HISOBCHI", r.accountant], ["SEX_BOSHLIGI", r.chief]]) {
    if (String(val || "").trim()) continue;
    const p = around(xml, `{{${key}}}`, "w:p");
    if (p) xml = xml.slice(0, p[0]) + xml.slice(p[1]);
  }

  // 3) qolgan qiymatlar
  const t = totals(r.rows);
  const [y, m] = r.month.split("-").map(Number);
  const [dy, dm, dd] = (r.date || "").split("-");
  xml = fill(xml, {
    KUN: dd || "",
    OY_SANA: dm ? OY[+dm - 1].toLowerCase() : "",
    YIL: dy || String(y),
    OY: OY[m - 1],
    DIREKTOR: r.director || "",
    JAMI_NOMI: "Жами",
    JAMI_M3: dec(t.m3, 3, 2),
    JAMI_SUMMA: money(t.sum),
    JAMI_BOSHQA: +r.otherCosts ? money(r.otherCosts) : "",
    SEX_BOSHLIGI: r.chief || "",
    HISOBCHI: r.accountant || "",
  });

  zip.file("word/document.xml", xml);
  const core = zip.file("docProps/core.xml");
  if (core) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const c = (await core.async("string")).replace(/(<dcterms:modified[^>]*>)[^<]*/, `$1${now}`);
    zip.file("docProps/core.xml", c);
  }
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
}

export const acctFileName = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `Material_hisoboti_${OY[m - 1]}_${y}.docx`;
};

/** Yuklab olish yoki ulashish (telefonda Telegram va h.k.) */
export async function deliverDocx(blob, filename, { share = false } = {}) {
  if (share) {
    const file = new File([blob], filename, { type: DOCX_MIME });
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
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
  return share ? "downloaded-fallback" : "downloaded";
}
