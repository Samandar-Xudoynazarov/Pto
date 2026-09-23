"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ROW_TYPES, calcMetalKg, costCard, expandNorms, fmt, fmtN, priceOf } from "@/lib/calc";

const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const blankCalc = (tpl) => ({ items: [], metalKg: 0, prodRows: [], otherRows: [], margin: 20, vat: 12, ...(clone(tpl) || {}), ...(tpl ? { items: [] } : {}) });

function MatSelect({ id, value, onChange, materials, filter }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Material">
      <option value="">— material —</option>
      {materials.filter(filter || (() => true)).map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({m.unit})
        </option>
      ))}
    </select>
  );
}

function RowsEditor({ title, rows, setRows, computed, idp }) {
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div>
      <h4>{title}</h4>
      <div className="tbl-wrap">
        <table className="edit">
          <thead>
            <tr>
              <th>Nomi</th>
              <th>Hisoblash turi</th>
              <th className="n">Qiymat</th>
              <th className="n">Summa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="wide">
                  <input id={`${idp}-n-${i}`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Nomi" />
                </td>
                <td>
                  <select id={`${idp}-t-${i}`} value={r.type} onChange={(e) => set(i, { type: e.target.value })} aria-label="Turi">
                    {ROW_TYPES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="n">
                  <input id={`${idp}-v-${i}`} type="number" step="any" value={r.value} onChange={(e) => set(i, { value: e.target.value })} aria-label="Qiymat" />
                </td>
                <td className="n">{fmt(computed[i]?.amount)}</td>
                <td>
                  <button type="button" className="btn sm danger" aria-label="O'chirish" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => setRows([...rows, { name: "", type: "m3", value: 0 }])}>
        + Qator
      </button>
    </div>
  );
}

export default function ProductEditor({ product, open, onClose, data, notify, onSaved }) {
  const ref = useRef(null);
  const { materials, mats, settings, products } = data;
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("norm");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (open) {
      const p = product ? clone(product) : { code: "", name: "", group: "", norms: [], calc: blankCalc(settings.calcTemplate) };
      if (!p.calc) p.calc = blankCalc(settings.calcTemplate);
      setD(p);
      setTab("norm");
      if (el && !el.open) el.showModal();
    } else if (el?.open) el.close();
  }, [open, product, settings.calcTemplate]);

  const norms = d?.norms || [];
  const calc = d?.calc || blankCalc();
  const setNorms = (n) => setD((x) => ({ ...x, norms: n }));
  const setCalc = (patch) => setD((x) => ({ ...x, calc: { ...x.calc, ...patch } }));

  // «jonli» hisob: raqam matnlarini songa aylantirib
  const numeric = useMemo(() => {
    if (!d) return null;
    const n = (v) => +v || 0;
    return {
      ...d,
      norms: norms.filter((l) => l.materialId).map((l) => ({ materialId: l.materialId, norm: n(l.norm) })),
      calc: {
        ...calc,
        items: calc.items.filter((l) => l.materialId).map((l) => ({ materialId: l.materialId, norm: n(l.norm) })),
        metalKg: n(calc.metalKg),
        margin: n(calc.margin),
        vat: n(calc.vat),
        prodRows: calc.prodRows.map((r) => ({ ...r, value: n(r.value) })),
        otherRows: calc.otherRows.map((r) => ({ ...r, value: n(r.value) })),
      },
    };
  }, [d, norms, calc]);
  const expanded = useMemo(() => (numeric ? expandNorms(numeric, mats, settings) : new Map()), [numeric, mats, settings]);
  const card = useMemo(() => (numeric ? costCard(numeric, mats) : null), [numeric, mats]);
  const groups = [...new Set(products.map((p) => p.group).filter(Boolean))];

  async function save(e) {
    e.preventDefault();
    if (!numeric.code.trim()) return notify("Marka kiritilmagan");
    setBusy(true);
    try {
      const body = { code: numeric.code.trim(), name: numeric.name, group: numeric.group, norms: numeric.norms, calc: numeric.calc };
      if (product?.id) await api(`/products/${product.id}`, { method: "PUT", body });
      else await api("/products", { method: "POST", body });
      notify("Saqlandi");
      await onSaved();
      onClose();
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }

  const derivedRows = [...expanded.entries()].filter(([, r]) => r.derived);

  return (
    <dialog ref={ref} onClose={onClose} className="wide-dlg">
      {d && (
        <form onSubmit={save}>
          <h2>{product ? `${product.code} — tahrirlash` : "Yangi mahsulot"}</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pe-code">Marka</label>
              <input id="pe-code" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="pe-name">Nomi</label>
              <input id="pe-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pe-group">Guruh</label>
              <input id="pe-group" list="pe-groups" value={d.group} onChange={(e) => setD({ ...d, group: e.target.value })} />
              <datalist id="pe-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="chips">
            <button type="button" className="chip" aria-pressed={tab === "norm"} onClick={() => setTab("norm")}>
              Sarf normasi (Норма)
            </button>
            <button type="button" className="chip" aria-pressed={tab === "calc"} onClick={() => setTab("calc")}>
              Kalkulyatsiya · {card ? fmt(card.final) : 0} so&apos;m
            </button>
          </div>

          {tab === "norm" && (
            <div className="grid2">
              <div>
                <h4>1 dona uchun sarf</h4>
                <div className="tbl-wrap">
                  <table className="edit">
                    <tbody>
                      {norms.map((l, i) => (
                        <tr key={i}>
                          <td className="wide">
                            <MatSelect id={`pn-m-${i}`} value={l.materialId} materials={materials} filter={(m) => m.group !== "xizmat"} onChange={(v) => setNorms(norms.map((x, j) => (j === i ? { ...x, materialId: v } : x)))} />
                          </td>
                          <td className="n">
                            <input id={`pn-q-${i}`} type="number" step="any" min="0" value={l.norm} onChange={(e) => setNorms(norms.map((x, j) => (j === i ? { ...x, norm: e.target.value } : x)))} aria-label="Norma" />
                          </td>
                          <td className="muted">{mats.get(l.materialId)?.unit}</td>
                          <td>
                            <button type="button" className="btn sm danger" aria-label="O'chirish" onClick={() => setNorms(norms.filter((_, j) => j !== i))}>
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => setNorms([...norms, { materialId: "", norm: "" }])}>
                  + Material
                </button>
              </div>
              <div>
                <h4>Avtomatik qo&apos;shiladi</h4>
                <div className="tbl-wrap">
                  {!derivedRows.length ? (
                    <div className="empty">Beton yoki metall qo&apos;shilganda bu yerda qum, sement, sheben va elektrod chiqadi.</div>
                  ) : (
                    <table>
                      <tbody>
                        {derivedRows.map(([id, r]) => (
                          <tr key={id}>
                            <td>{mats.get(id)?.name}</td>
                            <td className="n">{fmtN(r.qty, 4)}</td>
                            <td className="muted">{mats.get(id)?.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  Qum, sement, sheben — beton markasi koeffitsiyentlaridan («Materiallar» bo&apos;limi). Elektrod — metall og&apos;irligining {fmtN(settings.electrodePct, 2)} %.
                </p>
              </div>
            </div>
          )}

          {tab === "calc" && card && (
            <div className="calc-edit">
              <div className="bar">
                <h4 style={{ margin: 0 }}>Materiallar</h4>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    const rows = [...expanded.entries()]
                      .filter(([id]) => {
                        const g = mats.get(id)?.group;
                        return !(g === "xomashyo" && !norms.some((l) => l.materialId === id));
                      })
                      .map(([materialId, r]) => ({ materialId, norm: Math.round(r.qty * 10000) / 10000 }));
                    setCalc({ items: rows });
                  }}
                >
                  Sarf normasidan nusxa olish
                </button>
              </div>
              <div className="tbl-wrap">
                <table className="edit">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="n">Norma</th>
                      <th className="n">Narx</th>
                      <th className="n">Summa</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.items.map((l, i) => {
                      const m = mats.get(l.materialId);
                      const price = priceOf(m, mats);
                      return (
                        <tr key={i}>
                          <td className="wide">
                            <MatSelect id={`pc-m-${i}`} value={l.materialId} materials={materials} onChange={(v) => setCalc({ items: calc.items.map((x, j) => (j === i ? { ...x, materialId: v } : x)) })} />
                          </td>
                          <td className="n">
                            <input id={`pc-q-${i}`} type="number" step="any" min="0" value={l.norm} onChange={(e) => setCalc({ items: calc.items.map((x, j) => (j === i ? { ...x, norm: e.target.value } : x)) })} aria-label="Norma" />
                          </td>
                          <td className="n muted">{m ? fmt(price) : ""}</td>
                          <td className="n">{fmt(price * (+l.norm || 0))}</td>
                          <td>
                            <button type="button" className="btn sm danger" aria-label="O'chirish" onClick={() => setCalc({ items: calc.items.filter((_, j) => j !== i) })}>
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Итого СС. материалов</td>
                      <td className="n">{fmt(card.materials)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => setCalc({ items: [...calc.items, { materialId: "", norm: "" }] })}>
                + Material
              </button>

              <div className="form-grid" style={{ marginTop: 14 }}>
                <div className="field">
                  <label htmlFor="pe-kg">
                    Metall og&apos;irligi <span className="u">(kg, «Логистика метала» uchun)</span>
                  </label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input id="pe-kg" type="number" step="any" min="0" value={calc.metalKg} onChange={(e) => setCalc({ metalKg: e.target.value })} />
                    <button type="button" className="btn sm" onClick={() => setCalc({ metalKg: Math.round(calcMetalKg(numeric, mats) * 1000) / 1000 })}>
                      Hisoblash
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="pe-margin">
                    Маржа <span className="u">(%)</span>
                  </label>
                  <input id="pe-margin" type="number" step="any" value={calc.margin} onChange={(e) => setCalc({ margin: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="pe-vat">
                    НДС <span className="u">(%)</span>
                  </label>
                  <input id="pe-vat" type="number" step="any" value={calc.vat} onChange={(e) => setCalc({ vat: e.target.value })} />
                </div>
              </div>

              <RowsEditor title="Производственная СС (ФОТ, ЕСП …)" idp="pr" rows={calc.prodRows} setRows={(r) => setCalc({ prodRows: r })} computed={card.prodRows} />
              <RowsEditor title="Другие затраты" idp="or" rows={calc.otherRows} setRows={(r) => setCalc({ otherRows: r })} computed={card.otherRows} />

              <div className="totals">
                <span>Tannarx: {fmt(card.itogo)}</span>
                <span>Narx QQSsiz: {fmt(card.noVat)}</span>
                <strong>Narx QQS bilan: {fmt(card.final)} so&apos;m</strong>
              </div>
            </div>
          )}

          <div className="dlg-actions">
            <button type="button" className="btn" onClick={onClose}>
              Bekor qilish
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Saqlanmoqda…" : "Saqlash"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
