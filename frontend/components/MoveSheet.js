"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtN, today, GROUPS } from "@/lib/calc";
import Icon from "./Icon";

/**
 * Ombor kirimi / chiqimi — telefonda pastdan chiqadigan oyna.
 * init: { type: "in"|"out", materialId? }
 */
export default function MoveSheet({ init, onClose, onSaved, data, notify }) {
  const t = useT();
  const ref = useRef(null);
  const { materials, targets = [] } = data;
  const [type, setType] = useState("in");
  const [materialId, setMaterialId] = useState("");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const [f, setF] = useState({});
  const [bal, setBal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const qtyRef = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (init) {
      setType(init.type || "in");
      setMaterialId(init.materialId || "");
      setPicking(!init.materialId);
      setQ("");
      setF({ date: today(), qty: "", price: "", supplier: "", docNumber: "", departmentId: "", vehicleId: "", person: "", note: "" });
      setErr("");
      if (d && !d.open) d.showModal();
    } else if (d?.open) d.close();
  }, [init]);

  const mat = materials.find((m) => m.id === materialId);
  useEffect(() => {
    setBal(null);
    if (!materialId || !init) return;
    let off = false;
    const d = today();
    api(`/stock?from=${d}&to=${d}`)
      .then((s) => !off && setBal(s.materials?.[materialId]?.end || 0))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [materialId, init]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return materials
      .filter((m) => m.stock && !m.archived)
      .filter((m) => !s || m.name.toLowerCase().includes(s) || (m.code || "").toLowerCase().includes(s));
  }, [materials, q]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const depts = targets.filter((x) => x.kind === "department" && !x.archived);
  const cars = targets.filter((x) => x.kind === "vehicle" && !x.archived);
  const qty = +f.qty || 0;
  const after = bal === null ? null : type === "in" ? bal + qty : bal - qty;

  async function submit(e) {
    e.preventDefault();
    if (!mat) return setErr(t("Materialni tanlang"));
    if (!(qty > 0)) return setErr(t("Miqdorni to'g'ri kiriting"));
    if (type === "out" && !f.departmentId && !f.vehicleId && !f.person.trim())
      return setErr(t("Qayerga ketganini kiriting: bo'lim, texnika yoki mas'ul shaxs"));
    setBusy(true);
    setErr("");
    try {
      const body = { type, materialId, qty, date: f.date, person: f.person, note: f.note };
      if (type === "in") Object.assign(body, { price: +f.price || 0, supplier: f.supplier, docNumber: f.docNumber });
      else Object.assign(body, { departmentId: f.departmentId || null, vehicleId: f.vehicleId || null });
      await api("/movements", { method: "POST", body });
      notify(t(type === "in" ? "Kirim saqlandi" : "Chiqim saqlandi"));
      onSaved?.();
      onClose();
    } catch (e2) {
      setErr(t(e2.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="bsheet" onClose={onClose}>
      {init && (
        <form onSubmit={submit}>
          <div className="bsheet-grip" aria-hidden="true" />
          <div className="bsheet-head">
            <h2>{t(type === "in" ? "Kirim" : "Chiqim")}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Yopish")}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={type === "in"} className="seg-in" onClick={() => setType("in")}>
              <Icon name="in" /> {t("Kirim")}
            </button>
            <button type="button" role="tab" aria-selected={type === "out"} className="seg-out" onClick={() => setType("out")}>
              <Icon name="out" /> {t("Chiqim")}
            </button>
          </div>

          {/* material */}
          {picking || !mat ? (
            <div className="field">
              <label htmlFor="mv-q">{t("Material")}</label>
              <input id="mv-q" type="search" autoFocus placeholder={t("Qidirish…")} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="pick-list">
                {!list.length && <div className="empty">{t("Hech narsa topilmadi")}</div>}
                {list.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className="pick-item"
                    onClick={() => {
                      setMaterialId(m.id);
                      setPicking(false);
                      setTimeout(() => qtyRef.current?.focus(), 50);
                    }}
                  >
                    <span>{m.name}</span>
                    <span className="muted">
                      {t(GROUPS.find(([k]) => k === m.group)?.[1] || "")} · {m.unit}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button type="button" className="picked" onClick={() => setPicking(true)}>
              <span>
                <strong>{mat.name}</strong>
                <span className="muted">
                  {t("Qoldiq")}: {bal === null ? "…" : `${fmtN(bal, 3)} ${mat.unit}`}
                </span>
              </span>
              <span className="linkbtn">{t("O'zgartirish")}</span>
            </button>
          )}

          <div className="form-grid two">
            <div className="field">
              <label htmlFor="mv-qty">
                {t("Miqdor")} {mat && <span className="u">({mat.unit})</span>}
              </label>
              <input id="mv-qty" ref={qtyRef} className="big" type="number" inputMode="decimal" min="0" step="any" value={f.qty} onChange={set("qty")} required />
            </div>
            <div className="field">
              <label htmlFor="mv-date">{t("Sana")}</label>
              <input id="mv-date" type="date" value={f.date} max={today()} onChange={set("date")} required />
            </div>
          </div>
          {after !== null && qty > 0 && (
            <p className={`hint ${after < 0 ? "warn-text" : ""}`}>
              {t("Keyin qoladi")}: <strong>{fmtN(after, 3)} {mat?.unit}</strong>
              {after < 0 && ` — ${t("omborda yetarli emas")}`}
            </p>
          )}

          {type === "in" ? (
            <div className="form-grid two">
              <div className="field">
                <label htmlFor="mv-price">
                  {t("Birlik narxi")} <span className="u">({t("so'm")})</span>
                </label>
                <input id="mv-price" type="number" inputMode="decimal" min="0" step="any" value={f.price} onChange={set("price")} />
              </div>
              <div className="field">
                <label htmlFor="mv-doc">{t("Nakladnoy raqami")}</label>
                <input id="mv-doc" value={f.docNumber} onChange={set("docNumber")} />
              </div>
              <div className="field">
                <label htmlFor="mv-sup">{t("Yetkazib beruvchi")}</label>
                <input id="mv-sup" value={f.supplier} onChange={set("supplier")} />
              </div>
              <div className="field">
                <label htmlFor="mv-person">{t("Kim qabul qildi")}</label>
                <input id="mv-person" value={f.person} onChange={set("person")} />
              </div>
            </div>
          ) : (
            <div className="form-grid two">
              <div className="field">
                <label htmlFor="mv-dep">{t("Bo'lim / sex")}</label>
                <select id="mv-dep" value={f.departmentId} onChange={set("departmentId")}>
                  <option value="">—</option>
                  {depts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="mv-car">{t("Texnika")}</label>
                <select id="mv-car" value={f.vehicleId} onChange={set("vehicleId")}>
                  <option value="">—</option>
                  {cars.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.code ? ` · ${x.code}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ gridColumn: "1/-1" }}>
                <label htmlFor="mv-person">{t("Kim oldi (mas'ul shaxs)")}</label>
                <input id="mv-person" value={f.person} onChange={set("person")} />
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="mv-note">{t("Izoh")}</label>
            <input id="mv-note" value={f.note} onChange={set("note")} />
          </div>
          {err && <p className="err">{err}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t("Bekor qilish")}
            </button>
            <button className={`btn primary ${type === "out" ? "out" : ""}`} disabled={busy}>
              {busy ? t("Saqlanmoqda…") : t(type === "in" ? "Kirimni saqlash" : "Chiqimni saqlash")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
