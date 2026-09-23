// Excel'dan tayyorlangan ma'lumotlarni bazaga yuklaydi.
//
//   npm run import                 — faqat bo'sh bazaga yuklaydi
//   npm run import -- --reset      — hamma narsani o'chirib, qaytadan yuklaydi
//   npm run import -- data/boshqa.json
//
// Fayl tuzilishi: { materials, products, settings, days } — nomlar orqali bog'langan.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "../src/db.js";
import { Material, Product, Day, Order, Settings } from "../src/models.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const reset = args.includes("--reset");
const file = args.find((a) => a.endsWith(".json")) || "data/pto-sentyabr-2026.json";
const data = JSON.parse(fs.readFileSync(path.resolve(here, file), "utf8"));

await connectDB();

if (reset) {
  await Promise.all([Material.deleteMany({}), Product.deleteMany({}), Day.deleteMany({}), Order.deleteMany({}), Settings.deleteMany({})]);
  console.log("Baza tozalandi.");
} else if ((await Material.countDocuments()) || (await Product.countDocuments())) {
  console.log("Bazada ma'lumot bor. Qaytadan yuklash uchun: npm run import -- --reset");
  await mongoose.disconnect();
  process.exit(0);
}

// 1) materiallar (avval retseptsiz, keyin retseptlarni bog'laymiz)
const matId = new Map();
for (const [i, m] of data.materials.entries()) {
  const doc = await Material.create({
    name: m.name, unit: m.unit || "шт", group: m.group, price: m.price || 0,
    stock: Boolean(m.stock), electrodeBase: Boolean(m.electrodeBase), sort: i + 1,
  });
  matId.set(m.name, doc._id);
}
const M = (name) => {
  const id = matId.get(name);
  if (!id) throw new Error(`Material topilmadi: ${name}`);
  return id;
};
const lines = (arr = []) => arr.map((l) => ({ materialId: M(l.material), norm: l.norm }));
for (const m of data.materials) {
  if (m.recipe || m.writeoff) await Material.updateOne({ _id: M(m.name) }, { recipe: lines(m.recipe), writeoff: lines(m.writeoff) });
}
console.log(`${matId.size} ta material`);

// 2) mahsulotlar
const prodId = new Map();
for (const [i, p] of data.products.entries()) {
  const doc = await Product.create({
    code: p.code, name: p.name, group: p.group, sort: i + 1, notes: p.notes || [],
    excelPrice: p.excelPrice ?? null,
    norms: lines(p.norms),
    calc: p.calc ? { ...p.calc, items: lines(p.calc.items) } : data.settings.calcTemplate ? { ...data.settings.calcTemplate, items: [] } : undefined,
  });
  prodId.set(p.code, doc._id);
}
const P = (code) => {
  const id = prodId.get(code);
  if (!id) throw new Error(`Mahsulot topilmadi: ${code}`);
  return id;
};
console.log(`${prodId.size} ta mahsulot`);

// 3) sozlamalar va boshlang'ich qoldiq
const s = data.settings || {};
const byId = (obj, fn) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v).map(([k, v]) => [String(fn(k)), v]));
const template = s.calcTemplate ? { ...s.calcTemplate, items: [] } : null;
await Settings.create({
  key: "main",
  electrodePct: s.electrodePct ?? 1.5,
  company: s.company || "",
  signers: s.signers || [],
  calcTemplate: template,
  opening: s.opening
    ? { date: s.opening.date, materials: byId(s.opening.materials, M), products: byId(s.opening.products, P) }
    : { date: "", materials: {}, products: {} },
});

// 4) kunlik hisobotlar
for (const d of data.days || []) {
  await Day.create({
    date: d.date,
    note: d.note || "",
    production: d.production.map((l) => ({ productId: P(l.product), plan: l.plan || 0, fact: l.fact || 0, note: l.note || "" })),
    materials: d.materials.map((l) => ({ materialId: M(l.material), sarf: l.sarf || 0, kirim: l.kirim || 0 })),
    shipments: d.shipments.map((l) => ({ productId: P(l.product), qty: l.qty, customer: l.customer || "", vehicle: l.vehicle || "" })),
  });
}
console.log(`${(data.days || []).length} ta kunlik hisobot`);
console.log("Tayyor.");
await mongoose.disconnect();
