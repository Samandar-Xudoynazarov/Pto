"use client";
import { tr } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { useUser } from "@/lib/role";
import { api } from "@/lib/api";
import { STATUSES, costCard, fmt, fmtDate, lsGet, lsSet, productOptions, today } from "@/lib/calc";
import DeleteButton from "./DeleteButton";
import ExportButtons from "./ExportButtons";
import { fileDate } from "@/lib/xlsx-export";

export default function OrdersTab({ data, openForm, notify, reload }) {
  const { canEdit } = useUser();
  const { products, orders, mats, prods: byId } = data;
  const [filter, setFilter] = useState(() => lsGet("pto.ordFilter", "faol"));

  const counts = useMemo(() => {
    const c = { faol: 0, hammasi: orders.length };
    for (const o of orders) {
      c[o.status] = (c[o.status] || 0) + 1;
      if (o.status !== "topshirildi") c.faol++;
    }
    return c;
  }, [orders]);

  const list = orders
    .filter((o) => (filter === "hammasi" ? true : filter === "faol" ? o.status !== "topshirildi" : o.status === filter))
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));

  function chooseFilter(k) {
    setFilter(k);
    lsSet("pto.ordFilter", k);
  }

  function orderForm(existing) {
    if (!products.length) return notify("Avval «Katalog»ga mahsulot qo'shing");
    openForm({
      title: existing ? tr("Buyurtma №{n}", { n: existing.no }) : tr("Yangi buyurtma"),
      values: existing,
      fields: [
        { name: "customer", label: "Buyurtmachi", req: true, wide: true },
        { name: "productId", label: "Mahsulot", type: "select", options: productOptions(products), raw: true, req: true, wide: true },
        { name: "qty", label: "Soni", unit: "dona", type: "number", min: 1, step: 1, req: true },
        { name: "price", label: "Narx", unit: "so'm/dona QQS bilan, 0 = kalkulyatsiyadan", type: "number", min: 0, step: 1 },
        { name: "date", label: "Qabul sanasi", type: "date", def: today() },
        { name: "deadline", label: "Muddat", type: "date" },
        { name: "status", label: "Holat", type: "select", options: STATUSES, def: "yangi" },
        { name: "note", label: "Izoh", wide: true },
      ],
      onSubmit: async (v) => {
        if (existing) await api(`/orders/${existing.id}`, { method: "PUT", body: v });
        else await api("/orders", { method: "POST", body: v });
        await reload();
        notify("Saqlandi");
      },
    });
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
  let sum = 0;

  return (
    <section className="sheet">
      <div className="bar">
        <div className="l">
          <h2>{tr("Buyurtmalar")}</h2>
        </div>
        <div className="r">
          <ExportButtons
            company={data.settings?.company}
            notify={notify}
            disabled={!list.length}
            build={() => ({
              filename: `Buyurtmalar_${fileDate()}.xlsx`,
              sheets: [
                {
                  name: tr("Buyurtmalar"),
                  title: tr("Buyurtmalar"),
                  subtitle: tr([["faol", "Faol"], ["hammasi", "Hammasi"], ...STATUSES].find(([k]) => k === filter)?.[1] || ""),
                  columns: [
                    { header: "№", key: "no", type: "int", width: 6 },
                    { header: tr("Buyurtmachi"), key: "customer", width: 28 },
                    { header: tr("Mahsulot"), key: "product", width: 18 },
                    { header: tr("Soni"), key: "qty", type: "int", total: "sum", width: 9 },
                    { header: tr("Jo'natildi"), key: "shipped", type: "int", total: "sum", width: 11 },
                    { header: tr("Qoldi"), key: "left", type: "int", total: "sum", width: 9 },
                    { header: tr("Qabul sanasi"), key: "date", type: "date", width: 12 },
                    { header: tr("Muddat"), key: "deadline", type: "date", width: 12 },
                    { header: tr("Holat"), key: "status", width: 13 },
                    { header: tr("Narx (QQS bilan)"), key: "price", type: "money", width: 15 },
                    { header: tr("Summa, so'm"), key: "sum", type: "money", total: "sum", width: 17 },
                    { header: tr("Izoh"), key: "note", width: 24 },
                  ],
                  rows: list.map((o) => {
                    const p = byId.get(o.productId);
                    const price = +o.price || (p?.calc?.items?.length ? costCard(p, mats).final : 0);
                    const late = o.deadline && o.deadline < td && !["tayyor", "topshirildi"].includes(o.status);
                    return {
                      no: o.no, customer: o.customer, product: p?.code || tr("— o'chirilgan —"), qty: o.qty, shipped: o.shipped || 0,
                      left: Math.max(0, o.qty - (o.shipped || 0)), date: o.date ? fmtDate(o.date) : "", deadline: o.deadline ? fmtDate(o.deadline) : "",
                      status: tr(STATUSES.find(([k]) => k === o.status)?.[1] || o.status) + (late ? tr(" · kechikdi") : ""),
                      price: Math.round(price) || null, sum: Math.round(price * o.qty) || null, note: o.note,
                      _cell: late ? { deadline: "bad", status: "bad" } : undefined,
                    };
                  }),
                },
              ],
            })}
          />
          {canEdit && (
            <button className="btn primary" onClick={() => orderForm()}>{tr("+ Yangi buyurtma")}</button>
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

      <div className="tbl-wrap">
        {!list.length ? (
          <div className="empty">{tr("Bu filtr bo'yicha buyurtma yo'q.")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>{tr("Buyurtmachi")}</th>
                <th>{tr("Mahsulot")}</th>
                <th className="n">{tr("Soni")}</th>
                <th>{tr("Jo'natildi")}</th>
                <th>{tr("Muddat")}</th>
                <th>{tr("Holat")}</th>
                <th className="n">{tr("Summa, so'm")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => {
                const p = byId.get(o.productId);
                const done = o.shipped || 0;
                const pct = o.qty ? Math.min(100, (done / o.qty) * 100) : 0;
                const late = o.deadline && o.deadline < td && !["tayyor", "topshirildi"].includes(o.status);
                const summa = (+o.price || (p?.calc?.items?.length ? costCard(p, mats).final : 0)) * (+o.qty || 0);
                sum += summa;
                return (
                  <tr key={o.id}>
                    <td className="num">{o.no}</td>
                    <td>
                      {o.customer}
                      {o.note && <span className="sub">{o.note}</span>}
                    </td>
                    <td>
                      <span className="code">{p?.code || tr("— o'chirilgan —")}</span>
                    </td>
                    <td className="n">{fmt(o.qty)}</td>
                    <td>
                      <div className="prog">
                        <div className="track">
                          <div className="fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span>
                          {fmt(done)}/{fmt(o.qty)}
                        </span>
                      </div>
                    </td>
                    <td className={`num${late ? " late" : ""}`}>
                      {fmtDate(o.deadline)}
                      {late && tr(" · kechikdi")}
                    </td>
                    <td>
                      <select
                        id={`st-${o.id}`}
                        className={`st st-${o.status}`}
                        aria-label={tr("Holat")}
                        value={o.status}
                        disabled={!canEdit}
                        onChange={(e) => setStatus(o, e.target.value)}
                      >
                        {STATUSES.map(([k, l]) => (
                          <option key={k} value={k}>
                            {tr(l)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="n">{fmt(summa)}</td>
                    <td>
                      {canEdit && (
                        <div className="acts">
                          <button className="btn sm" onClick={() => orderForm(o)}>{tr("Tahrirlash")}</button>
                          <DeleteButton onConfirm={() => del(o.id)} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>{tr("Jami ({n} ta)", { n: list.length })}</td>
                <td className="n">{fmt(sum)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="hint">{tr(
        "«Jo'natildi» ustuni kunlik hisobotdagi shu buyurtmaga bog'langan jo'natishlardan hisoblanadi. Narx 0 bo'lsa, kalkulyatsiyadagi QQS bilan narx olinadi."
      )}</p>
    </section>
  );
}
