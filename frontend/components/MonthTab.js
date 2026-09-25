"use client";
import { tr } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { addMonthSheets, deliver, mergeMoves, newWorkbook } from "@/lib/excel";
import Icon from "./Icon";
import { concreteVolume, consumption, fmt, fmtN, lsGet, lsSet, monthDays, priceOf, today } from "@/lib/calc";

function niceStep(max) {
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function DailyChart({ month, plan, fact }) {
  const days = fact.length;
  const max = Math.max(...fact, ...plan, 1);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const W = 760, H = 190, L = 36, R = 8, T = 10, B = 22;
  const cw = (W - L - R) / days;
  const ph = H - T - B;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const td = today();
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr("Kunlik beton hajmi: reja va fakt")}>
      {ticks.map((v) => {
        const y = T + ph * (1 - v / top);
        return (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--line-2)" strokeWidth="1" />
            <text x={L - 6} y={y + 3} textAnchor="end">
              {fmtN(v, step < 1 ? 1 : 0)}
            </text>
          </g>
        );
      })}
      {fact.map((v, i) => {
        const x = L + i * cw;
        const hp = ph * (plan[i] / top);
        const hf = ph * (v / top);
        const isToday = td === `${month}-${String(i + 1).padStart(2, "0")}`;
        return (
          <g key={i}>
            {plan[i] > 0 && <rect x={x + cw * 0.12} y={T + ph - hp} width={cw * 0.76} height={hp} fill="var(--bar-2)" />}
            {v > 0 && (
              <rect x={x + cw * 0.24} y={T + ph - hf} width={cw * 0.52} height={hf} fill={isToday ? "var(--signal)" : "var(--bar)"}>
                <title>{tr("{d}-kun: fakt {f} m³, reja {p} m³", { d: i + 1, f: fmtN(v, 2), p: fmtN(plan[i], 2) })}</title>
              </rect>
            )}
            {(i === 0 || (i + 1) % 5 === 0) && (
              <text x={x + cw / 2} y={H - 6} textAnchor="middle">
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--line)" strokeWidth="1" />
    </svg>
  );
}

export default function MonthTab({ data, notify }) {
  const { materials, products, mats, prods, settings } = data;
  const [month, setMonth] = useState(() => lsGet("pto.month", today().slice(0, 7)));
  const [days, setDays] = useState(null);
  const [stock, setStock] = useState(null);

  const load = useCallback(async () => {
    setDays(null);
    try {
      const from = `${month}-01`;
      const to = `${month}-${String(monthDays(month)).padStart(2, "0")}`;
      const [d, s] = await Promise.all([api(`/days?month=${month}`), api(`/stock?from=${from}&to=${to}`)]);
      setDays(d);
      setStock(s);
    } catch (e) {
      notify(e.message);
      setDays([]);
    }
  }, [month, notify]);
  useEffect(() => {
    load();
  }, [load]);

  const S = useMemo(() => {
    const n = monthDays(month);
    const planM3 = Array(n).fill(0);
    const factM3 = Array(n).fill(0);
    const byProd = new Map();
    const actual = new Map();
    const factLines = [];
    let plan = 0, fact = 0, shipped = 0, m3 = 0, activeDays = 0;
    for (const d of days || []) {
      const i = +d.date.slice(8, 10) - 1;
      let dayFact = 0;
      for (const l of d.production) {
        const p = prods.get(l.productId);
        const v = concreteVolume(p, mats);
        planM3[i] += v * l.plan;
        factM3[i] += v * l.fact;
        m3 += v * l.fact;
        plan += l.plan;
        fact += l.fact;
        dayFact += l.fact;
        const g = byProd.get(l.productId) || { plan: 0, fact: 0, shipped: 0 };
        g.plan += l.plan;
        g.fact += l.fact;
        byProd.set(l.productId, g);
        factLines.push({ productId: l.productId, qty: l.fact });
      }
      if (dayFact) activeDays++;
      for (const l of d.shipments) {
        shipped += l.qty;
        const g = byProd.get(l.productId) || { plan: 0, fact: 0, shipped: 0 };
        g.shipped += l.qty;
        byProd.set(l.productId, g);
      }
      for (const l of d.materials) {
        const a = actual.get(l.materialId) || { sarf: 0, kirim: 0 };
        a.sarf += l.sarf;
        a.kirim += l.kirim;
        actual.set(l.materialId, a);
      }
    }
    const norm = consumption(factLines, prods, mats, settings);
    return { planM3, factM3, byProd, actual, norm, plan, fact, shipped, m3, activeDays };
  }, [days, month, prods, mats, settings]);

  const prodRows = [...S.byProd.entries()]
    .map(([id, g]) => ({ p: prods.get(id), ...g }))
    .sort((a, b) => (a.p?.sort || 0) - (b.p?.sort || 0));
  const matRows = materials
    .filter((m) => m.stock && !m.archived && (S.actual.get(m.id) || S.norm.get(m.id) || stock?.materials?.[m.id]))
    .map((m) => {
      const a = S.actual.get(m.id) || { sarf: 0, kirim: 0 };
      const n = S.norm.get(m.id) || 0;
      const st = stock?.materials?.[m.id] || { start: 0, end: 0, kirim: 0, chiqim: 0 };
      // kirim — ombor kirimi + eski qo'lda yozilganlar (qoldiq hisobidan), chiqim — ombor chiqimi
      return { m, ...a, kirim: st.kirim || 0, chiqim: st.chiqim || 0, norm: n, diff: a.sarf - n, start: st.start, end: st.end, value: a.sarf * priceOf(m, mats) };
    });
  const sarfValue = matRows.reduce((s, r) => s + r.value, 0);

  const [exporting, setExporting] = useState(false);
  async function exportMonth(share) {
    const open = settings.opening?.date || "";
    const to = `${month}-${String(monthDays(month)).padStart(2, "0")}`;
    let moves = [];
    try {
      moves = (await api(`/movements?from=${month}-01&to=${to}&limit=2000`)).items;
    } catch (e) {
      return notify(e.message);
    }
    const list = mergeMoves(days || [], moves).filter((d) => d.date >= open && (d.production.length || d.materials.length || d.shipments.length));
    if (!list.length) return notify(open ? tr("{d} dan keyin bu oyda kunlik hisobot yo'q", { d: open.split("-").reverse().join(".") }) : "Bu oyda kunlik hisobot yo'q");
    setExporting(true);
    try {
      const first = list[0].date;
      const s0 = await api(`/stock?from=${first}&to=${first}`);
      const startMat = new Map(Object.entries(s0.materials).map(([id, v]) => [id, v.start]));
      const startProd = new Map(Object.entries(s0.products).map(([id, v]) => [id, v.start]));
      const wb = await newWorkbook();
      addMonthSheets(wb, { days: list, startMat, startProd, materials, products, prods, company: settings.company, signers: settings.signers });
      const [y, m] = month.split("-");
      const r = await deliver(wb, `Ostatki_${m}.${y}.xlsx`, { share });
      if (r === "downloaded-fallback") notify("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
    } catch (e) {
      notify(e.message || "Excel faylni tayyorlab bo'lmadi");
    } finally {
      setExporting(false);
    }
  }

  function downloadCsv() {
    const lines = [
      ["Mahsulot", "Reja (dona)", "Fakt (dona)", "Bajarilishi %", "Jo'natildi (dona)"],
      ...prodRows.map((r) => [r.p?.code || "", r.plan, r.fact, r.plan ? Math.round((r.fact / r.plan) * 100) : "", r.shipped]),
      [],
      ["Material", "Birlik", "Oy boshida", "Kirim", "Chiqim", "Sarf (haqiqiy)", "Sarf (norma)", "Farq", "Oy oxirida"],
      ...matRows.map((r) => [r.m.name, r.m.unit, r.start, r.kirim, r.chiqim, r.sarf, r.norm, r.diff, r.end]),
    ];
    const cell = (c) => (typeof c === "number" ? String(Math.round(c * 10000) / 10000).replace(".", ",") : String(c ?? "").replace(/"/g, '""'));
    const csv = "﻿" + lines.map((l) => l.map((c) => `"${cell(c)}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `oylik-hisobot-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="sheet">
      <div className="bar">
        <div className="l">
          <h2>{tr("Oylik hisobot")}</h2>
          <input
            id="month"
            type="month"
            aria-label={tr("Oy")}
            value={month}
            onChange={(e) => {
              if (!e.target.value) return;
              setMonth(e.target.value);
              lsSet("pto.month", e.target.value);
            }}
          />
        </div>
        <div className="r">
          <button className="btn" onClick={() => exportMonth(false)} disabled={!days?.length || exporting}>
            <Icon name="download" /> {tr("Oylik Excel (har kun alohida varaq)")}</button>
          <button className="btn" onClick={() => exportMonth(true)} disabled={!days?.length || exporting}>
            <Icon name="share" /> {tr("Ulashish")}</button>
          <button className="btn" onClick={downloadCsv} disabled={!days?.length}>{tr("Hisobot CSV")}</button>
          <button className="btn" onClick={() => window.print()}>{tr("Chop etish")}</button>
        </div>
      </div>

      <div className="kpis">
        {[
          ["Ishlab chiqarildi", fmtN(S.fact), "dona"],
          ["Reja bajarilishi", S.plan ? fmtN((S.fact / S.plan) * 100, 0) : "—", "%"],
          ["Beton (fakt)", fmtN(S.m3, 1), "m³"],
          ["Jo'natildi", fmtN(S.shipped), "dona"],
        ].map(([k, v, u]) => (
          <div className="kpi" key={k}>
            <div className="k">{tr(k)}</div>
            <div className="v">
              {v}
              <small>{tr(u)}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="chart">
        <div className="bar">
          <h3 style={{ margin: 0 }}>{tr("Kunlik beton hajmi, m³")}</h3>
          <div className="legend">
            <span>
              <i style={{ background: "var(--bar-2)" }} /> {tr("reja")}</span>
            <span>
              <i style={{ background: "var(--bar)" }} /> {tr("fakt")}</span>
          </div>
        </div>
        <DailyChart month={month} plan={S.planM3} fact={S.factM3} />
      </div>

      {days === null ? (
        <div className="loading">{tr("Yuklanmoqda…")}</div>
      ) : (
        <>
          <div>
            <h3>{tr("Mahsulotlar bo'yicha")}</h3>
            <div className="tbl-wrap">
              {!prodRows.length ? (
                <div className="empty">{tr("Bu oyda yozuv yo'q.")}</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{tr("Mahsulot")}</th>
                      <th className="n">{tr("Reja")}</th>
                      <th className="n">{tr("Fakt")}</th>
                      <th className="n">{tr("Bajarilishi")}</th>
                      <th className="n">{tr("Beton, m³")}</th>
                      <th className="n">{tr("Jo'natildi")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prodRows.map((r) => {
                      const pct = r.plan ? (r.fact / r.plan) * 100 : null;
                      return (
                        <tr key={r.p?.id || Math.random()}>
                          <td>
                            <span className="code">{r.p?.code}</span>
                            <span className="sub">{r.p?.name}</span>
                          </td>
                          <td className="n">{fmtN(r.plan)}</td>
                          <td className="n">{fmtN(r.fact)}</td>
                          <td className={`n ${pct === null ? "" : pct >= 100 ? "ok" : "warn"}`}>{pct === null ? "—" : `${fmtN(pct, 0)} %`}</td>
                          <td className="n">{fmtN(concreteVolume(r.p, mats) * r.fact, 2)}</td>
                          <td className="n">{fmtN(r.shipped)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{tr("Jami")}</td>
                      <td className="n">{fmtN(S.plan)}</td>
                      <td className="n">{fmtN(S.fact)}</td>
                      <td className="n">{S.plan ? `${fmtN((S.fact / S.plan) * 100, 0)} %` : "—"}</td>
                      <td className="n">{fmtN(S.m3, 2)}</td>
                      <td className="n">{fmtN(S.shipped)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>

          <div>
            <h3>{tr("Materiallar: haqiqiy sarf va norma")}</h3>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr("Material")}</th>
                    <th>{tr("Birlik")}</th>
                    <th className="n">{tr("Oy boshida")}</th>
                    <th className="n">{tr("Kirim")}</th>
                    <th className="n">{tr("Chiqim")}</th>
                    <th className="n">{tr("Sarf (haqiqiy)")}</th>
                    <th className="n">{tr("Sarf (norma)")}</th>
                    <th className="n">{tr("Farq")}</th>
                    <th className="n">{tr("Oy oxirida")}</th>
                    <th className="n">{tr("Sarf qiymati, so'm")}</th>
                  </tr>
                </thead>
                <tbody>
                  {matRows.map((r) => {
                    const pct = r.norm ? (r.diff / r.norm) * 100 : null;
                    return (
                      <tr key={r.m.id}>
                        <td>
                          {r.m.name} <span className="unit-s">{r.m.unit}</span>
                        </td>
                        <td className="hide-s">{r.m.unit}</td>
                        <td className="n">{fmtN(r.start, 3)}</td>
                        <td className="n in-text">{r.kirim ? fmtN(r.kirim, 3) : ""}</td>
                        <td className="n out-text">{r.chiqim ? fmtN(r.chiqim, 3) : ""}</td>
                        <td className="n">{fmtN(r.sarf, 3)}</td>
                        <td className="n muted">{fmtN(r.norm, 3)}</td>
                        <td className={`n ${pct !== null && Math.abs(pct) > 10 ? "warn" : ""}`}>
                          {r.diff ? `${r.diff > 0 ? "+" : ""}${fmtN(r.diff, 3)}` : ""}
                          {pct !== null && r.diff ? <span className="sub">{fmtN(pct, 0)} %</span> : null}
                        </td>
                        <td className={`n strong ${r.end < -1e-9 ? "late" : ""}`}>{fmtN(r.end, 3)}</td>
                        <td className="n">{r.value ? fmt(r.value) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={8}>{tr("Sarflangan materiallar qiymati")}</td>
                    <td className="n">{fmt(sarfValue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="hint" style={{ marginTop: 6 }}>{tr(
              "«Farq» — haqiqiy sarf minus norma bo'yicha sarf. 10 % dan ortiq farq sariq bilan ajratilgan."
            )}</p>
          </div>
        </>
      )}
    </section>
  );
}
