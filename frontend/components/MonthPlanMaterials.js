"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { GROUPS, consumption, fmtDate, fmtN, priceOf, today } from "@/lib/calc";
import { monthTitle } from "@/lib/month-plan";
import ExportButtons from "./ExportButtons";

const r3 = (x) => Math.round((+x || 0) * 1000) / 1000;
const groupOrder = (g) => {
  const i = GROUPS.findIndex(([k]) => k === g);
  return i < 0 ? 99 : i;
};

/**
 * Tasdiqlangan reja bo'yicha material sarfi: butun oyga va bugundan oy oxirigacha kerak bo'ladigan materiallar,
 * ombordagi joriy qoldiq bilan solishtirib (sarf normasi + beton retsepti + elektrod — lib/calc.js → consumption).
 */
export default function MonthPlanMaterials({ plan, month, n, todayIdx, data, notify, editing }) {
  const t = useT();
  const { materials, prods, mats, settings } = data;
  const [stock, setStock] = useState(null);
  const [group, setGroup] = useState("all");
  const todayS = today();
  const past = todayIdx >= n; // oy tugagan — qolgan kunlar yo'q, ombor bilan solishtirish ma'nosiz
  const from = Math.max(0, Math.min(todayIdx, n)); // «qolgan» kunlar shu indeksdan (bugun ham kiradi)

  useEffect(() => {
    if (past) return setStock(null);
    let alive = true;
    api(`/stock?from=${todayS}&to=${todayS}`)
      .then((s) => alive && setStock(s))
      .catch((e) => alive && notify(e.message));
    return () => {
      alive = false;
    };
  }, [past, todayS, notify]);

  const calc = useMemo(() => {
    const allLines = [];
    const restLines = [];
    const noNorm = [];
    let unlinked = 0;
    for (const r of plan.rows) {
      const total = r.days.reduce((s, v) => s + (+v || 0), 0);
      if (!total) continue;
      if (!r.productId || !prods.get(r.productId)) {
        unlinked++;
        continue;
      }
      const p = prods.get(r.productId);
      if (!p.norms?.length) noNorm.push(p.code || r.name);
      const rest = r.days.slice(from).reduce((s, v) => s + (+v || 0), 0);
      allLines.push({ productId: r.productId, qty: total });
      if (rest) restLines.push({ productId: r.productId, qty: rest });
    }
    const all = consumption(allLines, prods, mats, settings);
    const rest = consumption(restLines, prods, mats, settings);
    // beton (retsept) o'zi ombor materiali emas — uning tarkibi (qum, sement, sheben) alohida qatorlarda keladi
    const rows = [...all.entries()]
      .map(([id, q]) => ({ m: mats.get(id), q, rest: rest.get(id) || 0 }))
      .filter((x) => x.m?.stock)
      .map((x) => {
        const price = priceOf(x.m, mats);
        const bal = stock?.materials?.[x.m.id]?.end || 0;
        return { ...x, price, value: x.q * price, restValue: x.rest * price, bal, short: Math.max(0, x.rest - bal) };
      })
      .sort((a, b) => groupOrder(a.m.group) - groupOrder(b.m.group) || b.value - a.value);
    return { rows, unlinked, noNorm };
  }, [plan, from, prods, mats, settings, stock]);

  if (!plan.rows.length) return null;
  const groups = GROUPS.filter(([k]) => calc.rows.some((r) => r.m.group === k));
  const rows = group === "all" ? calc.rows : calc.rows.filter((r) => r.m.group === group);
  const totValue = rows.reduce((s, r) => s + r.value, 0);
  const shortCount = calc.rows.filter((r) => r.short > 1e-9).length;
  const showRest = !past && todayIdx > 0; // joriy oy: «butun oy» va «qolgan kunlar» farq qiladi
  const showStock = !past;

  const restLabel = todayIdx < 0 ? t("Butun oyga") : t("Bugundan oy oxirigacha");

  return (
    <details className="plan-set mp-sum mp-mat">
      <summary>
        {t("Material sarfi (reja bo'yicha)")} · {calc.rows.length}
        {showStock && shortCount > 0 && <span className="pill st-jarayonda" style={{ marginLeft: 8 }}>{t("{n} ta material yetishmaydi", { n: shortCount })}</span>}
      </summary>

      <p className="hint">
        {t("Rejadagi soni × mahsulot sarf normasi (beton — retsept bo'yicha qum, sement, sheben; elektrod — metallning foizi). Narx — «Materiallar» bo'limidagi joriy narx.")}
        {showStock && " " + t("Omborda — bugungi ({d}) qoldiq.", { d: fmtDate(todayS) })}
        {editing && " " + t("Saqlanmagan o'zgarishlar ham hisobga olinmoqda.")}
      </p>
      {calc.unlinked > 0 && <p className="hint warn-text">{t("Katalog bilan bog'lanmagan {n} ta mahsulot hisobga kirmadi.", { n: calc.unlinked })}</p>}
      {calc.noNorm.length > 0 && <p className="hint warn-text">{t("Sarf normasi kiritilmagan: {list}", { list: calc.noNorm.join(", ") })}</p>}

      {!calc.rows.length ? (
        <div className="empty">{t("Reja bo'yicha material sarfi chiqmadi.")}</div>
      ) : (
        <>
          <div className="bar" style={{ margin: "8px 0" }}>
            <div className="l chips">
              <button type="button" className="chip" aria-pressed={group === "all"} onClick={() => setGroup("all")}>
                {t("Hammasi")}
              </button>
              {groups.map(([k, l]) => (
                <button key={k} type="button" className="chip" aria-pressed={group === k} onClick={() => setGroup(k)}>
                  {t(l)}
                </button>
              ))}
            </div>
            <div className="r">
              <ExportButtons
                company={settings?.company}
                notify={notify}
                build={() => ({
                  filename: `Material_sarfi_${month}.xlsx`,
                  sheets: [
                    {
                      name: tr("Material sarfi"),
                      title: tr("{m} oyi rejasi bo'yicha material sarfi", { m: monthTitle(month) }),
                      subtitle: showStock ? tr("Omborda — {d} holatiga", { d: fmtDate(todayS) }) : undefined,
                      columns: [
                        { header: tr("Material"), key: "name", width: 34 },
                        { header: tr("Guruh"), key: "group", width: 14 },
                        { header: tr("Birlik"), key: "unit", width: 8 },
                        { header: tr("Butun oyga"), key: "q", type: "num" },
                        ...(showRest ? [{ header: tr("Bugundan oy oxirigacha"), key: "rest", type: "num", width: 16 }] : []),
                        ...(showStock
                          ? [
                              { header: tr("Omborda"), key: "bal", type: "num" },
                              { header: tr("Yetishmaydi"), key: "short", type: "num" },
                            ]
                          : []),
                        { header: tr("Narx, so'm"), key: "price", type: "money" },
                        { header: tr("Summa, so'm"), key: "value", type: "money", total: "sum", width: 18 },
                      ],
                      rows: rows.map((r) => ({
                        name: r.m.name,
                        group: tr(GROUPS.find(([k]) => k === r.m.group)?.[1] || ""),
                        unit: r.m.unit,
                        q: r3(r.q),
                        rest: r3(r.rest),
                        bal: r3(r.bal),
                        short: r.short > 1e-9 ? r3(r.short) : null,
                        price: r.price || null,
                        value: r.price ? Math.round(r.value) : null,
                        _cell: r.short > 1e-9 ? { short: "bad" } : undefined,
                      })),
                    },
                  ],
                })}
              />
            </div>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Material")}</th>
                  <th className="n">{t("Butun oyga")}</th>
                  {showRest && <th className="n">{restLabel}</th>}
                  {showStock && <th className="n">{t("Omborda")}</th>}
                  {showStock && <th className="n">{t("Yetishmaydi")}</th>}
                  <th className="n">{t("Summa, so'm")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.m.id}>
                    <td>
                      {r.m.name} <span className="muted">({r.m.unit})</span>
                    </td>
                    <td className="n strong">{fmtN(r.q, 3)}</td>
                    {showRest && <td className="n">{fmtN(r.rest, 3)}</td>}
                    {showStock && <td className={`n${r.bal < -1e-9 ? " warn-text" : ""}`}>{fmtN(r.bal, 3)}</td>}
                    {showStock && <td className={`n strong ${r.short > 1e-9 ? "late" : "ok"}`}>{r.short > 1e-9 ? fmtN(r.short, 3) : t("yetadi")}</td>}
                    <td className="n">{r.price ? fmtN(r.value, 0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="strong">{t("Jami")}</td>
                  <td />
                  {showRest && <td />}
                  {showStock && <td />}
                  {showStock && <td />}
                  <td className="n strong">{fmtN(totValue, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {showStock && (
            <p className="hint">
              {todayIdx < 0 ? t("«Yetishmaydi» = butun oyga kerak − omborda.") : t("«Yetishmaydi» = bugundan oy oxirigacha kerak − omborda.")} {t("Kutilayotgan kirimlar hisobga olinmagan.")}
            </p>
          )}
        </>
      )}
    </details>
  );
}
