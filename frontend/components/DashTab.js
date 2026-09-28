"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { concreteVolume, fmt, fmtDate, fmtN, priceOf, today } from "@/lib/calc";
import Chart from "./Chart";
import ExportButtons from "./ExportButtons";
import { fileDate } from "@/lib/xlsx-export";

const MON = ["Yan", "Fev", "Mar", "Apr", "May", "Iyun", "Iyul", "Avg", "Sen", "Okt", "Noy", "Dek"];
const MON_FULL = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
const monthName = (m) => `${tr(MON_FULL[+m.slice(5, 7) - 1])} ${m.slice(0, 4)}`;
// oy ("2026-09") yoki kun ("2026-09-05") yorlig'i
const xfmt = (k, full) => (k.length > 7 ? (full ? fmtDate(k) : String(+k.slice(8, 10))) : full ? monthName(k) : tr(MON[+k.slice(5, 7) - 1]));
const shiftMonth = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
// material guruhlari → grafikdagi 4 ta qatlam (qolganlari «Boshqa»)
const COST_GROUPS = [
  ["xomashyo", "Xomashyo", "var(--s1)"],
  ["metall", "Metall", "var(--s2)"],
  ["yoqilgi", "Yoqilg'i", "var(--s3)"],
  ["boshqa", "Boshqa", "var(--s4)"],
];
const costGroup = (g) => (g === "xomashyo" || g === "beton" ? "xomashyo" : g === "metall" ? "metall" : g === "yoqilgi" ? "yoqilgi" : "boshqa");

/** Rahbar uchun grafiklar: oyma-oy reja bajarilishi, beton, material xarajati, brak, jo'natish */
export default function DashTab({ data, notify }) {
  const t = useT();
  const { mats, prods } = data;
  const [n, setN] = useState(12); // 1 — bitta oy kunma-kun
  const thisMonth = today().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [raw, setRaw] = useState(null);
  useEffect(() => {
    setRaw(null);
    const q = n === 1 ? `month=${month}` : `months=${n}`;
    api(`/dashboard?${q}`)
      .then((r) => setRaw(n === 1 ? { rows: r.days, cur: r.total, prev: r.prevTotal } : { rows: r.months.map((m) => ({ ...m, key: m.month })) }))
      .catch((e) => notify(e.message));
  }, [n, month, notify]);

  const derived = useMemo(() => {
    if (!raw) return null;
    const price = new Map();
    const pr = (id) => {
      if (!price.has(id)) price.set(id, priceOf(mats.get(id), mats) || 0);
      return price.get(id);
    };
    const derive = (m) => {
      const cost = { xomashyo: 0, metall: 0, yoqilgi: 0, boshqa: 0 };
      let sarfCost = 0;
      for (const [id, q] of Object.entries(m.sarf)) {
        const v = q * pr(id);
        sarfCost += v;
        cost[costGroup(mats.get(id)?.group)] += v;
      }
      for (const [id, q] of Object.entries(m.chiqim)) cost[costGroup(mats.get(id)?.group)] += q * pr(id);
      const m3 = Object.entries(m.prod).reduce((s, [id, q]) => s + q * concreteVolume(prods.get(id), mats), 0);
      const made = m.fact + m.brak;
      return {
        ...m,
        m3,
        cost,
        costTotal: Object.values(cost).reduce((a, b) => a + b, 0),
        perM3: m3 > 0 ? sarfCost / m3 : null,
        planPct: m.plan ? (m.fact / m.plan) * 100 : null,
        brakPct: made ? (m.brak / made) * 100 : null,
      };
    };
    const rows = raw.rows.map(derive);
    return raw.cur ? { rows, cur: derive(raw.cur), prev: derive(raw.prev) } : { rows, cur: rows[rows.length - 1], prev: rows[rows.length - 2] };
  }, [raw, mats, prods]);

  const rows = derived?.rows;
  const labels = rows?.map((r) => r.key) || [];
  const cur = derived?.cur;
  const prev = derived?.prev;
  const daily = n === 1;
  const mln = (v) => `${fmtN(v / 1e6, 1)} ${tr("mln")}`;

  return (
    <section className="sheet dash">
      <div className="bar">
        <div className="chips">
          {[1, 6, 12, 24].map((k) => (
            <button key={k} className="chip" aria-pressed={n === k} onClick={() => setN(k)}>
              {t("{n} oy", { n: k })}
            </button>
          ))}
          {daily && (
            <span className="month-pick">
              <button type="button" className="btn sm" aria-label={t("Oldingi oy")} onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                ‹
              </button>
              <input type="month" value={month} max={thisMonth} onChange={(e) => e.target.value && e.target.value <= thisMonth && setMonth(e.target.value)} aria-label={t("Oy")} />
              <button type="button" className="btn sm" aria-label={t("Keyingi oy")} disabled={month >= thisMonth} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
                ›
              </button>
            </span>
          )}
        </div>
        <div className="r">
          <ExportButtons company={data.settings?.company} notify={notify} disabled={!rows} build={() => dashExcel(rows, daily ? month : null)} />
        </div>
      </div>

      {!rows ? (
        <div className="loading">{t("Yuklanmoqda…")}</div>
      ) : (
        <>
          <div className="kpis">
            <Kpi k={t("Ishlab chiqarildi — {m}", { m: monthName(daily ? month : cur.key) })} v={fmt(cur.fact)} u={t("dona")} prev={prev && t("o'tgan oy: {v}", { v: fmt(prev.fact) })} />
            <Kpi k={t("Reja bajarilishi")} v={cur.planPct == null ? "—" : fmtN(cur.planPct, 0)} u="%" prev={prev?.planPct != null && t("o'tgan oy: {v}", { v: `${fmtN(prev.planPct, 0)} %` })} />
            <Kpi k={t("Brak ulushi")} v={cur.brakPct == null ? "—" : fmtN(cur.brakPct, 1)} u="%" warn={cur.brakPct > 2} prev={prev?.brakPct != null && t("o'tgan oy: {v}", { v: `${fmtN(prev.brakPct, 1)} %` })} />
            <Kpi k={t("Material xarajati")} v={fmtN(cur.costTotal / 1e6, 1)} u={t("mln so'm")} prev={prev && t("o'tgan oy: {v}", { v: mln(prev.costTotal) })} />
          </div>

          <div className="chart-grid">
            <Chart
              title={t("Reja va fakt, dona")}
              labels={labels}
              xfmt={xfmt}
              fmt={(v) => fmt(v)}
              series={[
                { key: "plan", label: t("Reja"), color: "var(--s1)", values: rows.map((r) => r.plan) },
                { key: "fact", label: t("Fakt"), color: "var(--s2)", values: rows.map((r) => r.fact) },
              ]}
            />
            <Chart
              title={t("Reja bajarilishi, %")}
              labels={labels}
              xfmt={xfmt}
              type="line"
              fmt={(v) => `${fmtN(v, 0)} %`}
              series={[{ key: "pct", label: t("Bajarilishi"), color: "var(--s1)", values: rows.map((r) => r.planPct) }]}
            />
            <Chart
              title={t("Material xarajati, so'm")}
              sub={t("Ishlab chiqarish sarfi va ombor chiqimi, joriy narxlarda. Xomashyo — sement, qum, sheben")}
              labels={labels}
              xfmt={xfmt}
              type="stack"
              fmt={(v) => mln(v)}
              series={COST_GROUPS.map(([k, l, c]) => ({ key: k, label: t(l), color: c, values: rows.map((r) => r.cost[k]) }))}
            />
            <Chart
              title={t("1 m³ betonga material xarajati, ming so'm")}
              sub={t("Ishlab chiqarish sarfi ÷ quyilgan beton hajmi")}
              labels={labels}
              xfmt={xfmt}
              type="line"
              fmt={(v) => fmt(v)}
              series={[{ key: "m3c", label: t("1 m³ uchun"), color: "var(--s1)", values: rows.map((r) => (r.perM3 == null ? null : Math.round(r.perM3 / 1000))) }]}
            />
            <Chart
              title={t("Quyilgan beton, m³")}
              labels={labels}
              xfmt={xfmt}
              fmt={(v) => fmtN(v, 1)}
              series={[{ key: "m3", label: t("Beton"), color: "var(--s1)", values: rows.map((r) => Math.round(r.m3 * 10) / 10) }]}
            />
            <Chart
              title={t("Brak ulushi, %")}
              sub={t("Brak ÷ (sifatli + brak)")}
              labels={labels}
              xfmt={xfmt}
              type="line"
              fmt={(v) => `${fmtN(v, 1)} %`}
              series={[{ key: "brak", label: t("Brak"), color: "var(--s1)", values: rows.map((r) => r.brakPct) }]}
            />
            <Chart
              title={t("Jo'natildi, dona")}
              labels={labels}
              xfmt={xfmt}
              fmt={(v) => fmt(v)}
              series={[{ key: "ship", label: t("Jo'natildi"), color: "var(--s1)", values: rows.map((r) => r.shipped) }]}
            />
            <Chart
              title={t("Omborga kirim (xarid), so'm")}
              labels={labels}
              xfmt={xfmt}
              fmt={(v) => mln(v)}
              series={[{ key: "kirim", label: t("Kirim"), color: "var(--s1)", values: rows.map((r) => r.kirimSum) }]}
            />
          </div>
          {daily && <p className="hint">{t("{m} — kunma-kun. Boshqa oyni yuqoridagi oy tanlagichdan tanlang.", { m: monthName(month) })}</p>}
          <p className="hint">
            {t("Grafik ustiga bosing (yoki sichqonchani olib boring) — o'sha oyning aniq qiymatlari chiqadi. «Jadval» — raqamlar jadval ko'rinishida. Joriy oy hali tugamagan — uni o'tgan oylar bilan solishtirishda buni hisobga oling.")}
          </p>
        </>
      )}
    </section>
  );
}

function Kpi({ k, v, u, prev, warn }) {
  return (
    <div className={`kpi ${warn ? "kpi-warn" : ""}`}>
      <div className="k">{k}</div>
      <div className="v">
        {v}
        <small>{u}</small>
      </div>
      {prev && <div className="k kpi-prev">{prev}</div>}
    </div>
  );
}

function dashExcel(rows, month) {
  return {
    filename: month ? `Kunlik_korsatkichlar_${month}.xlsx` : `Oylik_korsatkichlar_${fileDate()}.xlsx`,
    sheets: [
      {
        name: tr("Ko'rsatkichlar"),
        title: month ? tr("{m}: kunma-kun ko'rsatkichlar", { m: monthName(month) }) : tr("Oyma-oy asosiy ko'rsatkichlar"),
        columns: [
          { header: tr(month ? "Sana" : "Oy"), key: "m", type: month ? "date" : undefined, width: 16 },
          { header: tr("Reja, dona"), key: "plan", type: "int", total: "sum", width: 11 },
          { header: tr("Fakt, dona"), key: "fact", type: "int", total: "sum", width: 11 },
          { header: tr("Bajarilishi, %"), key: "pp", type: "num", width: 12 },
          { header: tr("Brak, dona"), key: "brak", type: "int", total: "sum", width: 10 },
          { header: tr("Brak, %"), key: "bp", type: "num", width: 9 },
          { header: tr("Beton, m³"), key: "m3", type: "num", total: "sum", width: 11 },
          { header: tr("Jo'natildi, dona"), key: "ship", type: "int", total: "sum", width: 13 },
          { header: tr("Material xarajati, so'm"), key: "cost", type: "money", total: "sum", width: 18 },
          { header: tr("1 m³ ga, so'm"), key: "perM3", type: "money", width: 13 },
          { header: tr("Kirim (xarid), so'm"), key: "kirim", type: "money", total: "sum", width: 17 },
        ],
        rows: rows.map((r) => ({
          m: xfmt(r.key, true), plan: r.plan, fact: r.fact, pp: r.planPct == null ? null : Math.round(r.planPct * 10) / 10, brak: r.brak || null,
          bp: r.brakPct == null ? null : Math.round(r.brakPct * 10) / 10, m3: Math.round(r.m3 * 100) / 100, ship: r.shipped, cost: Math.round(r.costTotal),
          perM3: r.perM3 == null ? null : Math.round(r.perM3), kirim: r.kirimSum || null,
        })),
        notes: [tr("Material xarajati joriy narxlarda hisoblangan.")],
      },
    ],
  };
}
