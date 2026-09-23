"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { concreteVolume, fmtN } from "@/lib/calc";
import DeleteButton from "./DeleteButton";

export default function CatalogTab({ data, notify, reload, onEdit }) {
  const { products, mats } = data;
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const groups = [...new Set(products.map((p) => p.group).filter(Boolean))];

  const list = products.filter(
    (p) => (group === "all" || p.group === group) && (!q || `${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase()))
  );

  async function del(id) {
    try {
      await api(`/products/${id}`, { method: "DELETE" });
      await reload();
      notify("O'chirildi");
    } catch (e) {
      notify(e.message);
    }
  }

  return (
    <section className="sheet">
      <div className="bar">
        <div className="l">
          <h2>Mahsulotlar katalogi</h2>
          <input id="cat-q" type="search" placeholder="Qidirish" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Qidirish" />
        </div>
        <div className="r">
          <button className="btn primary" onClick={() => onEdit(null)}>
            + Mahsulot qo&apos;shish
          </button>
        </div>
      </div>
      <div className="chips">
        {[["all", "Hammasi"], ...groups.map((g) => [g, g])].map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={group === k} onClick={() => setGroup(k)}>
            {l} · {k === "all" ? products.length : products.filter((p) => p.group === k).length}
          </button>
        ))}
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Marka</th>
              <th>Nomi</th>
              <th>Beton</th>
              <th className="n">Beton, m³</th>
              <th className="n">Metall, kg</th>
              <th className="n">Og&apos;irligi, t</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const v = concreteVolume(p, mats);
              const grade = p.norms.map((l) => mats.get(l.materialId)).find((m) => m?.group === "beton");
              const metal = p.norms.reduce((s, l) => {
                const m = mats.get(l.materialId);
                return s + (m?.group === "metall" && m.unit === "кг" ? +l.norm || 0 : 0);
              }, 0);
              return (
                <tr key={p.id}>
                  <td>
                    <span className="code">{p.code}</span>
                    {p.notes?.length ? <span className="sub warn-text">{p.notes[0]}</span> : null}
                  </td>
                  <td>{p.name}</td>
                  <td>{grade?.name.replace("Бетон ", "") || "—"}</td>
                  <td className="n">{v ? fmtN(v, 3) : "—"}</td>
                  <td className="n">{metal ? fmtN(metal, 1) : "—"}</td>
                  <td className="n">{v ? fmtN(v * 2.5 + metal / 1000, 2) : "—"}</td>
                  <td>
                    <div className="acts">
                      <button className="btn sm" onClick={() => onEdit(p)}>
                        Tahrirlash
                      </button>
                      <DeleteButton onConfirm={() => del(p.id)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Og&apos;irlik taxminan: beton hajmi × 2,5 t/m³ + metall.</p>
    </section>
  );
}
