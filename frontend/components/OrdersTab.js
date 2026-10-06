"use client";
import { tr } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@/lib/role";
import { api } from "@/lib/api";
import { STATUSES, costCard, fmt, fmtDate, lsGet, lsSet, productLabel, today } from "@/lib/calc";
import DeleteButton from "./DeleteButton";
import ExportButtons from "./ExportButtons";
import { fileDate } from "@/lib/xlsx-export";

const CLOSED = ["tayyor", "topshirildi"];
const pct = (a, b) => (b ? Math.min(100, (a / b) * 100) : 0);

/** Buyurtma qatori narxi: kiritilgan, bo'lmasa kalkulyatsiyadagi QQS bilan narx */
function itemPrice(it, byId, mats) {
  if (+it.price) return +it.price;
  const p = byId.get(it.productId);
  return p?.calc?.items?.length ? costCard(p, mats).final : 0;
}

export default function OrdersTab({ data, notify, reload }) {
  const { canEdit } = useUser();
  const { products, orders, mats, prods: byId } = data;
  const [filter, setFilter] = useState(() => lsGet("pto.ordFilter", "faol"));
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); // null — yopiq, {} — yangi, order — tahrirlash

  const counts = useMemo(() => {
    const c = { faol: 0, hammasi: orders.length };
    for (const o of orders) {
      c[o.status] = (c[o.status] || 0) + 1;
      if (o.status !== "topshirildi") c.faol++;
    }
    return c;
  }, [orders]);

  const s = q.trim().toLowerCase();
  const list = orders
    .filter((o) => (filter === "hammasi" ? true : filter === "faol" ? o.status !== "topshirildi" : o.status === filter))
    .filter((o) => !s || String(o.no) === s || o.customer.toLowerCase().includes(s) || (o.contractNo || "").toLowerCase().includes(s) || o.items.some((it) => (byId.get(it.productId)?.code || "").toLowerCase().includes(s)))
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.no - b.no);

  function chooseFilter(k) {
    setFilter(k);
    lsSet("pto.ordFilter", k);
  }
  function openNew() {
    if (!products.length) return notify("Avval «Katalog»ga mahsulot qo'shing");
    setEdit({});
  }

  async function setStatus(o, status) {
    try {
      await api(`/orders/${o.id}`, { method: "PUT", body: { status } });
      await reload();
    } catch (e) {
      notify(e.message);
    }
  }
  async function del(id) {
    try {
      await api(`/orders/${id}`, { method: "DELETE" });
      await reload();
      notify("O'chirildi");
    } catch (e) {
      notify(e.message);
    }
  }

  const td = today();
  const summaOf = (o) => o.items.reduce((t, it) => t + itemPrice(it, byId, mats) * it.qty, 0);

  return (
    <section className="sheet">
      <div className="bar">
        <div className="l">
          <h2>{tr("Buyurtmalar")}</h2>
        </div>
        <div className="r">
          <ExportButtons company={data.settings?.company} notify={notify} disabled={!list.length} build={() => ordersExcel(list, filter, byId, mats, td)} />
          {canEdit && (
            <button className="btn primary" onClick={openNew}>{tr("+ Yangi buyurtma")}</button>
          )}
        </div>
      </div>

      <div className="chips">
        {[["faol", "Faol"], ["hammasi", "Hammasi"], ...STATUSES].map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => chooseFilter(k)}>
            {tr(l)} · {counts[k] || 0}
          </button>
        ))}
      </div>
      <div className="field" style={{ maxWidth: 320 }}>
        <input id="ord-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Qidirish: buyurtmachi, shartnoma, mahsulot")} aria-label={tr("Qidirish")} />
      </div>

      {!list.length ? (
        <div className="empty">{tr("Bu filtr bo'yicha buyurtma yo'q.")}</div>
      ) : (
        <>
          <div className="ord-list">
            {list.map((o) => (
              <OrderCard key={o.id} o={o} td={td} byId={byId} summa={summaOf(o)} canEdit={canEdit} onEdit={() => setEdit(o)} onDelete={() => del(o.id)} onStatus={(st) => setStatus(o, st)} />
            ))}
          </div>
          <div className="ord-total">
            <span>{tr("Jami ({n} ta)", { n: list.length })}</span>
            <span>
              {tr("qoldi {n}", { n: fmt(list.reduce((t, o) => t + (o.left || 0), 0)) })} {tr("dona")}
            </span>
            <strong>
              {fmt(list.reduce((t, o) => t + summaOf(o), 0))} {tr("so'm")}
            </strong>
          </div>
        </>
      )}
      <p className="hint">{tr(
        "Bitta buyurtmada bir nechta mahsulot bo'lishi mumkin. «Jo'natildi» = tizimdan oldin jo'natilgan (buyurtmada qo'lda kiritiladi) + kunlik hisobotda shu buyurtmaga bog'langan jo'natishlar. Narx 0 bo'lsa, kalkulyatsiyadagi QQS bilan narx olinadi."
      )}</p>

      <OrderDialog
        order={edit}
        data={data}
        onClose={() => setEdit(null)}
        onSaved={async () => {
          await reload();
          notify("Saqlandi");
        }}
      />
    </section>
  );
}

const SHOW_ITEMS = 8; // shundan ko'p mahsulot bo'lsa — «yana N ta»
const contractText = (c) => String(c || "").replace(/^№\s*/, "");

/** Bitta buyurtma kartasi: sarlavha, ko'rsatkichlar va mahsulotlar (ixcham to'r) */
function OrderCard({ o, td, byId, summa, canEdit, onEdit, onDelete, onStatus }) {
  const [open, setOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const late = o.deadline && o.deadline < td && !CLOSED.includes(o.status);
  const items = [...o.items].sort((a, b) => (a.left === 0) - (b.left === 0)); // tugaganlari oxirida
  const shown = open ? items : items.slice(0, SHOW_ITEMS);
  const done = o.items.filter((it) => it.left === 0).length;
  const p = pct(o.shipped, o.qty);
  return (
    <article className={`ord-card${late ? " is-late" : ""}`}>
      <header className="ord-head">
        <div className="ord-title">
          <span className="ord-no">№{o.no}</span>
          <div className="ord-name">
            <strong>{o.customer}</strong>
            <span className="ord-meta">
              {o.contractNo && <span className="ord-contract">{tr("Shartnoma № {n}", { n: contractText(o.contractNo) })}</span>}
              {o.date && <span>{tr("qabul {d}", { d: fmtDate(o.date) })}</span>}
            </span>
          </div>
        </div>
        <div className="ord-side">
          <select id={`st-${o.id}`} className={`st st-${o.status}`} aria-label={tr("Holat")} value={o.status} disabled={!canEdit} onChange={(e) => onStatus(e.target.value)}>
            {STATUSES.map(([k, l]) => (
              <option key={k} value={k}>
                {tr(l)}
              </option>
            ))}
          </select>
          {canEdit && (
            <div className="acts">
              <button className="btn sm" onClick={onEdit}>{tr("Tahrirlash")}</button>
              <DeleteButton onConfirm={onDelete} />
            </div>
          )}
        </div>
      </header>

      {o.note && (
        <button type="button" className={`ord-note${noteOpen ? " open" : ""}`} onClick={() => setNoteOpen((v) => !v)} title={o.note}>
          {o.note}
        </button>
      )}

      <div className="ord-stats">
        <div className="ord-stat ord-stat-prog">
          <span className="k">{tr("Jo'natildi")}</span>
          <div className="prog">
            <div className="track">
              <div className="fill" style={{ width: `${p}%` }} />
            </div>
            <span>
              {fmt(o.shipped)} / {fmt(o.qty)} · {Math.round(p)}%
            </span>
          </div>
        </div>
        <div className="ord-stat">
          <span className="k">{tr("Qoldi")}</span>
          <strong>{fmt(o.left)}</strong>
        </div>
        <div className={`ord-stat${late ? " late" : ""}`}>
          <span className="k">{tr("Muddat")}</span>
          <strong>
            {o.deadline ? fmtDate(o.deadline) : "—"}
            {late && <small>{tr(" · kechikdi")}</small>}
          </strong>
        </div>
        <div className="ord-stat">
          <span className="k">{tr("Summa, so'm")}</span>
          <strong>{fmt(summa)}</strong>
        </div>
      </div>

      <div className="ord-grid">
        {shown.map((it) => {
          const ip = pct(it.shipped, it.qty);
          return (
            <div key={it.productId} className={`ord-chip${it.left === 0 ? " done" : ""}`} title={it.shippedBefore ? tr("Tizimdan oldin jo'natilgan: {n}", { n: fmt(it.shippedBefore) }) : undefined}>
              <div className="ord-chip-top">
                <span className="code">{byId.get(it.productId)?.code || tr("— o'chirilgan —")}</span>
                <span className="num">
                  {fmt(it.shipped)}/{fmt(it.qty)}
                </span>
              </div>
              <div className="ord-chip-bar">
                <div style={{ width: `${ip}%` }} />
              </div>
              <span className="ord-chip-sub">{it.left === 0 ? tr("to'liq jo'natildi") : tr("qoldi {n}", { n: fmt(it.left) })}</span>
            </div>
          );
        })}
      </div>
      {items.length > SHOW_ITEMS && (
        <button type="button" className="linkbtn ord-more" onClick={() => setOpen((v) => !v)}>
          {open ? tr("Yig'ish") : tr("Yana {n} ta mahsulot", { n: items.length - SHOW_ITEMS })}
        </button>
      )}
      <footer className="ord-foot muted">
        {tr("{n} xil mahsulot", { n: o.items.length })}
        {done > 0 && ` · ${tr("{n} tasi to'liq jo'natilgan", { n: done })}`}
      </footer>
    </article>
  );
}

const blankItem = () => ({ productId: "", qty: "", price: "", shippedBefore: "" });

/** Buyurtma oynasi: buyurtmachi, sanalar va mahsulotlar ro'yxati */
function OrderDialog({ order, data, onClose, onSaved }) {
  const ref = useRef(null);
  const { products, mats, prods: byId } = data;
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (order) {
      const o = order.id ? order : null;
      setF({
        customer: o?.customer || "",
        contractNo: o?.contractNo || "",
        date: o?.date || today(),
        deadline: o?.deadline || "",
        status: o?.status || "yangi",
        note: o?.note || "",
        // tizimdan oldin bo'lgan buyurtma: jo'natilgan qismi alohida kiritiladi
        old: Boolean(o?.items?.some((it) => it.shippedBefore > 0)),
        items: o?.items?.length
          ? o.items.map((it) => ({ productId: it.productId, qty: String(it.qty), price: it.price ? String(it.price) : "", shippedBefore: it.shippedBefore ? String(it.shippedBefore) : "", shippedSystem: it.shippedSystem || 0 }))
          : [blankItem()],
      });
      setError("");
      if (el && !el.open) el.showModal();
    } else if (el?.open) el.close();
  }, [order]);

  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setItem = (i, patch) => setF((x) => ({ ...x, items: x.items.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const used = new Set((f?.items || []).map((r) => r.productId).filter(Boolean));

  async function save(e) {
    e.preventDefault();
    const items = f.items
      .filter((r) => r.productId || +r.qty)
      .map((r) => ({ productId: r.productId, qty: Math.floor(+r.qty || 0), price: +r.price || 0, shippedBefore: f.old ? Math.floor(+r.shippedBefore || 0) : 0 }));
    if (!f.customer.trim()) return setError(tr("Buyurtmachi kiritilmagan"));
    if (!items.length) return setError(tr("Kamida bitta mahsulot qo'shing"));
    if (items.some((r) => !r.productId)) return setError(tr("Mahsulot tanlanmagan"));
    if (items.some((r) => r.qty < 1)) return setError(tr("Soni kamida 1 bo'lishi kerak"));
    if (items.some((r) => r.shippedBefore > r.qty)) return setError(tr("Oldin jo'natilgan soni buyurtma sonidan ko'p bo'lmaydi"));
    setBusy(true);
    setError("");
    try {
      const body = { customer: f.customer.trim(), contractNo: f.contractNo.trim(), date: f.date, deadline: f.deadline, status: f.status, note: f.note, items };
      if (order?.id) await api(`/orders/${order.id}`, { method: "PUT", body });
      else await api("/orders", { method: "POST", body });
      await onSaved();
      onClose();
    } catch (err) {
      setError(tr(err.message || "Saqlanmadi"));
    } finally {
      setBusy(false);
    }
  }

  const totals = (f?.items || []).reduce(
    (t, r) => {
      const qty = Math.floor(+r.qty || 0);
      const done = (f.old ? Math.floor(+r.shippedBefore || 0) : 0) + (r.shippedSystem || 0);
      t.qty += qty;
      t.done += done;
      t.sum += r.productId ? itemPrice({ productId: r.productId, price: +r.price || 0 }, byId, mats) * qty : 0;
      return t;
    },
    { qty: 0, done: 0, sum: 0 }
  );

  return (
    <dialog ref={ref} onClose={onClose} className="wide-dlg">
      {f && (
        <form onSubmit={save}>
          <h2>
            {order?.id ? tr("Buyurtma №{n}", { n: order.no }) : tr("Yangi buyurtma")}
            {order?.contractNo && <span className="muted"> · {tr("Shartnoma № {n}", { n: order.contractNo })}</span>}
          </h2>
          <div className="form-grid">
            <div className="field span2">
              <label htmlFor="od-c">{tr("Buyurtmachi")}</label>
              <input id="od-c" value={f.customer} onChange={(e) => set({ customer: e.target.value })} required maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor="od-cn">{tr("Shartnoma (договор) №")}</label>
              <input id="od-cn" value={f.contractNo} onChange={(e) => set({ contractNo: e.target.value })} maxLength={60} placeholder="ЕКМ 13" />
            </div>
            <div className="field">
              <label htmlFor="od-d">{tr("Qabul sanasi")}</label>
              <input id="od-d" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="od-dl">{tr("Muddat")}</label>
              <input id="od-dl" type="date" value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="od-s">{tr("Holat")}</label>
              <select id="od-s" value={f.status} onChange={(e) => set({ status: e.target.value })}>
                {STATUSES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {tr(l)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: "1/-1" }}>
              <label htmlFor="od-n">{tr("Izoh")}</label>
              <input id="od-n" value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={500} />
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={f.old} onChange={(e) => set({ old: e.target.checked })} />
            {tr("Tizim ishga tushishidan oldin olingan buyurtma — bir qismi allaqachon jo'natilgan")}
          </label>

          <div className="tbl-wrap">
            <table className="edit">
              <thead>
                <tr>
                  <th>{tr("Mahsulot")}</th>
                  <th className="n">{tr("Soni")}</th>
                  <th className="n">{tr("Narx (QQS bilan)")}</th>
                  {f.old && <th className="n">{tr("Oldin jo'natilgan")}</th>}
                  {order?.id && <th className="n">{tr("Kunlik hisobotdan")}</th>}
                  <th className="n">{tr("Qoldi")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {f.items.map((r, i) => {
                  const p = byId.get(r.productId);
                  const calcPrice = p?.calc?.items?.length ? costCard(p, mats).final : 0;
                  const left = Math.max(0, Math.floor(+r.qty || 0) - (f.old ? Math.floor(+r.shippedBefore || 0) : 0) - (r.shippedSystem || 0));
                  return (
                    <tr key={i}>
                      <td className="wide">
                        <select id={`od-p-${i}`} value={r.productId} onChange={(e) => setItem(i, { productId: e.target.value })} aria-label={tr("Mahsulot")} required>
                          <option value="">{tr("— tanlang —")}</option>
                          {products
                            .filter((x) => x.id === r.productId || !used.has(x.id))
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {productLabel(x)}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="n">
                        <input id={`od-q-${i}`} type="number" inputMode="numeric" min="1" step="1" value={r.qty} onChange={(e) => setItem(i, { qty: e.target.value })} aria-label={tr("Soni")} required />
                      </td>
                      <td className="n">
                        <input id={`od-pr-${i}`} type="number" min="0" step="1" value={r.price} placeholder={calcPrice ? fmt(calcPrice) : "0"} onChange={(e) => setItem(i, { price: e.target.value })} aria-label={tr("Narx")} />
                      </td>
                      {f.old && (
                        <td className="n">
                          <input id={`od-b-${i}`} type="number" inputMode="numeric" min="0" step="1" max={r.qty || undefined} value={r.shippedBefore} onChange={(e) => setItem(i, { shippedBefore: e.target.value })} aria-label={tr("Oldin jo'natilgan")} />
                        </td>
                      )}
                      {order?.id && <td className="n">{fmt(r.shippedSystem || 0)}</td>}
                      <td className="n">{fmt(left)}</td>
                      <td>
                        <button type="button" className="btn sm danger" aria-label={tr("Qatorni o'chirish")} disabled={f.items.length < 2} onClick={() => set({ items: f.items.filter((_, j) => j !== i) })}>
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>{tr("Jami")}</td>
                  <td className="n">{fmt(totals.qty)}</td>
                  <td className="n">{fmt(totals.sum)}</td>
                  {f.old && <td></td>}
                  {order?.id && <td></td>}
                  <td className="n">{fmt(Math.max(0, totals.qty - totals.done))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div>
            <button type="button" className="btn sm" disabled={used.size >= products.length} onClick={() => set({ items: [...f.items, blankItem()] })}>
              {tr("+ Mahsulot qo'shish")}
            </button>
          </div>
          <p className="hint">
            {tr(
              f.old
                ? "«Oldin jo'natilgan» — tizimdan oldin jo'natib bo'lingan soni. U ombor qoldig'iga ta'sir qilmaydi (boshlang'ich qoldiqda allaqachon hisobga olingan), faqat buyurtmaning qolgan qismini kamaytiradi."
                : "Narx bo'sh bo'lsa, kalkulyatsiyadagi QQS bilan narx olinadi. Jo'natishlar kunlik hisobotda shu buyurtmaga bog'lanadi."
            )}
          </p>
          {error && <p className="err">{error}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={onClose}>{tr("Bekor qilish")}</button>
            <button className="btn primary" disabled={busy}>
              {busy ? tr("Saqlanmoqda…") : tr("Saqlash")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Excel: har mahsulot qatori alohida (buyurtma ma'lumotlari takrorlanadi) */
function ordersExcel(list, filter, byId, mats, td) {
  const rows = [];
  for (const o of list) {
    const late = o.deadline && o.deadline < td && !CLOSED.includes(o.status);
    for (const it of o.items) {
      const price = itemPrice(it, byId, mats);
      rows.push({
        no: o.no, customer: o.customer, contract: o.contractNo || "", product: byId.get(it.productId)?.code || tr("— o'chirilgan —"), qty: it.qty,
        before: it.shippedBefore || null, system: it.shippedSystem || null, shipped: it.shipped, left: it.left,
        date: o.date ? fmtDate(o.date) : "", deadline: o.deadline ? fmtDate(o.deadline) : "",
        status: tr(STATUSES.find(([k]) => k === o.status)?.[1] || o.status) + (late ? tr(" · kechikdi") : ""),
        price: Math.round(price) || null, sum: Math.round(price * it.qty) || null, note: o.note,
        _cell: late ? { deadline: "bad", status: "bad" } : undefined,
      });
    }
  }
  return {
    filename: `Buyurtmalar_${fileDate()}.xlsx`,
    sheets: [
      {
        name: tr("Buyurtmalar"),
        title: tr("Buyurtmalar"),
        subtitle: tr([["faol", "Faol"], ["hammasi", "Hammasi"], ...STATUSES].find(([k]) => k === filter)?.[1] || ""),
        columns: [
          { header: "№", key: "no", type: "int", width: 6 },
          { header: tr("Buyurtmachi"), key: "customer", width: 28 },
          { header: tr("Shartnoma №"), key: "contract", width: 12 },
          { header: tr("Mahsulot"), key: "product", width: 18 },
          { header: tr("Soni"), key: "qty", type: "int", total: "sum", width: 9 },
          { header: tr("Oldin jo'natilgan"), key: "before", type: "int", total: "sum", width: 11 },
          { header: tr("Kunlik hisobotdan"), key: "system", type: "int", total: "sum", width: 11 },
          { header: tr("Jo'natildi"), key: "shipped", type: "int", total: "sum", width: 11 },
          { header: tr("Qoldi"), key: "left", type: "int", total: "sum", width: 9 },
          { header: tr("Qabul sanasi"), key: "date", type: "date", width: 12 },
          { header: tr("Muddat"), key: "deadline", type: "date", width: 12 },
          { header: tr("Holat"), key: "status", width: 13 },
          { header: tr("Narx (QQS bilan)"), key: "price", type: "money", width: 15 },
          { header: tr("Summa, so'm"), key: "sum", type: "money", total: "sum", width: 17 },
          { header: tr("Izoh"), key: "note", width: 24 },
        ],
        rows,
      },
    ],
  };
}
