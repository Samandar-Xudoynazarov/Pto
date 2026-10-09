"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import { setUnsaved } from "@/lib/dirty";
import { concreteVolume, fmt, fmtDate, fmtN, lidLinks, lsGet, lsSet, monthDays, productLabel, today } from "@/lib/calc";
import {
  applyPastFacts, applyProgramDays, emptyRow, exportMonthPlanXlsx, guessMonth, monthTitle, normalizePlan, parseBossExcel,
  rowLeft, rowOrdered, rowTotal, rowsFromOrders, shiftMonth, spreadRow, sum,
} from "@/lib/month-plan";
import { buildPlanPdf, deliverPdf, planPdfDefinition } from "@/lib/plan-pdf";
import DeleteButton from "./DeleteButton";
import Icon from "./Icon";
import MonthPlanMaterials from "./MonthPlanMaterials";

const WEEK = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
const SOURCE = { excel: "Excel'dan yuklangan", qolda: "Qo'lda tuzilgan", dastur: "Dastur taklifidan tuzilgan" };
const pad = (n) => String(n).padStart(2, "0");
const dateOf = (month, i) => `${month}-${pad(i + 1)}`;
const wdOf = (date) => new Date(date + "T00:00:00Z").getUTCDay();
const cellTxt = (v) => (v ? fmtN(v, 3) : "");

/**
 * Oylik reja (tasdiqlangan reja): Excel'dan yuklash, qo'lda tuzish, kunlik hisobotdagi fakt bilan solishtirish.
 */
export default function MonthPlan({ data, notify }) {
  const t = useT();
  const { canEdit, canPlan } = useUser(); // canPlan — tuzish/saqlash (usta ham), canEdit — o'chirish
  const { products, prods, mats, settings } = data;
  const [month, setMonthRaw] = useState(() => lsGet("pto.mplanMonth", today().slice(0, 7)));
  const [list, setList] = useState(null); // bazada saqlangan rejalar (oylar)
  const picked = useRef(lsGet("pto.mplanMonth", null) !== null); // foydalanuvchi oyni o'zi tanlaganmi
  const [saved, setSaved] = useState(undefined); // undefined — yuklanmoqda, null — reja yo'q
  const [dayDocs, setDayDocs] = useState([]);
  const [draft, setDraft] = useState(null);
  const [imp, setImp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showFact, setShowFact] = useState(() => lsGet("pto.mplanFact", true));
  const [range, setRange] = useState(() => lsGet("pto.mplanRange", "next"));
  const chooseRange = (v) => {
    setRange(v);
    lsSet("pto.mplanRange", v);
  };
  const fileRef = useRef(null);

  const n = monthDays(month);
  const todayS = today();
  const todayIdx = todayS.slice(0, 7) === month ? +todayS.slice(8, 10) - 1 : todayS < `${month}-01` ? -1 : n; // n — oy o'tib ketgan
  const cfg = settings?.plan || {};
  const workDays = Array.isArray(cfg.workDays) && cfg.workDays.length ? cfg.workDays : [1, 2, 3, 4, 5, 6];
  const holidays = useMemo(() => new Set(cfg.holidays || []), [cfg.holidays]);
  const isOff = useCallback((date) => !workDays.includes(wdOf(date)) || holidays.has(date), [workDays, holidays]);
  const limit = +cfg.concretePerDay || 0;

  const setMonth = (m) => {
    if (draft && !window.confirm(tr("Saqlanmagan o'zgarishlar bor. Ularni tashlab ketasizmi?"))) return;
    setDraft(null);
    setUnsaved(false);
    picked.current = true;
    setMonthRaw(m);
    lsSet("pto.mplanMonth", m);
  };

  const load = useCallback(async () => {
    setSaved(undefined);
    setErr("");
    try {
      const [r, d] = await Promise.all([api(`/month-plans/${month}`), api(`/days?month=${month}`)]);
      setSaved(r.plan ? normalizePlan(r.plan, month) : null);
      setDayDocs(d || []);
    } catch (e) {
      setErr(t(e.message));
      setSaved(null);
    }
  }, [month, t]);
  useEffect(() => {
    load();
  }, [load]);
  // saqlangan rejalar ro'yxati. Oy tanlanmagan bo'lsa va joriy oyga reja yo'q bo'lsa —
  // eng yaqin saqlangan rejali oy ochiladi (Excel boshqa oyga, masalan o'tgan oyga saqlangan bo'lishi mumkin)
  const loadList = useCallback(async () => {
    try {
      const l = await api("/month-plans");
      setList(l);
      if (!picked.current && l.length && !l.some((x) => x.month === month)) {
        const cur = today().slice(0, 7);
        const best = l.filter((x) => x.month <= cur).sort((a, b) => b.month.localeCompare(a.month))[0] || l[l.length - 1];
        picked.current = true;
        setMonthRaw(best.month);
      }
    } catch {
      setList([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadList();
  }, [loadList]);
  useEffect(() => () => setUnsaved(false), []);
  useEffect(() => {
    if (!draft) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  // kunlik hisobotdagi fakt: mahsulot → [kunlar]
  const facts = useMemo(() => {
    const m = new Map();
    for (const d of dayDocs) {
      const i = +d.date.slice(8, 10) - 1;
      for (const l of d.production || []) {
        const id = String(l.productId);
        if (!m.has(id)) m.set(id, Array(n).fill(0));
        m.get(id)[i] += +l.fact || 0;
      }
    }
    return m;
  }, [dayDocs, n]);

  const plan = draft || saved;
  const editing = !!draft;
  const zeros = useMemo(() => Array(n).fill(0), [n]);
  // katalogga bog'langan mahsulot — fakt bor (hisobotda bo'lmasa — 0), bog'lanmagan — fakt yo'q
  const factOf = (r) => (r.productId ? facts.get(r.productId) || zeros : null);

  /* ---------- tahrirlash ---------- */
  const change = (fn) => {
    setDraft((d) => fn(structuredClone(d)));
    setUnsaved(true);
  };
  const startDraft = (p, source) => {
    setDraft({ ...normalizePlan({ customers: [], extraCols: [], rows: [], ...p }, month), source: source || p?.source || "qolda" });
    setUnsaved(true);
  };
  const cancel = () => {
    if (!window.confirm(tr("Saqlanmagan o'zgarishlar bor. Ularni tashlab ketasizmi?"))) return;
    setDraft(null);
    setUnsaved(false);
  };
  async function save(p = draft, targetMonth = month) {
    const bad = p.rows.findIndex((r) => !r.productId && !r.name.trim());
    if (bad >= 0) return notify(tr("{n}-qatorda mahsulot tanlanmagan", { n: bad + 1 }));
    setBusy(true);
    try {
      const body = { ...p, rows: p.rows.map(({ _excelRow, ...r }) => ({ ...r, productId: r.productId || null })) };
      const doc = await api(`/month-plans/${targetMonth}`, { method: "PUT", body });
      setUnsaved(false);
      setDraft(null);
      if (targetMonth !== month) {
        setMonthRaw(targetMonth);
        lsSet("pto.mplanMonth", targetMonth);
      } else setSaved(normalizePlan(doc, month));
      notify(tr("{m} oyi uchun reja saqlandi — hamma foydalanuvchilarga ko'rinadi", { m: monthTitle(targetMonth) }));
      picked.current = true;
      loadList();
      return true;
    } catch (e) {
      notify(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    try {
      await api(`/month-plans/${month}`, { method: "DELETE" });
      setSaved(null);
      notify("O'chirildi");
      loadList();
    } catch (e) {
      notify(e.message);
    }
  }

  // yaratish usullari
  const fromOrders = (base) => rowsFromOrders(data.orders, products, mats, month, base);
  async function fromProgram(base) {
    setBusy(true);
    try {
      const p = await api("/plan?days=80");
      const withRows = fromOrders(base || { customers: [], extraCols: [], rows: [] });
      const prog = applyProgramDays(normalizePlan(withRows, month), p.days, month);
      // bugundan oldingi kunlar — kunlik hisobotdagi haqiqiy fakt
      const out = applyPastFacts(prog, facts, todayIdx, products, mats);
      if (!prog.cells && !out.pastCells) notify("Dastur taklifida bu oyga ish chiqmadi — faqat buyurtmalar qo'shildi");
      return out;
    } catch (e) {
      notify(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    try {
      const r = await parseBossExcel(await f.arrayBuffer(), products, mats);
      setImp({ ...r, fileName: f.name, month: guessMonth(r.prevMonthIdx, month) });
    } catch (e2) {
      notify(e2.message || "Faylni o'qib bo'lmadi");
    } finally {
      setBusy(false);
    }
  }

  // Kunlik reja PDF — «Dastur rejasi»dagi kabi kalendar (A4), mahsulot tagida o'tgan kunlar uchun fakt
  const [pdfBusy, setPdfBusy] = useState(false);
  async function makePdf(share) {
    if (!plan || !stats) return;
    setPdfBusy(true);
    try {
      const from = isCurMonth && range === "next" ? todayIdx : 0;
      const days = [];
      for (let i = from; i < n; i++) {
        const items = [];
        plan.rows.forEach((r, ri) => {
          const q = +r.days[i] || 0;
          const f = factOf(r);
          // o'tgan kunlar — fakt (0 bo'lsa ham); bugun — faqat allaqachon quyilgan bo'lsa (kun hali tugamagan)
          const fv = !f ? null : i < todayIdx ? f[i] || 0 : i === todayIdx && f[i] > 0 ? f[i] : null;
          if (q > 0 || (fv && i < todayIdx)) items.push({ key: ri, productId: r.productId || null, label: (r.productId && prods.get(r.productId)?.code) || r.name, qty: q, fact: fv, today: i === todayIdx });
        });
        if (items.length) days.push({ date: dateOf(month, i), items, concrete: stats.dayM3[i] });
      }
      const C = { head: "#1F3A68", soft: "#EEF2F8", ok: "#15803D", okBg: "#DCFCE7", warn: "#B45309", warnBg: "#FEF3C7", bad: "#B91C1C" };
      const pct = stats.planToDate ? `${fmtN((stats.factToDate / stats.planToDate) * 100, 0)} %` : "—";
      const def = planPdfDefinition(
        { days, today: isCurMonth ? todayS : "", settings: { workDays, holidays: [...holidays] } },
        {
          company: settings?.company,
          prods,
          mats,
          limit,
          concreteIsTotal: true,
          title: `${tr("Kunlik ishlab chiqarish rejasi")} — ${monthTitle(month)}`,
          headerRight: tr("Tasdiqlangan reja"),
          scope: `${tr(SOURCE[plan.source] || SOURCE.qolda)}${plan.fileName ? ` (${plan.fileName})` : ""}`,
          kpis: [
            ["Oylik reja", `${fmt(stats.total)} ${tr("dona")}`, C.head, C.soft],
            ["Beton, m³", fmtN(stats.m3, 1), C.head, C.soft],
            [todayIdx >= n ? "Bajarildi (oy bo'yicha)" : "Bajarildi (kechagacha)", pct, stats.planToDate && stats.factToDate < stats.planToDate ? C.warn : C.ok, stats.planToDate && stats.factToDate < stats.planToDate ? C.warnBg : C.okBg],
            ["Rejadan keyin buyurtma qoldig'i", `${fmt(stats.left)} ${tr("dona")}`, C.head, C.soft],
          ],
          subOf: (r) =>
            r.fact == null
              ? null
              : !r.qty
                ? { text: tr("rejadan tashqari: {n}", { n: fmt(r.fact) }), color: C.warn }
                : { text: `${tr("fakt")} ${fmt(r.fact)}`, color: r.fact >= r.qty ? C.ok : r.today ? undefined : C.bad },
          legend: tr("Har katakda: mahsulot va rejadagi soni (dona); o'tgan kunlarda tagida — kunlik hisobotdagi fakt (yashil — bajarildi, qizil — kam). Pastki satr — kun bo'yicha jami va beton hajmi."),
          extraContent: ({ cell, head, tableLayout, pageBreak }) => [
            { text: tr("Mahsulotlar bo'yicha"), fontSize: 13, bold: true, color: C.head, margin: [0, 8, 0, 6], pageBreak },
            {
              table: {
                headerRows: 1,
                widths: ["*", 70, 60, 60, 60, 60, 50],
                body: [
                  [head("Mahsulot"), head("Buyurtma", "right"), head("Jo'natildi", "right"), head("Oylik reja", "right"), head("Fakt", "right"), head("Qoldiq", "right"), head("m³", "right")],
                  ...plan.rows.map((r, i) => {
                    const fill = i % 2 ? "#F9FAFB" : undefined;
                    const f = factOf(r);
                    const left = rowLeft(r);
                    return [
                      cell(`${(r.productId && prods.get(r.productId)?.code) || ""}${r.productId ? "  " : ""}${r.name}`, { fill, size: 8.5 }),
                      cell(fmt(rowOrdered(r)), { align: "right", fill }),
                      cell(fmt(r.shipped), { align: "right", fill }),
                      cell(fmt(rowTotal(r)), { align: "right", fill, bold: true }),
                      cell(f ? fmt(sum(f)) : "—", { align: "right", fill }),
                      cell(fmt(left), { align: "right", fill, color: left < 0 ? C.bad : undefined }),
                      cell(fmtN(rowTotal(r) * (+r.m3 || 0), 1), { align: "right", fill }),
                    ];
                  }),
                ],
              },
              layout: tableLayout,
            },
          ],
        },
        { days: 999 }
      );
      const blob = await buildPlanPdf(def);
      const r = await deliverPdf(blob, `Tasdiqlangan_reja_${month}.pdf`, { share });
      if (r === "downloaded-fallback") notify("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
    } catch (e) {
      notify(e.message || "PDF tayyorlab bo'lmadi");
    } finally {
      setPdfBusy(false);
    }
  }

  async function doExport(share) {
    try {
      const r = await exportMonthPlanXlsx(plan, { company: settings?.company, facts: showFact ? facts : null, isOff, share });
      if (r === "downloaded-fallback") notify("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
    } catch (e) {
      notify(e.message || "Excel faylni tayyorlab bo'lmadi");
    }
  }

  /* ---------- hisoblar ---------- */
  const stats = useMemo(() => {
    if (!plan) return null;
    const dayPlan = Array(n).fill(0);
    const dayM3 = Array(n).fill(0);
    const dayFact = Array(n).fill(0);
    let planToDate = 0;
    let factToDate = 0;
    const upto = Math.min(todayIdx, n); // bugundan oldingi kunlar (bugun hali tugamagan)
    for (const r of plan.rows) {
      const f = factOf(r);
      r.days.forEach((v, i) => {
        dayPlan[i] += v;
        dayM3[i] += v * (+r.m3 || 0);
        if (f) dayFact[i] += f[i];
        if (i < upto) {
          planToDate += v;
          if (f) factToDate += Math.min(f[i], v);
        }
      });
    }
    const total = sum(dayPlan);
    const m3 = sum(dayM3);
    const left = plan.rows.reduce((s, r) => s + Math.max(0, rowLeft(r)), 0);
    return { dayPlan, dayM3, dayFact, total, m3, left, planToDate, factToDate };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, facts, n, todayIdx]);

  const isCurMonth = todayIdx >= 0 && todayIdx < n;
  const plannedDays = stats ? stats.dayPlan.filter((v) => v > 0).length : 0;

  /* ---------- ko'rinish ---------- */
  const meta = saved && !editing && (
    <span className="mp-meta">
      <span className={`pill mp-src-${saved.source}`}>{t(SOURCE[saved.source] || SOURCE.qolda)}</span>
      {saved.fileName && <span className="muted">{saved.fileName}</span>}
      {saved.updatedAt && (
        <span className="muted">
          {fmtDate(String(saved.updatedAt).slice(0, 10))}
          {saved.updatedBy?.name ? ` · ${saved.updatedBy.name}` : ""}
        </span>
      )}
    </span>
  );

  return (
    <div className="mp">
      <div className="mp-head">
        <div className="mp-month">
          <button type="button" className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("Oldingi oy")}>
            <Icon name="chevL" />
          </button>
          <label className="mp-month-l">
            <span>{monthTitle(month)}</span>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("Oy")} />
          </label>
          <button type="button" className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("Keyingi oy")}>
            <Icon name="chevR" />
          </button>
          {meta}
          {editing && <span className="pill st-jarayonda">{t("Tahrirlanmoqda")}</span>}
        </div>
        <div className="mp-acts">
          {editing ? (
            <>
              <button type="button" className="btn" onClick={cancel} disabled={busy}>
                {t("Bekor qilish")}
              </button>
              <button type="button" className="btn primary" onClick={() => save()} disabled={busy}>
                <Icon name="save" /> {busy ? t("Saqlanmoqda…") : t("Saqlash")}
              </button>
            </>
          ) : (
            <>
              {canPlan && (
                <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Icon name="upload" /> {t("Excel'dan yuklash")}
                </button>
              )}
              {canPlan && saved && (
                <button type="button" className="btn primary" onClick={() => startDraft(saved)}>
                  <Icon name="edit" /> {t("Tahrirlash")}
                </button>
              )}
              {saved && (
                <span className="export-btns">
                  <button type="button" className="btn" onClick={() => makePdf(false)} disabled={pdfBusy || !saved.rows.length} title={isCurMonth && range === "next" ? t("Bugundan oy oxirigacha") : t("Butun oy")}>
                    <Icon name="download" /> {pdfBusy ? t("Tayyorlanmoqda…") : t("Kunlik reja (PDF)")}
                  </button>
                  <button type="button" className="btn" onClick={() => makePdf(true)} disabled={pdfBusy || !saved.rows.length} aria-label={t("PDF ni ulashish")}>
                    <Icon name="share" />
                  </button>
                </span>
              )}
              {saved && (
                <span className="export-btns">
                  <button type="button" className="btn" onClick={() => doExport(false)} title={t("Excel faylni yuklab olish")}>
                    <Icon name="download" /> Excel
                  </button>
                  <button type="button" className="btn" onClick={() => doExport(true)} aria-label={t("Ulashish")} title={t("Telegram, pochta va boshqalarga yuborish")}>
                    <Icon name="share" />
                  </button>
                </span>
              )}
              {canEdit && saved && <DeleteButton onConfirm={remove} />}
            </>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden onChange={onFile} />
        </div>
      </div>

      {err && <p className="err">{err}</p>}

      {saved === undefined ? (
        <div className="empty">{t("Yuklanmoqda…")}</div>
      ) : !plan ? (
        <EmptyStart
          list={list}
          onPick={setMonth}
          canEdit={canPlan}
          busy={busy}
          month={month}
          onExcel={() => fileRef.current?.click()}
          onEmpty={() => startDraft({ customers: [], extraCols: [], rows: [] }, "qolda")}
          onOrders={() => {
            const r = fromOrders({ customers: [], extraCols: [], rows: [] });
            if (!r.rows.length) notify("Faol buyurtma yo'q.");
            startDraft(r, "qolda");
          }}
          onProgram={async () => {
            const r = await fromProgram();
            if (r) startDraft(r, "dastur");
          }}
        />
      ) : (
        <>
          {!editing && stats && (
            <div className="kpis">
              <div className="kpi">
                <div className="k">{t("Oylik reja")}</div>
                <div className="v">
                  {fmt(stats.total)} <small>{t("dona")}</small>
                </div>
                <div className="kpi-sub">{fmtN(stats.m3, 1)} {t("m³ beton")} · {plan.rows.length} {t("mahsulot")}</div>
              </div>
              <div className={`kpi ${!stats.planToDate ? "" : stats.factToDate < stats.planToDate ? "kpi-risk" : "kpi-in"}`}>
                <div className="k">{todayIdx >= n ? t("Bajarildi (oy bo'yicha)") : t("Bajarildi (kechagacha)")}</div>
                <div className="v">{stats.planToDate ? `${fmtN((stats.factToDate / stats.planToDate) * 100, 0)} %` : "—"}</div>
                <div className="kpi-sub">
                  {fmt(stats.factToDate)} / {fmt(stats.planToDate)} {t("dona")}
                </div>
              </div>
              {isCurMonth ? (
                <div className="kpi">
                  <div className="k">{t("Bugungi reja")}</div>
                  <div className="v">
                    {fmt(stats.dayPlan[todayIdx])} <small>{t("dona")}</small>
                  </div>
                  <div className="kpi-sub">{`${fmtN(stats.dayM3[todayIdx], 2)} ${t("m³ beton")}`}</div>
                </div>
              ) : (
                <div className="kpi">
                  <div className="k">{t("Kuniga o'rtacha")}</div>
                  <div className="v">
                    {plannedDays ? fmtN(stats.total / plannedDays, 1) : "—"} <small>{t("dona")}</small>
                  </div>
                  <div className="kpi-sub">{t("{n} kunga reja bor", { n: plannedDays })} · {plannedDays ? fmtN(stats.m3 / plannedDays, 1) : 0} {t("m³ beton")}</div>
                </div>
              )}
              <div className={`kpi ${stats.left ? "" : "kpi-in"}`}>
                <div className="k">{t("Rejadan keyin buyurtma qoldig'i")}</div>
                <div className="v">
                  {fmt(stats.left)} <small>{t("dona")}</small>
                </div>
                <div className="kpi-sub">{t("Остаток заказа")}</div>
              </div>
            </div>
          )}

          <div className="mp-tools">
            {editing ? (
              <EditTools
                busy={busy}
                onOrders={() => {
                  const r = fromOrders(draft);
                  change((d) => ({ ...d, ...normalizePlan(r, month), source: d.source }));
                  notify(tr("{n} ta yangi mahsulot qo'shildi", { n: r.added }));
                }}
                onProgram={async () => {
                  if (!window.confirm(tr("Dastur taklifidagi kunlar shu rejaga yoziladi (bugundan boshlab, o'sha mahsulotlar ustiga). Davom etamizmi?"))) return;
                  const base = { ...draft, rows: draft.rows.map((r) => ({ ...r, days: r.days.map((v, i) => (i >= Math.max(0, todayIdx) ? 0 : v)) })) };
                  const r = await fromProgram(base);
                  if (r) change(() => ({ ...normalizePlan(r, month), source: draft.source, title: draft.title, fileName: draft.fileName }));
                }}
                onPast={todayIdx > 0 ? () => {
                  const r = applyPastFacts(draft, facts, todayIdx, products, mats);
                  change(() => ({ ...normalizePlan(r, month), source: draft.source, title: draft.title, fileName: draft.fileName }));
                  notify(tr("O'tgan kunlar kunlik hisobotdan olindi ({n} ta yozuv)", { n: r.pastCells }));
                } : null}
              />
            ) : (
              <div className="chips">
                {isCurMonth && (
                  <>
                    <button type="button" className="chip" aria-pressed={range === "next"} onClick={() => chooseRange("next")}>
                      {t("Bugundan boshlab")}
                    </button>
                    <button type="button" className="chip" aria-pressed={range === "all"} onClick={() => chooseRange("all")}>
                      {t("Butun oy")}
                    </button>
                  </>
                )}
                <button type="button" className="chip" aria-pressed={showFact} onClick={() => (setShowFact(!showFact), lsSet("pto.mplanFact", !showFact))}>
                  {t("Fakt bilan solishtirish")}
                </button>
              </div>
            )}
            {!editing && showFact && (
              <div className="mp-legend">
                <span><i className="lg-ok" />{t("bajarildi")}</span>
                <span><i className="lg-bad" />{t("kam")}</span>
                <span><i className="lg-extra" />{t("rejadan tashqari")}</span>
              </div>
            )}
          </div>

          <Calendar
            plan={plan}
            n={n}
            month={month}
            editing={editing}
            showFact={showFact && !editing}
            range={isCurMonth ? range : "all"}
            factOf={factOf}
            isOff={isOff}
            todayIdx={todayIdx}
            stats={stats}
            limit={limit}
            products={products}
            prods={prods}
            mats={mats}
            change={change}
          />

          <Summary plan={plan} editing={editing} showFact={showFact && !editing} factOf={factOf} products={products} prods={prods} mats={mats} change={change} n={n} todayIdx={todayIdx} isOff={isOff} month={month} />

          <MonthPlanMaterials plan={plan} month={month} n={n} todayIdx={todayIdx} data={data} notify={notify} editing={editing} />

          {!editing && plan.rows.some((r) => !r.productId) && (
            <p className="hint warn-text">
              {t("Katalog bilan bog'lanmagan mahsulotlar bor ({n} ta) — ular uchun fakt ko'rsatilmaydi. «Tahrirlash» → «Mahsulotlar bo'yicha»da katalogdan tanlang.", { n: plan.rows.filter((r) => !r.productId).length })}
            </p>
          )}
        </>
      )}

      {imp && (
        <ImportDialog
          imp={imp}
          setImp={setImp}
          products={products}
          busy={busy}
          onClose={() => setImp(null)}
          onOpen={(p) => {
            setImp(null);
            if (p.month !== month) {
              setMonthRaw(p.month);
              lsSet("pto.mplanMonth", p.month);
            }
            setTimeout(() => startDraftFor(p), 0);
          }}
          onSave={async (p) => {
            if (await save(p, p.month)) setImp(null);
          }}
        />
      )}
    </div>
  );

  // Import oynasidan «Tahrirlashda ochish» — oy almashganda ham to'g'ri kunlar soni bilan
  function startDraftFor(p) {
    setDraft({ ...normalizePlan(p, p.month), source: "excel" });
    setUnsaved(true);
  }
}

/* ================= bo'sh oy: reja tuzish usullari ================= */
function EmptyStart({ list, onPick, canEdit, busy, month, onExcel, onEmpty, onOrders, onProgram }) {
  const t = useT();
  const others = (list || []).filter((x) => x.month !== month);
  const savedList = others.length > 0 && (
    <div className="mp-saved">
      <span className="muted">{t("Saqlangan rejalar:")}</span>
      <div className="chips">
        {others.map((x) => (
          <button key={x.month} type="button" className="chip" onClick={() => onPick(x.month)}>
            {monthTitle(x.month)} · {fmt(x.total)} {t("dona")}
          </button>
        ))}
      </div>
    </div>
  );
  if (!canEdit)
    return (
      <>
        <div className="empty">{t("{m} oyiga reja kiritilmagan.", { m: monthTitle(month) })}</div>
        {savedList}
      </>
    );
  const opts = [
    ["upload", "Excel'dan yuklash", "Tasdiqlangan reja Excel faylini tanlang — mahsulotlar katalog bilan avtomatik bog'lanadi, saqlashdan oldin ko'rib chiqasiz.", onExcel],
    ["grid", "Qo'lda tuzish", "Bo'sh jadval: mahsulot, buyurtmachi va kunlarni o'zingiz kiritasiz. Excel'dan nusxalab qo'yish ham mumkin.", onEmpty],
    ["ord", "Buyurtmalardan", "Faol buyurtmalar qatorlarga qo'yiladi (buyurtmachi, soni, jo'natilgani) — kunlarni o'zingiz taqsimlaysiz.", onOrders],
    ["auto", "Dastur taklifidan", "Dastur hisoblagan kunlik taklif shu oyga ko'chiriladi — keyin xohlagancha tuzatasiz.", onProgram],
  ];
  return (
    <div className="mp-start">
      <div className="mp-start-h">
        <strong>{t("{m} oyiga reja hali yo'q", { m: monthTitle(month) })}</strong>
        <span className="muted">{t("Qanday boshlaymiz?")}</span>
      </div>
      {savedList}
      <div className="mp-start-grid">
        {opts.map(([ic, title, text, fn]) => (
          <button key={title} type="button" className="mp-opt" onClick={fn} disabled={busy}>
            <span className="mp-opt-ic">
              <Icon name={ic} size={20} />
            </span>
            <strong>{t(title)}</strong>
            <span>{t(text)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================= tahrirlash asboblari ================= */
function EditTools({ busy, onOrders, onProgram, onPast }) {
  const t = useT();
  return (
    <div className="mp-edit-tools">
      <button type="button" className="btn sm" onClick={onOrders} disabled={busy}>
        <Icon name="ord" size={14} /> {t("Faol buyurtmalardan qo'shish")}
      </button>
      <button type="button" className="btn sm" onClick={onProgram} disabled={busy}>
        <Icon name="auto" size={14} /> {t("Kunlarni dastur taklifidan to'ldirish")}
      </button>
      {onPast && (
        <button type="button" className="btn sm" onClick={onPast} disabled={busy} title={t("Bugundan oldingi kunlarga kunlik hisobotdagi fakt yoziladi")}>
          <Icon name="day" size={14} /> {t("O'tgan kunlarni hisobotdan olish")}
        </button>
      )}
    </div>
  );
}

const dmy = (s) => `${fmtDate(s).slice(0, 5)} ${tr(WEEK[wdOf(s)])}`;
const codeOf = (r, prods) => (r.productId && prods.get(r.productId)?.code) || r.name || "—";
const SHOW = 12;

/* ================= kunlik kalendar («Dastur rejasi»dagi kartochkalar kabi) ================= */
function Calendar({ plan, n, month, editing, showFact, range, factOf, isOff, todayIdx, stats, limit, products, prods, mats, change }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(() => new Set()); // tahrirlashda qo'shilgan (hali 0 bo'lgan) qatorlar: "kun:qator"
  useEffect(() => {
    setAll(false);
    setOpen(new Set());
  }, [month, editing]);

  const days = Array.from({ length: n }, (_, i) => {
    const date = dateOf(month, i);
    const items = plan.rows
      .map((r, ri) => ({ r, ri, q: +r.days[i] || 0, f: factOf(r)?.[i] || 0 }))
      .filter((x) => x.q > 0 || (editing && open.has(`${i}:${x.ri}`)) || (showFact && x.f > 0 && i <= todayIdx));
    return { i, date, off: isOff(date), items };
  });
  let list = editing ? days : days.filter((d) => d.items.length);
  if (!editing && range === "next") list = list.filter((d) => d.i >= todayIdx);
  const shown = all ? list : list.slice(0, editing ? 14 : SHOW);

  const setQty = (i, ri, v) => change((d) => ((d.rows[ri].days[i] = v), d));
  const addTo = (i, val) => {
    if (!val) return;
    if (val.startsWith("r:")) {
      const ri = +val.slice(2);
      const b = lids.get(plan.rows[ri]?.productId)?.batch;
      if (b) setQty(i, ri, b);
      setOpen((s) => new Set(s).add(`${i}:${ri}`));
      return;
    }
    const p = prods.get(val.slice(2));
    if (!p) return;
    const ri = plan.rows.length;
    change((d) => {
      const row = { ...emptyRow(n), productId: p.id, name: autoName(p), orders: d.customers.map(() => 0), extra: d.extraCols.map(() => 0), m3: Math.round(concreteVolume(p, mats) * 1000) / 1000 };
      if (lids.get(p.id)) row.days[i] = lids.get(p.id).batch;
      d.rows.push(row);
      return d;
    });
    setOpen((s) => new Set(s).add(`${i}:${ri}`));
  };
  const copyPrev = (i) =>
    change((d) => {
      d.rows.forEach((r) => (r.days[i] = r.days[i - 1] || 0));
      return d;
    });
  const inPlan = new Set(plan.rows.map((r) => r.productId).filter(Boolean));
  const lids = useMemo(() => lidLinks(products), [products]);

  return (
    <>
      <h2 className="plan-h">{t(editing ? "Kunlar bo'yicha reja" : "Kunlik reja")}</h2>
      <p className="hint">
        {t(
          editing
            ? "Har kunga mahsulot qo'shing va sonini yozing. «Oldingi kundan» — bir kun oldingi rejani nusxalaydi."
            : "Tasdiqlangan reja kunma-kun: qaysi kuni qaysi mahsulotdan nechta. O'tgan kunlarda kunlik hisobotdagi fakt ham ko'rsatiladi."
        )}
      </p>
      <div className="plan-days">
        {shown.map((d) => {
          const m3 = stats?.dayM3[d.i] || 0;
          const past = d.i < todayIdx;
          const isToday = d.i === todayIdx;
          const dayPlan = stats?.dayPlan[d.i] || 0;
          const dayFact = stats?.dayFact[d.i] || 0;
          return (
            <div key={d.i} className={`plan-day${isToday ? " today" : ""}${d.off ? " mp-off" : ""}${editing ? " mp-eday" : ""}`}>
              <div className="plan-day-h">
                <strong>{dmy(d.date)}</strong>
                <span className={`muted${limit && m3 > limit + 1e-9 ? " warn-text" : ""}`}>
                  {d.off && !d.items.length ? t("dam olish") : m3 > 0 ? `${fmtN(m3, 2)}${limit ? ` / ${fmtN(limit, 1)}` : ""} ${t("m³ beton")}` : ""}
                </span>
              </div>
              {d.items.map(({ r, ri, q, f }) => {
                const hasFact = showFact && !!factOf(r) && (past || isToday);
                const cls = !hasFact ? "" : q && f >= q ? " ok" : q && f < q ? (past ? " bad" : "") : f ? " extra" : "";
                return (
                  <div key={ri} className={`plan-item${cls}`}>
                    <span className="code" title={r.name}>{codeOf(r, prods)}</span>
                    {editing ? (
                      <>
                        <input
                          className={`mp-qty${lids.get(r.productId) && q % lids.get(r.productId).batch ? " bad" : ""}`}
                          title={lids.get(r.productId) ? t("Qopqoq: kuniga {n} ta yoki 0 («{h}» qolibida)", { n: lids.get(r.productId).batch, h: lids.get(r.productId).hostCode }) : undefined}
                          type="number"
                          inputMode="numeric"
                          min="0"
                          step={lids.get(r.productId)?.batch || 1}
                          value={q || ""}
                          placeholder="0"
                          onChange={(e) => setQty(d.i, ri, Math.max(0, +e.target.value || 0))}
                          aria-label={t("Soni")}
                        />
                        <button
                          type="button"
                          className="mp-x"
                          title={t("Olib tashlash")}
                          onClick={() => {
                            setQty(d.i, ri, 0);
                            setOpen((s) => {
                              const x = new Set(s);
                              x.delete(`${d.i}:${ri}`);
                              return x;
                            });
                          }}
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <>
                        <strong>{q ? `${fmt(q)} ${t("dona")}` : "—"}</strong>
                        {hasFact && <span className="mp-f">{t("fakt")} {fmt(f)}</span>}
                      </>
                    )}
                  </div>
                );
              })}
              {!editing && showFact && (past || isToday) && dayPlan > 0 && (
                <div className="mp-day-prog" title={t("Fakt: {n}", { n: fmt(dayFact) })}>
                  <span className="mp-prog">
                    <i style={{ width: `${Math.min(100, (dayFact / dayPlan) * 100)}%` }} className={dayFact < dayPlan && past ? "bad" : ""} />
                  </span>
                  <span className="muted">{fmtN((dayFact / dayPlan) * 100, 0)} %</span>
                </div>
              )}
              {editing && (
                <div className="mp-eday-f">
                  <select className="mp-add" value="" onChange={(e) => addTo(d.i, e.target.value)} aria-label={t("Mahsulot qo'shish")}>
                    <option value="">{t("+ mahsulot qo'shish")}</option>
                    {plan.rows.some((r, ri) => !d.items.some((x) => x.ri === ri)) && (
                      <optgroup label={t("Rejadagi mahsulotlar")}>
                        {plan.rows.map((r, ri) =>
                          d.items.some((x) => x.ri === ri) ? null : (
                            <option key={ri} value={`r:${ri}`}>
                              {codeOf(r, prods)}
                              {r.name && r.productId ? ` — ${r.name}` : ""}
                            </option>
                          )
                        )}
                      </optgroup>
                    )}
                    <optgroup label={t("Katalogdan")}>
                      {products
                        .filter((p) => !inPlan.has(p.id))
                        .map((p) => (
                          <option key={p.id} value={`p:${p.id}`}>
                            {productLabel(p)}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                  {d.i > 0 && (
                    <button type="button" className="linkbtn" onClick={() => copyPrev(d.i)}>
                      {t("Oldingi kundan")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!list.length && <div className="empty">{t(range === "next" ? "Bugundan keyin rejada ish yo'q." : "Rejada ish yo'q.")}</div>}
      </div>
      {!all && list.length > shown.length && (
        <button type="button" className="btn sm more-days" onClick={() => setAll(true)}>
          {t("Yana {n} kunni ko'rsatish", { n: list.length - shown.length })}
        </button>
      )}
    </>
  );
}

/* ================= mahsulotlar bo'yicha jami (yig'iladigan) ================= */
function Summary({ plan, editing, showFact, factOf, products, prods, mats, change, n, todayIdx, isOff, month }) {
  const t = useT();
  const lids = useMemo(() => lidLinks(products), [products]);
  if (!plan.rows.length) return null;
  const workFrom = Array.from({ length: n }, (_, i) => i).filter((i) => i >= Math.max(0, Math.min(todayIdx, n)) && !isOff(dateOf(month, i)));
  return (
    <details className="plan-set mp-sum" open={editing || undefined}>
      <summary>
        {t("Mahsulotlar bo'yicha")} · {plan.rows.length}
      </summary>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("Mahsulot")}</th>
              <th className="n">{t("Buyurtma")}</th>
              <th className="n">{t("Jo'natildi")}</th>
              <th className="n">{t("Oylik reja")}</th>
              {showFact && <th className="n">{t("Fakt")}</th>}
              <th className="n" title="Остаток заказа">{t("Qoldiq")}</th>
              <th className="n">m³</th>
              {editing && <th />}
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r, ri) => {
              const total = rowTotal(r);
              const left = rowLeft(r);
              const f = factOf(r);
              const fTotal = f ? sum(f) : 0;
              const who = plan.customers.map((c, i) => (r.orders[i] ? `${c} ${fmt(r.orders[i])}` : "")).filter(Boolean).join(", ");
              const before = plan.extraCols.map((c, i) => (r.extra[i] ? `${c}: ${fmt(r.extra[i])}` : "")).filter(Boolean).join(", ");
              return (
                <tr key={ri}>
                  <td>
                    {editing ? (
                      <select
                        className={r.productId ? "" : "need"}
                        value={r.productId}
                        aria-label={t("Katalogdagi mahsulot")}
                        onChange={(e) => {
                          const np = prods.get(e.target.value);
                          change((d) => {
                            const row = d.rows[ri];
                            row.productId = e.target.value;
                            if (np && !row.m3) row.m3 = Math.round(concreteVolume(np, mats) * 1000) / 1000;
                            return d;
                          });
                        }}
                      >
                        <option value="">{t("— katalogdan tanlang —")}</option>
                        {products.map((x) => (
                          <option key={x.id} value={x.id}>
                            {productLabel(x)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="code">{codeOf(r, prods)}</span>
                    )}
                    <span className="sub">
                      {r.name}
                      {!r.productId && !editing ? ` · ${t("katalogda yo'q")}` : ""}
                    </span>
                  </td>
                  <td className="n">
                    {fmt(rowOrdered(r))}
                    {who && <span className="sub">{who}</span>}
                  </td>
                  <td className="n">
                    {fmt(r.shipped)}
                    {before && <span className="sub">{before}</span>}
                  </td>
                  <td className="n strong">{fmt(total)}</td>
                  {showFact && (
                    <td className="n">
                      {f ? fmt(fTotal) : "—"}
                      {f && total > 0 && (
                        <span className="mp-prog">
                          <i style={{ width: `${Math.min(100, (fTotal / total) * 100)}%` }} />
                        </span>
                      )}
                    </td>
                  )}
                  <td className={`n${left < 0 ? " warn-text" : left === 0 && rowOrdered(r) ? " ok" : ""}`} title={left < 0 ? t("Buyurtmadan ortiq rejalashtirilgan") : ""}>
                    {fmt(left)}
                  </td>
                  <td className="n">{fmtN(total * (+r.m3 || 0), 2)}</td>
                  {editing && (
                    <td>
                      <div className="acts">
                        <button type="button" className="btn sm" title={t("Qoldiqni bugundan oy oxirigacha ish kunlariga teng taqsimlash")} onClick={() => change((d) => ((d.rows[ri] = spreadRow(d.rows[ri], workFrom, lids.get(d.rows[ri].productId)?.batch || 0)), d))}>
                          <Icon name="spread" size={14} /> {t("Taqsimlash")}
                        </button>
                        <button type="button" className="btn sm danger" title={t("Mahsulotni rejadan o'chirish")} onClick={() => window.confirm(tr("Bu mahsulot butun oy rejasidan o'chiriladi. Davom etamizmi?")) && change((d) => (d.rows.splice(ri, 1), d))}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const autoName = (p) => (p ? `${p.name ? p.name + " " : ""}${p.code}` : "");

/* ================= Excel'dan yuklash: ko'rib chiqish oynasi ================= */
function ImportDialog({ imp, setImp, products, busy, onClose, onOpen, onSave }) {
  const t = useT();
  const ref = useRef(null);
  const [exists, setExists] = useState(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    let on = true;
    api(`/month-plans/${imp.month}`)
      .then((r) => on && setExists(r.plan ? r.plan : null))
      .catch(() => on && setExists(null));
    return () => {
      on = false;
    };
  }, [imp.month]);
  const nDays = monthDays(imp.month);
  const lost = imp.rows.reduce((s, r) => s + sum(r.days.slice(nDays)), 0);
  const linked = imp.rows.filter((r) => r.productId).length;
  const setRow = (i, pid) => setImp((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, productId: pid } : r)) }));
  const planOf = () => ({ month: imp.month, source: "excel", fileName: imp.fileName, title: "", customers: imp.customers, extraCols: imp.extraCols, rows: normalizePlan(imp, imp.month).rows });

  return (
    <dialog ref={ref} className="wide-dlg" onClose={onClose} onCancel={onClose}>
      <form method="dialog" onSubmit={(e) => e.preventDefault()}>
        <div className="mp-imp-h">
          <h2>{t("Excel'dan yuklash")}</h2>
          <span className="muted">
            {imp.fileName} · {t("varaq")} «{imp.sheet}»
          </span>
        </div>
        <div className="mp-imp-sum">
          <div className="field">
            <label htmlFor="imp-m">{t("Qaysi oy uchun reja")}</label>
            <input id="imp-m" type="month" value={imp.month} onChange={(e) => e.target.value && setImp((x) => ({ ...x, month: e.target.value }))} />
          </div>
          <div className="mp-imp-facts">
            <div>
              <strong>{imp.rows.length}</strong>
              <span>{t("qator")}</span>
            </div>
            <div className={linked === imp.rows.length ? "ok" : "warn-text"}>
              <strong>{linked}</strong>
              <span>{t("katalog bilan bog'landi")}</span>
            </div>
            <div>
              <strong>{fmt(imp.rows.reduce((s, r) => s + sum(r.days.slice(0, nDays)), 0))}</strong>
              <span>{t("dona rejada")}</span>
            </div>
            <div>
              <strong>{imp.customers.length}</strong>
              <span>{t("buyurtmachi")}</span>
            </div>
          </div>
        </div>
        {imp.prevMonthIdx >= 0 && <p className="hint">{t("Excel'da «{c}» ustuni bor — reja keyingi oy uchun deb taxmin qilindi. Kerak bo'lsa oyni o'zgartiring.", { c: imp.extraCols.find((c) => /остаток|qoldiq/i.test(c)) || imp.extraCols[0] })}</p>}
        {lost > 0 && <p className="notice">{t("Excel'da {d}-kungacha ustun bor, tanlangan oyda esa {n} kun — ortiqcha kunlardagi {q} dona olinmaydi.", { d: imp.maxDay, n: nDays, q: fmt(lost) })}</p>}
        {exists && <p className="notice">{t("Bu oyga reja allaqachon bor ({n} qator) — saqlasangiz, u almashtiriladi.", { n: exists.rows?.length || 0 })}</p>}
        <div className="field">
          <span className="lbl">
            {t("Buyurtmachilar")}: {imp.customers.join(", ") || "—"} · {t("Qo'shimcha ustunlar")}: {imp.extraCols.join(", ") || "—"}
          </span>
        </div>
        <div className="tbl-wrap scroll-y">
          <table className="edit mp-imp-table">
            <thead>
              <tr>
                <th>{t("Excel qatori")}</th>
                <th>{t("Excel'dagi nomi")}</th>
                <th>{t("Katalogdagi mahsulot")}</th>
                <th className="n">{t("Buyurtma")}</th>
                <th className="n">{t("Rejada")}</th>
                <th className="n">m³/{t("dona")}</th>
              </tr>
            </thead>
            <tbody>
              {imp.rows.map((r, i) => (
                <tr key={i} className={r.productId ? "" : "mp-unlinked"}>
                  <td className="num muted">{r._excelRow}</td>
                  <td>{r.name}</td>
                  <td className="wide">
                    <select value={r.productId} onChange={(e) => setRow(i, e.target.value)} className={r.productId ? "" : "need"} aria-label={t("Katalogdagi mahsulot")}>
                      <option value="">{t("— bog'lanmagan (faqat nomi) —")}</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {productLabel(p)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="n">{fmt(rowOrdered(r))}</td>
                  <td className="n strong">{fmt(sum(r.days.slice(0, nDays)))}</td>
                  <td className="n">{r.m3 ? fmtN(r.m3, 3) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {linked < imp.rows.length && <p className="hint">{t("Bog'lanmagan qatorlar ham saqlanadi, lekin ular uchun kunlik hisobotdagi fakt ko'rsatilmaydi va «Kunlik hisobot»ga to'ldirilmaydi.")}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Bekor qilish")}
          </button>
          <button type="button" className="btn" onClick={() => onOpen(planOf())} disabled={busy}>
            <Icon name="edit" /> {t("Tahrirlashda ochish")}
          </button>
          <button type="button" className="btn primary" onClick={() => onSave(planOf())} disabled={busy}>
            <Icon name="save" /> {busy ? t("Saqlanmoqda…") : t("Saqlash")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
