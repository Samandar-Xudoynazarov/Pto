"use client";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/lib/role";
import { api } from "@/lib/api";
import { GROUPS, fmt, fmtN, priceOf } from "@/lib/calc";
import DeleteButton from "./DeleteButton";

const groupLabel = Object.fromEntries(GROUPS);

function LinesEditor({ idp, lines, setLines, materials, mats, showPrice }) {
  return (
    <>
      <div className="tbl-wrap">
        <table className="edit">
          <tbody>
            {lines.map((l, i) => {
              const m = mats.get(l.materialId);
              return (
                <tr key={i}>
                  <td className="wide">
                    <select id={`${idp}-m-${i}`} value={l.materialId} aria-label="Material" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)))}>
                      <option value="">— material —</option>
                      {materials
                        .filter((x) => x.group !== "beton")
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({x.unit})
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="n">
                    <input id={`${idp}-q-${i}`} type="number" step="any" min="0" value={l.norm} aria-label="Norma" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, norm: e.target.value } : x)))} />
                  </td>
                  <td className="muted">{m?.unit}</td>
                  {showPrice && <td className="n">{m ? fmt((+l.norm || 0) * priceOf(m, mats)) : ""}</td>}
                  <td>
                    <button type="button" className="btn sm danger" aria-label="O'chirish" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => setLines([...lines, { materialId: "", norm: "" }])}>
        + Qator
      </button>
    </>
  );
}

function MaterialEditor({ material, open, onClose, data, notify, onSaved }) {
  const ref = useRef(null);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (open) {
      setD(
        material
          ? JSON.parse(JSON.stringify(material))
          : { name: "", unit: "кг", group: "metall", price: 0, stock: true, electrodeBase: false, recipe: [], writeoff: [] }
      );
      if (el && !el.open) el.showModal();
    } else if (el?.open) el.close();
  }, [open, material]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const clean = (arr) => (arr || []).filter((l) => l.materialId).map((l) => ({ materialId: l.materialId, norm: +l.norm || 0 }));
    const body = { name: d.name.trim(), unit: d.unit.trim(), group: d.group, price: +d.price || 0, stock: d.stock, electrodeBase: d.electrodeBase, recipe: clean(d.recipe), writeoff: clean(d.writeoff) };
    try {
      if (material?.id) await api(`/materials/${material.id}`, { method: "PUT", body });
      else await api("/materials", { method: "POST", body });
      notify("Saqlandi");
      await onSaved();
      onClose();
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isBeton = d?.group === "beton";
  const recipePrice = isBeton ? (d.recipe || []).reduce((s, l) => s + (+l.norm || 0) * priceOf(data.mats.get(l.materialId), data.mats), 0) : 0;

  return (
    <dialog ref={ref} onClose={onClose} className={isBeton ? "wide-dlg" : undefined}>
      {d && (
        <form onSubmit={save}>
          <h2>{material ? material.name : "Yangi material"}</h2>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: "1/-1" }}>
              <label htmlFor="me-name">Nomi</label>
              <input id="me-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="me-unit">Birlik</label>
              <input id="me-unit" list="me-units" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} required />
              <datalist id="me-units">
                {["кг", "т", "м3", "л", "шт", "п/м", "кВт·ч"].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="me-group">Guruh</label>
              <select id="me-group" value={d.group} onChange={(e) => setD({ ...d, group: e.target.value })}>
                {GROUPS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {!isBeton && (
              <div className="field">
                <label htmlFor="me-price">
                  Narx <span className="u">(so&apos;m / {d.unit || "birlik"})</span>
                </label>
                <input id="me-price" type="number" step="any" min="0" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} />
              </div>
            )}
          </div>
          <div className="checks">
            <label className="check">
              <input id="me-stock" type="checkbox" checked={d.stock} onChange={(e) => setD({ ...d, stock: e.target.checked })} /> Omborda hisobga olinadi
            </label>
            <label className="check">
              <input id="me-el" type="checkbox" checked={d.electrodeBase} onChange={(e) => setD({ ...d, electrodeBase: e.target.checked })} /> Elektrod normasi shu metalldan hisoblanadi
            </label>
          </div>
          {isBeton && (
            <div className="grid2">
              <div>
                <h4>1 m³ narxi uchun tarkib (kalkulyatsiya)</h4>
                <LinesEditor idp="rc" lines={d.recipe || []} setLines={(l) => setD({ ...d, recipe: l })} materials={data.materials} mats={data.mats} showPrice />
                <p className="hint" style={{ marginTop: 6 }}>
                  1 m³ narxi: <strong>{fmt(recipePrice, 1)} so&apos;m</strong>
                </p>
              </div>
              <div>
                <h4>1 m³ uchun ombordan yoziladi (Норма)</h4>
                <LinesEditor idp="wo" lines={d.writeoff || []} setLines={(l) => setD({ ...d, writeoff: l })} materials={data.materials} mats={data.mats} />
                <p className="hint" style={{ marginTop: 6 }}>
                  Kunlik hisobotdagi «Norma» ustuni va material ehtiyoji shu koeffitsiyentlar bilan hisoblanadi.
                </p>
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

export default function MaterialsTab({ data, notify, reload, reloadSettings }) {
  const { canEdit } = useUser();
  const { materials, mats, settings } = data;
  const [edit, setEdit] = useState(null); // null | "new" | material
  const [group, setGroup] = useState("all");
  const [pct, setPct] = useState(settings.electrodePct);
  const [company, setCompany] = useState(settings.company || "");
  const [signers, setSigners] = useState((settings.signers || []).join("\n"));
  useEffect(() => {
    setPct(settings.electrodePct);
    setCompany(settings.company || "");
    setSigners((settings.signers || []).join("\n"));
  }, [settings]);

  async function saveSettings(e) {
    e.preventDefault();
    try {
      await api("/settings", { method: "PUT", body: { electrodePct: +pct || 0, company, signers: signers.split("\n").map((s) => s.trim()).filter(Boolean) } });
      await reloadSettings();
      notify("Sozlamalar saqlandi");
    } catch (err) {
      notify(err.message);
    }
  }
  async function del(id) {
    try {
      await api(`/materials/${id}`, { method: "DELETE" });
      await reload();
      notify("O'chirildi");
    } catch (e) {
      notify(e.message);
    }
  }

  const list = materials.filter((m) => group === "all" || m.group === group);

  return (
    <section className="sheet">
      <div className="bar">
        <div className="l">
          <h2>Materiallar va narxlar</h2>
        </div>
        <div className="r">
          {canEdit && (
            <button className="btn primary" onClick={() => setEdit("new")}>
              + Material qo&apos;shish
            </button>
          )}
        </div>
      </div>
      <div className="chips">
        {[["all", "Hammasi"], ...GROUPS].map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={group === k} onClick={() => setGroup(k)}>
            {l} · {k === "all" ? materials.length : materials.filter((m) => m.group === k).length}
          </button>
        ))}
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Nomi</th>
              <th>Birlik</th>
              <th>Guruh</th>
              <th className="n">Narx, so&apos;m</th>
              <th>Ombor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.name}
                  {m.group === "beton" && (
                    <span className="sub">
                      Норма: {(m.writeoff || []).map((w) => `${mats.get(w.materialId)?.name.split(" ")[0]} ${fmtN(w.norm, 3)}`).join(", ")}
                    </span>
                  )}
                </td>
                <td>{m.unit}</td>
                <td>{groupLabel[m.group]}</td>
                <td className="n">
                  {fmt(priceOf(m, mats), m.group === "beton" ? 1 : 0)}
                  {m.group === "beton" && <span className="sub">retseptdan</span>}
                  {!priceOf(m, mats) && m.group !== "beton" && <span className="sub warn-text">narx yo&apos;q</span>}
                </td>
                <td>{m.stock ? "ha" : "—"}</td>
                <td>
                  {canEdit && (
                    <div className="acts">
                      <button className="btn sm" onClick={() => setEdit(m)}>
                        Tahrirlash
                      </button>
                      <DeleteButton onConfirm={() => del(m.id)} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={saveSettings}>
        <h3>Sozlamalar</h3>
        <fieldset className="plain" disabled={!canEdit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="set-pct">
              Elektrod normasi <span className="u">(% metall og&apos;irligidan)</span>
            </label>
            <input id="set-pct" type="number" step="any" min="0" value={pct} onChange={(e) => setPct(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="set-company">Korxona nomi (chop etishda)</label>
            <input id="set-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "1/-1" }}>
            <label htmlFor="set-signers">Imzo qo&apos;yuvchilar (har biri yangi qatorda)</label>
            <textarea id="set-signers" rows={2} value={signers} onChange={(e) => setSigners(e.target.value)} />
          </div>
        </div>
        </fieldset>
        {canEdit && (
          <button className="btn primary" style={{ marginTop: 10 }}>
            Sozlamalarni saqlash
          </button>
        )}
      </form>

      <MaterialEditor
        material={edit === "new" ? null : edit}
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        data={data}
        notify={notify}
        onSaved={reload}
      />
    </section>
  );
}
