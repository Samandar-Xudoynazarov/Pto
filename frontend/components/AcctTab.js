"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useUser } from "@/lib/role";
import { concreteVolume, costCard, fmt, fmtN, lsGet, lsSet, productLabel, today } from "@/lib/calc";
import { OY, acctFileName, buildAcctDocx, deliverDocx, rowOther, totals } from "@/lib/acct-docx";
import Icon from "./Icon";

// imzo qo'yuvchilar — birinchi hisobot uchun (keyingi oylarda oldingi hisobotdagisi olinadi)
const DEFAULT_SIGNERS = { director: "Ф.Махмудов", chief: "Б.Махмудов", accountant: "З.Аралова" };
const r3 = (x) => Math.round((+x || 0) * 1000) / 1000;

/** Hisobot odatda keyingi oyning boshida tayyorlanadi: oyning 1–10 kunlarida — o'tgan oy */
function defaultMonth() {
  const d = today();
  const [y, m, day] = d.split("-").map(Number);
  if (day > 10) return d.slice(0, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Mahsulot → hujjatdagi qator: nomi, beton hajmi, 1 dona material xarajati va QQSsiz narxi (kalkulyatsiyadan) */
function rowFor(p, qty, mats) {
  const V = concreteVolume(p, mats);
  const card = costCard(p, mats);
  return {
    productId: p.id,
    name: `${p.name || ""} ${p.code || ""}`.trim(),
    unit: "м3",
    qty,
    m3: r3(V * qty),
    unitCost: Math.round(card.materials),
    unitPrice: Math.round(card.noVat),
  };
}

export default function AcctTab({ data, notify }) {
  const { products, prods, mats } = data;
  const { canAcct } = useUser();
  const [month, setMonth] = useState(() => lsGet("pto.acct.month", defaultMonth()));
  const [withBrak, setWithBrak] = useState(() => lsGet("pto.acct.brak", false));
  const [days, setDays] = useState(null);
  const [saved, setSaved] = useState(undefined); // undefined — yuklanmoqda, null — hali saqlanmagan
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [addId, setAddId] = useState("");

  // kunlik hisobotdan: mahsulot → oy davomida quyilgan dona
  const computed = useMemo(() => {
    if (!days) return null;
    const qty = new Map();
    for (const d of days)
      for (const l of d.production) {
        const q = (l.fact || 0) + (withBrak ? l.brak || 0 : 0);
        if (q) qty.set(l.productId, (qty.get(l.productId) || 0) + q);
      }
    return [...qty.entries()]
      .map(([id, q]) => ({ p: prods.get(id), q }))
      .filter((x) => x.p)
      .sort((a, b) => (a.p.sort || 0) - (b.p.sort || 0))
      .map(({ p, q }) => rowFor(p, q, mats));
  }, [days, withBrak, prods, mats]);

  const load = useCallback(async () => {
    setDays(null);
    setSaved(undefined);
    setForm(null);
    setDirty(false);
    try {
      const [d, a] = await Promise.all([api(`/days?month=${month}`), api(`/acct-reports/${month}`)]);
      setDays(d);
      setSaved(a.report);
      setForm(
        a.report
          ? {
              ...a.report,
              // eski hisobotlarda QQSsiz narx yo'q — kalkulyatsiyadan olinadi
              rows: a.report.rows.map((r) => {
                const p = !r.unitPrice && r.productId && prods.get(r.productId);
                return p ? { ...r, unitPrice: Math.round(costCard(p, mats).noVat) } : { ...r };
              }),
            }
          : { date: today(), otherCosts: 0, ...DEFAULT_SIGNERS, ...(a.lastSigners || {}), rows: null } // rows — kunlik hisobotdan (pastda)
      );
    } catch (e) {
      notify(e.message);
      setDays([]);
      setSaved(null);
      setForm({ date: today(), otherCosts: 0, ...DEFAULT_SIGNERS, rows: [] });
    }
  }, [month, notify]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  // saqlanmagan oy: jadval kunlik hisobotdan to'ldiriladi (brak belgisi o'zgarsa ham qayta)
  useEffect(() => {
    if (form && !saved && computed && (form.rows === null || !dirty)) setForm((f) => ({ ...f, rows: computed }));
  }, [computed, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = form?.rows || [];
  const T = totals(rows);

  // saqlangan hisobot kunlik hisobotdagi sonlardan farq qiladimi
  const drift = useMemo(() => {
    if (!saved || !computed) return false;
    const a = new Map(computed.map((r) => [r.productId, r.qty]));
    const b = new Map();
    for (const r of form?.rows || []) if (r.productId) b.set(r.productId, (b.get(r.productId) || 0) + (+r.qty || 0));
    if (a.size !== b.size) return true;
    for (const [k, v] of a) if (b.get(k) !== v) return true;
    return false;
  }, [saved, computed, form]);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setRow = (i, patch) => {
    setForm((f) => {
      const list = f.rows.map((r, j) => {
        if (j !== i) return r;
        const n = { ...r, ...patch };
        // son o'zgarsa, beton hajmi mahsulot normasidan qayta hisoblanadi
        if ("qty" in patch && r.productId && prods.get(r.productId)) n.m3 = r3(concreteVolume(prods.get(r.productId), mats) * (+patch.qty || 0));
        return n;
      });
      return { ...f, rows: list };
    });
    setDirty(true);
  };
  const delRow = (i) => set({ rows: rows.filter((_, j) => j !== i) });
  const moveRow = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const list = [...rows];
    [list[i], list[j]] = [list[j], list[i]];
    set({ rows: list });
  };
  const addRow = () => {
    const p = prods.get(addId);
    set({ rows: [...rows, p ? rowFor(p, 1, mats) : { productId: null, name: "", unit: "м3", qty: 0, m3: 0, unitCost: 0, unitPrice: 0 }] });
    setAddId("");
  };
  const refill = () => {
    if (!computed) return;
    if (dirty || saved) {
      if (!window.confirm(tr("Jadval kunlik hisobot va kalkulyatsiyadan qaytadan to'ldiriladi. Qo'lda kiritilgan o'zgarishlar yo'qoladi. Davom etasizmi?"))) return;
    }
    set({ rows: computed });
  };

  async function save(quiet) {
    const body = {
      date: form.date,
      otherCosts: totals(rows).other,
      director: form.director,
      chief: form.chief,
      accountant: form.accountant,
      rows: rows.map((r) => ({ productId: r.productId || null, name: r.name, unit: r.unit || "м3", qty: +r.qty || 0, m3: +r.m3 || 0, unitCost: +r.unitCost || 0, unitPrice: +r.unitPrice || 0 })),
    };
    const doc = await api(`/acct-reports/${month}`, { method: "PUT", body });
    setSaved(doc);
    setDirty(false);
    if (!quiet) notify("Saqlandi");
    return doc;
  }

  async function onSave() {
    setBusy("save");
    try {
      await save(false);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }

  async function onDocx(share) {
    if (!rows.length) return notify("Jadvalda qator yo'q");
    if (rows.some((r) => !String(r.name).trim())) return notify("Mahsulot nomi kiritilmagan qator bor");
    setBusy(share ? "share" : "docx");
    try {
      if (canAcct && (dirty || !saved)) await save(true); // yuklangan fayl bazadagi hisobot bilan bir xil bo'lsin
      const blob = await buildAcctDocx({ month, ...form, rows });
      const r = await deliverDocx(blob, acctFileName(month), { share });
      if (r === "downloaded-fallback") notify("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
    } catch (e) {
      notify(e.message || "Faylni tayyorlab bo'lmadi");
    } finally {
      setBusy("");
    }
  }

  const [y, m] = month.split("-").map(Number);
  const loading = !form || !form.rows;

  return (
    <section className="sheet acct">
      <div className="bar">
        <div className="l">
          <h2>{tr("Material hisoboti")}</h2>
          <input
            type="month"
            aria-label={tr("Oy")}
            value={month}
            onChange={(e) => {
              if (!e.target.value) return;
              if (dirty && !window.confirm(tr("Saqlanmagan o'zgarishlar bor. Ularni tashlab ketasizmi?"))) return;
              setMonth(e.target.value);
              lsSet("pto.acct.month", e.target.value);
            }}
          />
          {saved === null && !loading && <span className="pill st-topshirildi">{tr("hali saqlanmagan")}</span>}
          {saved && !dirty && <span className="pill st-tayyor">{tr("saqlangan")}</span>}
          {dirty && <span className="pill st-jarayonda">{tr("o'zgartirildi")}</span>}
        </div>
        <div className="r">
          <button className="btn primary" onClick={() => onDocx(false)} disabled={loading || !!busy || !rows.length}>
            <Icon name="download" /> {busy === "docx" ? tr("Tayyorlanmoqda…") : tr("Word (DOCX) yuklab olish")}
          </button>
          <button className="btn" onClick={() => onDocx(true)} disabled={loading || !!busy || !rows.length}>
            <Icon name="share" /> {tr("Ulashish")}
          </button>
          {canAcct && (
            <button className="btn" onClick={onSave} disabled={loading || !!busy || !dirty}>
              <Icon name="save" /> {busy === "save" ? tr("Saqlanmoqda…") : tr("Saqlash")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading">{tr("Yuklanmoqda…")}</div>
      ) : (
        <fieldset className="plain" disabled={!canAcct}>
          <p className="hint">
            {tr(
              "Jadval kunlik hisobotdagi faktdan (dona), beton hajmi mahsulot normasidan, 1 dona material xarajati va QQSsiz narxi esa kalkulyatsiyadan olinadi. Istalgan katakni tuzatib, «Word (DOCX) yuklab olish»ni bosing — fayl asl shakldagidek chiqadi."
            )}
          </p>

          {drift && (
            <div className="notice">
              {tr("Saqlangan hisobot kunlik hisobotdagi sonlardan farq qiladi (kunlik hisobot keyin o'zgartirilgan bo'lishi mumkin).")}{" "}
              {canAcct && (
                <button type="button" className="btn sm" onClick={refill}>
                  {tr("Qaytadan to'ldirish")}
                </button>
              )}
            </div>
          )}

          <div className="form-grid">
            <div className="field">
              <label htmlFor="ac-date">{tr("Hujjat sanasi")}</label>
              <input id="ac-date" type="date" value={form.date || ""} onChange={(e) => set({ date: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ac-dir">{tr("Direktor")}</label>
              <input id="ac-dir" value={form.director || ""} onChange={(e) => set({ director: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ac-chief">{tr("Sex boshlig'i")}</label>
              <input id="ac-chief" value={form.chief || ""} onChange={(e) => set({ chief: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ac-acc">{tr("Moddiy hisobchi")}</label>
              <input id="ac-acc" value={form.accountant || ""} onChange={(e) => set({ accountant: e.target.value })} />
            </div>
          </div>

          <div className="bar" style={{ marginTop: 14 }}>
            <h3 style={{ margin: 0 }}>
              «Энергокурилишмахсулот» МЧЖ да {OY[m - 1]} {y} ойида куйилган махсулотлар руйхати
            </h3>
            {canAcct && (
              <div className="r">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={withBrak}
                    onChange={(e) => {
                      setWithBrak(e.target.checked);
                      lsSet("pto.acct.brak", e.target.checked);
                    }}
                  />{" "}
                  {tr("Brakni ham qo'shish")}
                </label>
                <button type="button" className="btn sm" onClick={refill} disabled={!computed}>
                  {tr("Kunlik hisobotdan qayta to'ldirish")}
                </button>
              </div>
            )}
          </div>

          <div className="tbl-wrap">
            {!rows.length ? (
              <div className="empty">{tr("Bu oyda kunlik hisobotda ishlab chiqarish yo'q. Qatorlarni qo'lda qo'shishingiz mumkin.")}</div>
            ) : (
              <table className="edit">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>{tr("Mahsulot nomi")}</th>
                    <th className="n">{tr("Soni")}</th>
                    <th className="n">m³</th>
                    <th className="n">{tr("Material, 1 dona")}</th>
                    <th className="n">{tr("Material, jami")}</th>
                    <th className="n">{tr("Narx QQSsiz, 1 dona")}</th>
                    <th className="n">{tr("Ish haqi va boshq.")}</th>
                    {canAcct && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="muted">{i + 1}</td>
                      <td className="wide">
                        <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} aria-label={tr("Mahsulot nomi")} />
                      </td>
                      <td className="n q">
                        <input type="number" min="0" step="1" inputMode="numeric" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value === "" ? "" : +e.target.value })} aria-label={tr("Soni")} />
                      </td>
                      <td className="n">
                        <input type="number" min="0" step="any" inputMode="decimal" value={r.m3} onChange={(e) => setRow(i, { m3: e.target.value === "" ? "" : +e.target.value })} aria-label={tr("Beton, m³")} />
                      </td>
                      <td className="n c">
                        <input type="number" min="0" step="1" inputMode="numeric" value={r.unitCost} onChange={(e) => setRow(i, { unitCost: e.target.value === "" ? "" : +e.target.value })} aria-label={tr("1 dona material xarajati")} />
                      </td>
                      <td className="n strong">{fmt(Math.round(+r.unitCost || 0) * (+r.qty || 0))}</td>
                      <td className="n c">
                        <input type="number" min="0" step="1" inputMode="numeric" value={r.unitPrice ?? 0} onChange={(e) => setRow(i, { unitPrice: e.target.value === "" ? "" : +e.target.value })} aria-label={tr("1 dona narxi (QQSsiz)")} />
                      </td>
                      <td className={`n${rowOther(r) < 0 ? " late" : ""}`}>{+r.unitPrice ? fmt(rowOther(r)) : "—"}</td>
                      {canAcct && (
                        <td className="acts">
                          <button type="button" className="icon-btn" onClick={() => moveRow(i, -1)} disabled={i === 0} aria-label={tr("Yuqoriga")} title={tr("Yuqoriga")}>
                            ↑
                          </button>
                          <button type="button" className="icon-btn" onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} aria-label={tr("Pastga")} title={tr("Pastga")}>
                            ↓
                          </button>
                          <button type="button" className="icon-btn" onClick={() => delRow(i)} aria-label={tr("O'chirish")} title={tr("O'chirish")}>
                            <Icon name="close" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td />
                    <td>Жами</td>
                    <td className="n">{fmtN(T.qty)}</td>
                    <td className="n">{fmtN(T.m3, 3)}</td>
                    <td />
                    <td className="n">{fmt(T.sum)}</td>
                    <td />
                    <td className="n">{fmt(T.other)}</td>
                    {canAcct && <td />}
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {canAcct && (
            <div className="acct-add">
              <select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label={tr("Mahsulot")}>
                <option value="">{tr("— bo'sh qator —")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {productLabel(p)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn sm" onClick={addRow}>
                <Icon name="plus" /> {tr("Qator qo'shish")}
              </button>
            </div>
          )}

          <div className="acct-other">
            <div>
              <div className="k">Иш хаки, фойда ва бошка харажатлар жами</div>
              <div className="hint">{tr("Har bir mahsulot: (1 dona QQSsiz narx − 1 dona material xarajati) × soni. Hammasining yig'indisi.")}</div>
            </div>
            <div className="v">
              {fmt(T.other)} <small>{tr("so'm")}</small>
            </div>
          </div>
        </fieldset>
      )}
    </section>
  );
}
