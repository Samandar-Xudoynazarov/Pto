"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtN, today } from "@/lib/calc";
import Icon from "./Icon";

/**
 * Xato kiritilgan markani tuzatish (пересортица): masalan kunlik hisobotga Л 8-8 o'rniga Л 8-11 yozilgan bo'lsa —
 * Л 8-11 dan 5 dona ayirib, Л 8-8 ga qo'shadi. Jami tayyor mahsulot o'zgarmaydi. Faqat ПТО, administrator, rahbar.
 * init: { fromId? } — ochilganda tanlangan «noto'g'ri» marka
 */
export default function ProductFixDialog({ init, products, stock, onClose, onSaved, notify }) {
  const t = useT();
  const ref = useRef(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const qty = (id) => stock?.products?.[id]?.end || 0;

  useEffect(() => {
    const d = ref.current;
    if (init) {
      const from = init.fromId || "";
      setF({ fromId: from, toId: "", qty: from && qty(from) > 0 ? String(qty(from)) : "", date: today(), note: "" });
      setErr("");
      if (d && !d.open) d.showModal();
    } else if (d?.open) d.close();
  }, [init]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return <dialog ref={ref} className="bsheet" onClose={onClose} />;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === "fromId" && { qty: qty(e.target.value) > 0 ? String(qty(e.target.value)) : "" }) }));
  const from = products.find((p) => p.id === f.fromId);
  const to = products.find((p) => p.id === f.toId);
  const n = Math.floor(+f.qty || 0);
  const haveFrom = from ? qty(from.id) : 0;
  const tooMuch = from && n > haveFrom;
  const label = (p) => `${p.code}${p.name ? ` — ${p.name}` : ""} (${fmtN(qty(p.id))})`;

  async function submit(e) {
    e.preventDefault();
    if (!from || !to) return setErr(t("Ikkala markani tanlang"));
    if (from.id === to.id) return setErr(t("To'g'ri mahsulotni tanlang (boshqa marka bo'lishi kerak)"));
    if (!(n >= 1)) return setErr(t("Soni kamida 1"));
    setBusy(true);
    setErr("");
    try {
      await api("/product-moves", { method: "POST", body: { type: "fix", productId: from.id, toProductId: to.id, qty: n, date: f.date, note: f.note } });
      notify(t("Tuzatildi: {a} → {b}, {n} dona", { a: from.code, b: to.code, n }));
      await onSaved?.();
      onClose();
    } catch (e2) {
      setErr(t(e2.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="bsheet" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="bsheet-grip" aria-hidden="true" />
        <div className="bsheet-head">
          <h2>{t("Markani tuzatish")}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Yopish")}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="hint">{t("Kunlik hisobotga mahsulot boshqa marka bilan yozib yuborilgan bo'lsa — noto'g'ri markadan ayirib, to'g'risiga o'tkazing. Jami tayyor mahsulot soni o'zgarmaydi, o'zgarish tarixda saqlanadi.")}</p>

        <div className="field">
          <label htmlFor="fx-from">{t("Noto'g'ri yozilgan marka (qayerdan)")}</label>
          <select id="fx-from" value={f.fromId} onChange={set("fromId")} required>
            <option value="">{t("— tanlang —")}</option>
            {products
              .filter((p) => qty(p.id) > 0 || p.id === f.fromId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
          </select>
        </div>
        <div className="fx-arrow" aria-hidden="true">↓</div>
        <div className="field">
          <label htmlFor="fx-to">{t("To'g'ri marka (qayerga)")}</label>
          <select id="fx-to" value={f.toId} onChange={set("toId")} required>
            <option value="">{t("— tanlang —")}</option>
            {products
              .filter((p) => p.id !== f.fromId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
          </select>
        </div>
        <div className="form-grid two">
          <div className="field">
            <label htmlFor="fx-q">
              {t("Soni")} <span className="u">({t("dona")})</span>
            </label>
            <input id="fx-q" type="number" inputMode="numeric" min="1" max={haveFrom || undefined} step="1" value={f.qty} onChange={set("qty")} required />
          </div>
          <div className="field">
            <label htmlFor="fx-d">{t("Sana")}</label>
            <input id="fx-d" type="date" max={today()} value={f.date} onChange={set("date")} required />
          </div>
          <div className="field" style={{ gridColumn: "1/-1" }}>
            <label htmlFor="fx-n">{t("Izoh")}</label>
            <input id="fx-n" value={f.note} onChange={set("note")} maxLength={300} placeholder={t("Masalan: 02.10 kunlik hisobotda adashib yozilgan")} />
          </div>
        </div>

        {from && to && n > 0 && (
          <div className={`fx-preview${tooMuch ? " bad" : ""}`}>
            <div>
              <span className="code">{from.code}</span>
              <span>
                {fmtN(haveFrom)} → <strong>{fmtN(haveFrom - n)}</strong>
              </span>
            </div>
            <div>
              <span className="code">{to.code}</span>
              <span>
                {fmtN(qty(to.id))} → <strong>{fmtN(qty(to.id) + n)}</strong>
              </span>
            </div>
          </div>
        )}
        {tooMuch && <p className="err">{t("Omborda yetarli emas. Qoldiq: {n} dona", { n: fmtN(haveFrom) })}</p>}
        {err && <p className="err">{err}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Bekor qilish")}
          </button>
          <button className="btn primary" disabled={busy || tooMuch}>
            {busy ? t("Saqlanmoqda…") : t("Tuzatish")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
