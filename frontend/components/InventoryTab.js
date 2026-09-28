"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import { GROUPS, fmt, fmtDate, fmtN, today } from "@/lib/calc";
import DeleteButton from "./DeleteButton";
import ExportButtons from "./ExportButtons";
import Icon from "./Icon";
import { fileDate } from "@/lib/xlsx-export";

const counted = (l) => l.actual !== null && l.actual !== undefined;
const groupName = (g) => tr(GROUPS.find(([k]) => k === g)?.[1] || "Hammasi");

/** Inventarizatsiya: omborni sanab chiqish, farqni ko'rish, tasdiqlab qoldiqni to'g'rilash */
export default function InventoryTab({ data, notify, onChanged, onDirtyChange }) {
  const t = useT();
  const { canEdit, canStore } = useUser();
  const [list, setList] = useState(null);
  const [doc, setDoc] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api("/inventories"));
    } catch (e) {
      notify(e.message);
    }
  }, [notify]);
  useEffect(() => {
    load();
  }, [load]);

  async function openDoc(id) {
    try {
      setDoc(await api(`/inventories/${id}`));
    } catch (e) {
      notify(e.message);
    }
  }

  if (doc)
    return (
      <InventoryDoc
        key={doc.id}
        doc={doc}
        data={data}
        notify={notify}
        onDirtyChange={onDirtyChange}
        onBack={() => {
          setDoc(null);
          load();
        }}
        onChanged={(d) => {
          if (d) setDoc(d);
          else setDoc(null);
          load();
          onChanged?.();
        }}
      />
    );

  const draft = list?.find((x) => x.status === "draft");
  return (
    <section className="sheet">
      <div className="bar">
        <div className="l">
          <h2>{t("Inventarizatsiya")}</h2>
        </div>
        <div className="r">
          {canStore && !draft && (
            <button className="btn primary" onClick={() => setCreating((v) => !v)}>
              {t("+ Yangi inventarizatsiya")}
            </button>
          )}
        </div>
      </div>
      {creating && <NewInventory data={data} notify={notify} canEdit={canEdit} onCreated={(d) => { setCreating(false); setDoc(d); load(); }} />}
      <p className="hint">
        {t("Ombordagi haqiqiy qoldiqni sanab kiriting. Hisobdagidan farqi (kamomad yoki ortiqcha) ko'rinadi. ПТО yoki administrator tasdiqlagach, qoldiq haqiqiyga tenglashtiriladi va farq kirim-chiqim tarixida «Inventarizatsiya» deb yoziladi.")}
      </p>
      {!list ? (
        <div className="loading">{t("Yuklanmoqda…")}</div>
      ) : !list.length ? (
        <div className="empty">{t("Hali inventarizatsiya o'tkazilmagan.")}</div>
      ) : (
        <ul className="inv-list">
          {list.map((x) => (
            <li key={x.id}>
              <button className="inv-item" onClick={() => openDoc(x.id)}>
                <span className="card-main">
                  <strong>
                    №{x.no} · {fmtDate(x.date)}
                  </strong>
                  <span className="muted">
                    {groupName(x.group)} · {t("sanaldi {a} / {b}", { a: x.counted, b: x.total })}
                    {x.blind ? ` · ${t("yashirin")}` : ""} · {x.createdBy?.name}
                  </span>
                </span>
                <span className="card-num">
                  <span className={`pill ${x.status === "done" ? "st-tayyor" : "st-jarayonda"}`}>{t(x.status === "done" ? "Tasdiqlangan" : "Qoralama")}</span>
                  {x.status === "done" && (x.shortage > 0 || x.surplus > 0) && (
                    <span className="muted sm">
                      {x.shortage > 0 && <span className="late">−{fmt(x.shortage)}</span>}
                      {x.shortage > 0 && x.surplus > 0 && " / "}
                      {x.surplus > 0 && <span className="ok-text">+{fmt(x.surplus)}</span>} {t("so'm")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewInventory({ data, notify, canEdit, onCreated }) {
  const t = useT();
  const [f, setF] = useState({ date: today(), group: "", blind: false });
  const [busy, setBusy] = useState(false);
  const used = GROUPS.filter(([k]) => data.materials.some((m) => m.stock && !m.archived && m.group === k));
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await api("/inventories", { method: "POST", body: f }));
    } catch (e2) {
      notify(e2.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="inv-new" onSubmit={create}>
      <div className="field">
        <label htmlFor="inv-date">{t("Sana")}</label>
        <input id="inv-date" type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
      </div>
      <div className="field">
        <label htmlFor="inv-group">{t("Qaysi materiallar")}</label>
        <select id="inv-group" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>
          <option value="">{t("Hammasi")}</option>
          {used.map(([k, l]) => (
            <option key={k} value={k}>
              {t(l)}
            </option>
          ))}
        </select>
      </div>
      {canEdit && (
        <label className="check inv-blind">
          <input type="checkbox" checked={f.blind} onChange={(e) => setF({ ...f, blind: e.target.checked })} />
          <span>
            {t("Yashirin sanash")}
            <small className="muted"> — {t("omborchi hisobdagi qoldiqni ko'rmaydi, faqat sanaganini yozadi")}</small>
          </span>
        </label>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? t("Tayyorlanmoqda…") : t("Boshlash")}
      </button>
    </form>
  );
}

function InventoryDoc({ doc, data, notify, onBack, onChanged, onDirtyChange }) {
  const t = useT();
  const { canEdit, canStore } = useUser();
  const { mats } = data;
  const [vals, setVals] = useState(() => Object.fromEntries(doc.lines.map((l) => [l.materialId, counted(l) ? String(l.actual) : ""])));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const draft = doc.status === "draft";
  const editable = draft && canStore;
  const hidden = doc.lines.some((l) => l.system === null); // yashirin sanash (omborchi)

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const rows = useMemo(
    () =>
      doc.lines.map((l) => {
        const m = mats.get(l.materialId);
        const v = vals[l.materialId];
        const actual = v === "" || v === undefined ? null : +v;
        const diff = actual === null || l.system === null ? null : Math.round((actual - l.system) * 1e6) / 1e6;
        return { l, m, actual, diff, sum: diff === null ? null : diff * (l.price || 0) };
      }),
    [doc, vals, mats]
  );
  const s = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => !s || (r.m?.name || "").toLowerCase().includes(s) || (r.m?.code || "").toLowerCase().includes(s))
    .filter((r) => (filter === "left" ? r.actual === null : filter === "diff" ? r.diff !== null && Math.abs(r.diff) > 1e-9 : true));
  const nCounted = rows.filter((r) => r.actual !== null).length;
  const shortage = rows.reduce((a, r) => a + (r.sum < 0 ? -r.sum : 0), 0);
  const surplus = rows.reduce((a, r) => a + (r.sum > 0 ? r.sum : 0), 0);
  const nDiff = rows.filter((r) => r.diff !== null && Math.abs(r.diff) > 1e-9).length;

  const setVal = (id, v) => {
    setVals((x) => ({ ...x, [id]: v }));
    setDirty(true);
  };
  async function save(quiet) {
    const lines = doc.lines.map((l) => ({ materialId: l.materialId, actual: vals[l.materialId] === "" ? null : vals[l.materialId] }));
    const d = await api(`/inventories/${doc.id}`, { method: "PUT", body: { lines } });
    setDirty(false);
    if (!quiet) notify("Saqlandi");
    return d;
  }
  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const approve = () =>
    run(async () => {
      if (dirty) await save(true);
      const d = await api(`/inventories/${doc.id}/approve`, { method: "POST", body: {} });
      notify(tr("Tasdiqlandi — {n} ta material qoldig'i to'g'rilandi", { n: d.adjustments }));
      onChanged(d);
    });
  const remove = () =>
    run(async () => {
      await api(`/inventories/${doc.id}`, { method: "DELETE" });
      setDirty(false);
      notify(draft ? "O'chirildi" : "Inventarizatsiya bekor qilindi");
      onChanged(null);
    });
  function back() {
    if (dirty && !window.confirm(t("Saqlanmagan o'zgarishlar bor. Chiqib ketilsinmi?"))) return;
    setDirty(false);
    onBack();
  }

  return (
    <section className="sheet inv">
      <div className="bar">
        <div className="l">
          <button className="btn sm" onClick={back}>
            ← {t("Ro'yxat")}
          </button>
          <h2>
            {t("Inventarizatsiya")} №{doc.no} · {fmtDate(doc.date)}
          </h2>
          <span className={`pill ${draft ? "st-jarayonda" : "st-tayyor"}`}>{t(draft ? "Qoralama" : "Tasdiqlangan")}</span>
        </div>
        <div className="r">
          <ExportButtons company={data.settings?.company} notify={notify} build={() => invExcel(doc, rows, data)} />
        </div>
      </div>
      <p className="hint">
        {groupName(doc.group)} · {t("boshladi")}: {doc.createdBy?.name}
        {doc.approvedBy?.name && ` · ${t("tasdiqladi")}: ${doc.approvedBy.name}, ${new Date(doc.approvedBy.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`}
        {doc.blind && ` · ${t("yashirin sanash")}`}
      </p>

      <div className={`kpis ${hidden ? "kpis-1" : ""}`}>
        <div className="kpi">
          <div className="k">{t("Sanaldi")}</div>
          <div className="v">
            {nCounted}
            <small>/ {rows.length}</small>
          </div>
        </div>
        {!hidden && (
          <>
            <div className="kpi">
              <div className="k">{t("Farqli materiallar")}</div>
              <div className="v">{nDiff}</div>
            </div>
            <div className={`kpi ${shortage > 0 ? "kpi-warn" : ""}`}>
              <div className="k">{t("Kamomad")}</div>
              <div className="v">
                {fmt(shortage)}
                <small>{t("so'm")}</small>
              </div>
            </div>
            <div className="kpi kpi-in">
              <div className="k">{t("Ortiqcha")}</div>
              <div className="v">
                {fmt(surplus)}
                <small>{t("so'm")}</small>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bar">
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder={t("Qidirish…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Qidirish")} />
        </div>
        <div className="chips">
          {[["all", "Hammasi"], ["left", "Sanalmagan"], ...(hidden ? [] : [["diff", "Farqli"]])].map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {t(l)}
            </button>
          ))}
        </div>
      </div>

      <div className="tbl-wrap">
        <table className={editable ? "edit" : ""}>
          <thead>
            <tr>
              <th>{t("Material")}</th>
              {!hidden && <th className="n">{t("Hisobda")}</th>}
              <th className="n">{t("Haqiqatda")}</th>
              {!hidden && <th className="n">{t("Farq")}</th>}
              {!hidden && <th className="n hide-s">{t("Farq, so'm")}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ l, m, actual, diff, sum }) => (
              <tr key={l.materialId} className={diff !== null && Math.abs(diff) > 1e-9 ? (diff < 0 ? "row-bad" : "row-ok") : ""}>
                <td>
                  {m?.name || t("— o'chirilgan —")}
                  <span className="sub">{m?.unit}</span>
                </td>
                {!hidden && <td className="n">{fmtN(l.system, 3)}</td>}
                <td className="n">
                  {editable ? (
                    <span className="inv-input">
                      <input
                        id={`inv-${l.materialId}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={vals[l.materialId]}
                        placeholder="—"
                        onChange={(e) => setVal(l.materialId, e.target.value)}
                        aria-label={tr("{m}: haqiqatda", { m: m?.name || "" })}
                      />
                      {!hidden && actual === null && (
                        <button type="button" className="btn sm" title={t("Hisobdagiga teng")} onClick={() => setVal(l.materialId, String(Math.max(0, l.system)))}>
                          =
                        </button>
                      )}
                    </span>
                  ) : actual === null ? (
                    "—"
                  ) : (
                    fmtN(actual, 3)
                  )}
                </td>
                {!hidden && (
                  <td className={`n${diff < 0 ? " late" : diff > 0 ? " ok-text" : ""}`}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${fmtN(diff, 3)}`}</td>
                )}
                {!hidden && <td className={`n hide-s${sum < 0 ? " late" : ""}`}>{sum === null || !sum ? "—" : fmt(sum)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="inv-actions">
        {editable && (
          <button className="btn primary" disabled={busy || !dirty} onClick={() => run(() => save(false))}>
            {dirty ? t("Saqlash") : t("Saqlangan")}
          </button>
        )}
        {draft && canEdit && <ApproveButton disabled={busy || !nCounted} onConfirm={approve} />}
        {draft && canStore && <DeleteButton onConfirm={remove} />}
        {!draft && canEdit && <DeleteButton label="Tasdiqni bekor qilish" onConfirm={remove} />}
      </div>
      {draft && !canEdit && canStore && <p className="hint">{t("Sanab bo'lgach saqlang — ПТО tekshirib tasdiqlaydi.")}</p>}
      {draft && canEdit && <p className="hint">{t("Tasdiqlanganda faqat sanalgan materiallar to'g'rilanadi; sanalmaganlar o'zgarmaydi.")}</p>}
    </section>
  );
}

function ApproveButton({ onConfirm, disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const x = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(x);
  }, [armed]);
  return (
    <button type="button" className={`btn ${armed ? "primary" : ""}`} disabled={disabled} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? tr("Ha, qoldiqni to'g'rilash") : tr("Tasdiqlash va qoldiqni to'g'rilash")}
    </button>
  );
}

function invExcel(doc, rows, data) {
  const hidden = doc.lines.some((l) => l.system === null);
  const cols = [
    { header: "№", key: "i", type: "int", width: 5 },
    { header: tr("Material"), key: "name", width: 34 },
    { header: tr("Birlik"), key: "unit", width: 8 },
    ...(hidden ? [] : [{ header: tr("Hisobda"), key: "system", type: "num", width: 12 }]),
    { header: tr("Haqiqatda"), key: "actual", type: "num", width: 12 },
    ...(hidden
      ? []
      : [
          { header: tr("Farq"), key: "diff", type: "num", width: 11 },
          { header: tr("Narx, so'm"), key: "price", type: "money", width: 13 },
          { header: tr("Farq, so'm"), key: "sum", type: "money", total: "sum", width: 15 },
        ]),
  ];
  const signers = data.settings?.signers?.length ? data.settings.signers : [tr("Omborchi"), tr("ПТО muhandisi"), tr("Rahbar")];
  return {
    filename: `Inventarizatsiya_${doc.no}_${fileDate()}.xlsx`,
    sheets: [
      {
        name: tr("Inventarizatsiya"),
        title: tr("Inventarizatsiya dalolatnomasi №{n}", { n: doc.no }),
        subtitle: `${fmtDate(doc.date)} · ${groupName(doc.group)} · ${tr(doc.status === "done" ? "Tasdiqlangan" : "Qoralama")}`,
        columns: cols,
        rows: rows.map((r, i) => ({
          i: i + 1, name: r.m?.name || "", unit: r.m?.unit || "", system: r.l.system, actual: r.actual, diff: r.diff, price: r.l.price || null,
          sum: r.sum ? Math.round(r.sum) : null, _style: r.diff < 0 ? "bad" : r.diff > 0 ? "ok" : undefined,
        })),
        notes: signers.map((x) => `${x}: ______________________`),
      },
    ],
  };
}
