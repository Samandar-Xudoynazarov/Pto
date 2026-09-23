"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import Icon from "./Icon";
import { addDaySheet, deliver, newWorkbook, pickRows } from "@/lib/excel";
import { consumption, fmtDate, fmtN, lsGet, lsSet, productOptions, round, shiftDate, today } from "@/lib/calc";

const num = (v) => (v === "" || v === null || v === undefined ? 0 : +v || 0);
const emptyProd = () => ({ productId: "", plan: "", fact: "", note: "" });
const emptyShip = () => ({ productId: "", qty: "", customer: "", vehicle: "", orderId: "" });

export default function DayTab({ data, notify, onSaved }) {
  const { materials, products, mats, prods, settings, orders } = data;
  const [date, setDate] = useState(() => lsGet("pto.day", today()));
  const [loading, setLoading] = useState(true);
  const [prod, setProd] = useState([]);
  const [matIn, setMatIn] = useState({}); // materialId → { sarf, kirim } (matn ko'rinishida)
  const [ships, setShips] = useState([]);
  const [note, setNote] = useState("");
  const [stock, setStock] = useState(null);
  const [exists, setExists] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([api(`/days/${date}`), api(`/stock?from=${date}&to=${date}`)]);
      setProd(d.production.length ? d.production.map((l) => ({ ...l, plan: l.plan || "", fact: l.fact || "" })) : [emptyProd()]);
      setMatIn(Object.fromEntries(d.materials.map((l) => [l.materialId, { sarf: l.sarf || "", kirim: l.kirim || "" }])));
      setShips(d.shipments.map((l) => ({ ...l, orderId: l.orderId || "" })));
      setNote(d.note || "");
      setExists(!d.isNew);
      setStock(s);
      setDirty(false);
    } catch (e) {
      notify(e.message);
    } finally {
      setLoading(false);
    }
  }, [date, notify]);
  useEffect(() => {
    load();
  }, [load]);

  function go(next) {
    if (!next) return;
    if (dirty && !window.confirm("Saqlanmagan o'zgarishlar bor. Ularni tashlab, boshqa kunga o'tasizmi?")) return;
    setDate(next);
    lsSet("pto.day", next);
  }
  const touch = (fn) => (...a) => {
    fn(...a);
    setDirty(true);
  };

  const setProdRow = touch((i, patch) => setProd((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r))));
  const setShipRow = touch((i, patch) => setShips((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r))));
  const setMat = touch((id, k, v) => setMatIn((m) => ({ ...m, [id]: { ...m[id], [k]: v } })));

  // norma bo'yicha sarf: fakt va reja
  const normFact = useMemo(
    () => consumption(prod.map((r) => ({ productId: r.productId, qty: num(r.fact) })), prods, mats, settings),
    [prod, prods, mats, settings]
  );
  const normPlan = useMemo(
    () => consumption(prod.map((r) => ({ productId: r.productId, qty: num(r.plan) })), prods, mats, settings),
    [prod, prods, mats, settings]
  );

  const fillFromNorm = touch(() => {
    const next = { ...matIn };
    for (const m of materials) {
      if (!m.stock) continue;
      const q = normFact.get(m.id);
      next[m.id] = { ...next[m.id], sarf: q ? String(round(q, 4)) : "" };
    }
    setMatIn(next);
    notify("Sarf normadan to'ldirildi — tekshirib, saqlang");
  });

  async function save() {
    setSaving(true);
    try {
      const body = {
        note,
        production: prod.filter((r) => r.productId).map((r) => ({ productId: r.productId, plan: num(r.plan), fact: num(r.fact), note: r.note || "" })),
        materials: Object.entries(matIn).map(([materialId, v]) => ({ materialId, sarf: num(v?.sarf), kirim: num(v?.kirim) })),
        shipments: ships
          .filter((r) => r.productId && num(r.qty) > 0)
          .map((r) => ({ productId: r.productId, qty: num(r.qty), customer: r.customer || "", vehicle: r.vehicle || "", orderId: r.orderId || null })),
      };
      await api(`/days/${date}`, { method: "PUT", body });
      notify(`${fmtDate(date)} saqlandi`);
      setDirty(false);
      setExists(true);
      onSaved();
    } catch (e) {
      notify(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ekrandagi (hali saqlanmagan bo'lsa ham) holat bo'yicha Excel
  async function exportExcel(share) {
    if (stock?.beforeOpening) return notify("Bu sana boshlang'ich qoldiqdan oldin — qoldiqlar noma'lum, fayl tayyorlanmaydi");
    setExporting(true);
    try {
      const day = {
        date,
        production: prod.filter((r) => r.productId).map((r) => ({ productId: r.productId, plan: num(r.plan), fact: num(r.fact) })),
        materials: Object.entries(matIn).map(([materialId, v]) => ({ materialId, sarf: num(v?.sarf), kirim: num(v?.kirim) })),
        shipments: ships.filter((r) => r.productId && num(r.qty) > 0).map((r) => ({ ...r, qty: num(r.qty) })),
      };
      const matStart = new Map(Object.entries(stock?.materials || {}).map(([id, v]) => [id, v.start]));
      const prodStart = new Map(Object.entries(stock?.products || {}).map(([id, v]) => [id, v.start]));
      const sarf = new Map(day.materials.map((l) => [l.materialId, l.sarf + l.kirim]));
      const moved = new Map([...day.production.map((l) => [l.productId, l.fact]), ...day.shipments.map((l) => [l.productId, l.qty])]);
      const { matList, prodList } = pickRows(materials, products, [matStart, sarf], [prodStart, moved]);
      const wb = await newWorkbook();
      addDaySheet(wb, { date, company: settings.company, signers: settings.signers, matList, prodList, prods, day, matStart, prodStart });
      const r = await deliver(wb, `Ostatki_${date.split("-").reverse().join(".")}.xlsx`, { share });
      if (r === "downloaded-fallback") notify("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
      if (dirty) notify("Diqqat: fayl saqlanmagan o'zgarishlar bilan tayyorlandi");
    } catch (e) {
      notify(e.message || "Excel faylni tayyorlab bo'lmadi");
    } finally {
      setExporting(false);
    }
  }

  async function removeDay() {
    if (!window.confirm(`${fmtDate(date)} kunidagi barcha yozuvlar o'chirilsinmi?`)) return;
    try {
      await api(`/days/${date}`, { method: "DELETE" });
      notify("O'chirildi");
      await load();
      onSaved();
    } catch (e) {
      notify(e.message);
    }
  }

  const stockMats = materials.filter((m) => m.stock);
  const matRows = stockMats
    .map((m) => {
      const start = stock?.materials?.[m.id]?.start || 0;
      const v = matIn[m.id] || {};
      const sarf = num(v.sarf);
      const kirim = num(v.kirim);
      return { m, start, plan: normPlan.get(m.id) || 0, norm: normFact.get(m.id) || 0, v, end: start - sarf + kirim, active: start || sarf || kirim || normFact.get(m.id) || normPlan.get(m.id) };
    })
    .filter((r) => showAll || r.active);

  const factBy = new Map();
  for (const r of prod) if (r.productId) factBy.set(r.productId, (factBy.get(r.productId) || 0) + num(r.fact));
  const shipBy = new Map();
  for (const r of ships) if (r.productId) shipBy.set(r.productId, (shipBy.get(r.productId) || 0) + num(r.qty));
  const prodStock = products
    .map((p) => {
      const start = stock?.products?.[p.id]?.start || 0;
      const fact = factBy.get(p.id) || 0;
      const shipped = shipBy.get(p.id) || 0;
      return { p, start, fact, shipped, end: start + fact - shipped };
    })
    .filter((r) => r.start || r.fact || r.shipped);

  const planSum = prod.reduce((s, r) => s + num(r.plan), 0);
  const factSum = prod.reduce((s, r) => s + num(r.fact), 0);
  const popts = productOptions(products);
  const activeOrders = orders.filter((o) => o.status !== "topshirildi");

  return (
    <section className="sheet day">
      <div className="print-only print-head">
        <div>{settings.company}</div>
        <strong>Ежедневная информация о выпуске ЖБИ и об остатках основных материалов на {fmtDate(date)}</strong>
      </div>

      <div className="bar no-print">
        <div className="l">
          <h2>Kunlik hisobot</h2>
          <div className="daynav">
            <button className="btn sm" onClick={() => go(shiftDate(date, -1))} aria-label="Oldingi kun">
              <Icon name="chevL" />
            </button>
            <input id="day-date" type="date" value={date} onChange={(e) => go(e.target.value)} aria-label="Sana" />
            <button className="btn sm" onClick={() => go(shiftDate(date, 1))} aria-label="Keyingi kun">
              <Icon name="chevR" />
            </button>
            <button className="btn sm" onClick={() => go(today())}>
              Bugun
            </button>
          </div>
          {dirty && <span className="pill st-jarayonda">Saqlanmagan</span>}
          {!dirty && exists && <span className="pill st-tayyor">Saqlangan</span>}
        </div>
        <div className="r">
          <button className="btn" onClick={() => exportExcel(false)} disabled={exporting || loading}>
            <Icon name="download" /> Excel yuklab olish
          </button>
          <button className="btn" onClick={() => exportExcel(true)} disabled={exporting || loading}>
            <Icon name="share" /> Ulashish
          </button>
          <button className="btn" onClick={() => window.print()}>
            <Icon name="print" /> Chop etish
          </button>
          {exists && (
            <button className="btn danger" onClick={removeDay}>
              Kunni o&apos;chirish
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={saving || loading}>
            <Icon name="save" /> {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </div>
      {stock?.beforeOpening && (
        <div className="notice">Bu sana boshlang&apos;ich qoldiq sanasidan ({fmtDate(stock.openingDate)}) oldin — qoldiqlar hisoblanmaydi.</div>
      )}

      {loading ? (
        <div className="loading">Yuklanmoqda…</div>
      ) : (
        <>
          {/* ---- reja / fakt ---- */}
          <div>
            <h3>Mahsulotlar: reja / fakt</h3>
            <div className="tbl-wrap">
              <table className="edit">
                <thead>
                  <tr>
                    <th>Mahsulot</th>
                    <th className="n">Reja, dona</th>
                    <th className="n">Fakt, dona</th>
                    <th className="n">Bajarilishi</th>
                    <th>Izoh</th>
                    <th className="no-print"></th>
                  </tr>
                </thead>
                <tbody>
                  {prod.map((r, i) => {
                    const pct = num(r.plan) ? (num(r.fact) / num(r.plan)) * 100 : null;
                    return (
                      <tr key={i}>
                        <td className="wide">
                          <select id={`dp-p-${i}`} value={r.productId} onChange={(e) => setProdRow(i, { productId: e.target.value })} aria-label="Mahsulot">
                            <option value="">— mahsulot tanlang —</option>
                            {popts.map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="n">
                          <input id={`dp-plan-${i}`} type="number" min="0" step="1" value={r.plan} onChange={(e) => setProdRow(i, { plan: e.target.value })} aria-label="Reja" />
                        </td>
                        <td className="n">
                          <input id={`dp-fact-${i}`} type="number" min="0" step="1" value={r.fact} onChange={(e) => setProdRow(i, { fact: e.target.value })} aria-label="Fakt" />
                        </td>
                        <td className={`n ${pct === null ? "" : pct >= 100 ? "ok" : "warn"}`}>{pct === null ? "—" : `${fmtN(pct, 0)} %`}</td>
                        <td>
                          <input id={`dp-note-${i}`} value={r.note || ""} onChange={(e) => setProdRow(i, { note: e.target.value })} aria-label="Izoh" />
                        </td>
                        <td className="no-print">
                          <button className="btn sm danger" aria-label="Qatorni o'chirish" onClick={touch(() => setProd((rows) => rows.filter((_, j) => j !== i)))}>
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Jami</td>
                    <td className="n">{fmtN(planSum)}</td>
                    <td className="n">{fmtN(factSum)}</td>
                    <td className="n">{planSum ? `${fmtN((factSum / planSum) * 100, 0)} %` : "—"}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <button className="btn sm no-print" style={{ marginTop: 8 }} onClick={touch(() => setProd((rows) => [...rows, emptyProd()]))}>
              + Mahsulot qo&apos;shish
            </button>
          </div>

          {/* ---- materiallar ---- */}
          <div>
            <div className="bar">
              <h3 style={{ margin: 0 }}>Xomashyo va materiallar</h3>
              <div className="r no-print">
                <label className="check">
                  <input id="day-showall" type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Barcha materiallar
                </label>
                <button className="btn sm" onClick={fillFromNorm}>
                  Sarfni normadan to&apos;ldirish
                </button>
              </div>
            </div>
            <div className="tbl-wrap" style={{ marginTop: 8 }}>
              <table className="edit">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Birlik</th>
                    <th className="n">Kun boshida</th>
                    <th className="n no-print">Kerak (reja)</th>
                    <th className="n no-print">Norma (fakt)</th>
                    <th className="n">Sarf</th>
                    <th className="n">Kirim</th>
                    <th className="n">Qoldiq</th>
                  </tr>
                </thead>
                <tbody>
                  {!matRows.length && (
                    <tr>
                      <td colSpan={8} className="empty">
                        Harakat yo&apos;q. «Barcha materiallar»ni yoqing.
                      </td>
                    </tr>
                  )}
                  {matRows.map(({ m, start, plan, norm, v, end }) => {
                    const sarf = num(v.sarf);
                    const diff = norm ? ((sarf - norm) / norm) * 100 : 0;
                    return (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{m.unit}</td>
                        <td className="n">{fmtN(start, 3)}</td>
                        <td className="n no-print muted">{plan ? fmtN(plan, 3) : ""}</td>
                        <td className="n no-print muted">{norm ? fmtN(norm, 3) : ""}</td>
                        <td className={`n ${sarf && norm && Math.abs(diff) > 10 ? "warn" : ""}`} title={norm ? `Normadan farq: ${fmtN(diff, 1)} %` : undefined}>
                          <input id={`dm-s-${m.id}`} type="number" min="0" step="any" value={v.sarf ?? ""} onChange={(e) => setMat(m.id, "sarf", e.target.value)} aria-label={`${m.name} sarf`} />
                        </td>
                        <td className="n">
                          <input id={`dm-k-${m.id}`} type="number" min="0" step="any" value={v.kirim ?? ""} onChange={(e) => setMat(m.id, "kirim", e.target.value)} aria-label={`${m.name} kirim`} />
                        </td>
                        <td className={`n strong ${end < -1e-9 ? "late" : ""}`}>{fmtN(end, 3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint no-print" style={{ marginTop: 6 }}>
              Metall kg da. «Norma (fakt)» — fakt × Норма (beton → qum/sement/sheben, elektrod = metallning {fmtN(settings.electrodePct, 2)} %). Sarf normadan 10 % dan ko&apos;p farq qilsa sariq bilan belgilanadi.
            </p>
          </div>

          {/* ---- tayyor mahsulot ---- */}
          <div className="grid2">
            <div>
              <h3>Tayyor mahsulot qoldig&apos;i</h3>
              <div className="tbl-wrap">
                {!prodStock.length ? (
                  <div className="empty">Qoldiq yo&apos;q.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Mahsulot</th>
                        <th className="n">Boshida</th>
                        <th className="n">Ishlandi</th>
                        <th className="n">Jo&apos;natildi</th>
                        <th className="n">Qoldiq</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodStock.map((r) => (
                        <tr key={r.p.id}>
                          <td>
                            <span className="code">{r.p.code}</span>
                          </td>
                          <td className="n">{fmtN(r.start)}</td>
                          <td className="n">{r.fact || ""}</td>
                          <td className="n">{r.shipped || ""}</td>
                          <td className={`n strong ${r.end < 0 ? "late" : ""}`}>{fmtN(r.end)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ---- jo'natish ---- */}
            <div>
              <h3>Jo&apos;natish (отгрузка)</h3>
              <div className="tbl-wrap">
                <table className="edit">
                  <thead>
                    <tr>
                      <th>Qayerga</th>
                      <th>Mahsulot</th>
                      <th className="n">Soni</th>
                      <th>Mashina</th>
                      <th className="no-print">Buyurtma</th>
                      <th className="no-print"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!ships.length && (
                      <tr>
                        <td colSpan={6} className="empty">
                          Jo&apos;natish yo&apos;q.
                        </td>
                      </tr>
                    )}
                    {ships.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <input id={`ds-c-${i}`} value={r.customer} onChange={(e) => setShipRow(i, { customer: e.target.value })} aria-label="Qayerga" placeholder="Samarqand" />
                        </td>
                        <td>
                          <select id={`ds-p-${i}`} value={r.productId} onChange={(e) => setShipRow(i, { productId: e.target.value })} aria-label="Mahsulot">
                            <option value="">—</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="n">
                          <input id={`ds-q-${i}`} type="number" min="1" step="1" value={r.qty} onChange={(e) => setShipRow(i, { qty: e.target.value })} aria-label="Soni" />
                        </td>
                        <td>
                          <input id={`ds-v-${i}`} value={r.vehicle} onChange={(e) => setShipRow(i, { vehicle: e.target.value })} aria-label="Mashina raqami" placeholder="75 X 023 RA" />
                        </td>
                        <td className="no-print">
                          <select id={`ds-o-${i}`} value={r.orderId || ""} onChange={(e) => setShipRow(i, { orderId: e.target.value })} aria-label="Buyurtma">
                            <option value="">—</option>
                            {activeOrders
                              .filter((o) => !r.productId || o.productId === r.productId || o.id === r.orderId)
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  №{o.no} {o.customer}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="no-print">
                          <button className="btn sm danger" aria-label="Qatorni o'chirish" onClick={touch(() => setShips((rows) => rows.filter((_, j) => j !== i)))}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn sm no-print" style={{ marginTop: 8 }} onClick={touch(() => setShips((rows) => [...rows, emptyShip()]))}>
                + Jo&apos;natish qo&apos;shish
              </button>
            </div>
          </div>

          <div className="field no-print">
            <label htmlFor="day-note">Izoh</label>
            <textarea id="day-note" rows={2} value={note} onChange={touch((e) => setNote(e.target.value))} />
          </div>

          <div className="print-only signers">
            {(settings.signers || []).map((s) => (
              <div key={s}>{s} ____________</div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
