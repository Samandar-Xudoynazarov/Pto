"use client";
import { tr } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@/lib/role";
import { api } from "@/lib/api";
import { GROUPS, consumption, costCard, fmt, fmtDate, fmtN, priceOf, today } from "@/lib/calc";

function OpeningDialog({ open, onClose, data, onSaved, notify }) {
  const ref = useRef(null);
  const { materials, products, settings } = data;
  const [date, setDate] = useState("");
  const [mq, setMq] = useState({});
  const [pq, setPq] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (open) {
      setDate(settings.opening?.date || today());
      setMq({ ...(settings.opening?.materials || {}) });
      setPq({ ...(settings.opening?.products || {}) });
      if (d && !d.open) d.showModal();
    } else if (d?.open) d.close();
  }, [open, settings]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/settings", { method: "PUT", body: { opening: { date, materials: mq, products: pq } } });
      notify("Boshlang'ich qoldiq saqlandi");
      onSaved();
      onClose();
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} className="wide-dlg">
      <form onSubmit={save}>
        <h2>{tr("Boshlang'ich qoldiq")}</h2>
        <p className="hint">{tr(
          "Omborni hisoblash shu sananing BOSHIDAGI qoldiqdan boshlanadi. Undan oldingi kunlik hisobotlar hisobga olinmaydi."
        )}</p>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="op-date">{tr("Sana")}</label>
          <input id="op-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="grid2">
          <div>
            <h3>{tr("Materiallar")}</h3>
            <div className="tbl-wrap scroll-y">
              <table className="edit">
                <tbody>
                  {materials
                    .filter((m) => m.stock)
                    .map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td className="n">
                          <input id={`op-m-${m.id}`} type="number" step="any" value={mq[m.id] ?? ""} onChange={(e) => setMq((x) => ({ ...x, [m.id]: e.target.value }))} aria-label={m.name} />
                        </td>
                        <td className="muted">{m.unit}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3>{tr("Tayyor mahsulot, dona")}</h3>
            <div className="tbl-wrap scroll-y">
              <table className="edit">
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="code">{p.code}</span>
                      </td>
                      <td className="n">
                        <input id={`op-p-${p.id}`} type="number" step="1" value={pq[p.id] ?? ""} onChange={(e) => setPq((x) => ({ ...x, [p.id]: e.target.value }))} aria-label={p.code} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>{tr("Bekor qilish")}</button>
          <button className="btn primary" disabled={busy}>
            {busy ? tr("Saqlanmoqda…") : tr("Saqlash")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function StockTab({ data, notify, reloadSettings, version }) {
  const { canEdit } = useUser();
  const { materials, products, mats, prods, settings, orders } = data;
  const [date, setDate] = useState(today());
  const [stock, setStock] = useState(null);
  const [group, setGroup] = useState("all");
  const [openDlg, setOpenDlg] = useState(false);

  const load = useCallback(async () => {
    try {
      setStock(await api(`/stock?from=${date}&to=${date}`));
    } catch (e) {
      notify(e.message);
    }
  }, [date, notify]);
  useEffect(() => {
    load();
  }, [load, settings, version]);

  const matRows = materials
    .filter((m) => m.stock && (group === "all" || m.group === group))
    .map((m) => {
      const q = stock?.materials?.[m.id]?.end || 0;
      const price = priceOf(m, mats);
      return { m, q, price, value: q * price };
    });
  const matValue = matRows.reduce((s, r) => s + (r.q > 0 ? r.value : 0), 0);

  const prodRows = products
    .map((p) => {
      const q = stock?.products?.[p.id]?.end || 0;
      const price = p.calc?.items?.length ? costCard(p, mats).final : 0;
      return { p, q, price, value: q * price };
    })
    .filter((r) => r.q);
  const prodValue = prodRows.reduce((s, r) => s + (r.q > 0 ? r.value : 0), 0);

  // faol buyurtmalar uchun ehtiyoj
  const need = useMemo(() => {
    const left = new Map();
    for (const o of orders) {
      if (o.status === "topshirildi") continue;
      const l = Math.max(0, (+o.qty || 0) - (o.shipped || 0));
      if (l) left.set(o.productId, (left.get(o.productId) || 0) + l);
    }
    const toMake = [];
    for (const [id, l] of left) {
      const have = Math.max(0, stock?.products?.[id]?.end || 0);
      const make = Math.max(0, l - have);
      toMake.push({ productId: id, left: l, have, qty: make });
    }
    const req = consumption(toMake, prods, mats, settings);
    const rows = [...req.entries()]
      .map(([id, q]) => ({ m: mats.get(id), q, bal: stock?.materials?.[id]?.end || 0 }))
      .filter((r) => r.m?.stock)
      .map((r) => ({ ...r, short: Math.max(0, r.q - r.bal) }))
      .sort((a, b) => b.short * priceOf(b.m, mats) - a.short * priceOf(a.m, mats));
    return { toMake: toMake.filter((x) => x.left), rows };
  }, [orders, stock, prods, mats, settings]);

  return (
    <section className="sheet">
      <div className="bar">
        <div className="l">
          <h2>{tr("Ombor")}</h2>
          <label className="check" htmlFor="st-date">{tr("holatiga")}</label>
          <input id="st-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <div className="r">
          {canEdit && (
            <button className="btn" onClick={() => setOpenDlg(true)}>{tr("Boshlang'ich qoldiq")}</button>
          )}
        </div>
      </div>
      {stock && (
        <p className="hint">
          {stock.openingDate
            ? tr("Qoldiq {a} boshidagi boshlang'ich qoldiq + {b} oxirigacha barcha kunlik hisobotlar va ombor harakatlaridan hisoblandi.", { a: fmtDate(stock.openingDate), b: fmtDate(date) })
            : tr("Boshlang'ich qoldiq kiritilmagan — hisob noldan boshlanadi.")}
        </p>
      )}

      <div className="kpis kpis-3">
        <div className="kpi">
          <div className="k">{tr("Materiallar qiymati")}</div>
          <div className="v">
            {fmt(matValue / 1e6, 1)}
            <small>{tr("mln so'm")}</small>
          </div>
        </div>
        <div className="kpi">
          <div className="k">{tr("Tayyor mahsulot")}</div>
          <div className="v">
            {fmtN(prodRows.reduce((s, r) => s + r.q, 0))}
            <small>{tr("dona")}</small>
          </div>
        </div>
        <div className="kpi">
          <div className="k">{tr("Tayyor mahsulot qiymati")}</div>
          <div className="v">
            {fmt(prodValue / 1e6, 1)}
            <small>{tr("mln so'm")}</small>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div>
          <div className="bar">
            <h3 style={{ margin: 0 }}>{tr("Materiallar qoldig'i")}</h3>
            <select id="st-group" value={group} onChange={(e) => setGroup(e.target.value)} aria-label={tr("Guruh")}>
              <option value="all">{tr("Barcha guruhlar")}</option>
              {GROUPS.filter(([k]) => k !== "beton" && k !== "xizmat").map(([k, l]) => (
                <option key={k} value={k}>
                  {tr(l)}
                </option>
              ))}
            </select>
          </div>
          <div className="tbl-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>{tr("Material")}</th>
                  <th className="n">{tr("Qoldiq")}</th>
                  <th>{tr("Birlik")}</th>
                  <th className="n">{tr("Qiymat, so'm")}</th>
                </tr>
              </thead>
              <tbody>
                {matRows.map((r) => (
                  <tr key={r.m.id}>
                    <td>
                      {r.m.name} <span className="unit-s">{r.m.unit}</span>
                    </td>
                    <td className={`n strong ${r.q < -1e-9 ? "late" : ""}`}>{fmtN(r.q, 3)}</td>
                    <td className="hide-s">{r.m.unit}</td>
                    <td className="n">{r.q ? fmt(r.value) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3>{tr("Tayyor mahsulot qoldig'i")}</h3>
          <div className="tbl-wrap">
            {!prodRows.length ? (
              <div className="empty">{tr("Qoldiq yo'q.")}</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{tr("Mahsulot")}</th>
                    <th className="n">{tr("Qoldiq, dona")}</th>
                    <th className="n">{tr("Narx (QQS bilan)")}</th>
                    <th className="n">{tr("Qiymat, so'm")}</th>
                  </tr>
                </thead>
                <tbody>
                  {prodRows.map((r) => (
                    <tr key={r.p.id}>
                      <td>
                        <span className="code">{r.p.code}</span>
                        <span className="sub">{r.p.name}</span>
                      </td>
                      <td className={`n strong ${r.q < 0 ? "late" : ""}`}>{fmtN(r.q)}</td>
                      <td className="n">{r.price ? fmt(r.price) : "—"}</td>
                      <td className="n">{r.price ? fmt(r.value) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h3 style={{ marginTop: 20 }}>{tr("Faol buyurtmalar uchun material ehtiyoji")}</h3>
          {!need.toMake.length ? (
            <div className="empty tbl-wrap">{tr("Faol buyurtmalarda qoldiq yo'q.")}</div>
          ) : (
            <>
              <p className="hint">{tr("Buyurtma qoldig'i (jo'natilmagan) minus ombordagi tayyor mahsulot =")}{" "}
                {need.toMake
                  .filter((x) => x.qty)
                  .map((x) => `${prods.get(x.productId)?.code} ${x.qty} ${tr("dona")}`)
                  .join(", ") || tr("hammasi omborda bor")}
                .
              </p>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{tr("Material")}</th>
                      <th className="n">{tr("Kerak")}</th>
                      <th className="n">{tr("Omborda")}</th>
                      <th className="n">{tr("Yetishmaydi")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {need.rows.map((r) => (
                      <tr key={r.m.id}>
                        <td>
                          {r.m.name} <span className="muted">({r.m.unit})</span>
                        </td>
                        <td className="n">{fmtN(r.q, 3)}</td>
                        <td className="n">{fmtN(r.bal, 3)}</td>
                        <td className={`n strong ${r.short > 0 ? "late" : "ok"}`}>{r.short > 0 ? fmtN(r.short, 3) : "yetadi"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <OpeningDialog
        open={openDlg}
        onClose={() => setOpenDlg(false)}
        data={data}
        notify={notify}
        onSaved={async () => {
          await reloadSettings();
        }}
      />
    </section>
  );
}
