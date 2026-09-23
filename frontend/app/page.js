"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, login, setPassword } from "@/lib/api";
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

const TABS = [
  ["day", "Kunlik hisobot", "Reja / fakt, xomashyo sarfi va kirimi, jo'natish"],
  ["month", "Oylik hisobot", "Reja bajarilishi, haqiqiy sarf va norma farqi"],
  ["stock", "Ombor", "Material va tayyor mahsulot qoldig'i, ehtiyoj"],
  ["ord", "Buyurtmalar", "Buyurtmachilar, muddatlar va jo'natish holati"],
  ["cost", "Kalkulyatsiya", "Tannarx va sotuv narxi — Excel tartibida"],
  ["cat", "Katalog", "Mahsulotlar, sarf normalari va kalkulyatsiya kartalari"],
  ["mat", "Materiallar", "Narxlar, beton retseptlari va sozlamalar"],
];

function Login({ onDone }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(pw);
      onDone();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="brand-mark">ПТО</div>
        <h1>ПТО ish stoli</h1>
        <p className="hint">Davom etish uchun parolni kiriting</p>
        <div className="field">
          <label htmlFor="pw">Parol</label>
          <input id="pw" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} required />
        </div>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Tekshirilmoqda…" : "Kirish"}
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  const [phase, setPhase] = useState("loading"); // loading | login | ready | error
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("day");
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [editProduct, setEditProduct] = useState(undefined); // undefined = yopiq, null = yangi
  const [toast, setToast] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const toastTimer = useRef(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }, []);

  const loadAll = useCallback(async () => {
    setPhase((p) => (p === "ready" ? p : "loading"));
    try {
      const [m, p, o, s] = await Promise.all([api("/materials"), api("/products"), api("/orders"), api("/settings")]);
      setMaterials(m);
      setProducts(p);
      setOrders(o);
      setSettings(s);
      setPhase("ready");
    } catch (e) {
      if (e.status === 401) setPhase("login");
      else {
        setLoadError(e.message);
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

  useEffect(() => {
    const t = lsGet("pto.tab", "day");
    if (TABS.some(([k]) => k === t)) setTab(t);
    loadAll();
  }, [loadAll]);

  const chooseTab = (k) => {
    setTab(k);
    lsSet("pto.tab", k);
  };
  const openForm = useCallback((f) => setForm({ ...f, key: Date.now() }), []);

  const data = useMemo(
    () => ({ materials, products, orders, settings: settings || {}, mats: byId(materials), prods: byId(products) }),
    [materials, products, orders, settings]
  );

  if (phase === "login") return <Login onDone={loadAll} />;

  const current = TABS.find(([k]) => k === tab) || TABS[0];

  return (
    <div className={`app${menuOpen ? " menu-open" : ""}`}>
      <aside className="side no-print" aria-label="Bo'limlar">
        <div className="brand">
          <div className="brand-mark">ПТО</div>
          <div>
            <div className="brand-name">ПТО ish stoli</div>
            <div className="brand-sub">{settings?.company || "Temir-beton zavodi"}</div>
          </div>
          <button className="icon-btn side-close" onClick={() => setMenuOpen(false)} aria-label="Menyuni yopish">
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className="nav" role="tablist">
          {TABS.map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => {
                chooseTab(k);
                setMenuOpen(false);
              }}
            >
              <Icon name={k} size={18} />
              <span>{l}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-date" suppressHydrationWarning>
            {fmtDate(today())}
          </div>
          <div className={`side-state ${phase}`}>{phase === "ready" ? "Server bilan ulangan" : phase === "error" ? "Ulanishda xato" : "Yuklanmoqda…"}</div>
          {phase === "ready" && (
            <button
              className="side-logout"
              onClick={() => {
                setPassword("");
                setPhase("login");
              }}
            >
              <Icon name="logout" /> Chiqish
            </button>
          )}
        </div>
      </aside>
      <div className="scrim no-print" onClick={() => setMenuOpen(false)} />

      <main className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menyu">
            <Icon name="menu" size={20} />
          </button>
          <div>
            <h1>{current[1]}</h1>
            <p>{current[2]}</p>
          </div>
        </header>

        {phase === "error" && (
          <div className="notice">
            {loadError}{" "}
            <button className="btn sm" onClick={loadAll}>
              Qayta urinish
            </button>
          </div>
        )}

        {phase !== "ready" ? (
          <section className="sheet">
            <div className="loading">{phase === "loading" ? "Ma'lumotlar yuklanmoqda…" : "Ma'lumotlarni yuklab bo'lmadi."}</div>
          </section>
        ) : (
          <>
            {tab === "day" && <DayTab data={data} notify={notify} onSaved={reloadOrders} />}
            {tab === "month" && <MonthTab data={data} notify={notify} />}
            {tab === "stock" && <StockTab data={data} notify={notify} reloadSettings={reloadSettings} />}
            {tab === "ord" && <OrdersTab data={data} openForm={openForm} notify={notify} reload={reloadOrders} />}
            {tab === "cost" && <CostTab data={data} onEdit={(p) => setEditProduct(p)} />}
            {tab === "cat" && <CatalogTab data={data} notify={notify} reload={reloadProducts} onEdit={(p) => setEditProduct(p)} />}
            {tab === "mat" && <MaterialsTab data={data} notify={notify} reload={reloadMaterials} reloadSettings={reloadSettings} />}
            <ProductEditor
              product={editProduct || null}
              open={editProduct !== undefined}
              onClose={() => setEditProduct(undefined)}
              data={data}
              notify={notify}
              onSaved={reloadProducts}
            />
          </>
        )}
      </main>

      <FormDialog form={form} onClose={() => setForm(null)} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
