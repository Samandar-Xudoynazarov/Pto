"use client";
import { tr } from "@/lib/i18n";
import { useCallback, useEffect, useState } from "react";
import { api, download } from "@/lib/api";
import { ROLES, roleLabel, useUser } from "@/lib/role";
import { fmtN } from "@/lib/calc";
import DeleteButton from "./DeleteButton";
import Icon from "./Icon";

/* ================= yordamchilar ================= */
const TZ = "Asia/Tashkent";
export const fmtDateTime = (s) =>
  s
    ? new Date(s).toLocaleString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

const FIELD = {
  production: "Ishlab chiqarish", materials: "Materiallar", shipments: "Jo'natish", products: "Mahsulotlar",
  plan: "reja", fact: "fakt", note: "izoh", sarf: "sarf", kirim: "kirim", qty: "soni", customer: "buyurtmachi",
  vehicle: "mashina", orderId: "buyurtma", productId: "mahsulot", materialId: "material", name: "nomi", unit: "birlik",
  group: "guruh", price: "narx", stock: "omborda hisoblanadi", electrodeBase: "elektrod asosi", isElectrode: "elektrod", recipe: "retsept (1 m³)",
  writeoff: "Норма (1 m³)", norm: "norma", code: "marka", norms: "Sarf normasi", calc: "Kalkulyatsiya", items: "materiallar",
  metalKg: "metall, kg", prodRows: "ishlab chiqarish xarajatlari", otherRows: "boshqa xarajatlar", margin: "marja, %",
  vat: "QQS, %", status: "holat", deadline: "muddat", date: "sana", electrodePct: "elektrod, %", company: "korxona",
  signers: "imzolar", opening: "Boshlang'ich qoldiq", role: "rol", active: "faol", username: "login", password: "parol",
  mustChangePassword: "parolni almashtirishi kerak", value: "qiymat", type: "turi", sort: "tartib", no: "№", notes: "izohlar",
  calcTemplate: "kalkulyatsiya andozasi", minQty: "minimal qoldiq", archived: "arxivda", kind: "turi",
  departmentId: "bo'lim / sex", vehicleId: "texnika", person: "mas'ul shaxs", supplier: "yetkazib beruvchi", docNumber: "nakladnoy",
};
const ENTITY = {
  day: "Kunlik hisobot", material: "Material", product: "Mahsulot", order: "Buyurtma", settings: "Sozlamalar", user: "Foydalanuvchi", backup: "Zaxira nusxa",
  movement: "Ombor harakati", target: "Sex / texnika",
};
const ACTION = {
  create: ["Qo'shildi", "st-tayyor"],
  update: ["O'zgardi", "st-jarayonda"],
  delete: ["O'chirildi", "st-bad"],
  login: ["Kirdi", "st-topshirildi"],
  backup: ["Yuklab olindi", "st-yangi"],
};
const ID_RE = /^([a-f0-9]{24})(#\d+)?$/;

function nameOf(id, data) {
  const m = data.mats.get(id);
  if (m) return m.name;
  const p = data.prods.get(id);
  if (p) return p.code;
  const o = data.orders.find((x) => x.id === id);
  if (o) return `№${o.no} ${o.customer}`;
  const t = data.targets?.find((x) => x.id === id);
  if (t) return t.name;
  return tr("o'chirilgan");
}
function pathLabel(p, data) {
  return p
    .split(".")
    .map((seg) => {
      const m = ID_RE.exec(seg);
      if (m) return nameOf(m[1], data) + (m[2] ? ` ${m[2]}` : "");
      if (/^\d+$/.test(seg)) return tr("{n}-qator", { n: +seg + 1 });
      return tr(FIELD[seg] || seg);
    })
    .join(" › ");
}
function valueLabel(v, data) {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return tr("ha");
  if (v === false) return tr("yo'q");
  if (typeof v === "number") return fmtN(v, 4);
  if (typeof v === "string" && ID_RE.test(v)) return nameOf(v, data);
  if (typeof v === "string") return tr(ROLES.find(([k]) => k === v)?.[1] || v);
  return JSON.stringify(v);
}

/* ================= Foydalanuvchilar ================= */
function Users({ openForm, notify }) {
  const { user: me } = useUser();
  const [list, setList] = useState(null);
  const load = useCallback(async () => {
    try {
      setList(await api("/users"));
    } catch (e) {
      notify(e.message);
    }
  }, [notify]);
  useEffect(() => {
    load();
  }, [load]);

  function userForm(u) {
    openForm({
      title: u ? tr("Foydalanuvchi: {u}", { u: u.username }) : tr("Yangi foydalanuvchi"),
      values: u ? { name: u.name, role: u.role } : { role: "pto" },
      fields: u
        ? [
            { name: "name", label: "Ism familiya", wide: true },
            { name: "role", label: "Rol", type: "select", options: ROLES, wide: true },
          ]
        : [
            { name: "username", label: "Login", req: true, unit: "lotin harflari" },
            { name: "name", label: "Ism familiya" },
            { name: "role", label: "Rol", type: "select", options: ROLES, wide: true },
            { name: "password", label: "Vaqtinchalik parol", type: "password", req: true, unit: "kamida 6 belgi", wide: true },
          ],
      onSubmit: async (v) => {
        if (u) await api(`/users/${u.id}`, { method: "PUT", body: v });
        else await api("/users", { method: "POST", body: v });
        await load();
        notify(u ? "Saqlandi" : "Foydalanuvchi qo'shildi — birinchi kirishda parolini o'zgartiradi");
      },
    });
  }
  function resetForm(u) {
    openForm({
      title: tr("{u} — yangi parol", { u: u.username }),
      fields: [{ name: "password", label: "Yangi vaqtinchalik parol", type: "password", req: true, unit: "kamida 6 belgi", wide: true }],
      submitLabel: "Parolni o'rnatish",
      onSubmit: async (v) => {
        await api(`/users/${u.id}`, { method: "PUT", body: v });
        notify("Parol o'rnatildi. Foydalanuvchi keyingi kirishda uni o'zgartiradi");
      },
    });
  }
  async function setActive(u, active) {
    try {
      await api(`/users/${u.id}`, { method: "PUT", body: { active } });
      await load();
    } catch (e) {
      notify(e.message);
    }
  }
  async function del(u) {
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      await load();
      notify("O'chirildi");
    } catch (e) {
      notify(e.message);
    }
  }

  return (
    <div>
      <div className="bar">
        <h3 style={{ margin: 0 }}>{tr("Foydalanuvchilar")}</h3>
        <button className="btn primary" onClick={() => userForm()}>
          <Icon name="plus" /> {tr("Foydalanuvchi qo'shish")}</button>
      </div>
      <div className="tbl-wrap" style={{ marginTop: 10 }}>
        {!list ? (
          <div className="loading">{tr("Yuklanmoqda…")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{tr("Login")}</th>
                <th>{tr("Ism")}</th>
                <th>{tr("Rol")}</th>
                <th>{tr("Holat")}</th>
                <th>{tr("Oxirgi kirish")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="code">{u.username}</span>
                    {u.id === me?.id && <span className="sub">{tr("bu siz")}</span>}
                  </td>
                  <td>{u.name}</td>
                  <td>{tr(roleLabel(u.role))}</td>
                  <td>
                    {u.active ? <span className="pill st-tayyor">{tr("Faol")}</span> : <span className="pill st-topshirildi">{tr("O'chirilgan")}</span>}
                    {u.mustChangePassword && <span className="sub">{tr("parolni almashtirishi kerak")}</span>}
                  </td>
                  <td className="num">{fmtDateTime(u.lastLoginAt)}</td>
                  <td>
                    <div className="acts">
                      <button className="btn sm" onClick={() => userForm(u)}>{tr("Tahrirlash")}</button>
                      <button className="btn sm" onClick={() => resetForm(u)}>{tr("Parol")}</button>
                      {u.id !== me?.id && (
                        <>
                          <button className="btn sm" onClick={() => setActive(u, !u.active)}>
                            {u.active ? tr("Bloklash") : tr("Faollashtirish")}
                          </button>
                          <DeleteButton onConfirm={() => del(u)} />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        <strong>{tr("Administrator")}</strong> {tr("hamma narsani va foydalanuvchilarni boshqaradi.")} <strong>{tr("ПТО muhandisi")}</strong> {tr("hisobot, ombor, buyurtma, katalog va materiallarni tahrirlaydi.")} <strong>{tr("Omborchi")}</strong> {tr("ombor kirim-chiqimini, sex va texnikani yuritadi.")} <strong>{tr("Rahbar")}</strong> {tr("va")} <strong>{tr("Kurator")}</strong> {tr(
          "hamma bo'limni ko'radi, lekin hech narsani o'zgartira olmaydi. Bloklangan foydalanuvchi darhol tizimdan chiqariladi."
        )}</p>
    </div>
  );
}

/* ================= O'zgarishlar tarixi ================= */
function Audit({ data, notify, users }) {
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState("");
  const [userId, setUserId] = useState("");
  const [open, setOpen] = useState(() => new Set());

  const load = useCallback(
    async (more = false, cur = []) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ limit: "40" });
        if (entity) qs.set("entity", entity);
        if (userId) qs.set("user", userId);
        if (more && cur.length) qs.set("before", cur[cur.length - 1].createdAt);
        const r = await api(`/audit?${qs}`);
        setItems(more ? [...cur, ...r.items] : r.items);
        setHasMore(r.hasMore);
      } catch (e) {
        notify(e.message);
      } finally {
        setLoading(false);
      }
    },
    [entity, userId, notify]
  );
  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div>
      <div className="bar">
        <h3 style={{ margin: 0 }}>{tr("O'zgarishlar tarixi")}</h3>
        <div className="r">
          <select id="au-entity" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label={tr("Bo'lim")}>
            <option value="">{tr("Barcha bo'limlar")}</option>
            {Object.entries(ENTITY).map(([k, l]) => (
              <option key={k} value={k}>
                {tr(l)}
              </option>
            ))}
          </select>
          <select id="au-user" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={tr("Foydalanuvchi")}>
            <option value="">{tr("Barcha foydalanuvchilar")}</option>
            {(users || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.username}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="tbl-wrap" style={{ marginTop: 10 }}>
        {!items.length && !loading ? (
          <div className="empty">{tr("Hozircha yozuv yo'q.")}</div>
        ) : (
          <table className="audit">
            <thead>
              <tr>
                <th>{tr("Vaqt")}</th>
                <th>{tr("Kim")}</th>
                <th>{tr("Amal")}</th>
                <th>{tr("Nima")}</th>
                <th className="n">{tr("Farqlar")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const [aLabel, aCls] = ACTION[it.action] || [it.action, ""];
                const n = (it.changes?.length || 0) + (it.more || 0);
                const isOpen = open.has(it.id);
                return [
                  <tr key={it.id} className={n ? "clickable" : undefined} onClick={n ? () => toggle(it.id) : undefined}>
                    <td className="num">{fmtDateTime(it.createdAt)}</td>
                    <td>{it.user?.name || it.user?.username}</td>
                    <td>
                      <span className={`pill ${aCls}`}>{tr(aLabel)}</span>
                    </td>
                    <td>
                      <span className="muted">{tr(ENTITY[it.entity] || it.entity)}</span>{" "}
                      {it.entity === "day" ? it.label.split("-").reverse().join(".") : it.label}
                    </td>
                    <td className="n">{n ? <button className="linkbtn">{isOpen ? tr("yopish") : tr("{n} ta", { n })}</button> : ""}</td>
                  </tr>,
                  isOpen && (
                    <tr key={`${it.id}-d`} className="audit-detail">
                      <td colSpan={5}>
                        <table className="changes no-rt">
                          <tbody>
                            {it.changes.map((c, i) => (
                              <tr key={i}>
                                <td>{pathLabel(c.p, data)}</td>
                                <td className="n old">{valueLabel(c.a, data)}</td>
                                <td className="arrow">→</td>
                                <td className="n new">{valueLabel(c.b, data)}</td>
                              </tr>
                            ))}
                            {it.more > 0 && (
                              <tr>
                                <td colSpan={4} className="muted">{tr("… yana {n} ta o'zgarish", { n: it.more })}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>
      {loading && <div className="loading">{tr("Yuklanmoqda…")}</div>}
      {hasMore && !loading && (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => load(true, items)}>{tr("Yana ko'rsatish")}</button>
      )}
      <p className="hint" style={{ marginTop: 8 }}>{tr(
        "Qatorni bosing — nima, qaysi qiymatdan qaysi qiymatga o'zgargani ko'rinadi. Yozuvlar 13 oy saqlanadi."
      )}</p>
    </div>
  );
}

/* ================= Zaxira nusxa ================= */
function Backup({ notify }) {
  const [last, setLast] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const loadLast = useCallback(async () => {
    try {
      const r = await api("/audit?action=backup&limit=1");
      setLast(r.items[0] || null);
    } catch {
      setLast(null);
    }
  }, []);
  useEffect(() => {
    loadLast();
  }, [loadLast]);

  async function run() {
    setBusy(true);
    try {
      const name = await download("/backup", "pto-backup.json");
      notify(tr("{f} yuklab olindi", { f: name }));
      await loadLast();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const days = last ? Math.floor((Date.now() - new Date(last.createdAt)) / 864e5) : null;

  return (
    <div>
      <h3>{tr("Zaxira nusxa")}</h3>
      <div className="backup-card">
        <div>
          <div className="strong">{tr("Butun bazani bitta faylga yuklab olish")}</div>
          <p className="hint" style={{ marginTop: 4 }}>{tr(
            "Materiallar, mahsulotlar, barcha kunlik hisobotlar, buyurtmalar va sozlamalar. Parollar faylga yozilmaydi."
          )}</p>
          <p className={`hint ${last === null || days > 7 ? "warn-text" : ""}`} style={{ marginTop: 6 }}>
            {last === undefined
              ? ""
              : last === null
                ? tr("Hali birorta ham zaxira nusxa olinmagan.")
                : tr("Oxirgi nusxa: {d} ({u})", { d: fmtDateTime(last.createdAt), u: last.user?.name || last.user?.username }) +
                  (days > 7 ? tr(" — {n} kun oldin, yangisini oling", { n: days }) : "")}
          </p>
        </div>
        <button className="btn primary" onClick={run} disabled={busy}>
          <Icon name="download" /> {busy ? tr("Tayyorlanmoqda…") : tr("Yuklab olish")}
        </button>
      </div>
      <details className="howto">
        <summary>{tr("Zaxiradan qanday tiklanadi?")}</summary>
        <ol>
          <li>{tr("Faylni kompyuterdagi")} <code>backend</code> {tr("papkasiga nusxalang.")}</li>
          <li>{tr("Avval tekshiring (hech narsa o'zgarmaydi):")} <code>npm run restore -- pto-backup-….json</code>
          </li>
          <li>{tr("Tiklash:")} <code>npm run restore -- pto-backup-….json --yes</code>
          </li>
        </ol>
        <p className="hint">{tr(
          "Tiklashda bazadagi hozirgi ma'lumotlar zaxiradagisi bilan almashtiriladi. Foydalanuvchilar tegilmaydi."
        )}</p>
      </details>
    </div>
  );
}

/* ================= bo'lim ================= */
export default function AdminTab({ data, openForm, notify }) {
  const [users, setUsers] = useState(null);
  useEffect(() => {
    api("/users")
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);
  return (
    <section className="sheet">
      <Users openForm={openForm} notify={notify} />
      <Backup notify={notify} />
      <Audit data={data} notify={notify} users={users} />
    </section>
  );
}
