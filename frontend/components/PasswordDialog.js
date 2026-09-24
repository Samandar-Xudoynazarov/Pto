"use client";
import { useEffect, useRef, useState } from "react";
import { api, setToken } from "@/lib/api";

/** O'z parolini almashtirish. forced = birinchi kirishda majburiy (yopib bo'lmaydi) */
export default function PasswordDialog({ open, forced, onClose, onDone }) {
  const ref = useRef(null);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) {
      setCur("");
      setNext("");
      setAgain("");
      setErr("");
      d.showModal();
    }
    if (!open && d?.open) d.close();
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    if (next !== again) return setErr("Yangi parollar bir xil emas");
    setBusy(true);
    setErr("");
    try {
      const r = await api("/me/password", { method: "PUT", body: { current: cur, next } });
      setToken(r.token);
      onDone(r.user);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => forced && e.preventDefault()}
      onClose={() => !forced && onClose()}
    >
      <form onSubmit={submit}>
        <h2>{forced ? "Yangi parol o'rnating" : "Parolni o'zgartirish"}</h2>
        {forced && <p className="hint">Siz vaqtinchalik parol bilan kirdingiz. Davom etish uchun o&apos;zingizning parolingizni o&apos;rnating.</p>}
        <div className="field">
          <label htmlFor="pw-cur">Joriy parol</label>
          <input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw-new">
            Yangi parol <span className="u">(kamida 6 belgi)</span>
          </label>
          <input id="pw-new" type="password" autoComplete="new-password" minLength={6} value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw-again">Yangi parol (yana bir marta)</label>
          <input id="pw-again" type="password" autoComplete="new-password" minLength={6} value={again} onChange={(e) => setAgain(e.target.value)} required />
        </div>
        {err && <p className="err">{err}</p>}
        <div className="dlg-actions">
          {!forced && (
            <button type="button" className="btn" onClick={onClose}>
              Bekor qilish
            </button>
          )}
          <button className="btn primary" disabled={busy}>
            {busy ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
