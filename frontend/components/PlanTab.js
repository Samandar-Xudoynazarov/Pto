"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import { fmt, fmtDate, fmtN, lsGet, lsSet, productLabel, today } from "@/lib/calc";
import ExportButtons from "./ExportButtons";
import Icon from "./Icon";
import { buildPlanPdf, deliverPdf, planPdfDefinition } from "@/lib/plan-pdf";
import { fileDate } from "@/lib/xlsx-export";
import MonthPlan from "./MonthPlan";
import { confirmLeave } from "@/lib/dirty";

const WEEK = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"]; // getUTCDay() tartibida
const wd = (s) => WEEK[new Date(s + "T00:00:00Z").getUTCDay()];
const dmy = (s) => (s ? `${fmtDate(s).slice(0, 5)} ${tr(wd(s))}` : "—");

const STATUS = {
  ok: ["Ulguradi", "st-tayyor"],
  risk: ["Xavfli", "st-jarayonda"],
  late: ["Kechikadi", "st-bad"],
  stock: ["Omborda bor", "st-tayyor"],
  nocap: ["Quvvat noma'lum", "st-bad"],
  far: ["2 yildan uzoq", "st-bad"],
};
const statusText = (o) => (o.status === "late" ? tr("Kechikadi · {n} kun", { n: o.lateDays }) : tr(STATUS[o.status]?.[0] || o.status));
const basisText = (b, lid) =>
  b === "qopqoq" && lid ? tr("{h} qolibida, {n} tadan", { h: lid.hostCode, n: lid.batch }) : b === "qolip" ? tr("qoliplardan") : b === "tarix" ? tr("o'rtachadan") : tr("noma'lum");

/**
 * Buyurtmalar rejasi — ikki ko'rinish:
 *  «Dastur rejasi» — avtomatik prognoz (qancha kunda tugatamiz, yangi buyurtmani olsak ulguramizmi);
 *  «Tasdiqlangan reja» — rahbar tuzgan oylik reja (Excel'dan yuklanadi yoki qo'lda tuziladi), fakt bilan solishtiriladi.
 */
export default function PlanTab(props) {
  const t = useT();
  const [view, setView] = useState(() => lsGet("pto.planView", "dastur"));
  const choose = (v) => {
    if (v === view || !confirmLeave()) return;
    setView(v);
    lsSet("pto.planView", v);
  };
  const VIEWS = [
    ["dastur", "auto", "Dastur rejasi", "Buyurtmalar bo'yicha avtomatik prognoz"],
    ["rahbar", "boss", "Tasdiqlangan reja", "Oylik reja: Excel'dan yoki qo'lda"],
  ];
  return (
    <>
      <div className="plan-switch" role="tablist" aria-label={t("Reja turi")}>
        {VIEWS.map(([k, ic, title, sub]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => choose(k)}>
            <span className="ps-ic">
              <Icon name={ic} size={20} />
            </span>
            <span className="ps-t">
              <strong>{t(title)}</strong>
              <small>{t(sub)}</small>
            </span>
          </button>
        ))}
      </div>
      {view === "rahbar" ? (
        <section className="sheet plan">
          <MonthPlan data={props.data} notify={props.notify} />
        </section>
      ) : (
        <ProgramPlan {...props} />
      )}
    </>
  );
}

/** Dastur rejasi: qancha kunda tugatamiz, yangi buyurtmani olsak ulguramizmi */
function ProgramPlan({ data, notify, reloadOrders, reloadSettings }) {
  const t = useT();
  const { canEdit } = useUser();
  const { products, prods } = data;
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState("");
  const [allDays, setAllDays] = useState(false);
  // «Hamma buyurtmalar» yoki «Tanlangan buyurtmalar»; alone — faqat tanlanganlarni rejalashtirish (boshqalari quvvatni band qilmaydi)
  const [mode, setMode] = useState(() => lsGet("pto.planMode", "all"));
  const [sel, setSel] = useState(() => new Set(lsGet("pto.planSel", [])));
  const [alone, setAlone] = useState(() => lsGet("pto.planAlone", false));
  const [pickQ, setPickQ] = useState("");

  // rejaga kiradigan (faol, jo'natilmagan qismi bor) buyurtmalar
  const active = useMemo(
    () => data.orders.filter((o) => o.status !== "tayyor" && o.status !== "topshirildi" && (o.left ?? 1) > 0).sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.no - b.no),
    [data.orders]
  );
  const selIds = useMemo(() => active.filter((o) => sel.has(o.id)).map((o) => o.id), [active, sel]);
  const filtered = mode === "sel";
  const selKey = selIds.join(",");
  const remember = (k, v) => lsSet(k, v);
  const chooseMode = (m) => {
    setMode(m);
    remember("pto.planMode", m);
  };
  const toggleSel = (id) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      remember("pto.planSel", [...n]);
      return n;
    });

  const load = useCallback(async () => {
    try {
      setPlan(await api(filtered && alone && selKey ? `/plan?orders=${selKey}` : "/plan"));
      setErr("");
    } catch (e) {
      setErr(t(e.message));
    }
  }, [t, filtered, alone, selKey]);
  useEffect(() => {
    load();
  }, [load, data.orders, data.products, data.settings]);

  // ekranda ko'rinadigan reja: tanlangan buyurtmalar bo'yicha
  const view = useMemo(() => {
    if (!plan || !filtered) return plan;
    const ids = new Set(selIds);
    return {
      ...plan,
      orders: plan.orders.filter((o) => ids.has(o.orderId)),
      days: plan.days.map((d) => ({ ...d, items: d.items.filter((it) => ids.has(it.orderId)) })),
    };
  }, [plan, filtered, selIds]);
  // tanlanganlar boshqalar bilan birga rejalashtirilgan bo'lsa — kunlik beton jami hamma buyurtmalar bo'yicha
  const concreteIsTotal = filtered && !alone;

  // PDF: kunlik reja (A4, chop etish uchun)
  const [pdfDays, setPdfDays] = useState(() => lsGet("pto.planPdfDays", 12));
  const [pdfBusy, setPdfBusy] = useState(false);
  async function makePdf(share) {
    if (!view) return;
    setPdfBusy(true);
    try {
      const chosen = active.filter((o) => selIds.includes(o.id));
      const scope = filtered
        ? `${t("Tanlangan buyurtmalar")}: ${chosen.map((o) => `№${o.no}`).join(", ") || "—"}${alone ? ` (${t("faqat shular rejalashtirilgan")})` : ""}`
        : t("Hamma buyurtmalar");
      const def = planPdfDefinition(view, { company: data.settings?.company, scope, filtered, prods, mats: data.mats, limit, concreteIsTotal }, { days: +pdfDays || 12 });
      const blob = await buildPlanPdf(def);
      const r = await deliverPdf(blob, `Kunlik_reja_${today().split("-").reverse().join(".")}.pdf`, { share });
      if (r === "downloaded-fallback") notify("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
    } catch (e) {
      notify(e.message || "PDF tayyorlab bo'lmadi");
    } finally {
      setPdfBusy(false);
    }
  }

  // buyurtma bo'yicha: bir nechta mahsulotli buyurtmaning holati — eng yomon qatori
  const counts = useMemo(() => {
    const rank = (s) => (s === "ok" || s === "stock" ? 0 : s === "risk" ? 1 : 2);
    const worst = new Map();
    for (const o of view?.orders || []) {
      const k = o.orderId || o.id;
      worst.set(k, Math.max(worst.get(k) ?? 0, rank(o.status)));
    }
    const c = { all: worst.size, ok: 0, risk: 0, bad: 0 };
    for (const r of worst.values()) c[["ok", "risk", "bad"][r]]++;
    return c;
  }, [view]);

  const code = (id) => prods.get(id)?.code || t("— o'chirilgan —");
  const noCap = products.filter((p) => !plan?.capacity?.[p.id]?.perDay);
  const limit = plan?.settings?.concretePerDay || 0;

  return (
    <section className="sheet plan">
      <div className="plan-scope">
        <div className="seg" role="tablist" aria-label={t("Qaysi buyurtmalar")}>
          <button type="button" role="tab" aria-selected={!filtered} onClick={() => chooseMode("all")}>
            {t("Hamma buyurtmalar")} · {active.length}
          </button>
          <button type="button" role="tab" aria-selected={filtered} onClick={() => chooseMode("sel")}>
            {t("Kerakli buyurtmalar")}{selIds.length ? ` · ${selIds.length}` : ""}
          </button>
        </div>
        {filtered && (
          <div className="plan-pick">
            <div className="plan-pick-bar">
              <input type="search" placeholder={t("Qidirish: buyurtmachi, shartnoma, №")} value={pickQ} onChange={(e) => setPickQ(e.target.value)} aria-label={t("Qidirish")} />
              {selIds.length > 0 && (
                <button type="button" className="btn sm" onClick={() => { setSel(new Set()); remember("pto.planSel", []); }}>
                  {t("Tozalash")}
                </button>
              )}
              <label className="check">
                <input type="checkbox" checked={alone} onChange={(e) => { setAlone(e.target.checked); remember("pto.planAlone", e.target.checked); }} />
                {t("Faqat shularni rejalashtirish (boshqa buyurtmalarni hisobga olmasdan)")}
              </label>
            </div>
            <div className="chips plan-pick-list">
              {active
                .filter((o) => {
                  const s = pickQ.trim().toLowerCase();
                  return !s || sel.has(o.id) || String(o.no) === s || o.customer.toLowerCase().includes(s) || (o.contractNo || "").toLowerCase().includes(s);
                })
                .map((o) => (
                  <button type="button" key={o.id} className="chip" aria-pressed={sel.has(o.id)} onClick={() => toggleSel(o.id)}>
                    №{o.no} {o.customer}
                    {o.contractNo ? ` · ${o.contractNo}` : ""}
                    {o.deadline ? <span className="muted"> · {fmtDate(o.deadline).slice(0, 5)}</span> : null}
                  </button>
                ))}
              {!active.length && <span className="muted">{t("Faol buyurtma yo'q.")}</span>}
            </div>
            {!selIds.length && <p className="hint">{t("Rejasini ko'rmoqchi bo'lgan buyurtmalarni belgilang.")}</p>}
            {selIds.length > 0 && (
              <p className="hint">
                {alone
                  ? t("Faqat tanlangan buyurtmalar rejalashtirildi — boshqa buyurtmalar qoliplarni band qilmaydi deb hisoblandi (shularga ustuvorlik bersak nima bo'ladi).")
                  : t("Reja hamma buyurtmalar bilan birga hisoblandi (navbat va quvvat umumiy) — ekranda faqat tanlanganlari ko'rsatilgan.")}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k">{t(filtered ? "Tanlangan buyurtmalar" : "Faol buyurtmalar")}</div>
          <div className="v">{counts.all}</div>
        </div>
        <div className="kpi kpi-in">
          <div className="k">{t("Muddatida tugaydi")}</div>
          <div className="v">{counts.ok}</div>
        </div>
        <div className={`kpi ${counts.risk ? "kpi-risk" : ""}`}>
          <div className="k">{t("Xavfli")}</div>
          <div className="v">{counts.risk}</div>
        </div>
        <div className={`kpi ${counts.bad ? "kpi-warn" : ""}`}>
          <div className="k">{t("Kechikadi")}</div>
          <div className="v">{counts.bad}</div>
        </div>
      </div>

      <WhatIf products={products} prods={prods} notify={notify} canEdit={canEdit} onCreated={async () => {
        await reloadOrders();
        await load();
      }} />

      <div className="bar">
        <div className="l">
          <h2>{t("Buyurtmalar bo'yicha prognoz")}</h2>
        </div>
        <div className="r">
          <ExportButtons
            company={data.settings?.company}
            notify={notify}
            disabled={!view?.orders?.length}
            build={() => planExcel(view, code)}
          />
          <div className="pdf-ctl">
            <select aria-label={t("PDF: nechta ish kuni")} value={pdfDays} onChange={(e) => { setPdfDays(+e.target.value); lsSet("pto.planPdfDays", +e.target.value); }}>
              {[6, 12, 24].map((n) => (
                <option key={n} value={n}>
                  {t("{n} kun", { n })}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={pdfBusy || !view?.days?.some((d) => d.items.length)} onClick={() => makePdf(false)}>
              <Icon name="download" /> {pdfBusy ? t("Tayyorlanmoqda…") : t("Kunlik reja (PDF)")}
            </button>
            <button type="button" className="btn" disabled={pdfBusy || !view?.days?.some((d) => d.items.length)} onClick={() => makePdf(true)} aria-label={t("PDF ni ulashish")}>
              <Icon name="share" />
            </button>
          </div>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="tbl-wrap">
        {!plan ? (
          <div className="empty">{t("Hisoblanmoqda…")}</div>
        ) : !view.orders.length ? (
          <div className="empty">{t(filtered ? (selIds.length ? "Tanlangan buyurtmalarda ishlab chiqarish kerak bo'lgan mahsulot yo'q." : "Buyurtma tanlanmagan.") : "Faol buyurtma yo'q.")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>{t("Buyurtmachi")}</th>
                <th>{t("Mahsulot")}</th>
                <th className="n">{t("Qoldi")}</th>
                <th className="n hide-s" title={t("Ishlab chiqarish kerak")}>{t("Qilish kerak")}</th>
                <th className="n" title={t("Quvvat, dona/kun")}>{t("Quvvat/kun")}</th>
                <th className="n" title={t("Kerak, dona/kun")}>{t("Kerak/kun")}</th>
                <th>{t("Tugaydi")}</th>
                <th>{t("Holat")}</th>
              </tr>
            </thead>
            <tbody>
              {view.orders.map((o) => (
                <tr key={o.id}>
                  <td className="num">№{o.no}</td>
                  <td>
                    {o.customer}
                    {o.contractNo && <span className="sub">{t("Shartnoma № {n}", { n: o.contractNo })}</span>}
                  </td>
                  <td>
                    <span className="code">{code(o.productId)}</span>
                  </td>
                  <td className="n">
                    {fmt(o.remaining)}
                    {o.fromStock > 0 && <span className="sub">{t("{n} omborda", { n: fmt(o.fromStock) })}</span>}
                  </td>
                  <td className="n hide-s">{fmt(o.toProduce)}</td>
                  <td className="n">
                    {o.perDay ? fmtN(o.perDay, 2) : "—"}
                    <span className="sub">{basisText(o.basis, o.lid)}</span>
                  </td>
                  <td className={`n${o.needPerDay && o.perDay && o.needPerDay > o.perDay ? " late" : ""}`}>{o.needPerDay ? fmt(o.needPerDay) : "—"}</td>
                  <td className="num">
                    {o.finish ? dmy(o.finish) : "—"}
                    <span className="sub">{o.deadline ? t("muddat {d}", { d: fmtDate(o.deadline).slice(0, 5) }) : t("muddatsiz")}</span>
                  </td>
                  <td>
                    <span className={`pill ${STATUS[o.status]?.[1] || ""}`}>{statusText(o)}</span>
                    {o.bottleneck && o.status !== "ok" && o.status !== "stock" && (
                      <span className="sub">{t(o.bottleneck === "beton" ? "Cheklov: beton" : "Cheklov: qoliplar")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {noCap.length > 0 && (
        <p className="hint warn-text">
          {t("Quvvati noma'lum mahsulotlar (qolip soni kiritilmagan va 60 kunlik tarix yo'q): {list}. «Katalog»da qoliplar sonini kiriting.", {
            list: noCap.map((p) => p.code).slice(0, 12).join(", ") + (noCap.length > 12 ? "…" : ""),
          })}
        </p>
      )}

      <h2 className="plan-h">{t("Kunlik ishlab chiqarish taklifi")}</h2>
      <p className="hint">{t("Qaysi kuni qaysi buyurtma uchun nechta quyish kerak — eng qistovdagi buyurtma birinchi.")}</p>
      <div className="plan-days">
        {(view?.days || []).filter((d) => d.items.length).slice(0, allDays ? undefined : 6).map((d) => {
          const used = d.concrete;
          return (
            <div key={d.date} className={`plan-day${d.date === today() ? " today" : ""}`}>
              <div className="plan-day-h">
                <strong>{dmy(d.date)}</strong>
                {used > 0 && (
                  <span className={`muted${limit && used > limit - 1e-9 ? " warn-text" : ""}`}>
                    {fmtN(used, 2)}
                    {limit ? ` / ${fmtN(limit, 1)}` : ""} {t("m³ beton")}
                    {concreteIsTotal ? ` · ${t("jami")}` : ""}
                  </span>
                )}
              </div>
              {Object.values(
                d.items.reduce((acc, it) => {
                  const a = (acc[it.productId] ||= { productId: it.productId, qty: 0, nos: [], spare: 0 });
                  a.qty += it.qty;
                  if (it.spare) a.spare += it.qty;
                  else a.nos.push(it.no);
                  return acc;
                }, {})
              ).map((a) => (
                <div key={a.productId} className="plan-item">
                  <span className="code">{code(a.productId)}</span>
                  <strong>
                    {fmt(a.qty)} {t("dona")}
                  </strong>
                  <span className="muted">
                    {a.nos.length ? `№ ${a.nos.join(", ")}` : ""}
                    {a.spare ? `${a.nos.length ? " + " : ""}${t("{n} omborga", { n: a.spare })}` : ""}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        {view && !view.days.some((d) => d.items.length) && <div className="empty">{t("Ishlab chiqarish kerak bo'lgan buyurtma yo'q.")}</div>}
      </div>
      {!allDays && (view?.days || []).filter((d) => d.items.length).length > 6 && (
        <button type="button" className="btn sm more-days" onClick={() => setAllDays(true)}>
          {t("Yana {n} kunni ko'rsatish", { n: view.days.filter((d) => d.items.length).length - 6 })}
        </button>
      )}

      {canEdit && plan && <PlanSettings plan={plan} notify={notify} onSaved={async () => {
        await reloadSettings();
        await load();
      }} />}

      <p className="hint">
        {t(
          "Quvvat: qoliplar soni ÷ aylanish muddati (kun) — «Katalog»da har mahsulotga kiritiladi. Kiritilmagan bo'lsa, oxirgi 60 kundagi o'rtacha fakt olinadi. Omborda tayyor turgan mahsulot avval buyurtmalarga taqsimlanadi. Dam olish kunlari va kunlik beton cheklovi hisobga olinadi."
        )}
      </p>
    </section>
  );
}

/** «Shu buyurtmani olsak — ulguramizmi?» */
function WhatIf({ products, prods, notify, canEdit, onCreated }) {
  const t = useT();
  const [f, setF] = useState({ productId: "", qty: "", deadline: "", customer: "" });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setRes(null);
  };

  async function check(e) {
    e.preventDefault();
    setBusy(true);
    try {
      setRes(await api("/plan/check", { method: "POST", body: { ...f, qty: +f.qty } }));
    } catch (e2) {
      notify(e2.message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!f.customer.trim()) return notify("Buyurtmachi kiritilmagan");
    setBusy(true);
    try {
      await api("/orders", { method: "POST", body: { customer: f.customer.trim(), productId: f.productId, qty: +f.qty, deadline: f.deadline, date: today() } });
      notify("Buyurtma qo'shildi");
      setRes(null);
      setF({ productId: "", qty: "", deadline: "", customer: "" });
      await onCreated();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }

  const o = res?.order;
  const code = (id) => prods.get(id)?.code || "—";
  const verdict = !o
    ? null
    : o.status === "nocap"
      ? ["bad", t("Bu mahsulotning quvvati noma'lum — «Katalog»da qoliplar sonini kiriting.")]
      : o.status === "far"
        ? ["bad", t("2 yil ichida tugatib bo'lmaydi — quvvat juda kam.")]
        : o.status === "late"
          ? ["bad", t("Muddatga ulgurmaymiz — {n} kun kechikadi.", { n: o.lateDays })]
          : o.status === "risk"
            ? ["risk", t("Ulguramiz, lekin zaxira yo'q — bir kun to'xtab qolsa kechikadi.")]
            : o.status === "stock"
              ? ["ok", t("Omborda tayyor bor — darhol jo'natish mumkin.")]
              : ["ok", o.deadline ? t("Ulguramiz — muddatdan {n} ish kuni oldin tugaydi.", { n: o.slack }) : t("Tugash sanasi hisoblandi.")];

  return (
    <form className="whatif" onSubmit={check}>
      <h2>{t("Yangi buyurtma olsak — ulguramizmi?")}</h2>
      <div className="whatif-grid">
        <div className="field wide">
          <label htmlFor="wi-p">{t("Mahsulot")}</label>
          <select id="wi-p" value={f.productId} onChange={set("productId")} required>
            <option value="">{t("— tanlang —")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {productLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wi-q">
            {t("Soni")} <span className="u">({t("dona")})</span>
          </label>
          <input id="wi-q" type="number" inputMode="numeric" min="1" step="1" value={f.qty} onChange={set("qty")} required />
        </div>
        <div className="field">
          <label htmlFor="wi-d">{t("Muddat")}</label>
          <input id="wi-d" type="date" min={today()} value={f.deadline} onChange={set("deadline")} />
        </div>
        <button className="btn primary" disabled={busy}>
          {busy ? t("Hisoblanmoqda…") : t("Hisoblash")}
        </button>
      </div>

      {o && (
        <div className={`verdict v-${verdict[0]}`}>
          <p className="verdict-h">{verdict[1]}</p>
          <div className="verdict-facts">
            {o.finish && (
              <div>
                <span className="muted">{t("Tugash sanasi")}</span>
                <strong>{dmy(o.finish)}</strong>
              </div>
            )}
            {o.deadline && (
              <div>
                <span className="muted">{t("Muddat")}</span>
                <strong>{dmy(o.deadline)}</strong>
              </div>
            )}
            {o.fromStock > 0 && (
              <div>
                <span className="muted">{t("Omborda tayyor")}</span>
                <strong>
                  {fmt(o.fromStock)} {t("dona")}
                </strong>
              </div>
            )}
            <div>
              <span className="muted">{t("Quvvat")}</span>
              <strong>
                {o.perDay ? `${fmtN(o.perDay, 2)} ${t("dona/kun")}` : "—"}
              </strong>
              <span className="muted sm">{basisText(o.basis, o.lid)}</span>
            </div>
            {o.needPerDay && (
              <div>
                <span className="muted">{t("Muddatga ulgurish uchun")}</span>
                <strong className={o.perDay && o.needPerDay > o.perDay ? "late" : ""}>
                  {fmt(o.needPerDay)} {t("dona/kun")}
                </strong>
                <span className="muted sm">{t("{n} ish kuni", { n: o.daysLeft })}</span>
              </div>
            )}
          </div>
          {o.bottleneck && o.status !== "ok" && o.status !== "stock" && (
            <p className="hint">
              {t(o.bottleneck === "beton" ? "Asosiy cheklov — kunlik beton hajmi. Beton qorishni ko'paytirish yoki smena qo'shish tezlashtiradi." : "Asosiy cheklov — qoliplar soni. Qo'shimcha qolip yoki aylanishni tezlashtirish (bug'lash) yordam beradi.")}
            </p>
          )}
          {res.affected.length > 0 && (
            <div className="affected">
              <strong>{t("Boshqa buyurtmalarga ta'siri:")}</strong>
              <ul>
                {res.affected.map((a) => (
                  <li key={a.id} className={a.becomesLate ? "late" : ""}>
                    №{a.no} {a.customer} ({code(a.productId)}): {dmy(a.finishBefore)} → {dmy(a.finishAfter)}
                    {a.becomesLate && ` — ${t("muddatdan kechikadi")}`}
                  </li>
                ))}
              </ul>
              {res.finishWithoutDelay && (
                <p className="hint">
                  {t("Boshqa buyurtmalarni kechiktirmasdan (navbatning oxirida) bu buyurtma {d} kuni tugaydi.", { d: dmy(res.finishWithoutDelay) })}
                </p>
              )}
            </div>
          )}
          {canEdit && (
            <div className="whatif-save">
              <input id="wi-c" placeholder={t("Buyurtmachi")} value={f.customer} onChange={(e) => setF((x) => ({ ...x, customer: e.target.value }))} aria-label={t("Buyurtmachi")} />
              <button type="button" className="btn" disabled={busy} onClick={create}>
                {t("Buyurtma sifatida saqlash")}
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

/** Ish kunlari, bayramlar va kunlik beton cheklovi (ПТО / admin) */
function PlanSettings({ plan, notify, onSaved }) {
  const t = useT();
  const [s, setS] = useState(() => ({ ...plan.settings, concretePerDay: plan.settings.concretePerDay || "" }));
  const [hday, setHday] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (d) => setS((x) => ({ ...x, workDays: x.workDays.includes(d) ? x.workDays.filter((y) => y !== d) : [...x.workDays, d].sort() }));

  async function save() {
    if (!s.workDays.length) return notify("Kamida bitta ish kuni tanlang");
    setBusy(true);
    try {
      await api("/settings", { method: "PUT", body: { plan: { concretePerDay: +s.concretePerDay || 0, workDays: s.workDays, holidays: s.holidays } } });
      notify("Saqlandi");
      await onSaved();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const future = s.holidays.filter((d) => d >= today());

  return (
    <details className="plan-set">
      <summary>{t("Rejalashtirish sozlamalari")}</summary>
      <div className="form-grid two">
        <div className="field">
          <label htmlFor="ps-c">
            {t("Kuniga beton, m³")} <span className="u">({t("0 — cheklanmagan")})</span>
          </label>
          <input id="ps-c" type="number" min="0" step="any" value={s.concretePerDay} onChange={(e) => setS((x) => ({ ...x, concretePerDay: e.target.value }))} />
        </div>
        <div className="field">
          <span className="lbl">{t("Ish kunlari")}</span>
          <div className="chips">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button type="button" key={d} className="chip" aria-pressed={s.workDays.includes(d)} onClick={() => toggle(d)}>
                {t(WEEK[d])}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="ps-h">{t("Dam olish / bayram kunlari")}</label>
          <div className="hday-row">
            <input id="ps-h" type="date" min={today()} value={hday} onChange={(e) => setHday(e.target.value)} />
            <button type="button" className="btn" disabled={!hday} onClick={() => {
              setS((x) => ({ ...x, holidays: [...new Set([...x.holidays, hday])].sort() }));
              setHday("");
            }}>
              {t("Qo'shish")}
            </button>
          </div>
          <div className="chips">
            {future.map((d) => (
              <button type="button" key={d} className="chip" title={t("O'chirish")} onClick={() => setS((x) => ({ ...x, holidays: x.holidays.filter((y) => y !== d) }))}>
                {dmy(d)} ×
              </button>
            ))}
          </div>
        </div>
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={save}>
        {busy ? t("Saqlanmoqda…") : t("Saqlash")}
      </button>
    </details>
  );
}

function planExcel(plan, code) {
  const rows = plan.orders.map((o) => ({
    no: o.no, customer: o.customer, contract: o.contractNo || "", product: code(o.productId), qty: o.qty, shipped: o.shipped, remaining: o.remaining, fromStock: o.fromStock,
    toProduce: o.toProduce, perDay: o.perDay || null, basis: basisText(o.basis, o.lid), need: o.needPerDay, start: o.start ? fmtDate(o.start) : "",
    finish: o.finish ? fmtDate(o.finish) : "", deadline: o.deadline ? fmtDate(o.deadline) : "", status: statusText(o),
    _cell: o.status === "late" || o.status === "nocap" || o.status === "far" ? { status: "bad", finish: "bad" } : o.status === "risk" ? { status: "warn" } : { status: "ok" },
  }));
  const days = [];
  for (const d of plan.days)
    for (const it of d.items) days.push({ date: fmtDate(d.date), wd: tr(wd(d.date)), product: code(it.productId), qty: it.qty, no: it.no || null, concrete: d.concrete || null });
  return {
    filename: `Buyurtmalar_rejasi_${fileDate()}.xlsx`,
    sheets: [
      {
        name: tr("Prognoz"),
        title: tr("Buyurtmalar bo'yicha prognoz"),
        subtitle: tr("Hisoblangan sana: {d}", { d: fmtDate(plan.today) }),
        columns: [
          { header: "№", key: "no", type: "int", width: 6 },
          { header: tr("Buyurtmachi"), key: "customer", width: 26 },
          { header: tr("Shartnoma №"), key: "contract", width: 12 },
          { header: tr("Mahsulot"), key: "product", width: 16 },
          { header: tr("Soni"), key: "qty", type: "int", total: "sum", width: 9 },
          { header: tr("Jo'natildi"), key: "shipped", type: "int", total: "sum", width: 11 },
          { header: tr("Qoldi"), key: "remaining", type: "int", total: "sum", width: 9 },
          { header: tr("Omborda tayyor"), key: "fromStock", type: "int", total: "sum", width: 11 },
          { header: tr("Ishlab chiqarish kerak"), key: "toProduce", type: "int", total: "sum", width: 13 },
          { header: tr("Quvvat, dona/kun"), key: "perDay", type: "num", width: 11 },
          { header: tr("Quvvat asosi"), key: "basis", width: 13 },
          { header: tr("Kerak, dona/kun"), key: "need", type: "int", width: 11 },
          { header: tr("Boshlanadi"), key: "start", type: "date", width: 12 },
          { header: tr("Tugaydi"), key: "finish", type: "date", width: 12 },
          { header: tr("Muddat"), key: "deadline", type: "date", width: 12 },
          { header: tr("Holat"), key: "status", width: 20 },
        ],
        rows,
      },
      {
        name: tr("Kunlik taklif"),
        title: tr("Kunlik ishlab chiqarish taklifi"),
        columns: [
          { header: tr("Sana"), key: "date", type: "date", width: 12 },
          { header: tr("Kun"), key: "wd", width: 6 },
          { header: tr("Mahsulot"), key: "product", width: 16 },
          { header: tr("Soni"), key: "qty", type: "int", total: "sum", width: 9 },
          { header: tr("Buyurtma №"), key: "no", type: "int", width: 11 },
          { header: tr("Beton kuniga, m³"), key: "concrete", type: "num", width: 14 },
        ],
        rows: days,
      },
    ],
  };
}
