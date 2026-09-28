"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { useUser } from "@/lib/role";
import { fmt, fmtDate, fmtN, shiftDate, today } from "@/lib/calc";
import ExportButtons from "./ExportButtons";
import Icon from "./Icon";
import { fileDate } from "@/lib/xlsx-export";

const PERIODS = [
  ["m0", "Bu oy", () => [today().slice(0, 8) + "01", today()]],
  ["d30", "30 kun", () => [shiftDate(today(), -29), today()]],
  ["d90", "3 oy", () => [shiftDate(today(), -89), today()]],
  ["d365", "1 yil", () => [shiftDate(today(), -364), today()]],
];
const KINDS = [
  ["tamir", "Ta'mir"],
  ["to", "Texnik xizmat (TO)"],
  ["meter", "Ko'rsatkich"],
  ["boshqa", "Boshqa"],
];
const kindLabel = (k) => KINDS.find(([x]) => x === k)?.[1] || k;
const unitOf = (v) => (v.meterUnit === "soat" ? "soat" : "km");
const rateUnit = (v) => (v.meterUnit === "soat" ? "l/soat" : "l/100 km");
const OVER = 110; // normadan 10% ortiq — ogohlantirish

/** Texnika: yoqilg'i sarfi normaga nisbatan, ehtiyot qismlar, ta'mir, texnik xizmat */
export default function FleetTab({ data, notify, version }) {
  const t = useT();
  const [period, setPeriod] = useState("m0");
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);
  const [from, to] = PERIODS.find(([k]) => k === period)[2]();

  useEffect(() => {
    setList(null);
    api(`/vehicles/report?from=${from}&to=${to}`).then(setList).catch((e) => notify(e.message));
  }, [from, to, notify, version, tick]);

  const shown = useMemo(() => (list || []).filter((x) => !x.vehicle.archived || x.fuelQty || x.repairSum || x.partsSum), [list]);
  const K = useMemo(() => {
    const k = { fuel: 0, fuelSum: 0, parts: 0, over: 0, service: 0 };
    for (const x of shown) {
      k.fuel += x.fuelQty;
      k.fuelSum += x.fuelSum;
      k.parts += x.partsSum + x.repairSum;
      if (x.normPct > OVER) k.over++;
      if (x.service && (x.service.status === "due" || x.service.status === "soon")) k.service++;
    }
    return k;
  }, [shown]);

  return (
    <section className="sheet fleet">
      <div className="kpis">
        <div className="kpi">
          <div className="k">{t("Yoqilg'i")}</div>
          <div className="v">
            {fmt(K.fuel)}
            <small>{t("l")}</small>
          </div>
          <div className="k">
            {fmt(K.fuelSum / 1e6, 1)} {t("mln so'm")}
          </div>
        </div>
        <div className="kpi">
          <div className="k">{t("Ehtiyot qism va ta'mir")}</div>
          <div className="v">
            {fmt(K.parts / 1e6, 1)}
            <small>{t("mln so'm")}</small>
          </div>
        </div>
        <div className={`kpi ${K.over ? "kpi-warn" : ""}`}>
          <div className="k">{t("Normadan ortiq sarf")}</div>
          <div className="v">{K.over}</div>
        </div>
        <div className={`kpi ${K.service ? "kpi-risk" : ""}`}>
          <div className="k">{t("Texnik xizmat vaqti")}</div>
          <div className="v">{K.service}</div>
        </div>
      </div>

      <div className="bar">
        <div className="chips">
          {PERIODS.map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>
              {t(l)}
            </button>
          ))}
        </div>
        <div className="r">
          <ExportButtons company={data.settings?.company} notify={notify} disabled={!shown.length} build={() => fleetExcel(shown, from, to)} />
        </div>
      </div>

      {!list ? (
        <div className="loading">{t("Yuklanmoqda…")}</div>
      ) : !shown.length ? (
        <div className="empty">{t("Texnika qo'shilmagan. «Sex va texnika» bo'limida mashinalarni kiriting.")}</div>
      ) : (
        <ul className="veh-list">
          {shown.map((x) => {
            const v = x.vehicle;
            const over = x.normPct > OVER;
            const s = x.service;
            return (
              <li key={v.id}>
                <button className="veh-item" onClick={() => setOpen(v)}>
                  <span className="card-main">
                    <strong>
                      {v.name}
                      {v.code && <span className="muted"> · {v.code}</span>}
                    </strong>
                    <span className="muted">
                      {x.lastMeter != null ? `${fmtN(x.lastMeter, 1)} ${t(unitOf(v))}` : t("ko'rsatkich yo'q")}
                      {x.distance > 0 && ` · ${t("davrda {n}", { n: `${fmtN(x.distance, 1)} ${t(unitOf(v))}` })}`}
                    </span>
                    <span className="veh-tags">
                      {x.rate != null && (
                        <span className={`pill ${over ? "st-bad" : "st-tayyor"}`}>
                          {fmtN(x.rate, 1)} {t(rateUnit(v))}
                          {x.normPct != null && ` · ${x.normPct}%`}
                        </span>
                      )}
                      {s?.status === "due" && <span className="pill st-bad">{t("TO muddati o'tgan")}</span>}
                      {s?.status === "soon" && <span className="pill st-jarayonda">{t("TO yaqin: {n}", { n: `${fmtN(s.left, 0)} ${t(unitOf(v))}` })}</span>}
                    </span>
                  </span>
                  <span className="card-num">
                    <strong>{fmt(x.fuelSum + x.partsSum + x.repairSum + x.otherSum)}</strong>
                    <span className="muted">{t("so'm · {n} l", { n: fmtN(x.fuelQty, 1) })}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="hint">
        {t("Sarf «quyishdan quyishgacha» hisoblanadi: yoqilg'i berilganda spidometr (motosoat) ko'rsatkichi yozilsa, keyingi quyishgacha yurilgan masofaga bo'linadi. Normadan 10% dan ortiq sarf qizil bilan belgilanadi. Normani va texnik xizmat oralig'ini «Sex va texnika» bo'limida kiriting.")}
      </p>
      <VehicleSheet vehicle={open} from={from} to={to} data={data} notify={notify} onClose={() => setOpen(null)} onChanged={() => setTick((x) => x + 1)} />
    </section>
  );
}

function VehicleSheet({ vehicle, from, to, data, notify, onClose, onChanged }) {
  const t = useT();
  const { canStore, canEdit, user } = useUser();
  const ref = useRef(null);
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const { mats } = data;
  const load = () =>
    api(`/vehicles/${vehicle.id}?from=${from}&to=${to}`)
      .then(setD)
      .catch((e) => notify(e.message));
  useEffect(() => {
    const el = ref.current;
    if (vehicle) {
      setD(null);
      setForm(null);
      load();
      if (el && !el.open) el.showModal();
    } else if (el?.open) el.close();
  }, [vehicle, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/vehicle-logs", { method: "POST", body: { ...form, vehicleId: vehicle.id } });
      notify("Saqlandi");
      setForm(null);
      await load();
      onChanged();
    } catch (e2) {
      notify(e2.message);
    } finally {
      setBusy(false);
    }
  }
  async function del(l) {
    try {
      await api(`/vehicle-logs/${l.id}`, { method: "DELETE" });
      await load();
      onChanged();
    } catch (e) {
      notify(e.message);
    }
  }
  const canDel = (l) => canEdit || (l.createdBy?.id === user?.id && Date.now() - new Date(l.createdAt).getTime() < 24 * 36e5);
  const v = vehicle || {};
  const u = unitOf(v);

  return (
    <dialog ref={ref} className="bsheet" onClose={onClose}>
      {vehicle && (
        <div className="bsheet-body">
          <div className="bsheet-grip" aria-hidden="true" />
          <div className="bsheet-head">
            <h2>
              {v.name} {v.code && <span className="muted">· {v.code}</span>}
            </h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Yopish")}>
              <Icon name="close" size={18} />
            </button>
          </div>
          {!d ? (
            <div className="loading">{t("Yuklanmoqda…")}</div>
          ) : (
            <>
              <div className="veh-facts">
                <div>
                  <span className="muted">{t(u === "soat" ? "Motosoat" : "Spidometr, km")}</span>
                  <strong>{d.lastMeter != null ? fmtN(d.lastMeter, 1) : "—"}</strong>
                  {d.lastMeterDate && <span className="muted sm">{fmtDate(d.lastMeterDate)}</span>}
                </div>
                <div>
                  <span className="muted">{t("O'rtacha sarf")}</span>
                  <strong className={d.normPct > OVER ? "late" : ""}>{d.rate != null ? `${fmtN(d.rate, 1)} ${t(rateUnit(v))}` : "—"}</strong>
                  <span className="muted sm">{v.fuelNorm > 0 ? t("norma {n}", { n: `${v.fuelNorm} ${t(rateUnit(v))}` }) : t("norma kiritilmagan")}</span>
                </div>
                <div>
                  <span className="muted">{t("Navbatdagi TO")}</span>
                  <strong className={d.service?.status === "due" ? "late" : ""}>{d.service?.due != null ? `${fmtN(d.service.due, 0)} ${t(u)}` : "—"}</strong>
                  <span className="muted sm">
                    {!d.service
                      ? t("oraliq kiritilmagan")
                      : d.service.left == null
                        ? t("ko'rsatkich yo'q")
                        : d.service.left <= 0
                          ? t("{n} o'tib ketdi", { n: `${fmtN(-d.service.left, 0)} ${t(u)}` })
                          : t("{n} qoldi", { n: `${fmtN(d.service.left, 0)} ${t(u)}` })}
                  </span>
                </div>
                <div>
                  <span className="muted">{t("Davrdagi xarajat")}</span>
                  <strong>{fmt(d.fuelSum + d.partsSum + d.repairSum + d.otherSum)}</strong>
                  <span className="muted sm">
                    {t("yoqilg'i {a} · qism {b} · ta'mir {c}", { a: fmt(d.fuelSum), b: fmt(d.partsSum), c: fmt(d.repairSum) })}
                  </span>
                </div>
              </div>

              {canStore && !form && (
                <div className="two-btn">
                  <button className="btn" onClick={() => setForm({ kind: "tamir", date: today(), cost: "", meter: "", note: "" })}>
                    <Icon name="plus" /> {t("Ta'mir / TO yozish")}
                  </button>
                  <button className="btn" onClick={() => setForm({ kind: "meter", date: today(), cost: "", meter: "", note: "" })}>
                    {t("Ko'rsatkich kiritish")}
                  </button>
                </div>
              )}
              {form && (
                <form className="veh-form" onSubmit={save}>
                  <div className="form-grid two">
                    <div className="field">
                      <label htmlFor="vl-k">{t("Turi")}</label>
                      <select id="vl-k" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                        {KINDS.map(([k, l]) => (
                          <option key={k} value={k}>
                            {t(l)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="vl-d">{t("Sana")}</label>
                      <input id="vl-d" type="date" max={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                    </div>
                    <div className="field">
                      <label htmlFor="vl-m">{t(u === "soat" ? "Motosoat" : "Spidometr, km")}</label>
                      <input id="vl-m" type="number" inputMode="decimal" min="0" step="any" value={form.meter} placeholder={d.lastMeter != null ? String(d.lastMeter) : ""} onChange={(e) => setForm({ ...form, meter: e.target.value })} required={form.kind === "meter"} />
                    </div>
                    {form.kind !== "meter" && (
                      <div className="field">
                        <label htmlFor="vl-c">
                          {t("Xarajat")} <span className="u">({t("so'm, tashqi xizmat")})</span>
                        </label>
                        <input id="vl-c" type="number" inputMode="numeric" min="0" step="1" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
                      </div>
                    )}
                    <div className="field" style={{ gridColumn: "1/-1" }}>
                      <label htmlFor="vl-n">{t("Izoh")}</label>
                      <input id="vl-n" value={form.note} placeholder={form.kind === "to" ? t("Masalan: moy va filtrlar almashtirildi") : ""} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </div>
                  </div>
                  <p className="hint">{t("Ombordan olingan ehtiyot qism va moylar chiqim sifatida shu texnikaga yoziladi — bu yerga faqat tashqi xizmat haqini kiriting.")}</p>
                  <div className="dlg-actions">
                    <button type="button" className="btn" onClick={() => setForm(null)}>
                      {t("Bekor qilish")}
                    </button>
                    <button className="btn primary" disabled={busy}>
                      {busy ? t("Saqlanmoqda…") : t("Saqlash")}
                    </button>
                  </div>
                </form>
              )}

              {d.intervals.length > 0 && (
                <>
                  <h3>{t("Yoqilg'i sarfi (quyishdan quyishgacha)")}</h3>
                  <div className="tbl-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Sana")}</th>
                          <th className="n">{t("Yurdi")}</th>
                          <th className="n">{t("Quyildi, l")}</th>
                          <th className="n">{t("Sarf")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.intervals.map((i) => (
                          <tr key={`${i.from}-${i.meterFrom}`} className={i.pct > OVER ? "row-bad" : ""}>
                            <td className="num">
                              {fmtDate(i.from).slice(0, 5)} → {fmtDate(i.to).slice(0, 5)}
                              <span className="sub">
                                {fmtN(i.meterFrom, 0)} → {fmtN(i.meterTo, 0)}
                              </span>
                            </td>
                            <td className="n">
                              {fmtN(i.dist, 1)} <span className="unit-s">{t(u)}</span>
                            </td>
                            <td className="n">{fmtN(i.fuel, 1)}</td>
                            <td className={`n${i.pct > OVER ? " late" : ""}`}>
                              {fmtN(i.rate, 1)}
                              {i.pct != null && <span className="sub">{i.pct}%</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <h3>{t("Ombordan berilgan")}</h3>
              {!d.moves.length ? (
                <div className="empty">{t("Bu davrda berilmagan.")}</div>
              ) : (
                <ul className="prices">
                  {d.moves.map((m) => {
                    const mat = mats.get(m.materialId);
                    return (
                      <li key={m.id}>
                        <span>
                          {mat?.name || "—"}
                          <small className="muted">
                            {" "}
                            · {fmtDate(m.date)}
                            {m.meter != null ? ` · ${fmtN(m.meter, 1)} ${t(u)}` : ""}
                            {m.person ? ` · ${m.person}` : ""}
                          </small>
                        </span>
                        <strong>
                          {fmtN(m.qty, 3)} {mat?.unit}
                          <small className="muted"> · {fmt(m.qty * (m.price || 0))}</small>
                        </strong>
                      </li>
                    );
                  })}
                </ul>
              )}

              <h3>{t("Ta'mir va texnik xizmat")}</h3>
              {!d.logs.length ? (
                <div className="empty">{t("Bu davrda yozuv yo'q.")}</div>
              ) : (
                <ul className="brak-list">
                  {d.logs.map((l) => (
                    <li key={l.id}>
                      <span className="card-main">
                        <strong>{t(kindLabel(l.kind))}</strong>
                        <span className="muted">
                          {fmtDate(l.date)}
                          {l.meter != null ? ` · ${fmtN(l.meter, 1)} ${t(u)}` : ""}
                          {l.note ? ` · ${l.note}` : ""}
                          {l.createdBy?.name ? ` · ${l.createdBy.name}` : ""}
                        </span>
                      </span>
                      <span className="card-num">
                        {l.cost > 0 && <strong>{fmt(l.cost)}</strong>}
                        {canDel(l) && (
                          <button className="linkbtn" onClick={() => del(l)}>
                            {t("O'chirish")}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </dialog>
  );
}

function fleetExcel(list, from, to) {
  const sub = `${fmtDate(from)} — ${fmtDate(to)}`;
  const rows = list.map((x) => {
    const v = x.vehicle;
    return {
      name: v.name, code: v.code, meter: x.lastMeter, unit: tr(unitOf(v)), dist: x.distance || null, fuel: x.fuelQty || null, fuelSum: x.fuelSum || null,
      rate: x.rate, norm: v.fuelNorm || null, pct: x.normPct, parts: x.partsSum || null, repair: x.repairSum || null,
      total: x.fuelSum + x.partsSum + x.repairSum + x.otherSum || null, due: x.service?.due ?? null,
      _cell: { ...(x.normPct > OVER && { pct: "bad", rate: "bad" }), ...(x.service?.status === "due" && { due: "bad" }) },
    };
  });
  const ints = [];
  for (const x of list)
    for (const i of x.intervals)
      ints.push({ name: x.vehicle.name, from: fmtDate(i.from), to: fmtDate(i.to), m1: i.meterFrom, m2: i.meterTo, dist: i.dist, fuel: i.fuel, rate: i.rate, pct: i.pct, _cell: i.pct > OVER ? { pct: "bad" } : undefined });
  return {
    filename: `Texnika_${fileDate()}.xlsx`,
    sheets: [
      {
        name: tr("Texnika"),
        title: tr("Texnika bo'yicha xarajat va yoqilg'i sarfi"),
        subtitle: sub,
        columns: [
          { header: tr("Texnika"), key: "name", width: 24 },
          { header: tr("Davlat raqami"), key: "code", width: 14 },
          { header: tr("Ko'rsatkich"), key: "meter", type: "num", width: 12 },
          { header: tr("Birlik"), key: "unit", width: 7 },
          { header: tr("Yurdi"), key: "dist", type: "num", width: 10 },
          { header: tr("Yoqilg'i, l"), key: "fuel", type: "num", total: "sum", width: 11 },
          { header: tr("Yoqilg'i, so'm"), key: "fuelSum", type: "money", total: "sum", width: 14 },
          { header: tr("Sarf"), key: "rate", type: "num", width: 9 },
          { header: tr("Norma"), key: "norm", type: "num", width: 9 },
          { header: tr("Normaga, %"), key: "pct", type: "int", width: 10 },
          { header: tr("Ehtiyot qism, so'm"), key: "parts", type: "money", total: "sum", width: 15 },
          { header: tr("Ta'mir, so'm"), key: "repair", type: "money", total: "sum", width: 14 },
          { header: tr("Jami, so'm"), key: "total", type: "money", total: "sum", width: 15 },
          { header: tr("Navbatdagi TO"), key: "due", type: "num", width: 13 },
        ],
        rows,
      },
      {
        name: tr("Quyishlar"),
        title: tr("Yoqilg'i sarfi: quyishdan quyishgacha"),
        subtitle: sub,
        columns: [
          { header: tr("Texnika"), key: "name", width: 24 },
          { header: tr("Dan"), key: "from", type: "date", width: 12 },
          { header: tr("Gacha"), key: "to", type: "date", width: 12 },
          { header: tr("Ko'rsatkich (dan)"), key: "m1", type: "num", width: 14 },
          { header: tr("Ko'rsatkich (gacha)"), key: "m2", type: "num", width: 14 },
          { header: tr("Yurdi"), key: "dist", type: "num", total: "sum", width: 10 },
          { header: tr("Quyildi, l"), key: "fuel", type: "num", total: "sum", width: 11 },
          { header: tr("Sarf"), key: "rate", type: "num", width: 9 },
          { header: tr("Normaga, %"), key: "pct", type: "int", width: 10 },
        ],
        rows: ints,
      },
    ],
  };
}
