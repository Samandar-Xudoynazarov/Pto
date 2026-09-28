/**
 * Texnika hisobi (sof funksiya — DB'ga bog'liq emas).
 *
 * Yoqilg'i sarfi «quyishdan quyishgacha»: i-quyishda yozilgan spidometr (yoki motosoat) ko'rsatkichidan
 * keyingi ko'rsatkichli quyishgacha yurilgan masofaga shu i-quyishdagi yoqilg'i sarflangan deb olinadi.
 *   km   → l / 100 km = yoqilg'i ÷ masofa × 100
 *   soat → l / soat   = yoqilg'i ÷ motosoat
 * Texnik xizmat (TO): oxirgi «to» yozuvidagi ko'rsatkich + har necha km/soatda = navbatdagi TO.
 */

const DAY = (m) => `${m.date} ${m.createdAt ? new Date(m.createdAt).toISOString() : ""}`;
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * vehicle: { id, name, meterUnit: "km"|"soat", fuelNorm, serviceEvery }
 * moves:   ombordan shu texnikaga chiqimlar [{ date, createdAt, qty, price, meter, group, materialId }]
 * logs:    ta'mir / TO / ko'rsatkich yozuvlari [{ date, createdAt, kind, cost, meter }]
 */
export function vehicleStats(vehicle, moves, logs, from, to) {
  const perKm = (vehicle.meterUnit || "km") === "km";
  const inP = (d) => d >= from && d <= to;
  const fuel = moves.filter((m) => m.group === "yoqilgi").sort((a, b) => DAY(a).localeCompare(DAY(b)));
  const readings = [
    ...moves.filter((m) => m.meter != null).map((m) => ({ date: m.date, at: DAY(m), meter: +m.meter })),
    ...logs.filter((l) => l.meter != null).map((l) => ({ date: l.date, at: DAY(l), meter: +l.meter })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  // quyishdan quyishgacha oraliqlar (boshlanishi davr ichida bo'lganlari)
  const fills = fuel.filter((m) => m.meter != null);
  const intervals = [];
  for (let i = 0; i + 1 < fills.length; i++) {
    const a = fills[i];
    const b = fills[i + 1];
    const dist = +b.meter - +a.meter;
    if (!inP(a.date) || !(dist > 0)) continue;
    const rate = perKm ? (a.qty / dist) * 100 : a.qty / dist;
    intervals.push({
      from: a.date, to: b.date, meterFrom: +a.meter, meterTo: +b.meter, dist, fuel: a.qty, rate: r2(rate),
      pct: vehicle.fuelNorm > 0 ? Math.round((rate / vehicle.fuelNorm) * 100) : null,
    });
  }
  const dSum = intervals.reduce((s, x) => s + x.dist, 0);
  const fSum = intervals.reduce((s, x) => s + x.fuel, 0);
  const rate = dSum > 0 ? (perKm ? (fSum / dSum) * 100 : fSum / dSum) : null;

  const pm = moves.filter((m) => inP(m.date));
  const sum = (arr) => arr.reduce((s, m) => s + (+m.qty || 0) * (+m.price || 0), 0);
  const pr = readings.filter((x) => inP(x.date)).map((x) => x.meter);
  const last = readings.length ? readings[readings.length - 1] : null;

  // texnik xizmat
  const tos = logs.filter((l) => l.kind === "to").sort((a, b) => DAY(a).localeCompare(DAY(b)));
  const lastTO = tos.length ? tos[tos.length - 1] : null;
  let service = null;
  if (vehicle.serviceEvery > 0) {
    const base = lastTO?.meter ?? (lastTO ? null : readings[0]?.meter ?? null);
    const due = base == null ? null : base + vehicle.serviceEvery;
    const left = due == null || !last ? null : due - last.meter;
    service = {
      every: vehicle.serviceEvery,
      lastDate: lastTO?.date || null,
      lastMeter: lastTO?.meter ?? null,
      due,
      left,
      status: left == null ? "unknown" : left <= 0 ? "due" : left <= vehicle.serviceEvery * 0.1 ? "soon" : "ok",
    };
  }

  const fuelP = pm.filter((m) => m.group === "yoqilgi");
  return {
    id: vehicle.id,
    fuelQty: r2(fuelP.reduce((s, m) => s + (+m.qty || 0), 0)),
    fuelSum: Math.round(sum(fuelP)),
    partsSum: Math.round(sum(pm.filter((m) => m.group === "ehtiyot"))),
    otherSum: Math.round(sum(pm.filter((m) => m.group !== "yoqilgi" && m.group !== "ehtiyot"))),
    repairSum: Math.round(logs.filter((l) => inP(l.date)).reduce((s, l) => s + (+l.cost || 0), 0)),
    distance: pr.length > 1 ? r2(Math.max(...pr) - Math.min(...pr)) : 0,
    rate: rate == null ? null : r2(rate),
    normPct: rate != null && vehicle.fuelNorm > 0 ? Math.round((rate / vehicle.fuelNorm) * 100) : null,
    lastMeter: last?.meter ?? null,
    lastMeterDate: last?.date ?? null,
    intervals,
    service,
  };
}
