"use client";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { STATUSES, costCard, fmt, fmtDate, lsGet, lsSet, productOptions, today } from "@/lib/calc";
import DeleteButton from "./DeleteButton";

export default function OrdersTab({ data, openForm, notify, reload }) {
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
      title: existing ? `Buyurtma №${existing.no}` : "Yangi buyurtma",
      values: existing,
      fields: [
        { name: "customer", label: "Buyurtmachi", req: true, wide: true },
        { name: "productId", label: "Mahsulot", type: "select", options: productOptions(products), req: true, wide: true },
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
          <h2>Buyurtmalar</h2>
        </div>
        <div className="r">
          <button className="btn primary" onClick={() => orderForm()}>
            + Yangi buyurtma
          </button>
        </div>
      </div>

      <div className="chips">
        {[["faol", "Faol"], ["hammasi", "Hammasi"], ...STATUSES].map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => chooseFilter(k)}>
            {l} · {counts[k] || 0}
          </button>
        ))}
      </div>

      <div className="tbl-wrap">
        {!list.length ? (
          <div className="empty">Bu filtr bo&apos;yicha buyurtma yo&apos;q.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Buyurtmachi</th>
                <th>Mahsulot</th>
                <th className="n">Soni</th>
                <th>Jo&apos;natildi</th>
                <th>Muddat</th>
                <th>Holat</th>
                <th className="n">Summa, so&apos;m</th>
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
                      <span className="code">{p?.code || "— o'chirilgan —"}</span>
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
                      {late && " · kechikdi"}
                    </td>
                    <td>
                      <select
                        id={`st-${o.id}`}
                        className={`st st-${o.status}`}
                        aria-label="Holat"
                        value={o.status}
                        onChange={(e) => setStatus(o, e.target.value)}
                      >
                        {STATUSES.map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="n">{fmt(summa)}</td>
                    <td>
                      <div className="acts">
                        <button className="btn sm" onClick={() => orderForm(o)}>
                          Tahrirlash
                        </button>
                        <DeleteButton onConfirm={() => del(o.id)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>Jami ({list.length} ta)</td>
                <td className="n">{fmt(sum)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="hint">«Jo&apos;natildi» ustuni kunlik hisobotdagi shu buyurtmaga bog&apos;langan jo&apos;natishlardan hisoblanadi. Narx 0 bo&apos;lsa, kalkulyatsiyadagi QQS bilan narx olinadi.</p>
    </section>
  );
}
