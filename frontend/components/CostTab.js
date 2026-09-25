"use client";
import { tr } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROW_TYPES, costCard, fmt, fmtN, lsGet, lsSet } from "@/lib/calc";

const typeHint = (r, card) => {
  if (r.type === "m3") return `${fmt(r.value)} × ${fmtN(card.V, 3)} m³`;
  if (r.type === "kg") return `${fmt(r.value)} × ${fmtN(card.kg, 2)} kg`;
  if (r.type === "pctPrev" || r.type === "pctSS") return `${fmtN(r.value, 2)} %`;
  return "";
};

export function CostCard({ product, mats }) {
  const c = costCard(product, mats);
  return (
    <div className="tbl-wrap">
      <table className="card-tbl no-rt">
        <thead>
          <tr>
            <th>{tr("Nomi")}</th>
            <th className="hide-s">{tr("Birlik")}</th>
            <th className="n">{tr("Norma")}</th>
            <th className="n hide-s">{tr("Narx")}</th>
            <th className="n">{tr("Summa, so'm")}</th>
          </tr>
        </thead>
        <tbody>
          {c.items.map((it, i) => (
            <tr key={i}>
              <td>{it.m?.name || tr("— o'chirilgan —")}</td>
              <td className="hide-s">{it.m?.unit}</td>
              <td className="n">{fmtN(it.norm, 3)}</td>
              <td className="n hide-s">{fmt(it.price, it.price % 1 ? 1 : 0)}</td>
              <td className="n">{fmt(it.sum)}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={4}>Итого СС. материалов</td>
            <td className="n">{fmt(c.materials)}</td>
          </tr>
          {c.prodRows.map((r, i) => (
            <tr key={`p${i}`}>
              <td>{r.name}</td>
              <td colSpan={3} className="muted">
                {typeHint(r, c)}
              </td>
              <td className="n">{fmt(r.amount)}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={4}>Производственная СС.</td>
            <td className="n">{fmt(c.prodSS)}</td>
          </tr>
          {c.otherRows.map((r, i) => (
            <tr key={`o${i}`}>
              <td>{r.name}</td>
              <td colSpan={3} className="muted">
                {typeHint(r, c)}
              </td>
              <td className="n">{fmt(r.amount)}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={4}>{tr("Другие затраты, jami")}</td>
            <td className="n">{fmt(c.other)}</td>
          </tr>
          <tr className="sum">
            <td colSpan={4}>{tr("Итого (tannarx)")}</td>
            <td className="n">{fmt(c.itogo)}</td>
          </tr>
          <tr>
            <td>Маржа</td>
            <td colSpan={3} className="muted">
              {fmtN(c.margin, 2)} %
            </td>
            <td className="n">{fmt(c.marginAmt)}</td>
          </tr>
          <tr className="sum">
            <td colSpan={4}>Цена без НДС</td>
            <td className="n">{fmt(c.noVat)}</td>
          </tr>
          <tr>
            <td>НДС</td>
            <td colSpan={3} className="muted">
              {fmtN(c.vat, 2)} %
            </td>
            <td className="n">{fmt(c.vatAmt)}</td>
          </tr>
          <tr className="total">
            <td colSpan={4}>Цена с НДС</td>
            <td className="n">{fmt(c.final)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function CostTab({ data, onEdit }) {
  const { canEdit } = useUser();
  const { products, mats } = data;
  const [sel, setSel] = useState(() => lsGet("pto.costSel", products[0]?.id));
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      products.map((p) => {
        const c = costCard(p, mats);
        return { p, c, has: Boolean(p.calc?.items?.length) };
      }),
    [products, mats]
  );
  const shown = rows.filter((r) => !q || `${r.p.code} ${r.p.name} ${r.p.group}`.toLowerCase().includes(q.toLowerCase()));
  const cur = rows.find((r) => r.p.id === sel) || rows[0];
  const [sheet, setSheet] = useState(false);
  const sheetRef = useRef(null);
  const choose = (id) => {
    setSel(id);
    lsSet("pto.costSel", id);
    // telefonda karta pastdan chiqadigan oynada ochiladi
    if (window.matchMedia("(max-width: 980px)").matches) setSheet(true);
  };
  useEffect(() => {
    const d = sheetRef.current;
    if (sheet && d && !d.open) d.showModal();
    if (!sheet && d?.open) d.close();
  }, [sheet]);
  const side = cur && (
          <div>
            <div className="bar">
              <div>
                <h3 style={{ margin: 0 }}>
                  {cur.p.name} {cur.p.code}
                </h3>
                <p className="hint">{cur.p.group}</p>
              </div>
              {canEdit && (
                <button className="btn no-print" onClick={() => { setSheet(false); onEdit(cur.p); }}>{tr("Tahrirlash")}</button>
              )}
            </div>
            {!cur.has ? (
              <div className="empty tbl-wrap">{tr("Kalkulyatsiya kiritilmagan. «Tahrirlash» orqali materiallarni qo'shing.")}</div>
            ) : (
              <>
                <CostCard product={cur.p} mats={mats} />
                {cur.p.excelPrice ? (
                  <p className={`hint ${Math.abs(cur.c.final - cur.p.excelPrice) > 1 ? "warn-text" : ""}`} style={{ marginTop: 8 }}>{Math.abs(cur.c.final - cur.p.excelPrice) > 1
                    ? tr("Excel faylidagi narx: {p} so'm — farq {d} so'm", { p: fmt(cur.p.excelPrice), d: `${cur.c.final > cur.p.excelPrice ? "+" : ""}${fmt(cur.c.final - cur.p.excelPrice)}` })
                    : tr("Excel faylidagi narx: {p} so'm — mos.", { p: fmt(cur.p.excelPrice) })}
                  </p>
                ) : null}
                {cur.p.notes?.length ? <p className="hint">{cur.p.notes.join(". ")}</p> : null}
              </>
            )}
          </div>
  );

  return (
    <section className="sheet">
      <div className="bar">
        <div className="l">
          <h2>{tr("Kalkulyatsiya")}</h2>
          <input id="cost-q" type="search" placeholder={tr("Qidirish: Ф5, лоток…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Qidirish")} />
        </div>
        <div className="r">
          <button className="btn" onClick={() => window.print()}>{tr("Chop etish")}</button>
        </div>
      </div>
      <div className="split">
        <div className="tbl-wrap list-pane no-print">
          <table>
            <thead>
              <tr>
                <th>{tr("Mahsulot")}</th>
                <th className="n">{tr("Beton, m³")}</th>
                <th className="n">{tr("Tannarx")}</th>
                <th className="n">{tr("Narx QQS bilan")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ p, c, has }) => (
                <tr key={p.id} className={`clickable ${cur?.p.id === p.id ? "selected" : ""}`} onClick={() => choose(p.id)}>
                  <td>
                    <span className="code">{p.code}</span>
                    <span className="sub">{p.name}</span>
                  </td>
                  <td className="n">{has ? fmtN(c.V, 3) : ""}</td>
                  <td className="n">{has ? fmt(c.itogo) : "—"}</td>
                  <td className="n strong">{has ? fmt(c.final) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cur && <div className="cost-side">{side}</div>}
      </div>
      <dialog ref={sheetRef} className="bsheet cost-sheet" onClose={() => setSheet(false)}>
        {sheet && cur && (
          <div className="bsheet-body">
            <div className="bsheet-grip" aria-hidden="true" />
            <div className="bsheet-head">
              <span />
              <button type="button" className="icon-btn" onClick={() => setSheet(false)} aria-label={tr("Yopish")}>
                ✕
              </button>
            </div>
            {side}
          </div>
        )}
      </dialog>
      <p className="hint">{tr("Qator turlari:")} {ROW_TYPES.map(([, l]) => tr(l)).join(" · ")}.</p>
    </section>
  );
}
