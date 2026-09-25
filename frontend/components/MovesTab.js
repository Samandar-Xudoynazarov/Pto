"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import { fmt, fmtDate, fmtN, shiftDate, today } from "@/lib/calc";
import ExportButtons from "./ExportButtons";
import Icon from "./Icon";

const PERIODS = [
  ["today", "Bugun"],
  ["7", "7 kun"],
  ["30", "30 kun"],
  ["month", "Shu oy"],
  ["custom", "Davr"],
];

function range(p, from, to) {
  const d = today();
  if (p === "today") return [d, d];
  if (p === "7") return [shiftDate(d, -6), d];
  if (p === "30") return [shiftDate(d, -29), d];
  if (p === "month") return [`${d.slice(0, 7)}-01`, d];
  return [from || d, to || d];
}

/** Ombor tarixi: kirim va chiqimlar, kun bo'yicha guruhlangan */
export default function MovesTab({ data, notify, version, onChanged }) {
  const t = useT();
  const { user, canEdit } = useUser();
  const { materials, targets = [], mats } = data;
  const [period, setPeriod] = useState("7");
  const [cFrom, setCFrom] = useState(shiftDate(today(), -6));
  const [cTo, setCTo] = useState(today());
  const [type, setType] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [items, setItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState(null);

  const [from, to] = range(period, cFrom, cTo);
  const load = useCallback(async () => {
    setItems(null);
    const qs = new URLSearchParams({ from, to, limit: "1000" });
    if (type) qs.set("type", type);
    if (materialId) qs.set("materialId", materialId);
    if (targetId) qs.set("targetId", targetId);
    try {
      const r = await api(`/movements?${qs}`);
      setItems(r.items);
      setHasMore(r.hasMore);
    } catch (e) {
      notify(t(e.message));
      setItems([]);
    }
  }, [from, to, type, materialId, targetId, notify, t]);
  useEffect(() => {
    load();
  }, [load, version]);

  const tname = (id) => targets.find((x) => x.id === id);
  const groups = useMemo(() => {
    const g = new Map();
    for (const m of items || []) {
      if (!g.has(m.date)) g.set(m.date, []);
      g.get(m.date).push(m);
    }
    return [...g.entries()];
  }, [items]);
  const sumIn = (items || []).filter((m) => m.type === "in").reduce((s, m) => s + m.qty * (m.price || 0), 0);
  const sumOut = (items || []).filter((m) => m.type === "out").reduce((s, m) => s + m.qty * (m.price || 0), 0);

  const canCancel = (m) =>
    canEdit || (m.createdBy?.id === user?.id && Date.now() - new Date(m.createdAt).getTime() < 24 * 36e5);

  async function cancel(m) {
    if (!window.confirm(t("Bu yozuv bekor qilinsinmi? Qoldiq qayta hisoblanadi."))) return;
    try {
      await api(`/movements/${m.id}`, { method: "DELETE" });
      notify(t("Bekor qilindi"));
      setOpen(null);
      onChanged?.();
    } catch (e) {
      notify(t(e.message));
    }
  }

  // Excel: 1-varaq — barcha yozuvlar, 2-varaq — material bo'yicha jami
  function buildExport() {
    const list = items || [];
    const where = (m) => (m.type === "in" ? m.supplier : [tname(m.departmentId)?.name, tname(m.vehicleId)?.name].filter(Boolean).join(", "));
    const sum = new Map();
    for (const m of list) {
      const r = sum.get(m.materialId) || { inQ: 0, outQ: 0, inS: 0, outS: 0 };
      if (m.type === "in") (r.inQ += m.qty), (r.inS += m.qty * (m.price || 0));
      else (r.outQ += m.qty), (r.outS += m.qty * (m.price || 0));
      sum.set(m.materialId, r);
    }
    const period = `${fmtDate(from)} — ${fmtDate(to)}`;
    const filt = [type && t(type === "in" ? "Faqat kirim" : "Faqat chiqim"), materialId && mats.get(materialId)?.name, targetId && tname(targetId)?.name].filter(Boolean).join(", ");
    return {
      filename: `Kirim-chiqim_${from}_${to}.xlsx`,
      sheets: [
        {
          name: t("Kirim-chiqim tarixi"),
          title: `${t("Kirim-chiqim tarixi")}: ${period}`,
          subtitle: filt,
          columns: [
            { header: t("Sana"), key: "date", type: "date", width: 11 },
            { header: t("Turi"), key: "type", width: 9 },
            { header: t("Material"), key: "mat", width: 32 },
            { header: t("Birlik"), key: "unit", width: 7 },
            { header: t("Metrda"), key: "meters", type: "num", width: 10 },
            { header: t("Kirim"), key: "in", type: "num", total: "sum", width: 11 },
            { header: t("Chiqim"), key: "out", type: "num", total: "sum", width: 11 },
            { header: t("Narx"), key: "price", type: "money", width: 12 },
            { header: t("Summa, so'm"), key: "sum", type: "money", width: 15 },
            { header: t("Qayerdan / qayerga"), key: "where", width: 28 },
            { header: t("Mas'ul shaxs"), key: "person", width: 18 },
            { header: t("Nakladnoy"), key: "doc", width: 12 },
            { header: t("Izoh"), key: "note", width: 22 },
            { header: t("Kim kiritdi"), key: "who", width: 16 },
          ],
          rows: [...list].reverse().map((m) => {
            const mat = mats.get(m.materialId);
            return {
              date: fmtDate(m.date),
              type: t(m.type === "in" ? "Kirim" : "Chiqim"),
              mat: mat?.name || "?",
              unit: mat?.unit,
              meters: m.inputUnit === "m" ? m.inputQty : null,
              in: m.type === "in" ? m.qty : null,
              out: m.type === "out" ? m.qty : null,
              price: m.price || null,
              sum: Math.round(m.qty * (m.price || 0)) || null,
              where: where(m),
              person: m.person,
              doc: m.docNumber,
              note: m.note,
              who: m.createdBy?.name,
              _cell: { type: m.type === "in" ? "ok" : "warn" },
            };
          }),
        },
        {
          name: t("Material bo'yicha"),
          title: `${t("Material bo'yicha jami")}: ${period}`,
          subtitle: filt,
          columns: [
            { header: t("Material"), key: "mat", width: 34 },
            { header: t("Birlik"), key: "unit", width: 8 },
            { header: t("Kirim"), key: "inQ", type: "num" },
            { header: t("Chiqim"), key: "outQ", type: "num" },
            { header: t("Kirim summasi"), key: "inS", type: "money", total: "sum", width: 17 },
            { header: t("Chiqim summasi"), key: "outS", type: "money", total: "sum", width: 17 },
          ],
          rows: [...sum.entries()]
            .map(([id, r]) => ({ mat: mats.get(id)?.name || "?", unit: mats.get(id)?.unit, inQ: r.inQ || null, outQ: r.outQ || null, inS: Math.round(r.inS) || null, outS: Math.round(r.outS) || null }))
            .sort((a, b) => a.mat.localeCompare(b.mat)),
        },
      ],
    };
  }

  return (
    <section className="sheet">
      <div className="chips scroll-x">
        {PERIODS.map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>
            {t(l)}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="bar">
          <div className="l">
            <input type="date" value={cFrom} max={cTo} onChange={(e) => e.target.value && setCFrom(e.target.value)} aria-label={t("Dan")} />
            <span className="muted">—</span>
            <input type="date" value={cTo} min={cFrom} onChange={(e) => e.target.value && setCTo(e.target.value)} aria-label={t("Gacha")} />
          </div>
        </div>
      )}
      <div className="filters">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t("Turi")}>
          <option value="">{t("Kirim va chiqim")}</option>
          <option value="in">{t("Faqat kirim")}</option>
          <option value="out">{t("Faqat chiqim")}</option>
        </select>
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} aria-label={t("Material")}>
          <option value="">{t("Barcha materiallar")}</option>
          {materials
            .filter((m) => m.stock)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label={t("Bo'lim / texnika")}>
          <option value="">{t("Barcha bo'lim va texnikalar")}</option>
          {targets.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.code ? ` · ${x.code}` : ""}
            </option>
          ))}
        </select>
        <ExportButtons build={buildExport} company={data.settings?.company} notify={notify} disabled={!items?.length} />
      </div>

      {items && (
        <div className="kpis kpis-3">
          <div className="kpi">
            <div className="k">{t("Yozuvlar")}</div>
            <div className="v">{items.length}</div>
          </div>
          <div className="kpi kpi-in">
            <div className="k">{t("Kirim summasi")}</div>
            <div className="v">
              {fmt(sumIn / 1e6, 1)}
              <small>{t("mln so'm")}</small>
            </div>
          </div>
          <div className="kpi kpi-out">
            <div className="k">{t("Chiqim summasi")}</div>
            <div className="v">
              {fmt(sumOut / 1e6, 1)}
              <small>{t("mln so'm")}</small>
            </div>
          </div>
        </div>
      )}

      {!items ? (
        <div className="loading">{t("Yuklanmoqda…")}</div>
      ) : !items.length ? (
        <div className="empty">{t("Bu davrda kirim-chiqim yo'q")}</div>
      ) : (
        <div className="day-groups">
          {groups.map(([date, list]) => (
            <div key={date}>
              <h3 className="day-h">
                {fmtDate(date)}
                {date === today() && <span className="pill st-yangi">{t("Bugun")}</span>}
              </h3>
              <ul className="moves">
                {list.map((m) => {
                  const mat = mats.get(m.materialId);
                  const where = m.type === "in" ? m.supplier : [tname(m.departmentId)?.name, tname(m.vehicleId)?.name, m.person].filter(Boolean).join(" · ");
                  return (
                    <li key={m.id}>
                      <button className={`mv mv-${m.type}`} onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                        <span className="mv-ico">
                          <Icon name={m.type} />
                        </span>
                        <span className="card-main">
                          <strong>{mat?.name || t("— o'chirilgan —")}</strong>
                          <span className="muted">{where || t(m.type === "in" ? "Kirim" : "Chiqim")}</span>
                        </span>
                        <span className="card-num">
                          <strong className="mv-qty">
                            {m.type === "in" ? "+" : "−"}
                            {fmtN(m.qty, 3)}
                          </strong>
                          <span className="muted">
                            {mat?.unit}
                            {m.inputUnit === "m" && ` · ${fmtN(m.inputQty, 3)} ${t("m")}`}
                          </span>
                        </span>
                      </button>
                      {open === m.id && (
                        <div className="mv-detail">
                          <dl>
                            {m.price > 0 && (
                              <>
                                <dt>{t("Narx")}</dt>
                                <dd>
                                  {fmt(m.price)} {t("so'm")} · {t("jami")} {fmt(m.qty * m.price)}
                                </dd>
                              </>
                            )}
                            {m.docNumber && (
                              <>
                                <dt>{t("Nakladnoy")}</dt>
                                <dd>{m.docNumber}</dd>
                              </>
                            )}
                            {m.person && (
                              <>
                                <dt>{t(m.type === "in" ? "Kim qabul qildi" : "Mas'ul shaxs")}</dt>
                                <dd>{m.person}</dd>
                              </>
                            )}
                            {m.note && (
                              <>
                                <dt>{t("Izoh")}</dt>
                                <dd>{m.note}</dd>
                              </>
                            )}
                            <dt>{t("Kim kiritdi")}</dt>
                            <dd>
                              {m.createdBy?.name || "?"} · {new Date(m.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                            </dd>
                          </dl>
                          {canCancel(m) && (
                            <button className="btn sm danger" onClick={() => cancel(m)}>
                              {t("Bekor qilish")}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {hasMore && <p className="hint">{t("Faqat oxirgi 1000 ta yozuv ko'rsatildi — davrni qisqartiring.")}</p>}
        </div>
      )}
    </section>
  );
}
