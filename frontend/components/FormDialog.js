"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Umumiy forma oynasi.
 * fields: [{ name, label, type: text|number|date|select, options: [[value,label]], unit, req, wide, min, step, def }]
 */
export default function FormDialog({ form, onClose }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (form && d && !d.open) {
      setError("");
      d.showModal();
    }
    if (!form && d?.open) d.close();
  }, [form]);

  if (!form) return <dialog ref={ref} onClose={onClose} />;

  async function submit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const out = {};
    for (const f of form.fields) {
      const v = String(fd.get(f.name) ?? "").trim();
      out[f.name] = f.type === "number" ? (v === "" ? 0 : Number(v)) : v;
    }
    setBusy(true);
    setError("");
    try {
      await form.onSubmit(out);
      onClose();
    } catch (err) {
      setError(err.message || "Saqlanmadi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose}>
      <form onSubmit={submit} key={form.key}>
        <h2>{form.title}</h2>
        <div className="form-grid">
          {form.fields.map((f) => {
            const id = `f-${f.name}`;
            const v = form.values?.[f.name] ?? f.def ?? "";
            return (
              <div className="field" key={f.name} style={f.wide ? { gridColumn: "1/-1" } : undefined}>
                <label htmlFor={id}>
                  {f.label} {f.unit && <span className="u">({f.unit})</span>}
                </label>
                {f.type === "select" ? (
                  <select id={id} name={f.name} defaultValue={String(v ?? "")} required={f.req}>
                    {f.options.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    name={f.name}
                    type={f.type || "text"}
                    defaultValue={v}
                    required={f.req}
                    min={f.min}
                    step={f.step}
                  />
                )}
              </div>
            );
          })}
        </div>
        {error && <p className="err">{error}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saqlanmoqda…" : form.submitLabel || "Saqlash"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
