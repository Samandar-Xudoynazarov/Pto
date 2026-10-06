"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import ProductFixDialog from "./ProductFixDialog";
import { BRAK_REASONS, brakLabel, costCard, fmt, fmtDate, fmtN, shiftDate, today } from "@/lib/calc";
import ExportButtons from "./ExportButtons";
import Icon from "./Icon";
import { fileDate } from "@/lib/xlsx-export";

const monthStart = (d) => d.slice(0, 8) + "01";
const PERIODS = [
  ["m0", "Bu oy", () => [monthStart(today()), today()]],
  ["m1", "O'tgan oy", () => {
    const end = shiftDate(monthStart(today()), -1);
    return [monthStart(end), end];
  }],
  ["d90", "3 oy", () => [shiftDate(today(), -89), today()]],
  ["d365", "1 yil", () => [shiftDate(today(), -364), today()]],
];
const cost = (p, mats) => (p?.calc?.items?.length ? costCard(p, mats).itogo : 0); // tannarx (marjasiz, QQSsiz)

/** Tayyor mahsulot ombori va brak hisobi */
export default function FinishedTab({ data, notify, version }) {
  const t = useT();
  const { products, prods, mats, orders } = data;
  const [view, setView] = useState("stock");
  const [period, setPeriod] = useState("m0");
  const [stock, setStock] = useState(null);
  const [rep, setRep] = useState(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((x) => x + 1);
  const { canEdit } = useUser();
  const [fix, setFix] = useState(null); // marka tuzatish oynasi: { fromId? }
  async function cancelFix(f) {
    if (!window.confirm(t("Tuzatishni bekor qilasizmi?"))) return; // eslint-disable-line no-alert
    try {
      await api(`/product-moves/${f.id}`, { method: "DELETE" });
      notify("Bekor qilindi");
      refresh();
    } catch (e) {
      notify(e.message);
    }
  }

  useEffect(() => {
    const d = today();
    api(`/stock?from=${d}&to=${d}`).then(setStock).catch((e) => notify(e.message));
  }, [notify, version, tick]);
  const [from, to] = PERIODS.find(([k]) => k === period)[2]();
  useEffect(() => {
    setRep(null);
    api(`/finished?from=${from}&to=${to}`).then(setRep).catch((e) => notify(e.message));
  }, [from, to, notify, version, tick]);

  // buyurtmalarga band: faol buyurtmalarning jo'natilmagan qismi
  const reserved = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      if (o.status === "topshirildi") continue;
      for (const it of o.items || []) if (it.left) m.set(it.productId, (m.get(it.productId) || 0) + it.left);
    }
    return m;
  }, [orders]);

  const s = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      products
        .map((p) => {
          const end = stock?.products?.[p.id]?.end || 0;
          const res = Math.min(Math.max(0, end), reserved.get(p.id) || 0);
          const c = cost(p, mats);
          return { p, end, res, free: end - res, need: Math.max(0, (reserved.get(p.id) || 0) - Math.max(0, end)), c, value: Math.max(0, end) * c };
        })
        .filter((r) => r.end || r.need)
        .filter((r) => !s || `${r.p.code} ${r.p.name}`.toLowerCase().includes(s))
        .sort((a, b) => b.end - a.end),
    [products, stock, reserved, mats, s]
  );
  const total = rows.reduce((a, r) => a + Math.max(0, r.end), 0);
  const value = rows.reduce((a, r) => a + r.value, 0);
  const res = rows.reduce((a, r) => a + r.res, 0);

  // brak statistikasi
  const B = useMemo(() => {
    if (!rep) return null;
    const byProd = new Map();
    const byReason = new Map();
    let made = 0, brakMade = 0, brakStock = 0, loss = 0;
    for (const [id, x] of Object.entries(rep.products)) {
      made += x.fact || 0;
      if (!(x.brak || x.writeoff || x.fact)) continue;
      byProd.set(id, { p: prods.get(id), fact: x.fact || 0, brak: x.brak || 0, writeoff: x.writeoff || 0 });
    }
    for (const b of rep.brak) {
      const c = cost(prods.get(b.productId), mats);
      loss += b.qty * c;
      byReason.set(b.reason, (byReason.get(b.reason) || 0) + b.qty);
      if (b.source === "ishlab") brakMade += b.qty;
      else brakStock += b.qty;
    }
    const prodRows = [...byProd.values()]
      .filter((r) => r.brak || r.writeoff)
      .map((r) => ({ ...r, pct: r.fact + r.brak ? (r.brak / (r.fact + r.brak)) * 100 : 0, loss: (r.brak + r.writeoff) * cost(r.p, mats) }))
      .sort((a, b) => b.loss - a.loss || b.brak + b.writeoff - (a.brak + a.writeoff));
    const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
    return { made, brakMade, brakStock, loss, pct: made + brakMade ? (brakMade / (made + brakMade)) * 100 : 0, prodRows, reasons };
  }, [rep, prods, mats]);

  return (
    <section className="sheet fg">
      <div className="seg fg-seg" role="tablist">
        <button type="button" role="tab" aria-selected={view === "stock"} onClick={() => setView("stock")}>
          {t("Omborda")}
        </button>
        <button type="button" role="tab" aria-selected={view === "brak"} onClick={() => setView("brak")}>
          {t("Brak")}
        </button>
      </div>

      {view === "stock" ? (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="k">{t("Tayyor mahsulot")}</div>
              <div className="v">
                {fmt(total)}
                <small>{t("dona")}</small>
              </div>
            </div>
            <div className="kpi">
              <div className="k">{t("Tannarx bo'yicha qiymati")}</div>
              <div className="v">
                {fmt(value / 1e6, 1)}
                <small>{t("mln so'm")}</small>
              </div>
            </div>
            <div className="kpi">
              <div className="k">{t("Buyurtmalarga band")}</div>
              <div className="v">
                {fmt(res)}
                <small>{t("dona")}</small>
              </div>
            </div>
            <div className="kpi">
              <div className="k">{t("Bo'sh (sotish mumkin)")}</div>
              <div className="v">
                {fmt(Math.max(0, total - res))}
                <small>{t("dona")}</small>
              </div>
            </div>
          </div>
          <div className="bar">
            <div className="search">
              <Icon name="search" />
              <input type="search" placeholder={t("Qidirish…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Qidirish")} />
            </div>
            <div className="r">
              <ExportButtons company={data.settings?.company} notify={notify} disabled={!rows.length} build={() => stockExcel(rows)} />
              {canEdit && (
                <button type="button" className="btn" onClick={() => setFix({})}>
                  <Icon name="swap" /> {t("Markani tuzatish")}
                </button>
              )}
            </div>
          </div>
          <div className="tbl-wrap">
            {!stock ? (
              <div className="loading">{t("Yuklanmoqda…")}</div>
            ) : !rows.length ? (
              <div className="empty">{t("Omborda tayyor mahsulot yo'q.")}</div>
            ) : (
              <table className="click-rows">
                <thead>
                  <tr>
                    <th>{t("Mahsulot")}</th>
                    <th className="n">{t("Qoldiq")}</th>
                    <th className="n">{t("Band")}</th>
                    <th className="n">{t("Bo'sh")}</th>
                    <th className="n hide-s">{t("Tannarx")}</th>
                    <th className="n">{t("Qiymati")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.p.id} onClick={() => setOpen(r.p)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(r.p)}>
                      <td>
                        <span className="code">{r.p.code}</span>
                        {r.p.name && <span className="sub">{r.p.name}</span>}
                      </td>
                      <td className={`n strong${r.end < 0 ? " late" : ""}`}>{fmtN(r.end)}</td>
                      <td className="n">{r.res ? fmtN(r.res) : "—"}</td>
                      <td className="n">
                        {fmtN(Math.max(0, r.free))}
                        {r.need > 0 && <span className="sub late">{t("yetmaydi {n}", { n: fmtN(r.need) })}</span>}
                      </td>
                      <td className="n hide-s">{r.c ? fmt(r.c) : "—"}</td>
                      <td className="n">{r.value ? fmt(r.value) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {rep?.fixes?.length > 0 && (
            <div className="fx-list">
              <h3>{t("Marka tuzatishlari")} <span className="muted">· {fmtDate(from)} — {fmtDate(to)}</span></h3>
              <ul>
                {rep.fixes.map((f) => (
                  <li key={f.id}>
                    <span className="num">{fmtDate(f.date)}</span>
                    <span>
                      <span className="code">{prods.get(f.productId)?.code || "?"}</span> → <span className="code">{prods.get(f.toProductId)?.code || "?"}</span>
                    </span>
                    <strong>{fmtN(f.qty)} {t("dona")}</strong>
                    <span className="muted">
                      {f.createdBy?.name}
                      {f.note ? ` · ${f.note}` : ""}
                    </span>
                    {canEdit && (
                      <button type="button" className="btn sm" onClick={() => cancelFix(f)}>
                        {t("Bekor qilish")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="hint">
            {t("Qoldiq = boshlang'ich + sifatli fakt − jo'natilgan − brakka chiqarilgan ± marka tuzatishlari. «Band» — faol buyurtmalarning jo'natilmagan qismi. Qiymat kalkulyatsiyadagi tannarx (marja va QQSsiz) bo'yicha.")}
          </p>
        </>
      ) : (
        <BrakView B={B} rep={rep} period={period} setPeriod={setPeriod} from={from} to={to} data={data} notify={notify} onChanged={refresh} />
      )}

      <ProductSheet product={open} end={open ? stock?.products?.[open.id]?.end || 0 : 0} onClose={() => setOpen(null)} notify={notify} onChanged={refresh} onFix={canEdit ? (id) => { setOpen(null); setFix({ fromId: id }); } : null} />
      <ProductFixDialog init={fix} products={products} stock={stock} onClose={() => setFix(null)} onSaved={refresh} notify={notify} />
    </section>
  );
}

function BrakView({ B, rep, period, setPeriod, from, to, data, notify, onChanged }) {
  const t = useT();
  const { canEdit, user } = useUser();
  const { prods } = data;
  const maxR = Math.max(1, ...(B?.reasons || []).map(([, n]) => n));
  async function cancel(b) {
    try {
      await api(`/product-moves/${b.id}`, { method: "DELETE" });
      notify("Bekor qilindi");
      onChanged();
    } catch (e) {
      notify(e.message);
    }
  }
  const canCancel = (b) => b.source === "ombor" && (canEdit || (b.createdBy?.id === user?.id && Date.now() - new Date(b.createdAt).getTime() < 24 * 36e5));
  return (
    <>
      <div className="bar">
        <div className="chips">
          {PERIODS.map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>
              {t(l)}
            </button>
          ))}
        </div>
        <div className="r">
          <ExportButtons company={data.settings?.company} notify={notify} disabled={!B?.prodRows.length} build={() => brakExcel(B, rep, prods, from, to)} />
        </div>
      </div>
      {!B ? (
        <div className="loading">{t("Yuklanmoqda…")}</div>
      ) : (
        <>
          <div className="kpis">
            <div className={`kpi ${B.brakMade + B.brakStock ? "kpi-warn" : ""}`}>
              <div className="k">{t("Jami brak")}</div>
              <div className="v">
                {fmt(B.brakMade + B.brakStock)}
                <small>{t("dona")}</small>
              </div>
            </div>
            <div className="kpi">
              <div className="k">{t("Ishlab chiqarishda brak ulushi")}</div>
              <div className="v">
                {fmtN(B.pct, 1)}
                <small>%</small>
              </div>
            </div>
            <div className="kpi">
              <div className="k">{t("Ombordan brakka chiqarildi")}</div>
              <div className="v">
                {fmt(B.brakStock)}
                <small>{t("dona")}</small>
              </div>
            </div>
            <div className={`kpi ${B.loss ? "kpi-warn" : ""}`}>
              <div className="k">{t("Zarar (tannarx bo'yicha)")}</div>
              <div className="v">
                {fmt(B.loss / 1e6, 1)}
                <small>{t("mln so'm")}</small>
              </div>
            </div>
          </div>

          {!B.reasons.length ? (
            <div className="empty">{t("Bu davrda brak yo'q.")}</div>
          ) : (
            <div className="grid2 brak-grid">
              <div>
                <h3>{t("Sabablar bo'yicha")}</h3>
                <ul className="bars">
                  {B.reasons.map(([k, n]) => (
                    <li key={k}>
                      <span>{t(brakLabel(k))}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(n / maxR) * 100}%` }} />
                      </span>
                      <strong>{fmt(n)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>{t("Mahsulotlar bo'yicha")}</h3>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Mahsulot")}</th>
                        <th className="n">{t("Sifatli")}</th>
                        <th className="n">{t("Brak")}</th>
                        <th className="n">{t("Ombordan")}</th>
                        <th className="n">{t("Zarar, so'm")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {B.prodRows.map((r) => (
                        <tr key={r.p?.id || Math.random()}>
                          <td>
                            <span className="code">{r.p?.code || "—"}</span>
                          </td>
                          <td className="n">{fmtN(r.fact)}</td>
                          <td className={`n${r.brak ? " late" : ""}`}>
                            {r.brak ? fmtN(r.brak) : "—"}
                            {r.brak > 0 && <span className="sub">{fmtN(r.pct, 1)} %</span>}
                          </td>
                          <td className="n">{r.writeoff ? fmtN(r.writeoff) : "—"}</td>
                          <td className="n">{r.loss ? fmt(r.loss) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {rep?.brak?.length > 0 && (
            <>
              <h3>{t("Brak yozuvlari")}</h3>
              <ul className="brak-list">
                {rep.brak.slice(0, 100).map((b, i) => (
                  <li key={b.id || `${b.date}-${b.productId}-${i}`}>
                    <span className="card-main">
                      <strong>
                        <span className="code">{prods.get(b.productId)?.code || "—"}</span> · {t(brakLabel(b.reason))}
                      </strong>
                      <span className="muted">
                        {fmtDate(b.date)} · {t(b.source === "ishlab" ? "ishlab chiqarishda" : "ombordan chiqarildi")}
                        {b.note ? ` · ${b.note}` : ""}
                        {b.createdBy?.name ? ` · ${b.createdBy.name}` : ""}
                      </span>
                    </span>
                    <span className="card-num">
                      <strong className="late">−{fmt(b.qty)}</strong>
                      {canCancel(b) && (
                        <button className="linkbtn" onClick={() => cancel(b)}>
                          {t("Bekor qilish")}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="hint">
            {t("Ishlab chiqarishdagi brak kunlik hisobotda «Brak» ustuniga yoziladi — u omborga kirmaydi, lekin material sarfiga qo'shiladi. Ombordagi tayyor mahsulot keyin yaroqsiz bo'lsa (tashishda singan va h.k.), mahsulot kartasidan «Brakka chiqarish» bilan yoziladi.")}
          </p>
        </>
      )}
    </>
  );
}

/** Mahsulot kartasi: 30 kunlik harakat, brakka chiqarish */
function ProductSheet({ product, end, onClose, notify, onChanged, onFix }) {
  const t = useT();
  const { canDay } = useUser();
  const ref = useRef(null);
  const [ev, setEv] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!product) return;
    setEv(null);
    api(`/finished?from=${shiftDate(today(), -29)}&to=${today()}&productId=${product.id}`)
      .then((r) => setEv(r.events || []))
      .catch(() => setEv([]));
  }, [product]);
  useEffect(() => {
    const d = ref.current;
    if (product) {
      setForm(null);
      load();
      if (d && !d.open) d.showModal();
    } else if (d?.open) d.close();
  }, [product, load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/product-moves", { method: "POST", body: { productId: product.id, ...form, qty: +form.qty } });
      notify("Brakka chiqarildi");
      setForm(null);
      load();
      onChanged();
    } catch (e2) {
      notify(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="bsheet" onClose={onClose}>
      {product && (
        <div className="bsheet-body">
          <div className="bsheet-grip" aria-hidden="true" />
          <div className="bsheet-head">
            <h2>
              <span className="code">{product.code}</span> {product.name}
            </h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Yopish")}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="big-qty">
            <span>{fmtN(end)}</span> {t("dona omborda")}
          </div>
          {!form && end > 0 && (canDay || onFix) && (
            <div className="two-btn">
              {canDay && (
                <button className="btn danger" onClick={() => setForm({ qty: "", reason: "tashish", note: "", date: today() })}>
                  {t("Brakka chiqarish")}
                </button>
              )}
              {onFix && (
                <button className="btn" onClick={() => onFix(product.id)}>
                  {t("Boshqa markaga o'tkazish")}
                </button>
              )}
            </div>
          )}
          {form && (
            <form className="brak-form" onSubmit={save}>
              <div className="form-grid two">
                <div className="field">
                  <label htmlFor="bk-q">
                    {t("Soni")} <span className="u">({t("dona")})</span>
                  </label>
                  <input id="bk-q" type="number" inputMode="numeric" min="1" max={Math.max(1, end)} step="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} required autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="bk-d">{t("Sana")}</label>
                  <input id="bk-d" type="date" max={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                </div>
                <div className="field" style={{ gridColumn: "1/-1" }}>
                  <label htmlFor="bk-r">{t("Sababi")}</label>
                  <select id="bk-r" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                    {BRAK_REASONS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {t(l)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ gridColumn: "1/-1" }}>
                  <label htmlFor="bk-n">{t("Izoh")}</label>
                  <input id="bk-n" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </div>
              </div>
              <div className="dlg-actions">
                <button type="button" className="btn" onClick={() => setForm(null)}>
                  {t("Bekor qilish")}
                </button>
                <button className="btn primary out" disabled={busy}>
                  {busy ? t("Saqlanmoqda…") : t("Brakka chiqarish")}
                </button>
              </div>
            </form>
          )}
          <h3>{t("Oxirgi 30 kun")}</h3>
          {!ev ? (
            <div className="loading">{t("Yuklanmoqda…")}</div>
          ) : !ev.length ? (
            <div className="empty">{t("Bu davrda harakat yo'q.")}</div>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("Sana")}</th>
                    <th className="n">{t("Ishlab chiqarildi")}</th>
                    <th className="n">{t("Jo'natildi")}</th>
                    <th className="n">{t("Brak")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ev.map((e) => (
                    <tr key={e.date}>
                      <td className="num">{fmtDate(e.date)}</td>
                      <td className="n">{e.fact ? `+${fmtN(e.fact)}` : "—"}</td>
                      <td className="n">
                        {e.shipped ? `−${fmtN(e.shipped)}` : "—"}
                        {e.customers.length > 0 && <span className="sub">{[...new Set(e.customers)].join(", ")}</span>}
                      </td>
                      <td className={`n${e.brak || e.writeoff ? " late" : ""}`}>
                        {e.brak || e.writeoff ? fmtN(e.brak + e.writeoff) : "—"}
                        {e.writeoff > 0 && <span className="sub">{t("ombordan {n}", { n: e.writeoff })}</span>}
                        {e.corr ? <span className="sub">{t("tuzatish {n}", { n: `${e.corr > 0 ? "+" : "−"}${fmtN(Math.abs(e.corr))}` })}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

function stockExcel(rows) {
  return {
    filename: `Tayyor_mahsulot_${fileDate()}.xlsx`,
    sheets: [
      {
        name: tr("Tayyor mahsulot"),
        title: tr("Tayyor mahsulot qoldig'i — {d} holatiga", { d: fmtDate(today()) }),
        columns: [
          { header: tr("Marka"), key: "code", width: 16 },
          { header: tr("Nomi"), key: "name", width: 30 },
          { header: tr("Qoldiq, dona"), key: "end", type: "int", total: "sum", width: 12 },
          { header: tr("Band"), key: "res", type: "int", total: "sum", width: 10 },
          { header: tr("Bo'sh"), key: "free", type: "int", total: "sum", width: 10 },
          { header: tr("Yetmaydi"), key: "need", type: "int", total: "sum", width: 10 },
          { header: tr("Tannarx, so'm"), key: "c", type: "money", width: 14 },
          { header: tr("Qiymati, so'm"), key: "value", type: "money", total: "sum", width: 16 },
        ],
        rows: rows.map((r) => ({
          code: r.p.code, name: r.p.name, end: r.end, res: r.res || null, free: Math.max(0, r.free), need: r.need || null, c: r.c ? Math.round(r.c) : null,
          value: r.value ? Math.round(r.value) : null, _cell: r.need ? { need: "bad" } : undefined,
        })),
      },
    ],
  };
}

function brakExcel(B, rep, prods, from, to) {
  const sub = `${fmtDate(from)} — ${fmtDate(to)}`;
  return {
    filename: `Brak_${fileDate()}.xlsx`,
    sheets: [
      {
        name: tr("Mahsulotlar"),
        title: tr("Brak hisoboti: mahsulotlar"),
        subtitle: sub,
        columns: [
          { header: tr("Marka"), key: "code", width: 16 },
          { header: tr("Nomi"), key: "name", width: 28 },
          { header: tr("Sifatli, dona"), key: "fact", type: "int", total: "sum", width: 12 },
          { header: tr("Brak (ishlab chiqarishda)"), key: "brak", type: "int", total: "sum", width: 14 },
          { header: tr("Brak, %"), key: "pct", type: "num", width: 9 },
          { header: tr("Ombordan brakka"), key: "writeoff", type: "int", total: "sum", width: 12 },
          { header: tr("Zarar, so'm"), key: "loss", type: "money", total: "sum", width: 16 },
        ],
        rows: B.prodRows.map((r) => ({
          code: r.p?.code, name: r.p?.name, fact: r.fact, brak: r.brak || null, pct: r.brak ? Math.round(r.pct * 10) / 10 : null, writeoff: r.writeoff || null, loss: Math.round(r.loss) || null,
        })),
      },
      {
        name: tr("Yozuvlar"),
        title: tr("Brak yozuvlari"),
        subtitle: sub,
        columns: [
          { header: tr("Sana"), key: "date", type: "date", width: 12 },
          { header: tr("Marka"), key: "code", width: 16 },
          { header: tr("Soni"), key: "qty", type: "int", total: "sum", width: 8 },
          { header: tr("Sababi"), key: "reason", width: 30 },
          { header: tr("Qayerda"), key: "src", width: 20 },
          { header: tr("Izoh"), key: "note", width: 30 },
        ],
        rows: rep.brak.map((b) => ({
          date: fmtDate(b.date), code: prods.get(b.productId)?.code, qty: b.qty, reason: tr(brakLabel(b.reason)),
          src: tr(b.source === "ishlab" ? "ishlab chiqarishda" : "ombordan chiqarildi"), note: b.note || "",
        })),
      },
    ],
  };
}
