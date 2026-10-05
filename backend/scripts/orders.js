// Shartnomalar (buyurtmalar) ro'yxatini JSON fayldan bazaga qo'shadi.
//
//   npm run orders                                  — nima qo'shilishini ko'rsatadi (bazaga tegmaydi)
//   npm run orders -- --yes                         — qo'shadi
//   npm run orders -- data/boshqa.json --yes        — boshqa fayldan
//   npm run orders -- --yes --update                — shu shartnoma raqami bilan buyurtma bo'lsa, mahsulotlarini yangilaydi
//
// Fayl: { newProducts: [{ code, name, group }], orders: [{ contractNo, customer, status, note, date, deadline,
//         items: [{ code, qty, price, shippedBefore }] }] }
//   code — katalogdagi marka (katta-kichik harf, bo'shliq, «,»/«.» farqi hisobga olinmaydi)
//   shippedBefore — tizimdan oldin jo'natilgan soni
//   newProducts — katalogda yo'q bo'lsa yaratiladigan mahsulotlar (normasiz; «Katalog»da to'ldiriladi)
// Shartnoma raqami bazada bo'lsa, buyurtma qayta qo'shilmaydi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "../src/db.js";
import { Product, Order, Settings, Counter, AuditLog, STATUSES } from "../src/models.js";
import { cleanItems } from "../src/orders.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const update = args.includes("--update");
const file = args.find((a) => a.endsWith(".json")) || "data/buyurtmalar-2026-07-01.json";
const data = JSON.parse(fs.readFileSync(path.resolve(here, file), "utf8"));

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "").replace(/,/g, ".");
const fmt = (n) => Math.round(n).toLocaleString("ru-RU");
const who = { id: "", username: "import", name: "Import (npm run orders)" };
const log = (entry) => AuditLog.create({ user: who, changes: [], more: 0, ...entry }).catch(() => {});

await connectDB();

const products = await Product.find().select("code").lean();
const byCode = new Map(products.map((p) => [norm(p.code), p]));
const toCreate = (data.newProducts || []).filter((p) => !byCode.has(norm(p.code)));

// 1) tekshiruv
const problems = [];
const plan = [];
for (const o of data.orders || []) {
  const contractNo = String(o.contractNo || "").trim();
  if (!contractNo) problems.push(`${o.customer}: shartnoma raqami yo'q`);
  const missing = o.items.filter((it) => !byCode.has(norm(it.code)) && !toCreate.some((p) => norm(p.code) === norm(it.code)));
  for (const it of missing) problems.push(`${contractNo}: «${it.code}» katalogda yo'q va newProducts'da ham yo'q`);
  if (o.status && !STATUSES.includes(o.status)) problems.push(`${contractNo}: holat noto'g'ri — ${o.status}`);
  const exists = contractNo ? await Order.findOne({ contractNo }).select("no customer").lean() : null;
  plan.push({ o, contractNo, exists });
}

console.log(`Fayl: ${file}${data.source ? ` (${data.source})` : ""}\n`);
if (toCreate.length) console.log(`Katalogga qo'shiladigan mahsulotlar (${toCreate.length}): ${toCreate.map((p) => p.code).join(", ")}\n`);
for (const { o, contractNo, exists } of plan) {
  const sum = o.items.reduce((s, it) => s + it.qty * (it.price || 0), 0);
  const before = o.items.reduce((s, it) => s + (it.shippedBefore || 0), 0);
  const qty = o.items.reduce((s, it) => s + it.qty, 0);
  const action = exists ? (update ? `YANGILANADI (№${exists.no})` : `O'TKAZIB YUBORILADI — bazada bor (№${exists.no})`) : "QO'SHILADI";
  console.log(`Shartnoma ${contractNo} — ${o.customer}: ${o.items.length} ta mahsulot, ${qty} dona, oldin jo'natilgan ${before}, summa ${fmt(sum)} so'm → ${action}`);
  for (const it of o.items) console.log(`   ${it.code.padEnd(14)} ${String(it.qty).padStart(5)} dona  oldin ${String(it.shippedBefore || 0).padStart(4)}  narx ${fmt(it.price || 0)}`);
}
if (problems.length) {
  console.log(`\nXatolar — hech narsa yozilmadi:\n - ${problems.join("\n - ")}`);
  await mongoose.disconnect();
  process.exit(1);
}
if (!yes) {
  console.log("\nBazaga hech narsa yozilmadi. Qo'shish uchun: npm run orders -- --yes");
  await mongoose.disconnect();
  process.exit(0);
}

// 2) yangi mahsulotlar
if (toCreate.length) {
  const [last, settings] = await Promise.all([Product.findOne().sort({ sort: -1 }).select("sort").lean(), Settings.findOne({ key: "main" }).lean()]);
  let sort = last?.sort || 0;
  const scheme = Array.isArray(settings?.costSchemes) && settings.costSchemes[0]?.id;
  for (const p of toCreate) {
    const doc = await Product.create({ code: p.code, name: p.name || "", group: p.group || "", sort: ++sort, ...(scheme ? { calc: { scheme } } : settings?.calcTemplate ? { calc: { ...settings.calcTemplate, items: [] } } : {}) });
    byCode.set(norm(doc.code), doc);
    await log({ action: "create", entity: "product", entityId: String(doc._id), label: `${doc.code} (buyurtmalar importi)` });
    console.log(`+ mahsulot ${doc.code}`);
  }
}

// 3) buyurtmalar
async function nextOrderNo() {
  const c = await Counter.findOneAndUpdate({ _id: "order" }, { $inc: { seq: 1 } }, { returnDocument: "after" });
  if (c) return c.seq;
  const lastOrder = await Order.findOne().sort({ no: -1 }).select("no").lean();
  try {
    await Counter.create({ _id: "order", seq: lastOrder?.no || 0 });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
  return nextOrderNo();
}

let added = 0;
let updated = 0;
for (const { o, contractNo, exists } of plan) {
  if (exists && !update) continue;
  const raw = o.items.map((it) => ({ productId: String(byCode.get(norm(it.code))._id), qty: it.qty, price: it.price || 0, shippedBefore: it.shippedBefore || 0 }));
  const r = cleanItems(raw, mongoose.isValidObjectId);
  if (r.error) throw new Error(`${contractNo}: ${r.error}`);
  const fields = { customer: o.customer, contractNo, items: r.items, note: o.note || "", ...(o.date && { date: o.date }), ...(o.deadline && { deadline: o.deadline }), ...(o.status && { status: o.status }) };
  if (exists) {
    await Order.updateOne({ _id: exists._id }, { $set: fields, $unset: { productId: 1, qty: 1, price: 1 } }, { runValidators: true });
    await log({ action: "update", entity: "order", entityId: String(exists._id), label: `№${exists.no} ${o.customer} (shartnoma ${contractNo}) — importdan yangilandi` });
    updated++;
  } else {
    const doc = await Order.create({ ...fields, no: await nextOrderNo() });
    await log({ action: "create", entity: "order", entityId: String(doc._id), label: `№${doc.no} ${doc.customer} (shartnoma ${contractNo}) — importdan` });
    console.log(`+ buyurtma №${doc.no}: ${doc.customer}, shartnoma ${contractNo}`);
    added++;
  }
}
console.log(`\nTayyor: ${added} ta buyurtma qo'shildi${updated ? `, ${updated} ta yangilandi` : ""}${toCreate.length ? `, ${toCreate.length} ta mahsulot katalogga qo'shildi` : ""}.`);
await mongoose.disconnect();
