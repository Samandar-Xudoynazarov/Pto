"use client";
import { tr } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { costCard, fmt, lsGet, lsSet, today } from "@/lib/calc";
import { deliverDocx } from "@/lib/acct-docx";
import { OFFER_DEFAULTS, buildOfferDocx, offerFileName } from "@/lib/offer-docx";

const KEY = "pto.offer"; // oxirgi tanlov va matnlar (shu brauzerda)
const nameOf = (p) => [p.name, p.code].filter(Boolean).join(" ").trim();

/**
 * Katalog → tijorat taklifi (Word).
 * Mahsulotlar belgilanadi, har biri uchun 1 dona narxi QQSsiz (kalkulyatsiyadan) — kerak bo'lsa qo'lda o'zgartiriladi.
 */
export default function OfferDialog({ open, onClose, data, notify }) {
  const ref = useRef(null);
  const { products, mats } = data;
  const [f, setF] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const cards = useMemo(() => new Map(products.map((p) => [p.id, p.calc?.items?.length ? Math.round(costCard(p, mats).noVat) : 0])), [products, mats]);

  useEffect(() => {
    const el = ref.current;
    if (open) {
      const saved = lsGet(KEY, {}) || {};
      const sel = Array.isArray(saved.sel) ? saved.sel.filter((id) => products.some((p) => p.id === id)) : [];
      setF({
        date: today(),
        number: "",
        to: saved.to ?? OFFER_DEFAULTS.to,
        text: saved.text ?? OFFER_DEFAULTS.text,
        priceHead: saved.priceHead ?? OFFER_DEFAULTS.priceHead,
        note: saved.note ?? OFFER_DEFAULTS.note,
        director: saved.director ?? OFFER_DEFAULTS.director,
        sel: new Set(sel),
        names: {}, // qo'lda o'zgartirilgan nomlar
        prices: {}, // qo'lda o'zgartirilgan narxlar
      });
      setQ("");
      if (el && !el.open) el.showModal();
    } else if (el?.open) el.close();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return <dialog ref={ref} onClose={onClose} className="wide-dlg" />;

  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const toggle = (id) => setF((x) => {
    const sel = new Set(x.sel);
    sel.has(id) ? sel.delete(id) : sel.add(id);
    return { ...x, sel };
  });
  const s = q.trim().toLowerCase();
  const shown = products.filter((p) => !s || `${p.code} ${p.name} ${p.group}`.toLowerCase().includes(s));
  const groups = [...new Set(shown.map((p) => p.group || ""))];
  const setMany = (ids, on) => setF((x) => {
    const sel = new Set(x.sel);
    for (const id of ids) on ? sel.add(id) : sel.delete(id);
    return { ...x, sel };
  });
  // hujjatda katalog tartibida
  const chosen = products.filter((p) => f.sel.has(p.id));
  const priceOf = (p) => (f.prices[p.id] !== undefined && f.prices[p.id] !== "" ? +f.prices[p.id] : cards.get(p.id) || 0);
  const noPrice = chosen.filter((p) => !priceOf(p));

  async function make(share) {
    if (!chosen.length) return notify("Kamida bitta mahsulot tanlang");
    if (noPrice.length) return notify(tr("Narxi yo'q mahsulotlar: {list} — kalkulyatsiyani kiriting yoki narxni qo'lda yozing", { list: noPrice.map((p) => p.code).join(", ") }));
    setBusy(true);
    try {
      lsSet(KEY, { sel: [...f.sel], to: f.to, text: f.text, priceHead: f.priceHead, note: f.note, director: f.director });
      const blob = await buildOfferDocx({
        date: f.date, number: f.number, to: f.to, text: f.text, priceHead: f.priceHead, note: f.note, director: f.director,
        rows: chosen.map((p) => ({ name: (f.names[p.id] ?? nameOf(p)).trim() || p.code, unit: "Шт", qty: 1, price: priceOf(p) })),
      });
      const r = await deliverDocx(blob, offerFileName(f.date), { share });
      if (r === "downloaded-fallback") notify("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
      else if (r !== "cancelled") notify("Word fayl tayyor");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} className="wide-dlg offer-dlg">
      <form onSubmit={(e) => { e.preventDefault(); make(false); }}>
        <h2>{tr("Tijorat taklifi (katalog)")}</h2>
        <p className="hint">{tr("Mahsulotlarni belgilang — Word faylda 1 dona narxi QQSsiz (kalkulyatsiyadan) chiqadi. Narx yoki nomni shu yerda o'zgartirish mumkin, katalogga ta'sir qilmaydi.")}</p>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="of-d">{tr("Sana")}</label>
            <input id="of-d" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="of-n">{tr("Chiquvchi №")}</label>
            <input id="of-n" value={f.number} onChange={(e) => set({ number: e.target.value })} maxLength={30} />
          </div>
          <div className="field">
            <label htmlFor="of-to">{tr("Kimga")}</label>
            <input id="of-to" value={f.to} onChange={(e) => set({ to: e.target.value })} maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="of-dir">{tr("Direktor")}</label>
            <input id="of-dir" value={f.director} onChange={(e) => set({ director: e.target.value })} maxLength={80} />
          </div>
          <div className="field" style={{ gridColumn: "1/-1" }}>
            <label htmlFor="of-t">{tr("Matn")}</label>
            <textarea id="of-t" rows={2} value={f.text} onChange={(e) => set({ text: e.target.value })} maxLength={1000} />
          </div>
          <div className="field">
            <label htmlFor="of-ph">{tr("Narx ustuni sarlavhasi")}</label>
            <input id="of-ph" value={f.priceHead} onChange={(e) => set({ priceHead: e.target.value })} maxLength={60} />
          </div>
          <div className="field span2">
            <label htmlFor="of-note">{tr("Izoh")}</label>
            <input id="of-note" value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} />
          </div>
        </div>

        <div className="bar">
          <div className="l">
            <strong>{tr("Tanlangan: {n} ta", { n: chosen.length })}</strong>
            <input id="of-q" type="search" placeholder={tr("Qidirish: Ф5, лоток…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Qidirish")} />
          </div>
          <div className="r">
            <button type="button" className="btn sm" onClick={() => setMany(shown.map((p) => p.id), true)}>{tr("Hammasini belgilash")}</button>
            <button type="button" className="btn sm" onClick={() => setMany(shown.map((p) => p.id), false)}>{tr("Tozalash")}</button>
          </div>
        </div>

        <div className="tbl-wrap offer-list">
          <table className="edit no-rt">
            <thead>
              <tr>
                <th></th>
                <th>{tr("Hujjatdagi nomi")}</th>
                <th className="n">{tr("Narx QQSsiz, so'm")}</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const list = shown.filter((p) => (p.group || "") === g);
              const all = list.every((p) => f.sel.has(p.id));
              return (
                <tbody key={g || "-"}>
                  <tr className="sum">
                    <td>
                      <input type="checkbox" aria-label={tr("Guruhni belgilash")} checked={all} onChange={() => setMany(list.map((p) => p.id), !all)} />
                    </td>
                    <td colSpan={2}>{g || tr("Guruhsiz")}</td>
                  </tr>
                  {list.map((p) => {
                    const on = f.sel.has(p.id);
                    const calc = cards.get(p.id) || 0;
                    return (
                      <tr key={p.id} className={on ? "selected" : ""}>
                        <td>
                          <input id={`of-c-${p.id}`} type="checkbox" checked={on} onChange={() => toggle(p.id)} aria-label={p.code} />
                        </td>
                        <td className="wide">
                          {on ? (
                            <input value={f.names[p.id] ?? nameOf(p)} onChange={(e) => set({ names: { ...f.names, [p.id]: e.target.value } })} aria-label={tr("Hujjatdagi nomi")} />
                          ) : (
                            <label htmlFor={`of-c-${p.id}`} className="offer-name">
                              <span className="code">{p.code}</span> <span className="muted">{p.name}</span>
                            </label>
                          )}
                        </td>
                        <td className="n">
                          {on ? (
                            <input type="number" min="0" step="1" value={f.prices[p.id] ?? ""} placeholder={calc ? fmt(calc) : tr("narx yo'q")} onChange={(e) => set({ prices: { ...f.prices, [p.id]: e.target.value } })} aria-label={tr("Narx")} />
                          ) : calc ? (
                            fmt(calc)
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
        {noPrice.length > 0 && <p className="hint warn-text">{tr("Narxi yo'q: {list} — kalkulyatsiya kiritilmagan, narxni qo'lda yozing.", { list: noPrice.map((p) => p.code).join(", ") })}</p>}

        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>{tr("Yopish")}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => make(true)}>{tr("Ulashish")}</button>
          <button className="btn primary" disabled={busy || !chosen.length}>
            {busy ? tr("Tayyorlanmoqda…") : tr("Word (DOCX) yuklab olish")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
