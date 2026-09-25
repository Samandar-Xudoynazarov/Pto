"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, login, logout } from "@/lib/api";
import { UserContext, roleLabel, canStoreRole } from "@/lib/role";
import { I18nProvider, LANGS, tr, useI18n, useT } from "@/lib/i18n";
import { useCardTables } from "@/lib/cards";
import { byId, fmtDate, lsGet, lsSet, today } from "@/lib/calc";
import FormDialog from "@/components/FormDialog";
import DayTab from "@/components/DayTab";
import MonthTab from "@/components/MonthTab";
import StockTab from "@/components/StockTab";
import OrdersTab from "@/components/OrdersTab";
import CostTab from "@/components/CostTab";
import CatalogTab from "@/components/CatalogTab";
import MaterialsTab from "@/components/MaterialsTab";
import ProductEditor from "@/components/ProductEditor";
import Icon from "@/components/Icon";
import AdminTab from "@/components/AdminTab";
import PasswordDialog from "@/components/PasswordDialog";
import InstallHint from "@/components/InstallHint";
import WarehouseTab from "@/components/WarehouseTab";
import MovesTab from "@/components/MovesTab";
import TargetsTab from "@/components/TargetsTab";
import MoveSheet from "@/components/MoveSheet";

// [kalit, nomi, izoh, kimlarga (bo'sh — hammaga)]
const NO_STORE = ["admin", "pto", "rahbar", "kurator"];
const TABS = [
  ["day", "Kunlik hisobot", "Reja / fakt, xomashyo sarfi, jo'natish", NO_STORE],
  ["month", "Oylik hisobot", "Reja bajarilishi, haqiqiy sarf va norma farqi", NO_STORE],
  ["wh", "Ombor", "Materiallar qoldig'i, kirim va chiqim"],
  ["moves", "Kirim-chiqim tarixi", "Ombordagi barcha harakatlar"],
  ["stock", "Qoldiq va ehtiyoj", "Material va tayyor mahsulot qiymati, buyurtmalar uchun ehtiyoj", NO_STORE],
  ["ord", "Buyurtmalar", "Buyurtmachilar, muddatlar va jo'natish holati", NO_STORE],
  ["cost", "Kalkulyatsiya", "Tannarx va sotuv narxi — Excel tartibida", NO_STORE],
  ["cat", "Katalog", "Mahsulotlar, sarf normalari va kalkulyatsiya kartalari", NO_STORE],
  ["mat", "Materiallar", "Narxlar, beton retseptlari va sozlamalar", NO_STORE],
  ["targets", "Sex va texnika", "Chiqim manzillari: bo'limlar va mashinalar"],
  ["admin", "Boshqaruv", "Foydalanuvchilar, zaxira nusxa va o'zgarishlar tarixi", ["admin"]],
];
const tabsFor = (user) => TABS.filter((t) => !t[3] || t[3].includes(user?.role));
// Telefondagi pastki menyu: rol bo'yicha 4 ta asosiy bo'lim (+ o'rtada «+» tugmasi)
const BOTTOM = {
  omborchi: ["wh", "moves", "targets"],
  admin: ["day", "wh", "moves"],
  pto: ["day", "wh", "moves"],
  rahbar: ["day", "month", "wh", "moves"],
  kurator: ["day", "month", "wh", "moves"],
};
const DEFAULT_TAB = { omborchi: "wh" };
// pastki menyuda sig'adigan qisqa nomlar
const SHORT = { day: "Kunlik", month: "Oylik", moves: "Tarix", targets: "Sex/texnika", stock: "Qoldiq", ord: "Buyurtma" };

function LangSwitch({ dark }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`lang${dark ? " dark" : ""}`} role="group" aria-label="Til / Язык">
      {LANGS.map((l) => (
        <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => setLang(l.code)} title={l.label}>
          {l.short}
        </button>
      ))}
    </div>
  );
}

function Login({ onDone }) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(username, pw);
      onDone();
    } catch (e2) {
      setErr(t(e2.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="login-top">
          <div className="brand-mark">ПТО</div>
          <LangSwitch />
        </div>
        <h1>{t("Zavod ish stoli")}</h1>
        <p className="hint">{t("Davom etish uchun login va parolni kiriting")}</p>
        <div className="field">
          <label htmlFor="login-user">{t("Login")}</label>
          <input
            id="login-user"
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pw">{t("Parol")}</label>
          <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </div>
        {err && <p className="err">{err}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? t("Tekshirilmoqda…") : t("Kirish")}
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  return (
    <I18nProvider>
      <App />
    </I18nProvider>
  );
}

function App() {
  const t = useT();
  useCardTables();
  const [phase, setPhase] = useState("loading"); // loading | login | ready | error
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("day");
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [settings, setSettings] = useState(null);
  const [targets, setTargets] = useState([]);
  const [move, setMove] = useState(null); // kirim/chiqim oynasi: { type, materialId? }
  const [version, setVersion] = useState(0); // ombor harakati saqlanganda qoldiqlarni yangilash uchun
  const [user, setUser] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [editProduct, setEditProduct] = useState(undefined); // undefined = yopiq, null = yangi
  const [toast, setToast] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const toastTimer = useRef(null);

  const notify = useCallback((msg) => {
    setToast(tr(msg)); // server xabarlari ham tanlangan tilga o'giriladi
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }, []);

  const loadAll = useCallback(async () => {
    setPhase((p) => (p === "ready" ? p : "loading"));
    try {
      const me = await api("/me");
      setUser(me);
      // vaqtinchalik parol: server boshqa ma'lumotni bermaydi — avval yangi parol o'rnatiladi
      if (me.mustChangePassword) {
        setPhase("password");
        return;
      }
      const [m, p, o, s, tg] = await Promise.all([api("/materials"), api("/products"), api("/orders"), api("/settings"), api("/targets")]);
      setTargets(tg);
      setMaterials(m);
      setProducts(p);
      setOrders(o);
      setSettings(s);
      setPhase("ready");
    } catch (e) {
      if (e.status === 401) setPhase("login");
      else {
        setLoadError(tr(e.message));
        setPhase("error");
      }
    }
  }, []);

  const safe = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      notify(e.message);
    }
  };
  const reloadMaterials = useCallback(safe(async () => setMaterials(await api("/materials"))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const reloadProducts = useCallback(safe(async () => setProducts(await api("/products"))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const reloadOrders = useCallback(safe(async () => setOrders(await api("/orders"))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const reloadSettings = useCallback(safe(async () => setSettings(await api("/settings"))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const reloadTargets = useCallback(safe(async () => setTargets(await api("/targets"))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const saved = lsGet("pto.tab", "");
    if (TABS.some(([k]) => k === saved)) setTab(saved);
    loadAll();
  }, [loadAll]);

  // token eskirgan yoki foydalanuvchi bloklangan bo'lsa — kirish sahifasiga
  useEffect(() => {
    const onAuth = () => setPhase("login");
    window.addEventListener("pto:unauthorized", onAuth);
    return () => window.removeEventListener("pto:unauthorized", onAuth);
  }, []);

  // Kunlik hisobotda saqlanmagan o'zgarish bor-yo'qligi (DayTab xabar beradi)
  const unsaved = useRef(false);
  const onDirtyChange = useCallback((v) => {
    unsaved.current = v;
  }, []);
  const confirmLeave = () =>
    !unsaved.current || window.confirm(t("Kunlik hisobotda saqlanmagan o'zgarishlar bor. Ularni tashlab ketasizmi?"));

  const chooseTab = (k) => {
    setMenuOpen(false);
    if (k === active) return;
    if (!confirmLeave()) return;
    unsaved.current = false;
    setTab(k);
    lsSet("pto.tab", k);
  };
  const openForm = useCallback((f) => setForm({ ...f, key: Date.now() }), []);

  const data = useMemo(
    () => ({ materials, products, orders, targets, settings: settings || {}, mats: byId(materials), prods: byId(products) }),
    [materials, products, orders, targets, settings]
  );

  if (phase === "login") return <Login onDone={loadAll} />;

  const tabs = tabsFor(user);
  const current = tabs.find(([k]) => k === tab) || tabs.find(([k]) => k === DEFAULT_TAB[user?.role]) || tabs[0];
  const active = current[0];
  const canMove = canStoreRole(user?.role);
  const bottom = (BOTTOM[user?.role] || BOTTOM.rahbar).map((k) => tabs.find((x) => x[0] === k)).filter(Boolean);

  const doLogout = () => {
    if (!confirmLeave()) return;
    unsaved.current = false;
    logout();
    setUser(null);
    setMenuOpen(false);
    setPhase("login");
  };

  return (
    <UserContext.Provider value={user}>
      <div className={`app${menuOpen ? " menu-open" : ""}`}>
        <aside className="side no-print" aria-label={t("Bo'limlar")}>
          <div className="brand">
            <div className="brand-mark">ПТО</div>
            <div>
              <div className="brand-name">{t("Zavod ish stoli")}</div>
              <div className="brand-sub">{settings?.company || t("Temir-beton zavodi")}</div>
            </div>
            <button className="icon-btn side-close" onClick={() => setMenuOpen(false)} aria-label={t("Menyuni yopish")}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <nav className="nav" role="tablist">
            {tabs.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={active === k} onClick={() => chooseTab(k)}>
                <Icon name={k} size={18} />
                <span>{t(l)}</span>
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <LangSwitch dark />
            <div className="side-date" suppressHydrationWarning>
              {fmtDate(today())}
            </div>
            <div className={`side-state ${phase === "password" ? "ready" : phase}`}>
              {phase === "ready" || phase === "password" ? t("Server bilan ulangan") : phase === "error" ? t("Ulanishda xato") : t("Yuklanmoqda…")}
            </div>
            {(phase === "ready" || phase === "password") && user && (
              <div className="side-user">
                <div className="side-user-name">{user.name || user.username}</div>
                <div className="side-user-role">{t(roleLabel(user.role))}</div>
                <div className="side-user-acts">
                  <button className="side-logout" onClick={() => setPwOpen(true)}>
                    <Icon name="key" /> {t("Parol")}
                  </button>
                  <button className="side-logout" onClick={doLogout}>
                    <Icon name="logout" /> {t("Chiqish")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
        <div className="scrim no-print" onClick={() => setMenuOpen(false)} />

        <main className="main">
          <header className="topbar no-print">
            <div className="topbar-txt">
              <h1>{t(current[1])}</h1>
              <p>{t(current[2])}</p>
            </div>
            {canMove && phase === "ready" && (
              <div className="topbar-acts">
                <button className="btn in" onClick={() => setMove({ type: "in" })}>
                  <Icon name="in" /> {t("Kirim")}
                </button>
                <button className="btn out" onClick={() => setMove({ type: "out" })}>
                  <Icon name="out" /> {t("Chiqim")}
                </button>
              </div>
            )}
          </header>

          <InstallHint />

          {phase === "error" && (
            <div className="notice">
              {loadError}{" "}
              <button className="btn sm" onClick={loadAll}>
                {t("Qayta urinish")}
              </button>
            </div>
          )}

          {phase !== "ready" ? (
            <section className="sheet">
              <div className="loading">
                {phase === "loading" ? t("Ma'lumotlar yuklanmoqda…") : phase === "password" ? t("Davom etish uchun yangi parol o'rnating.") : t("Ma'lumotlarni yuklab bo'lmadi.")}
              </div>
            </section>
          ) : (
            <>
              {active === "day" && <DayTab data={data} notify={notify} onSaved={reloadOrders} onDirtyChange={onDirtyChange} version={version} />}
              {active === "month" && <MonthTab data={data} notify={notify} />}
              {active === "wh" && <WarehouseTab data={data} notify={notify} version={version} openMove={setMove} reloadMaterials={reloadMaterials} />}
              {active === "moves" && <MovesTab data={data} notify={notify} version={version} onChanged={bump} />}
              {active === "stock" && <StockTab data={data} notify={notify} reloadSettings={reloadSettings} version={version} />}
              {active === "ord" && <OrdersTab data={data} openForm={openForm} notify={notify} reload={reloadOrders} />}
              {active === "cost" && <CostTab data={data} notify={notify} onEdit={(p) => setEditProduct(p)} />}
              {active === "cat" && <CatalogTab data={data} notify={notify} reload={reloadProducts} onEdit={(p) => setEditProduct(p)} />}
              {active === "mat" && <MaterialsTab data={data} notify={notify} reload={reloadMaterials} reloadSettings={reloadSettings} />}
              {active === "targets" && <TargetsTab data={data} notify={notify} reload={reloadTargets} />}
              {active === "admin" && <AdminTab data={data} openForm={openForm} notify={notify} />}
              <ProductEditor
                product={editProduct || null}
                open={editProduct !== undefined}
                onClose={() => setEditProduct(undefined)}
                data={data}
                notify={notify}
                onSaved={reloadProducts}
              />
              <MoveSheet init={move} onClose={() => setMove(null)} onSaved={bump} data={data} notify={notify} />
            </>
          )}
        </main>

        {/* telefon: pastki menyu */}
        {user && (
          <nav className="bnav no-print" aria-label={t("Asosiy bo'limlar")}>
            {bottom.slice(0, canMove ? 2 : 4).map(([k, l]) => (
              <button key={k} aria-current={active === k ? "page" : undefined} onClick={() => chooseTab(k)}>
                <Icon name={k} size={22} />
                <span>{t(SHORT[k] || l)}</span>
              </button>
            ))}
            {canMove && (
              <button className="bnav-fab" onClick={() => setMove({ type: "in" })} aria-label={t("Kirim yoki chiqim")} disabled={phase !== "ready"}>
                <Icon name="plus" size={26} />
              </button>
            )}
            {canMove &&
              bottom.slice(2, 3).map(([k, l]) => (
                <button key={k} aria-current={active === k ? "page" : undefined} onClick={() => chooseTab(k)}>
                  <Icon name={k} size={22} />
                  <span>{t(SHORT[k] || l)}</span>
                </button>
              ))}
            <button onClick={() => setMenuOpen(true)} aria-current={!bottom.some(([k]) => k === active) ? "page" : undefined}>
              <Icon name="menu" size={22} />
              <span>{t("Menyu")}</span>
            </button>
          </nav>
        )}

        <FormDialog form={form} onClose={() => setForm(null)} />
        <PasswordDialog
          open={pwOpen || Boolean(user?.mustChangePassword)}
          forced={Boolean(user?.mustChangePassword)}
          onClose={() => setPwOpen(false)}
          onDone={(u) => {
            setUser(u);
            setPwOpen(false);
            notify("Parol o'zgartirildi");
            if (phase !== "ready") loadAll();
          }}
        />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </UserContext.Provider>
  );
}
