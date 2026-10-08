"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { fmtDate, lsGet, lsSet } from "@/lib/calc";
import { buildPlanPdf, deliverPdf } from "@/lib/plan-pdf";
import { cyr, money, nakladnoyDefinition, nextNo } from "@/lib/nakladnoy-pdf";
import Icon from "./Icon";

const KEY = "pto.nakl"; // { lastNo, sender, sentBy, signature, drivers: { mashina: FIO }, copies, showSum }
const num = (v) => +String(v ?? "").replace(/\s/g, "").replace(",", ".") || 0;

/**
 * Накладная: kunlik hisobotdagi jo'natishlardan (bitta mashina + bitta qabul qiluvchi = bitta накладная).
 * ships — joriy jadvaldagi jo'natish qatorlari (saqlanmagan bo'lsa ham), date — hisobot sanasi.
 */
export default function NakladnoyDialog({ ships, date, data, notify, onClose }) {
  const t = useT();
  const { prods, mats, orders } = data;
  const ref = useRef(null);
  const saved = useMemo(() => lsGet(KEY, {}), []);

  // jo'natishlarni guruhlash: mashina + qayerga/buyurtmachi
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of ships) {
      if (!s.productId || !(num(s.qty) > 0)) continue;
      const o = orders.find((x) => x.id === s.orderId);
      const k = `${(s.vehicle || "").replace(/\s+/g, "").toUpperCase()}|${(s.customer || o?.customer || "").trim().toLowerCase()}`;
      if (!m.has(k)) m.set(k, { key: k, vehicle: s.vehicle || "", customer: s.customer || "", order: o || null, lines: [] });
      const g = m.get(k);
      g.order ||= o || null;
      g.lines.push({ ...s, order: o });
    }
    return [...m.values()];
  }, [ships, orders]);
  const [gk, setGk] = useState(groups[0]?.key || "");
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);

  // накладнаяda mahsulot faqat markasi (kodi) bilan; summa — qo'lda
  const line = (productId, qty) => ({ productId, name: prods.get(productId)?.code || "", unit: "шт", qty: String(num(qty)), sum: "" });
  const blank = () => ({ productId: "", name: "", unit: "шт", qty: "", sum: "" });
  // shartnomali buyurtmalar (faollari birinchi) — «Договор №» ro'yxati
  const contracts = useMemo(
    () =>
      orders
        .filter((o) => o.contractNo)
        .sort((a, b) => (a.status === "topshirildi" || a.status === "tayyor") - (b.status === "topshirildi" || b.status === "tayyor") || b.no - a.no),
    [orders]
  );

  // tanlangan guruhdan shaklni to'ldirish
  useEffect(() => {
    const g = groups.find((x) => x.key === gk);
    const items = (g?.lines || []).map((l) => line(l.productId, l.qty));
    const receiver = g?.customer || ""; // ob'ekt nomi — jo'natishdagi «Qayerga» (qo'lda o'zgartiriladi)
    setF({
      num: nextNo(saved.lastNo, date),
      sender: saved.sender || '"ЭКМ" МЧЖ',
      receiver,
      date,
      contract: g?.order?.contractNo || "",
      orderId: g?.order?.id || "",
      place: g?.customer || "",
      items: items.length ? items : [blank(), blank(), blank()],
      sentBy: saved.sentBy || "",
      driver: (saved.drivers || {})[(g?.vehicle || "").replace(/\s+/g, "").toUpperCase()] || "",
      receivedBy: "",
      car: g?.vehicle || "",
      copies: saved.copies === 1 ? 1 : 2,
      showSum: saved.showSum !== false,
      signature: saved.signature || "",
    });
  }, [gk, groups, date, prods, saved]);

  // shakl to'lgandan keyin (birinchi renderda dialog hali yo'q) ochiladi
  useEffect(() => {
    const d = ref.current;
    if (f && d && !d.open) d.showModal();
  }, [f]);

  if (!f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  // «Договор №» tanlansa — faqat shartnoma eslab qolinadi: «Наименование» katagida shu shartnomadagi
  // mahsulot kodlari taklif qilinadi. Soni, summa va ob'ekt — qo'lda
  const onContract = (e) => {
    const v = e.target.value;
    const o = contracts.find((x) => x.contractNo.trim().toLowerCase() === v.trim().toLowerCase());
    setF((x) => ({ ...x, contract: v, orderId: o?.id || "" }));
  };
  const order = orders.find((o) => o.id === f.orderId);
  const codes = (order ? order.items.map((it) => prods.get(it.productId)).filter(Boolean) : [...prods.values()]).map((p) => ({
    id: p.id,
    code: p.code,
    left: order?.items.find((it) => it.productId === p.id)?.left,
  }));
  const setItem = (i, k, v) => setF((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const totalQty = f.items.reduce((s, it) => s + num(it.qty), 0);
  const total = f.items.reduce((s, it) => s + num(it.sum), 0);

  async function make(share) {
    if (!f.items.some((it) => it.name.trim() && num(it.qty) > 0)) return notify("Kamida bitta mahsulot va sonini kiriting");
    setBusy(true);
    try {
      const items = f.items.filter((it) => it.name.trim() || num(it.qty)).map((it) => ({ name: cyr(it.name), unit: cyr(it.unit), qty: it.qty, sum: f.showSum ? cyr(it.sum) : "" }));
      const def = nakladnoyDefinition({ ...f, items, total: f.showSum && total ? money(total) : "", totalQty });
      const blob = await buildPlanPdf(def);
      const st = lsGet(KEY, {});
      const plate = (f.car || "").replace(/\s+/g, "").toUpperCase();
      lsSet(KEY, { ...st, lastNo: f.num, sender: f.sender, sentBy: f.sentBy, copies: f.copies, showSum: f.showSum, signature: f.signature, drivers: { ...(st.drivers || {}), ...(plate && f.driver ? { [plate]: f.driver } : {}) } });
      const r = await deliverPdf(blob, `Nakladnaya_${(f.num || "").replace(/[^\w-]+/g, "_")}_${fmtDate(f.date)}.pdf`, { share });
      if (r === "downloaded-fallback") notify("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
    } catch (e) {
      notify(e.message || "PDF tayyorlab bo'lmadi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="wide-dlg nk-dlg" onClose={onClose} onCancel={onClose}>
      <form method="dialog" onSubmit={(e) => e.preventDefault()}>
        <div className="nk-h">
          <h2>{t("Накладная")}</h2>
          <span className="muted">{t("{d} kungi jo'natish", { d: fmtDate(date) })}</span>
        </div>

        {!groups.length && <p className="notice">{t("Bu kunda jo'natish yozilmagan. «Договор №» ni tanlang, keyin «Наименование» katagini bosing — shu shartnomadagi mahsulot kodlari chiqadi. Soni, summa va ob'ektni o'zingiz yozasiz.")}</p>}
        {groups.length > 1 && (
          <div className="field">
            <span className="lbl">{t("Qaysi jo'natish (mashina)")}</span>
            <div className="chips">
              {groups.map((g) => (
                <button key={g.key} type="button" className="chip" aria-pressed={g.key === gk} onClick={() => setGk(g.key)}>
                  {g.vehicle || t("mashinasiz")} · {g.customer || g.order?.customer || "—"} · {g.lines.length} {t("mahsulot")}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-grid nk-grid">
          <div className="field">
            <label htmlFor="nk-num">{t("Накладная №")}</label>
            <input id="nk-num" value={f.num} onChange={set("num")} />
          </div>
          <div className="field">
            <label htmlFor="nk-date">{t("Дата отправки")}</label>
            <input id="nk-date" type="date" value={f.date} onChange={set("date")} />
          </div>
          <div className="field">
            <label htmlFor="nk-contract">{t("Договор №")}</label>
            <input id="nk-contract" list="nk-contracts" value={f.contract} onChange={onContract} placeholder={t("tanlang yoki yozing")} autoComplete="off" />
            <datalist id="nk-contracts">
              {contracts.map((o) => (
                <option key={o.id} value={o.contractNo}>
                  №{o.no} {o.customer}
                </option>
              ))}
            </datalist>
          </div>
          <div className="field span2">
            <label htmlFor="nk-sender">{t("Отправитель")}</label>
            <input id="nk-sender" value={f.sender} onChange={set("sender")} />
          </div>
          <div className="field span2">
            <label htmlFor="nk-recv">{t("Получатель / Объект")}</label>
            <input id="nk-recv" value={f.receiver} onChange={set("receiver")} />
          </div>
        </div>

        <div className="tbl-wrap">
          <table className="edit nk-items no-rt">
            <thead>
              <tr>
                <th>№</th>
                <th>{t("Наименование")}</th>
                <th>{t("Ед.изм")}</th>
                <th className="n">{t("Кол-во")}</th>
                <th className="n">{t("Сумма")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {f.items.map((it, i) => (
                <tr key={i}>
                  <td className="num muted">{i + 1}</td>
                  <td className="wide">
                    <CodePicker
                      value={it.name}
                      codes={codes}
                      hint={order ? t("«{c}» shartnomasidagi mahsulotlar", { c: order.contractNo }) : t("Katalogdagi mahsulotlar")}
                      onChange={(v, id) => setF((x) => ({ ...x, items: x.items.map((r, j) => (j === i ? { ...r, name: v, productId: id ?? "" } : r)) }))}
                    />
                  </td>
                  <td>
                    <input value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} aria-label={t("Ед.изм")} style={{ width: 64 }} />
                  </td>
                  <td className="n">
                    <input inputMode="decimal" value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} aria-label={t("Кол-во")} />
                  </td>
                  <td className="n">
                    <input value={it.sum} onChange={(e) => setItem(i, "sum", e.target.value)} aria-label={t("Сумма")} disabled={!f.showSum} />
                  </td>
                  <td>
                    <button type="button" className="mp-x" title={t("Qatorni o'chirish")} onClick={() => setF((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>
                  <button type="button" className="btn sm" onClick={() => setF((x) => ({ ...x, items: [...x.items, blank()] }))}>
                    <Icon name="plus" size={14} /> {t("Qator")}
                  </button>
                </td>
                <td className="n">{t("Jami")}</td>
                <td className="n">{totalQty || ""}</td>
                <td className="n">{f.showSum && total ? money(total) : ""}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.showSum} onChange={(e) => setF((x) => ({ ...x, showSum: e.target.checked }))} />
          {t("Summa ustunini PDF'ga chiqarish")}
        </label>

        <div className="form-grid nk-grid">
          <div className="field">
            <label htmlFor="nk-sent">{t("Отправил (ФИО)")}</label>
            <input id="nk-sent" value={f.sentBy} onChange={set("sentBy")} />
          </div>
          <div className="field">
            <span className="lbl">{t("Imzo")}</span>
            <div className="nk-sig">
              {f.signature ? <img src={f.signature} alt={t("Imzo")} /> : <span className="muted">{t("imzosiz")}</span>}
              <button type="button" className="btn sm" onClick={() => setSigOpen(true)}>
                <Icon name="edit" size={14} /> {t(f.signature ? "Qayta chizish" : "Imzo chizish")}
              </button>
              {f.signature && (
                <button type="button" className="mp-x" title={t("Imzoni olib tashlash")} onClick={() => setF((x) => ({ ...x, signature: "" }))}>
                  ×
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <label htmlFor="nk-drv">{t("Водитель (ФИО)")}</label>
            <input id="nk-drv" value={f.driver} onChange={set("driver")} />
          </div>
          <div className="field">
            <label htmlFor="nk-car">{t("Автомобиль")}</label>
            <input id="nk-car" value={f.car} onChange={set("car")} />
          </div>
          <div className="field">
            <label htmlFor="nk-recb">{t("Получил (ФИО)")}</label>
            <input id="nk-recb" value={f.receivedBy} onChange={set("receivedBy")} />
          </div>
          <div className="field">
            <span className="lbl">{t("Nusxalar")}</span>
            <div className="unit-seg">
              <button type="button" aria-pressed={f.copies === 2} onClick={() => setF((x) => ({ ...x, copies: 2 }))}>
                {t("Ikkita (albom)")}
              </button>
              <button type="button" aria-pressed={f.copies === 1} onClick={() => setF((x) => ({ ...x, copies: 1 }))}>
                {t("Bitta (A4)")}
              </button>
            </div>
          </div>
        </div>

        <div className="dlg-actions">
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            {t("Yopish")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => make(true)}>
            <Icon name="share" /> {t("Ulashish")}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => make(false)}>
            <Icon name="download" /> {busy ? t("Tayyorlanmoqda…") : t("PDF yuklab olish")}
          </button>
        </div>
      </form>
      {sigOpen && (
        <SignaturePad
          onCancel={() => setSigOpen(false)}
          onSave={(url) => {
            setF((x) => ({ ...x, signature: url }));
            setSigOpen(false);
          }}
        />
      )}
    </dialog>
  );
}

/** Mahsulot kodi: katakni bosganda ro'yxat (shartnomadagi yoki katalogdagi kodlar), yozib qidirish ham mumkin */
function CodePicker({ value, codes, hint, onChange }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !box.current?.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
  const list = codes.filter((c) => !q || norm(c.code).includes(norm(q)));
  return (
    <div className="nk-pick" ref={box}>
      <input
        value={value}
        onFocus={() => {
          setQ("");
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          onChange(e.target.value, null);
        }}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-label={t("Наименование")}
        autoComplete="off"
      />
      {open && (
        <div className="nk-pick-list" role="listbox">
          <div className="nk-pick-h">{hint}</div>
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.code === value}
              onClick={() => {
                onChange(c.code, c.id);
                setOpen(false);
              }}
            >
              <span className="code">{c.code}</span>
              {c.left != null && <span className="muted">{t("qoldi {n}", { n: c.left })}</span>}
            </button>
          ))}
          {!list.length && <div className="nk-pick-h">{t("Topilmadi")}</div>}
        </div>
      )}
    </div>
  );
}

/** Barmoq / sichqoncha bilan imzo chizish */
function SignaturePad({ onSave, onCancel }) {
  const t = useT();
  const cv = useRef(null);
  const st = useRef({ draw: false, x: 0, y: 0, used: false });
  useEffect(() => {
    const c = cv.current;
    const r = c.getBoundingClientRect();
    const k = window.devicePixelRatio || 1;
    c.width = r.width * k;
    c.height = r.height * k;
    const ctx = c.getContext("2d");
    ctx.scale(k, k);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a3fa0";
  }, []);
  const pos = (e) => {
    const r = cv.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e) => {
    const p = pos(e);
    st.current = { ...st.current, draw: true, ...p };
    cv.current.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!st.current.draw) return;
    const p = pos(e);
    const ctx = cv.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(st.current.x, st.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    st.current = { ...st.current, ...p, used: true };
  };
  const up = () => (st.current.draw = false);
  const clear = () => {
    const c = cv.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    st.current.used = false;
  };
  return (
    <div className="nk-pad">
      <p className="nk-pad-t">{t("Shu yerga imzo chizing")}</p>
      <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <div className="dlg-actions">
        <button type="button" className="btn" onClick={clear}>
          {t("Tozalash")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("Bekor qilish")}
        </button>
        <button type="button" className="btn primary" onClick={() => (st.current.used ? onSave(cv.current.toDataURL("image/png")) : onCancel())}>
          {t("Saqlash")}
        </button>
      </div>
    </div>
  );
}

