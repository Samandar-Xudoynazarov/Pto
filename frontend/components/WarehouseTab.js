"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import { GROUPS, fmt, fmtDate, fmtN, priceOf, today } from "@/lib/calc";
import Icon from "./Icon";
import ExportButtons from "./ExportButtons";
import { meterFactor } from "@/lib/metal";
import { fileDate } from "@/lib/xlsx-export";

/** Ombor: materiallar qoldig'i — telefonda kartochkalar, qidiruv, «kam qoldi» */
export default function WarehouseTab({ data, notify, version, openMove, reloadMaterials }) {
  const t = useT();
  const { canStore, canEdit } = useUser();
  const { materials, mats } = data;
  const [stock, setStock] = useState(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [onlyLow, setOnlyLow] = useState(false);
  const [open, setOpen] = useState(null); // material kartasi
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const d = today();
    try {
      setStock(await api(`/stock?from=${d}&to=${d}`));
    } catch (e) {
      notify(t(e.message));
    }
  }, [notify, t]);
  useEffect(() => {
    load();
  }, [load, version]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return materials
      .filter((m) => m.stock && !m.archived)
      .map((m) => {
        const qty = stock?.materials?.[m.id]?.end || 0;
        const low = qty <= 1e-9 ? "out" : m.minQty > 0 && qty < m.minQty ? "low" : "";
        return { m, qty, low, value: Math.max(0, qty) * priceOf(m, mats) };
      })
      .filter((r) => group === "all" || r.m.group === group)
      .filter((r) => !onlyLow || r.low)
      .filter((r) => !s || r.m.name.toLowerCase().includes(s) || (r.m.code || "").toLowerCase().includes(s));
  }, [materials, mats, stock, q, group, onlyLow]);

  const all = materials.filter((m) => m.stock && !m.archived);
  const lowCount = all.filter((m) => {
    const qty = stock?.materials?.[m.id]?.end || 0;
    return qty <= 1e-9 || (m.minQty > 0 && qty < m.minQty);
  }).length;
  const total = all.reduce((s, m) => s + Math.max(0, stock?.materials?.[m.id]?.end || 0) * priceOf(m, mats), 0);
  const usedGroups = GROUPS.filter(([k]) => all.some((m) => m.group === k));

  return (
    <section className="sheet">
      <div className="kpis kpis-3">
        <div className="kpi">
          <div className="k">{t("Ombor qiymati")}</div>
          <div className="v">
            {fmt(total / 1e6, 1)}
            <small>{t("mln so'm")}</small>
          </div>
        </div>
        <div className="kpi">
          <div className="k">{t("Materiallar")}</div>
          <div className="v">{all.length}</div>
        </div>
        <button className={`kpi kpi-btn ${lowCount ? "kpi-warn" : ""}`} onClick={() => setOnlyLow((v) => !v)} aria-pressed={onlyLow}>
          <div className="k">{t("Kam qoldi / tugagan")}</div>
          <div className="v">{lowCount}</div>
        </button>
      </div>

      <div className="bar">
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder={t("Material qidirish…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Qidirish")} />
        </div>
        <div className="r">
          <ExportButtons
            company={data.settings?.company}
            notify={notify}
            disabled={!stock}
            build={() => ({
              filename: `Ombor_qoldigi_${fileDate()}.xlsx`,
              sheets: [
                {
                  name: t("Ombor qoldig'i"),
                  title: t("Ombor qoldig'i — {d} holatiga", { d: fmtDate(today()) }),
                  subtitle: [group !== "all" && t(GROUPS.find(([k]) => k === group)?.[1] || ""), onlyLow && t("Kam qoldi"), q && `«${q}»`].filter(Boolean).join(", "),
                  columns: [
                    { header: "№", key: "i", type: "int", width: 6 },
                    { header: t("Material"), key: "name", width: 36 },
                    { header: t("Guruh"), key: "group", width: 20 },
                    { header: t("Kod / artikul"), key: "code", width: 14 },
                    { header: t("Birlik"), key: "unit", width: 8 },
                    { header: t("Qoldiq"), key: "qty", type: "num" },
                    { header: t("Minimal qoldiq"), key: "min", type: "num" },
                    { header: t("Holat"), key: "state", width: 14 },
                    { header: t("Narx, so'm"), key: "price", type: "money" },
                    { header: t("Qiymat, so'm"), key: "value", type: "money", total: "sum", width: 18 },
                  ],
                  rows: rows.map((r, i) => ({
                    i: i + 1,
                    name: r.m.name,
                    group: t(GROUPS.find(([k]) => k === r.m.group)?.[1] || ""),
                    code: r.m.code,
                    unit: r.m.unit,
                    qty: Math.round(r.qty * 1000) / 1000,
                    min: r.m.minQty || null,
                    state: r.low ? t(r.low === "out" ? "Tugagan" : "Kam qoldi") : "",
                    price: priceOf(r.m, mats) || null,
                    value: Math.round(r.value),
                    _cell: r.low ? { state: r.low === "out" ? "bad" : "warn", qty: r.low === "out" ? "bad" : "warn" } : undefined,
                  })),
                },
              ],
            })}
          />
          {canStore && (
            <button className="btn" onClick={() => setAdding(true)}>
              <Icon name="plus" /> {t("Yangi material")}
            </button>
          )}
        </div>
      </div>
      <div className="chips scroll-x">
        <button className="chip" aria-pressed={group === "all"} onClick={() => setGroup("all")}>
          {t("Barchasi")}
        </button>
        {usedGroups.map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={group === k} onClick={() => setGroup(k)}>
            {t(l)}
          </button>
        ))}
        <button className="chip chip-warn" aria-pressed={onlyLow} onClick={() => setOnlyLow((v) => !v)}>
          {t("Kam qoldi")}
        </button>
      </div>

      {!stock ? (
        <div className="loading">{t("Yuklanmoqda…")}</div>
      ) : !rows.length ? (
        <div className="empty">{q ? t("Hech narsa topilmadi") : t("Material yo'q")}</div>
      ) : (
        <ul className="cards">
          {rows.map((r) => (
            <li key={r.m.id}>
              <button className="card-row" onClick={() => setOpen(r.m)}>
                <span className={`dot g-${r.m.group}`} aria-hidden="true" />
                <span className="card-main">
                  <strong>{r.m.name}</strong>
                  <span className="muted">
                    {t(GROUPS.find(([k]) => k === r.m.group)?.[1] || "")}
                    {r.m.code ? ` · ${r.m.code}` : ""}
                    {r.m.minQty ? ` · ${t("min")} ${fmtN(r.m.minQty, 3)}` : ""}
                  </span>
                </span>
                <span className="card-num">
                  <strong className={r.qty < -1e-9 ? "late" : ""}>{fmtN(r.qty, 3)}</strong>
                  <span className="muted">
                    {r.m.unit}
                    {(() => {
                      const f = meterFactor(r.m);
                      return f && r.qty > 0 ? ` ≈ ${fmtN(r.qty / f.perM, 0)} ${t("m")}` : "";
                    })()}
                  </span>
                  {r.low && <span className={`pill ${r.low === "out" ? "st-bad" : "st-jarayonda"}`}>{t(r.low === "out" ? "Tugagan" : "Kam qoldi")}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <MaterialCard
        material={open}
        qty={open ? stock?.materials?.[open.id]?.end || 0 : 0}
        data={data}
        onClose={() => setOpen(null)}
        openMove={(type) => {
          const id = open.id;
          setOpen(null);
          openMove({ type, materialId: id });
        }}
        canStore={canStore}
        version={version}
      />
      <NewMaterial
        open={adding}
        onClose={() => setAdding(false)}
        notify={notify}
        onSaved={async () => {
          await reloadMaterials();
        }}
        canEdit={canEdit}
      />
    </section>
  );
}

/** Material kartasi: qoldiq va oxirgi harakatlar */
function MaterialCard({ material, qty, data, onClose, openMove, canStore, version }) {
  const t = useT();
  const ref = useRef(null);
  const [moves, setMoves] = useState(null);
  const { targets = [] } = data;
  const tname = (id) => targets.find((x) => x.id === id)?.name;
  useEffect(() => {
    const d = ref.current;
    if (material) {
      if (d && !d.open) d.showModal();
      setMoves(null);
      api(`/movements?materialId=${material.id}&limit=30`)
        .then((r) => setMoves(r.items))
        .catch(() => setMoves([]));
    } else if (d?.open) d.close();
  }, [material, version]);
  return (
    <dialog ref={ref} className="bsheet" onClose={onClose}>
      {material && (
        <div className="bsheet-body">
          <div className="bsheet-grip" aria-hidden="true" />
          <div className="bsheet-head">
            <h2>{material.name}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Yopish")}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="big-qty">
            <span>{fmtN(qty, 3)}</span> {material.unit}
            {material.minQty > 0 && <small className="muted"> · {t("min")} {fmtN(material.minQty, 3)}</small>}
          </div>
          {canStore && (
            <div className="two-btn">
              <button className="btn primary in" onClick={() => openMove("in")}>
                <Icon name="in" /> {t("Kirim")}
              </button>
              <button className="btn primary out" onClick={() => openMove("out")}>
                <Icon name="out" /> {t("Chiqim")}
              </button>
            </div>
          )}
          <h3>{t("Oxirgi harakatlar")}</h3>
          {!moves ? (
            <div className="loading">{t("Yuklanmoqda…")}</div>
          ) : !moves.length ? (
            <div className="empty">{t("Bu material bo'yicha hali kirim-chiqim yo'q")}</div>
          ) : (
            <ul className="moves">
              {moves.map((m) => (
                <li key={m.id} className={`mv mv-${m.type}`}>
                  <span className="mv-ico">
                    <Icon name={m.type} />
                  </span>
                  <span className="card-main">
                    <strong>{m.type === "in" ? m.supplier || t("Kirim") : [tname(m.departmentId), tname(m.vehicleId), m.person].filter(Boolean).join(" · ")}</strong>
                    <span className="muted">
                      {fmtDate(m.date)}
                      {m.createdBy?.name ? ` · ${m.createdBy.name}` : ""}
                    </span>
                  </span>
                  <strong className="mv-qty">
                    {m.type === "in" ? "+" : "−"}
                    {fmtN(m.qty, 3)}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Yangi material (omborchi ham qo'sha oladi — narx va retseptsiz) */
function NewMaterial({ open, onClose, notify, onSaved, canEdit }) {
  const t = useT();
  const ref = useRef(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (open) {
      setF({ name: "", unit: "шт", group: "boshqa", code: "", minQty: "", price: "" });
      setErr("");
      if (d && !d.open) d.showModal();
    } else if (d?.open) d.close();
  }, [open]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const body = { name: f.name.trim(), unit: f.unit.trim(), group: f.group, code: f.code.trim(), minQty: +f.minQty || 0, stock: true };
      if (canEdit) body.price = +f.price || 0;
      await api("/materials", { method: "POST", body });
      notify(t("Material qo'shildi"));
      await onSaved();
      onClose();
    } catch (e2) {
      setErr(t(e2.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="bsheet" onClose={onClose}>
      {open && (
        <form onSubmit={submit}>
          <div className="bsheet-grip" aria-hidden="true" />
          <h2>{t("Yangi material")}</h2>
          <div className="field">
            <label htmlFor="nm-name">{t("Nomi")}</label>
            <input id="nm-name" value={f.name} onChange={set("name")} required autoFocus />
          </div>
          <div className="form-grid two">
            <div className="field">
              <label htmlFor="nm-unit">{t("Birlik")}</label>
              <input id="nm-unit" list="nm-units" value={f.unit} onChange={set("unit")} required />
              <datalist id="nm-units">
                {["шт", "кг", "т", "л", "м", "м²", "м³", "п/м", "комп"].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="nm-group">{t("Guruh")}</label>
              <select id="nm-group" value={f.group} onChange={set("group")}>
                {GROUPS.filter(([k]) => k !== "beton" && k !== "xizmat").map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nm-min">{t("Minimal qoldiq")}</label>
              <input id="nm-min" type="number" inputMode="decimal" min="0" step="any" value={f.minQty} onChange={set("minQty")} />
            </div>
            <div className="field">
              <label htmlFor="nm-code">{t("Kod / artikul")}</label>
              <input id="nm-code" value={f.code} onChange={set("code")} />
            </div>
            {canEdit && (
              <div className="field">
                <label htmlFor="nm-price">
                  {t("Narxi")} <span className="u">({t("so'm")})</span>
                </label>
                <input id="nm-price" type="number" inputMode="decimal" min="0" step="any" value={f.price} onChange={set("price")} />
              </div>
            )}
          </div>
          {err && <p className="err">{err}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t("Bekor qilish")}
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? t("Saqlanmoqda…") : t("Saqlash")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
