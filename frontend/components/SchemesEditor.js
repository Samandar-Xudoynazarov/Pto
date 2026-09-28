"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { applyScheme, costCard, fmt } from "@/lib/calc";
import { RowsEditor } from "./ProductEditor";

const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const num = (s) => ({
  ...s,
  margin: +s.margin || 0,
  vat: +s.vat || 0,
  prodRows: s.prodRows.map((r) => ({ ...r, value: +r.value || 0 })),
  otherRows: s.otherRows.map((r) => ({ ...r, value: +r.value || 0 })),
});

/**
 * Umumiy xarajat andozalari: Производственная СС, Другие затраты, marja, QQS.
 * Bir marta o'zgartiriladi — andozaga bog'langan barcha mahsulotlar narxi qayta hisoblanadi.
 * Pastda — qaysi mahsulot qaysi andozada (guruh bo'yicha birdaniga o'tkazish ham mumkin).
 */
export default function SchemesEditor({ open, onClose, data, notify, onSaved }) {
  const ref = useRef(null);
  const { mats } = data;
  const raw = useMemo(() => [...(data.rawProds?.values() || [])], [data.rawProds]);
  const [list, setList] = useState([]);
  const [sel, setSel] = useState("");
  const [assign, setAssign] = useState({}); // productId → scheme ("" — alohida)
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState({ group: "", scheme: "" });
  const [q, setQ] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (open) {
      const l = clone(data.schemes || []);
      setList(l);
      setSel(l[0]?.id || "");
      setAssign(Object.fromEntries(raw.map((p) => [p.id, p.calc?.scheme || ""])));
      setBulk({ group: "", scheme: l[0]?.id || "" });
      if (el && !el.open) el.showModal();
    } else if (el?.open) el.close();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = list.find((x) => x.id === sel);
  const upd = (patch) => setList((l) => l.map((x) => (x.id === sel ? { ...x, ...patch } : x)));
  const numList = useMemo(() => list.map(num), [list]);
  const priceWith = (p, scheme, schemes) => costCard(applyScheme({ ...p, calc: { ...(p.calc || {}), scheme } }, schemes), mats).final;
  // namuna: shu andozadagi birinchi mahsulot
  const sample = raw.find((p) => assign[p.id] === sel && p.calc?.items?.length);
  const sampleCard = sample && cur ? costCard(applyScheme({ ...sample, calc: { ...sample.calc, scheme: sel } }, numList), mats) : null;
  // nechta mahsulot narxi o'zgaradi
  const changed = useMemo(() => {
    if (!open) return [];
    return raw
      .filter((p) => p.calc?.items?.length)
      .map((p) => ({ p, a: priceWith(p, p.calc?.scheme || "", data.schemes || []), b: priceWith(p, assign[p.id] || "", numList) }))
      .filter((x) => Math.round(x.a) !== Math.round(x.b));
  }, [open, raw, assign, numList, data.schemes]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = [...new Set(raw.map((p) => p.group).filter(Boolean))];
  const count = (id) => raw.filter((p) => assign[p.id] === id).length;

  function addScheme() {
    const base = cur || { prodRows: [], otherRows: [], margin: 20, vat: 12 };
    const id = `a-${Date.now().toString(36)}`;
    setList((l) => [...l, { ...clone(base), id, name: tr("Yangi andoza") }]);
    setSel(id);
  }
  function removeScheme() {
    if (count(sel)) return notify(tr("Bu andozada {n} ta mahsulot bor — avval ularni boshqa andozaga o'tkazing", { n: count(sel) }));
    setList((l) => l.filter((x) => x.id !== sel));
    setSel(list.find((x) => x.id !== sel)?.id || "");
  }
  async function save() {
    if (list.some((x) => !String(x.name).trim())) return notify("Andoza nomi kiritilmagan");
    setBusy(true);
    try {
      await api("/settings", { method: "PUT", body: { costSchemes: numList } });
      const moves = new Map();
      for (const p of raw) {
        const to = assign[p.id] || "";
        if (to !== (p.calc?.scheme || "")) moves.set(to, [...(moves.get(to) || []), p.id]);
      }
      for (const [scheme, productIds] of moves) await api("/products/scheme", { method: "POST", body: { scheme, productIds } });
      await onSaved();
      notify(tr("Saqlandi — {n} ta mahsulot narxi qayta hisoblandi", { n: changed.length }));
      onClose();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = raw.filter((p) => !q || `${p.code} ${p.name} ${p.group}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <dialog ref={ref} onClose={onClose} className="wide-dlg">
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <h2>{tr("Xarajat andozalari")}</h2>
          <p className="hint">
            {tr("Производственная СС, Другие затраты, marja va QQS shu yerda bir marta kiritiladi — andozaga bog'langan barcha mahsulotlar kalkulyatsiyasi avtomatik yangilanadi. Mahsulotning o'zida faqat materiallar va metall og'irligi qoladi.")}
          </p>
          <div className="chips">
            {list.map((x) => (
              <button key={x.id} type="button" className="chip" aria-pressed={sel === x.id} onClick={() => setSel(x.id)}>
                {x.name} · {count(x.id)}
              </button>
            ))}
            <button type="button" className="chip" onClick={addScheme}>
              {tr("+ Yangi andoza")}
            </button>
          </div>

          {cur && (
            <div className="scheme-edit">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="sc-name">{tr("Andoza nomi")}</label>
                  <input id="sc-name" value={cur.name} onChange={(e) => upd({ name: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="sc-margin">
                    Маржа <span className="u">(%)</span>
                  </label>
                  <input id="sc-margin" type="number" step="any" value={cur.margin} onChange={(e) => upd({ margin: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="sc-vat">
                    НДС <span className="u">(%)</span>
                  </label>
                  <input id="sc-vat" type="number" step="any" value={cur.vat} onChange={(e) => upd({ vat: e.target.value })} />
                </div>
              </div>
              <RowsEditor title="Производственная СС (ФОТ, ЕСП …)" idp="sp" rows={cur.prodRows} setRows={(r) => upd({ prodRows: r })} computed={sampleCard?.prodRows || []} />
              <RowsEditor title="Другие затраты" idp="so" rows={cur.otherRows} setRows={(r) => upd({ otherRows: r })} computed={sampleCard?.otherRows || []} />
              <p className="hint">
                {sampleCard
                  ? tr("«Summa» ustuni namuna uchun: {c} (1 dona). Narx QQS bilan: {p} so'm.", { c: sample.code, p: fmt(sampleCard.final) })
                  : tr("Bu andozaga hali mahsulot bog'lanmagan.")}
              </p>
              {list.length > 1 && (
                <button type="button" className="btn sm danger" onClick={removeScheme}>
                  {tr("Andozani o'chirish")}
                </button>
              )}
            </div>
          )}

          <h3>{tr("Mahsulotlar qaysi andozada")}</h3>
          <div className="inline-form scheme-bulk">
            <select value={bulk.group} onChange={(e) => setBulk({ ...bulk, group: e.target.value })} aria-label={tr("Guruh")}>
              <option value="">{tr("— guruh —")}</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <span>→</span>
            <select value={bulk.scheme} onChange={(e) => setBulk({ ...bulk, scheme: e.target.value })} aria-label={tr("Andoza")}>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
              <option value="">{tr("Alohida")}</option>
            </select>
            <button
              type="button"
              className="btn"
              disabled={!bulk.group}
              onClick={() => setAssign((a) => ({ ...a, ...Object.fromEntries(raw.filter((p) => p.group === bulk.group).map((p) => [p.id, bulk.scheme])) }))}
            >
              {tr("Guruhning hammasiga")}
            </button>
          </div>
          <input type="search" className="scheme-q" placeholder={tr("Qidirish")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Qidirish")} />
          <div className="tbl-wrap scheme-products">
            <table>
              <thead>
                <tr>
                  <th>{tr("Mahsulot")}</th>
                  <th>{tr("Guruh")}</th>
                  <th>{tr("Andoza")}</th>
                  <th className="n">{tr("Narx QQS bilan")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const before = p.calc?.items?.length ? priceWith(p, p.calc?.scheme || "", data.schemes || []) : null;
                  const after = p.calc?.items?.length ? priceWith(p, assign[p.id] || "", numList) : null;
                  const diff = before != null && Math.round(before) !== Math.round(after);
                  return (
                    <tr key={p.id} className={diff ? "row-warn" : ""}>
                      <td>
                        <span className="code">{p.code}</span>
                        {p.name && <span className="sub">{p.name}</span>}
                      </td>
                      <td>{p.group}</td>
                      <td>
                        <select value={assign[p.id] || ""} onChange={(e) => setAssign((a) => ({ ...a, [p.id]: e.target.value }))} aria-label={tr("Andoza")}>
                          {list.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                          <option value="">{tr("Alohida")}</option>
                        </select>
                      </td>
                      <td className="n">
                        {after == null ? "—" : fmt(after)}
                        {diff && <span className="sub">{tr("hozir {v}", { v: fmt(before) })}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="dlg-actions">
            <span className="muted scheme-impact">{changed.length ? tr("{n} ta mahsulot narxi o'zgaradi", { n: changed.length }) : tr("Narxlar o'zgarmaydi")}</span>
            <button type="button" className="btn" onClick={onClose}>
              {tr("Bekor qilish")}
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? tr("Saqlanmoqda…") : tr("Saqlash")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
