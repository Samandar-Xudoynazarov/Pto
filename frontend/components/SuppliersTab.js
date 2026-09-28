"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import { fmt, fmtDate, fmtN, shiftDate, today } from "@/lib/calc";
import DeleteButton from "./DeleteButton";
import ExportButtons from "./ExportButtons";
import Icon from "./Icon";
import { fileDate } from "@/lib/xlsx-export";

const PERIODS = [
  ["30", "30 kun", 30],
  ["90", "3 oy", 90],
  ["365", "1 yil", 365],
  ["all", "Hammasi", null],
];
const pct = (a, b) => (a && b ? ((a - b) / b) * 100 : null);

/** Ta'minotchilar: kontaktlar, kimdan qancha olindi, narxlar qanday o'zgardi */
export default function SuppliersTab({ data, openForm, notify }) {
  const t = useT();
  const { canEdit, canStore } = useUser();
  const { mats } = data;
  const [period, setPeriod] = useState("90");
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    const days = PERIODS.find(([k]) => k === period)?.[2];
    const qs = days ? `?from=${shiftDate(today(), -days + 1)}&to=${today()}` : "";
    try {
      setList(await api(`/suppliers${qs}`));
    } catch (e) {
      notify(e.message);
    }
  }, [period, notify]);
  useEffect(() => {
    load();
  }, [load]);

  const s = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (list || [])
        .filter((x) => !x.archived || x.stats)
        .filter((x) => !s || `${x.name} ${x.phone} ${x.inn} ${x.contact}`.toLowerCase().includes(s))
        .sort((a, b) => (b.stats?.total || 0) - (a.stats?.total || 0) || a.name.localeCompare(b.name)),
    [list, s]
  );
  const total = shown.reduce((a, x) => a + (x.stats?.total || 0), 0);
  // narxi oshgan materiallar (oxirgi kirim oldingisidan qimmat)
  const rises = useMemo(() => {
    const out = [];
    for (const x of list || [])
      for (const m of x.stats?.materials || []) {
        const p = pct(m.lastPrice, m.prevPrice);
        if (p !== null && p > 0.5) out.push({ supplier: x.name, ...m, p });
      }
    return out.sort((a, b) => b.p - a.p).slice(0, 8);
  }, [list]);

  function form(existing) {
    openForm({
      title: existing?.id ? existing.name : tr("Yangi ta'minotchi"),
      values: existing,
      fields: [
        { name: "name", label: "Nomi", req: true, wide: true },
        { name: "phone", label: "Telefon" },
        { name: "inn", label: "STIR (INN)" },
        { name: "contact", label: "Mas'ul shaxs", wide: true },
        { name: "note", label: "Izoh", wide: true },
      ],
      onSubmit: async (v) => {
        if (existing?.id) await api(`/suppliers/${existing.id}`, { method: "PUT", body: v });
        else await api("/suppliers", { method: "POST", body: v });
        await load();
        notify("Saqlandi");
      },
    });
  }
  async function del(x) {
    try {
      const r = await api(`/suppliers/${x.id}`, { method: "DELETE" });
      notify(r.archived ? "Kirimlarda ishlatilgan — arxivga olindi" : "O'chirildi");
      setOpen(null);
      await load();
    } catch (e) {
      notify(e.message);
    }
  }

  return (
    <section className="sheet">
      <div className="kpis kpis-3">
        <div className="kpi">
          <div className="k">{t("Xaridlar")}</div>
          <div className="v">
            {fmt(total / 1e6, 1)}
            <small>{t("mln so'm")}</small>
          </div>
        </div>
        <div className="kpi">
          <div className="k">{t("Ta'minotchilar")}</div>
          <div className="v">{shown.filter((x) => x.stats).length}</div>
        </div>
        <div className={`kpi ${rises.length ? "kpi-warn" : ""}`}>
          <div className="k">{t("Narxi oshgan")}</div>
          <div className="v">{rises.length}</div>
        </div>
      </div>

      <div className="bar">
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder={t("Qidirish…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Qidirish")} />
        </div>
        <div className="r">
          <ExportButtons company={data.settings?.company} notify={notify} disabled={!shown.length} build={() => supExcel(shown, mats, period)} />
          {canStore && (
            <button className="btn primary" onClick={() => form(null)}>
              {t("+ Ta'minotchi")}
            </button>
          )}
        </div>
      </div>
      <div className="chips">
        {PERIODS.map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>
            {t(l)}
          </button>
        ))}
      </div>

      {rises.length > 0 && (
        <div className="notice">
          <strong>{t("Narxi oshgan materiallar")}</strong>
          <ul className="rises">
            {rises.map((r, i) => (
              <li key={i}>
                {mats.get(r.materialId)?.name || "—"} — {r.supplier}: {fmt(r.prevPrice)} → <strong>{fmt(r.lastPrice)}</strong> {t("so'm")} <span className="late">+{fmtN(r.p, 1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!list ? (
        <div className="loading">{t("Yuklanmoqda…")}</div>
      ) : !shown.length ? (
        <div className="empty">{t("Ta'minotchi yo'q. Kirim yozilganda ta'minotchi nomi shu ro'yxatga avtomatik qo'shiladi.")}</div>
      ) : (
        <ul className="sup-list">
          {shown.map((x) => {
            const k = x.id || x.name;
            const isOpen = open === k;
            return (
              <li key={k} className={x.archived ? "archived" : ""}>
                <button className="sup-item" onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen}>
                  <span className="card-main">
                    <strong>{x.name}</strong>
                    <span className="muted">
                      {[x.phone, x.contact, x.inn && `${t("STIR")} ${x.inn}`].filter(Boolean).join(" · ") || t("kontakt kiritilmagan")}
                      {x.archived ? ` · ${t("arxivda")}` : ""}
                    </span>
                  </span>
                  <span className="card-num">
                    <strong>{x.stats ? fmt(x.stats.total) : "—"}</strong>
                    <span className="muted">{x.stats ? t("{n} ta kirim · oxirgi {d}", { n: x.stats.count, d: fmtDate(x.stats.last) }) : t("bu davrda xarid yo'q")}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="sup-detail">
                    {x.stats?.materials?.length > 0 && (
                      <div className="tbl-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>{t("Material")}</th>
                              <th className="n">{t("Miqdor")}</th>
                              <th className="n">{t("Summa, so'm")}</th>
                              <th className="n">{t("Oxirgi narx")}</th>
                              <th className="n hide-s">{t("Min – max")}</th>
                              <th>{t("Oxirgi kirim")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {x.stats.materials.map((m) => {
                              const mat = mats.get(m.materialId);
                              const p = pct(m.lastPrice, m.prevPrice);
                              return (
                                <tr key={m.materialId}>
                                  <td>{mat?.name || t("— o'chirilgan —")}</td>
                                  <td className="n">
                                    {fmtN(m.qty, 3)} <span className="unit-s">{mat?.unit}</span>
                                  </td>
                                  <td className="n">{fmt(m.total)}</td>
                                  <td className="n">
                                    {m.lastPrice ? fmt(m.lastPrice) : "—"}
                                    {p !== null && Math.abs(p) > 0.05 && <span className={`sub ${p > 0 ? "late" : "ok-text"}`}>{p > 0 ? "+" : ""}{fmtN(p, 1)}%</span>}
                                  </td>
                                  <td className="n hide-s">{m.minPrice ? (m.minPrice === m.maxPrice ? fmt(m.minPrice) : `${fmt(m.minPrice)} – ${fmt(m.maxPrice)}`) : "—"}</td>
                                  <td className="num">{fmtDate(m.lastDate)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {x.note && <p className="hint">{x.note}</p>}
                    <div className="acts">
                      {x.phone && (
                        <a className="btn sm" href={`tel:${x.phone.replace(/[^\d+]/g, "")}`}>
                          {t("Qo'ng'iroq")}
                        </a>
                      )}
                      {canStore && (
                        <button className="btn sm" onClick={() => form(x.id ? x : { name: x.name })}>
                          {t(x.id ? "Tahrirlash" : "Ro'yxatga qo'shish")}
                        </button>
                      )}
                      {canEdit && x.id && <DeleteButton onConfirm={() => del(x)} />}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="hint">{t("Summa va narxlar tanlangan davrdagi kirimlardan hisoblanadi. Narx o'zgarishi — shu ta'minotchidan oxirgi kirim narxi oldingi (boshqa) narxga nisbatan.")}</p>
    </section>
  );
}

function supExcel(list, mats, period) {
  const rows = [];
  for (const x of list)
    for (const m of x.stats?.materials || []) {
      const mat = mats.get(m.materialId);
      const p = pct(m.lastPrice, m.prevPrice);
      rows.push({
        sup: x.name, phone: x.phone, inn: x.inn, mat: mat?.name || "", unit: mat?.unit || "", qty: m.qty, total: m.total, last: m.lastPrice, prev: m.prevPrice,
        p: p === null ? null : Math.round(p * 10) / 10, min: m.minPrice, max: m.maxPrice, date: fmtDate(m.lastDate), _cell: p > 0 ? { p: "bad" } : undefined,
      });
    }
  return {
    filename: `Taminotchilar_${fileDate()}.xlsx`,
    sheets: [
      {
        name: tr("Ta'minotchilar"),
        title: tr("Ta'minotchilar bo'yicha xaridlar"),
        subtitle: tr(PERIODS.find(([k]) => k === period)?.[1] || ""),
        columns: [
          { header: tr("Ta'minotchi"), key: "sup", width: 28 },
          { header: tr("Telefon"), key: "phone", width: 16 },
          { header: tr("STIR"), key: "inn", width: 12 },
          { header: tr("Material"), key: "mat", width: 30 },
          { header: tr("Birlik"), key: "unit", width: 8 },
          { header: tr("Miqdor"), key: "qty", type: "num", width: 12 },
          { header: tr("Summa, so'm"), key: "total", type: "money", total: "sum", width: 16 },
          { header: tr("Oxirgi narx"), key: "last", type: "money", width: 13 },
          { header: tr("Oldingi narx"), key: "prev", type: "money", width: 13 },
          { header: tr("O'zgarish, %"), key: "p", type: "num", width: 11 },
          { header: tr("Min narx"), key: "min", type: "money", width: 12 },
          { header: tr("Max narx"), key: "max", type: "money", width: 12 },
          { header: tr("Oxirgi kirim"), key: "date", type: "date", width: 12 },
        ],
        rows,
      },
    ],
  };
}
