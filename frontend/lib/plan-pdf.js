/**
 * «Buyurtmalar rejasi» — kunlik ishlab chiqarish rejasi PDF (A4, chop etish uchun).
 * pdfmake faqat tugma bosilganda yuklanadi (shrift ~1 MB) — sahifa sekinlashmaydi.
 * Roboto shrifti kirill (o'zbek: ў қ ғ ҳ) va lotin harflarini qo'llaydi.
 */
import { tr } from "./i18n";
import { fmt, fmtDate, fmtN } from "./calc";

const PDF_MIME = "application/pdf";
const MON_SHORT = ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"];
const WEEK_FULL = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const C = { ink: "#111827", ink2: "#374151", muted: "#6B7280", line: "#D1D5DB", head: "#1F3A68", soft: "#EEF2F8", ok: "#15803D", okBg: "#DCFCE7", warn: "#B45309", warnBg: "#FEF3C7", bad: "#B91C1C", badBg: "#FEE2E2", zebra: "#F9FAFB" };
const STATUS = {
  ok: ["Ulguradi", C.ok, C.okBg],
  stock: ["Omborda bor", C.ok, C.okBg],
  risk: ["Xavfli", C.warn, C.warnBg],
  late: ["Kechikadi", C.bad, C.badBg],
  nocap: ["Quvvat noma'lum", C.bad, C.badBg],
  far: ["2 yildan uzoq", C.bad, C.badBg],
};
const wd = (s) => tr(WEEK_FULL[new Date(s + "T00:00:00Z").getUTCDay()]);
const pad = (n) => String(n).padStart(2, "0");

/** Mahsulotning 1 donasidagi beton hajmi (m³) — normadagi «beton» guruhidagi materiallar */
export function volumeOf(product, mats) {
  return (product?.norms || []).reduce((t, l) => t + (mats.get(l.materialId)?.group === "beton" ? +l.norm || 0 : 0), 0);
}

const cell = (text, o = {}) => ({ text: text ?? "", fontSize: o.size || 9, bold: o.bold, color: o.color || C.ink, alignment: o.align, fillColor: o.fill, margin: o.margin || [3, 3, 3, 3] });
const head = (text, align) => cell(tr(text), { bold: true, color: "#FFFFFF", fill: C.head, align, size: 8.5 });
const tableLayout = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.8 : 0.4),
  vLineWidth: () => 0.4,
  hLineColor: () => C.line,
  vLineColor: () => C.line,
  paddingLeft: () => 2,
  paddingRight: () => 2,
  paddingTop: () => 1,
  paddingBottom: () => 1,
};

/**
 * plan — /api/plan javobi (filtrlangan ko'rinish), days — nechta ish kuni
 * ctx: { company, scope, prods (Map), mats (Map), limit, concreteIsTotal, signers }
 */
export function planPdfDefinition(plan, ctx, { days: maxDays = 12 } = {}) {
  const { prods, mats } = ctx;
  const code = (id) => prods.get(id)?.code || tr("— o'chirilgan —");
  const vol = (id) => volumeOf(prods.get(id), mats);
  const now = new Date();
  const stamp = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const days = (plan.days || []).filter((d) => d.items.length).slice(0, maxDays);

  // buyurtma bo'yicha holat (eng yomon qatori)
  const rank = (s) => (s === "ok" || s === "stock" ? 0 : s === "risk" ? 1 : 2);
  const worst = new Map();
  for (const o of plan.orders || []) worst.set(o.orderId || o.id, Math.max(worst.get(o.orderId || o.id) ?? 0, rank(o.status)));
  const cnt = [0, 0, 0];
  for (const r of worst.values()) cnt[r]++;

  const kpi = (label, value, color, fill) => ({
    table: { widths: ["*"], body: [[{ columns: [{ text: tr(label), fontSize: 8.5, color: C.ink2, width: "*", margin: [0, 3, 0, 0] }, { text: String(value), fontSize: 14, bold: true, color, width: "auto" }], fillColor: fill, margin: [8, 4, 8, 4] }]] },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
  });

  const content = [
    { text: tr("Kunlik ishlab chiqarish rejasi"), fontSize: 17, bold: true, color: C.head },
    {
      text: [
        days.length ? `${fmtDate(days[0].date)} — ${fmtDate(days[days.length - 1].date)}` : tr("Ishlab chiqarish kerak bo'lgan buyurtma yo'q."),
        { text: `   ·   ${ctx.scope}`, color: C.muted },
      ],
      fontSize: 9.5,
      color: C.ink2,
      margin: [0, 3, 0, 10],
    },
    {
      columns: [
        kpi(ctx.filtered ? "Tanlangan buyurtmalar" : "Faol buyurtmalar", worst.size, C.head, C.soft),
        kpi("Muddatida tugaydi", cnt[0], C.ok, C.okBg),
        kpi("Xavfli", cnt[1], C.warn, C.warnBg),
        kpi("Kechikadi", cnt[2], C.bad, C.badBg),
      ],
      columnGap: 8,
      margin: [0, 0, 0, 10],
    },
  ];

  // 1) kalendar: haftalar qator, ish kunlari ustun (Du … Sh)
  const workDays = plan.settings?.workDays?.length ? plan.settings.workDays : [1, 2, 3, 4, 5, 6];
  const cols = [1, 2, 3, 4, 5, 6, 0].filter((d) => workDays.includes(d));
  const holidays = new Set(plan.settings?.holidays || []);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const addD = (s, n) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n)).toISOString().slice(0, 10);
  const dow = (s) => new Date(s + "T00:00:00Z").getUTCDay();
  const monIdx = (wd) => (wd + 6) % 7; // dushanba = 0
  const today = plan.today;

  const dayCell = (date) => {
    const d = byDate.get(date);
    const [, m, dd] = date.split("-");
    const isToday = date === today;
    const top = {
      columns: [
        { text: String(+dd), fontSize: 15, bold: true, color: isToday ? "#FFFFFF" : C.head, width: "auto" },
        { text: ` ${tr(MON_SHORT[+m - 1])}`, fontSize: 8, color: isToday ? "#E0E7FF" : C.muted, margin: [2, 6, 0, 0], width: "*" },
        ...(isToday ? [{ text: tr("bugun"), fontSize: 7, color: "#FFFFFF", alignment: "right", margin: [0, 6, 0, 0], width: "auto" }] : []),
      ],
    };
    const topBox = { table: { widths: ["*"], body: [[{ ...top, fillColor: isToday ? C.head : C.soft, margin: [5, 2, 5, 2] }]] }, layout: "noBorders" };
    if (!d) {
      const label = holidays.has(date) ? tr("Dam olish") : date < (days[0]?.date || "") || date > (days[days.length - 1]?.date || "") ? "" : tr("Reja yo'q");
      return { stack: [topBox, { text: label, fontSize: 7.5, color: C.muted, margin: [5, 6, 5, 6] }], fillColor: "#F3F4F6" };
    }
    const byProd = new Map();
    for (const it of d.items) {
      const a = byProd.get(it.productId) || { productId: it.productId, qty: 0, nos: [] };
      a.qty += it.qty;
      if (!a.nos.includes(it.no)) a.nos.push(it.no);
      byProd.set(it.productId, a);
    }
    const rows = [...byProd.values()];
    const totalQty = rows.reduce((t, r) => t + r.qty, 0);
    const totalVol = rows.reduce((t, r) => t + r.qty * vol(r.productId), 0);
    const concrete = ctx.concreteIsTotal ? d.concrete : totalVol;
    const over = ctx.limit && concrete > ctx.limit + 1e-9;
    return {
      stack: [
        topBox,
        ...rows.map((r) => ({
          margin: [5, 3, 5, 0],
          stack: [
            {
              columns: [
                { text: code(r.productId), fontSize: 8.5, bold: true, width: "*" },
                { text: fmt(r.qty), fontSize: 9.5, bold: true, alignment: "right", width: "auto", color: C.head },
              ],
            },
            { text: r.nos.map((n) => `№${n}`).join(", "), fontSize: 6.5, color: C.muted },
          ],
        })),
        {
          margin: [5, 5, 5, 5],
          table: {
            widths: ["*"],
            body: [[{
              text: `${fmt(totalQty)} ${tr("dona")}${concrete ? `  ·  ${fmtN(concrete, 1)}${ctx.limit ? `/${fmtN(ctx.limit, 0)}` : ""} m³` : ""}`,
              fontSize: 7.5, bold: true, alignment: "center", color: over ? C.bad : C.ink2, fillColor: over ? C.badBg : "#E5E7EB", margin: [2, 2, 2, 2],
            }]],
          },
          layout: "noBorders",
        },
      ],
    };
  };

  if (days.length) {
    const first = days[0].date;
    const last = days[days.length - 1].date;
    const body = [cols.map((wd) => ({ text: tr(WEEK_FULL[wd]), bold: true, fontSize: 8.5, color: "#FFFFFF", fillColor: C.head, alignment: "center", margin: [2, 4, 2, 4] }))];
    for (let wk = addD(first, -monIdx(dow(first))); wk <= last; wk = addD(wk, 7)) {
      const row = cols.map((wd) => dayCell(addD(wk, monIdx(wd))));
      body.push(row);
    }
    content.push({
      table: { headerRows: 1, dontBreakRows: true, widths: cols.map(() => "*"), body },
      layout: {
        hLineWidth: () => 0.8,
        vLineWidth: () => 0.8,
        hLineColor: () => "#FFFFFF",
        vLineColor: () => "#FFFFFF",
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
    });
    content.push({
      text: tr("Har katakda: mahsulot va soni (dona), tagida — qaysi buyurtmalar uchun. Pastki satr — kun bo'yicha jami va beton hajmi (qizil — kunlik beton cheklovidan oshgan)."),
      fontSize: 7.5, color: C.muted, margin: [0, 6, 0, 0],
    });
  }

  // 2) buyurtmalar bo'yicha prognoz
  if ((plan.orders || []).length) {
    content.push({ text: tr("Buyurtmalar bo'yicha prognoz"), fontSize: 13, bold: true, color: C.head, margin: [0, 8, 0, 6], pageBreak: days.length ? "before" : undefined });
    content.push({
      table: {
        headerRows: 1,
        widths: [26, "*", 58, 32, 40, 40, 56, 56, 62],
        body: [
          [head("№", "center"), head("Buyurtmachi"), head("Mahsulot"), head("Qoldi", "right"), head("Qilish kerak", "right"), head("Quvvat/kun", "right"), head("Tugaydi"), head("Muddat"), head("Holat")],
          ...plan.orders.map((o, i) => {
            const fill = i % 2 ? C.zebra : undefined;
            const st = STATUS[o.status] || [o.status, C.ink, undefined];
            return [
              cell(`№${o.no}`, { align: "center", fill }),
              cell(`${o.customer}${o.contractNo ? `\n${tr("Shartnoma № {n}", { n: o.contractNo })}` : ""}`, { fill, size: 8.5 }),
              cell(code(o.productId), { bold: true, fill, size: 8.5 }),
              cell(fmt(o.remaining), { align: "right", fill }),
              cell(fmt(o.toProduce), { align: "right", fill }),
              cell(o.perDay ? fmtN(o.perDay, 2) : "—", { align: "right", fill, color: C.ink2 }),
              cell(o.finish ? fmtDate(o.finish) : "—", { fill, bold: true }),
              cell(o.deadline ? fmtDate(o.deadline) : tr("muddatsiz"), { fill, color: C.ink2 }),
              cell(o.status === "late" ? tr("Kechikadi · {n} kun", { n: o.lateDays }) : tr(st[0]), { fill: st[2], color: st[1], bold: true, size: 8 }),
            ];
          }),
        ],
      },
      layout: tableLayout,
    });
  }

  // imzolar
  content.push({
    margin: [0, 26, 0, 0],
    unbreakable: true,
    columns: [
      { text: [tr("Tuzdi (ПТО)"), ":  ____________________"], fontSize: 10 },
      { text: [tr("Tasdiqlayman"), ":  ____________________"], fontSize: 10, alignment: "right" },
    ],
  });

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [28, 42, 28, 36],
    info: { title: tr("Kunlik ishlab chiqarish rejasi"), creator: "ПТО" },
    defaultStyle: { font: "Roboto", fontSize: 9, color: C.ink, lineHeight: 1.15 },
    header: () => ({
      margin: [28, 16, 28, 0],
      columns: [
        { text: ctx.company || "", fontSize: 8.5, bold: true, color: C.ink2 },
        { text: tr("Buyurtmalar rejasi"), fontSize: 8.5, color: C.muted, alignment: "right" },
      ],
    }),
    footer: (page, pages) => ({
      margin: [28, 12, 28, 0],
      columns: [
        { text: tr("Tayyorlandi: {d}", { d: stamp }), fontSize: 7.5, color: C.muted },
        { text: `${page} / ${pages}`, fontSize: 7.5, color: C.muted, alignment: "right" },
      ],
    }),
    content,
  };
}

let pdfMakeP = null;
async function loadPdfMake() {
  pdfMakeP ||= (async () => {
    const [m, f] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
    const pdfMake = m.default || m;
    const vfs = f.default?.pdfMake?.vfs || f.default || f.pdfMake?.vfs || f;
    pdfMake.vfs = vfs;
    return pdfMake;
  })().catch((e) => {
    pdfMakeP = null;
    throw e;
  });
  return pdfMakeP;
}

/** PDF Blob */
export async function buildPlanPdf(def) {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(def).getBlob(resolve);
    } catch (e) {
      reject(e);
    }
  });
}

/** Yuklab olish yoki ulashish (telefonda Telegram va h.k.) */
export async function deliverPdf(blob, filename, { share = false } = {}) {
  if (share) {
    const file = new File([blob], filename, { type: PDF_MIME });
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
