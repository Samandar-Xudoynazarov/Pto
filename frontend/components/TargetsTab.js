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
                  <button className="btn sm" onClick={() => setEdit({ kind, name: "", code: "" })}>
                    <Icon name="plus" /> {t("Qo'shish")}
                  </button>
                )}
              </div>
              {edit && !edit.id && edit.kind === kind && (
                <form className="inline-form" onSubmit={save}>
                  <input autoFocus placeholder={t(ex)} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required aria-label={t("Nomi")} />
                  <input placeholder={t(kind === "vehicle" ? "Davlat raqami" : "Kodi")} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} aria-label={t("Kodi")} />
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
                                <button className="btn sm" onClick={() => setEdit({ id: x.id, kind, name: x.name, code: x.code || "" })}>
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
