"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * Oddiy SVG grafik: ustunlar (yonma-yon yoki ustma-ust) yoki chiziq.
 * Qoidalar: bitta o'q; ustun ≤ 24px, uchi 4px yumaloq, tagi to'g'ri; ustunlar orasida 2px bo'shliq;
 * chiziq 2px; nuqta r=4 + 2px sirt halqasi; to'r chiziqlari ingichka va xira.
 * Rang — CSS o'zgaruvchisi (--s1…--s4), matn doim matn rangida.
 * Sichqoncha/barmoq ostida — oy bo'yicha barcha qiymatlar; «Jadval» — shu ma'lumot jadval ko'rinishida.
 *
 * labels: ["2026-01", …] · series: [{ key, label, color: "var(--s1)", values: [..] }]
 * type: "group" | "stack" | "line" · fmt: (v) => string · xfmt: (label) => string
 */
export default function Chart({ title, sub, labels, series, type = "group", fmt = (v) => String(v), xfmt = (x) => x, height = 220 }) {
  const t = useT();
  const wrap = useRef(null);
  const [w, setW] = useState(560);
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  const n = labels.length;
  const pad = { l: 44, r: 12, t: 10, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const vals = (i) => series.map((s) => +s.values[i] || 0);
  const maxV = Math.max(
    0,
    ...labels.map((_, i) => (type === "stack" ? vals(i).reduce((a, b) => a + Math.max(0, b), 0) : Math.max(...vals(i))))
  );
  const ticks = niceTicks(maxV);
  const top = ticks[ticks.length - 1] || 1;
  const y = (v) => pad.t + ih - (v / top) * ih;
  const band = iw / Math.max(1, n);
  const cx = (i) => pad.l + band * i + band / 2;
  const groupW = Math.min(band * 0.7, type === "group" ? 24 * series.length + 2 * (series.length - 1) : 24);
  const barW = type === "group" ? Math.max(3, (groupW - 2 * (series.length - 1)) / series.length) : groupW;
  const empty = maxV <= 0;
  const showLabel = (i) => n <= 8 || i % Math.ceil(n / 8) === (n - 1) % Math.ceil(n / 8);

  return (
    <figure className="chart-card">
      <figcaption>
        <div>
          <h3>{title}</h3>
          {sub && <p className="muted">{sub}</p>}
        </div>
        <button type="button" className="linkbtn" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {t(table ? "Grafik" : "Jadval")}
        </button>
      </figcaption>
      {series.length > 1 && (
        <ul className="legend-row" aria-label={t("Belgilar")}>
          {series.map((s) => (
            <li key={s.key}>
              <span className={`key ${type === "line" ? "key-line" : ""}`} style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {table ? (
        <div className="tbl-wrap chart-table">
          <table>
            <thead>
              <tr>
                <th>{t("Oy")}</th>
                {series.map((s) => (
                  <th key={s.key} className="n">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={l}>
                  <td>{xfmt(l, true)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="n">
                      {s.values[i] == null ? "—" : fmt(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="chart-wrap" onMouseLeave={() => setHover(null)}>
          <svg width={w} height={height} role="img" aria-label={title}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="grid" />
                <text x={pad.l - 6} y={y(v)} className="axis" textAnchor="end" dominantBaseline="middle">
                  {fmtTick(v)}
                </text>
              </g>
            ))}
            {labels.map((l, i) =>
              showLabel(i) ? (
                <text key={l} x={cx(i)} y={height - 6} className="axis" textAnchor="middle">
                  {xfmt(l)}
                </text>
              ) : null
            )}
            {hover != null && <rect x={pad.l + band * hover} y={pad.t} width={band} height={ih} className="hover-band" />}

            {type !== "line" &&
              labels.map((l, i) => {
                if (type === "group")
                  return series.map((s, k) => {
                    const v = Math.max(0, +s.values[i] || 0);
                    const x = cx(i) - groupW / 2 + k * (barW + 2);
                    return v > 0 ? <path key={`${l}-${s.key}`} d={bar(x, y(v), barW, y(0) - y(v), true)} fill={s.color} /> : null;
                  });
                let base = 0;
                const segs = series.map((s) => ({ s, v: Math.max(0, +s.values[i] || 0) })).filter((x) => x.v > 0);
                return segs.map(({ s, v }, k) => {
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base);
                  const hgt = Math.max(0, y0 - y1 - (k < segs.length - 1 ? 2 : 0)); // 2px sirt bo'shlig'i
                  return <path key={`${l}-${s.key}`} d={bar(cx(i) - barW / 2, y0 - hgt, barW, hgt, k === segs.length - 1)} fill={s.color} />;
                });
              })}

            {type === "line" &&
              series.map((s) => {
                const pts = labels.map((_, i) => (s.values[i] == null ? null : [cx(i), y(+s.values[i])]));
                const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? "L" : "M"}${p[0]},${p[1]}` : acc), "");
                const lastI = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0).pop();
                return (
                  <g key={s.key}>
                    <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    {pts.map((p, i) =>
                      p && (i === lastI || i === hover) ? <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={s.color} className="dot" /> : null
                    )}
                    {lastI != null && series.length === 1 && (
                      <text x={Math.min(pts[lastI][0], w - pad.r - 4)} y={pts[lastI][1] - 10} className="val" textAnchor="end">
                        {fmt(s.values[lastI])}
                      </text>
                    )}
                  </g>
                );
              })}

            {labels.map((l, i) => (
              <rect
                key={`h-${l}`}
                x={pad.l + band * i}
                y={pad.t}
                width={band}
                height={ih + pad.b}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
                onClick={() => setHover(i)}
              />
            ))}
            {empty && (
              <text x={pad.l + iw / 2} y={pad.t + ih / 2} className="axis" textAnchor="middle">
                {t("Ma'lumot yo'q")}
              </text>
            )}
          </svg>
          {hover != null && !empty && (
            <div className="chart-tip" style={{ left: Math.min(Math.max(cx(hover), 90), w - 90) }}>
              <strong>{xfmt(labels[hover], true)}</strong>
              {series.map((s) => (
                <span key={s.key}>
                  <i style={{ background: s.color }} />
                  {series.length > 1 && <>{s.label}: </>}
                  <b>{s.values[hover] == null ? "—" : fmt(s.values[hover])}</b>
                </span>
              ))}
              {type === "stack" && series.length > 1 && (
                <span className="tip-total">
                  {t("Jami")}: <b>{fmt(series.reduce((a, s) => a + (+s.values[hover] || 0), 0))}</b>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

// ustun: uchi 4px yumaloq, tagi to'g'ri
function bar(x, y0, w, h, round) {
  if (h <= 0) return "";
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y0 + h}V${y0 + r}Q${x},${y0} ${x + r},${y0}H${x + w - r}Q${x + w},${y0} ${x + w},${y0 + r}V${y0 + h}Z`;
}
function niceTicks(max) {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
function fmtTick(v) {
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${+(v / 1e3).toFixed(0)}k`;
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}
