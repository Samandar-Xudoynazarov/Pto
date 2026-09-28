"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import Icon from "./Icon";

const KINDS = [
  ["department", "Bo'limlar va sexlar", "Masalan: Beton sexi, Armatura sexi, Oshxona"],
  ["vehicle", "Texnika va mashinalar", "Masalan: KAMAZ, Avtokran, Yuklagich"],
];

/** Chiqim manzillari: bo'lim/sex va texnika */
export default function TargetsTab({ data, notify, reload }) {
  const t = useT();
  const { canStore } = useUser();
  const { targets = [] } = data;
  const [edit, setEdit] = useState(null); // { id?, kind, name, code }
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: edit.name.trim(), code: edit.code.trim() };
      if (edit.kind === "vehicle") Object.assign(body, { meterUnit: edit.meterUnit || "km", fuelNorm: +edit.fuelNorm || 0, serviceEvery: +edit.serviceEvery || 0 });
      if (edit.id) await api(`/targets/${edit.id}`, { method: "PUT", body });
      else await api("/targets", { method: "POST", body: { ...body, kind: edit.kind } });
      notify(t("Saqlandi"));
      setEdit(null);
      await reload();
    } catch (e2) {
      notify(t(e2.message));
    } finally {
      setBusy(false);
    }
  }
  async function remove(x) {
    if (!window.confirm(t("«{name}» o'chirilsinmi? Tarixda ishlatilgan bo'lsa, arxivga o'tkaziladi.", { name: x.name }))) return;
    try {
      const r = await api(`/targets/${x.id}`, { method: "DELETE" });
      notify(t(r.archived ? "Arxivga o'tkazildi" : "O'chirildi"));
      await reload();
    } catch (e) {
      notify(t(e.message));
    }
  }
  async function restore(x) {
    try {
      await api(`/targets/${x.id}`, { method: "PUT", body: { archived: false } });
      await reload();
    } catch (e) {
      notify(t(e.message));
    }
  }

  return (
    <section className="sheet">
      <p className="hint">{t("Chiqim qilinganda material qayerga ketganini shu ro'yxatlardan tanlaysiz.")}</p>
      <div className="grid2">
        {KINDS.map(([kind, title, ex]) => {
          const list = targets.filter((x) => x.kind === kind && (showArchived || !x.archived));
          return (
            <div key={kind}>
              <div className="bar">
                <h3 style={{ margin: 0 }}>{t(title)}</h3>
                {canStore && (
                  <button className="btn sm" onClick={() => setEdit({ kind, name: "", code: "", meterUnit: "km", fuelNorm: "", serviceEvery: "" })}>
                    <Icon name="plus" /> {t("Qo'shish")}
                  </button>
                )}
              </div>
              {edit && !edit.id && edit.kind === kind && (
                <form className="inline-form" onSubmit={save}>
                  <input autoFocus placeholder={t(ex)} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required aria-label={t("Nomi")} />
                  <input placeholder={t(kind === "vehicle" ? "Davlat raqami" : "Kodi")} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} aria-label={t("Kodi")} />
                  {kind === "vehicle" && <VehicleFields edit={edit} setEdit={setEdit} />}
                  <button className="btn primary" disabled={busy}>
                    {t("Saqlash")}
                  </button>
                  <button type="button" className="btn" onClick={() => setEdit(null)}>
                    {t("Bekor qilish")}
                  </button>
                </form>
              )}
              {!list.length ? (
                <div className="empty tbl-wrap" style={{ marginTop: 8 }}>
                  {t("Hali qo'shilmagan")}
                </div>
              ) : (
                <ul className="cards" style={{ marginTop: 8 }}>
                  {list.map((x) =>
                    edit?.id === x.id ? (
                      <li key={x.id}>
                        <form className="inline-form" onSubmit={save}>
                          <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required aria-label={t("Nomi")} />
                          <input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} aria-label={t("Kodi")} />
                          {kind === "vehicle" && <VehicleFields edit={edit} setEdit={setEdit} />}
                          <button className="btn primary" disabled={busy}>
                            {t("Saqlash")}
                          </button>
                          <button type="button" className="btn" onClick={() => setEdit(null)}>
                            {t("Bekor qilish")}
                          </button>
                        </form>
                      </li>
                    ) : (
                      <li key={x.id} className={`card-row static ${x.archived ? "archived" : ""}`}>
                        <span className="card-main">
                          <strong>{x.name}</strong>
                          <span className="muted">
                            {x.code}
                            {kind === "vehicle" && x.fuelNorm > 0 && `${x.code ? " · " : ""}${t("norma")} ${x.fuelNorm} ${t(x.meterUnit === "soat" ? "l/soat" : "l/100 km")}`}
                            {x.archived ? ` ${t("(arxivda)")}` : ""}
                          </span>
                        </span>
                        {canStore && (
                          <span className="acts">
                            {x.archived ? (
                              <button className="btn sm" onClick={() => restore(x)}>
                                {t("Qaytarish")}
                              </button>
                            ) : (
                              <>
                                <button className="btn sm" onClick={() => setEdit({ id: x.id, kind, name: x.name, code: x.code || "", meterUnit: x.meterUnit || "km", fuelNorm: x.fuelNorm || "", serviceEvery: x.serviceEvery || "" })}>
                                  {t("Tahrirlash")}
                                </button>
                                <button className="btn sm danger" onClick={() => remove(x)} aria-label={t("O'chirish")}>
                                  ×
                                </button>
                              </>
                            )}
                          </span>
                        )}
                      </li>
                    )
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {targets.some((x) => x.archived) && (
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> {t("Arxivdagilarni ko'rsatish")}
        </label>
      )}
    </section>
  );
}

/** Texnika: spidometr yoki motosoat, yoqilg'i normasi, texnik xizmat oralig'i */
function VehicleFields({ edit, setEdit }) {
  const t = useT();
  const hour = edit.meterUnit === "soat";
  return (
    <div className="veh-fields">
      <label>
        <span>{t("Hisoblagich")}</span>
        <select value={edit.meterUnit || "km"} onChange={(e) => setEdit({ ...edit, meterUnit: e.target.value })}>
          <option value="km">{t("Spidometr, km")}</option>
          <option value="soat">{t("Motosoat")}</option>
        </select>
      </label>
      <label>
        <span>{t(hour ? "Yoqilg'i normasi, l/soat" : "Yoqilg'i normasi, l/100 km")}</span>
        <input type="number" min="0" step="any" inputMode="decimal" value={edit.fuelNorm} placeholder="0" onChange={(e) => setEdit({ ...edit, fuelNorm: e.target.value })} />
      </label>
      <label>
        <span>{t(hour ? "Texnik xizmat har … soatda" : "Texnik xizmat har … km da")}</span>
        <input type="number" min="0" step="1" inputMode="numeric" value={edit.serviceEvery} placeholder="0" onChange={(e) => setEdit({ ...edit, serviceEvery: e.target.value })} />
      </label>
    </div>
  );
}
