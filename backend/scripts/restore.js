// Zaxira nusxadan (pto-backup-....json) bazani tiklaydi.
//
//   npm run restore -- pto-backup-2026-09-24-18-30.json            — nima tiklanishini ko'rsatadi (hech narsa o'zgarmaydi)
//   npm run restore -- pto-backup-2026-09-24-18-30.json --yes      — materiallar, mahsulotlar, kunlar,
//                                                                      buyurtmalar va sozlamalarni zaxiradagisi bilan almashtiradi
//
// Foydalanuvchilar va o'zgarishlar jurnali tegilmaydi (zaxirada parollar saqlanmaydi).
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "../src/db.js";
import { Material, Product, Day, Order, Settings, Counter } from "../src/models.js";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const yes = args.includes("--yes");
if (!file) {
  console.log("Fayl ko'rsatilmagan. Masalan: npm run restore -- pto-backup-2026-09-24-18-30.json --yes");
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"));
if (backup?.app !== "pto" || !backup.data) {
  console.log("Bu fayl ПТО zaxira nusxasi emas.");
  process.exit(1);
}
const d = backup.data;
const plan = [
  ["materiallar", Material, d.materials],
  ["mahsulotlar", Product, d.products],
  ["kunlik hisobotlar", Day, d.days],
  ["buyurtmalar", Order, d.orders],
  ["sozlamalar", Settings, d.settings],
];

console.log(`Zaxira: ${backup.createdAt} (${backup.createdBy || "?"})`);
await connectDB();
for (const [name, Model, rows] of plan) {
  console.log(`  ${name.padEnd(18)} bazada: ${String(await Model.countDocuments()).padStart(5)}  →  zaxirada: ${(rows || []).length}`);
}
if (!yes) {
  console.log("\nHech narsa o'zgartirilmadi. Tiklash uchun oxiriga --yes qo'shing.");
  await mongoose.disconnect();
  process.exit(0);
}

// 1) Zaxiradagi har bir yozuvni OLDINDAN tekshiramiz — xato bo'lsa, bazaga umuman tegilmaydi
let bad = 0;
for (const [name, Model, rows] of plan) {
  for (const [i, row] of (rows || []).entries()) {
    const err = await new Model(row).validate().then(() => null, (e) => e);
    if (err) {
      bad++;
      if (bad <= 10) console.log(`✗ ${name} #${i + 1}: ${Object.values(err.errors || {}).map((e) => e.message).join("; ") || err.message}`);
    }
  }
}
if (bad) {
  console.log(`\nZaxirada ${bad} ta noto'g'ri yozuv bor. Baza o'zgartirilmadi.`);
  await mongoose.disconnect();
  process.exit(1);
}

// 2) Joriy bazani avval faylga saqlab qo'yamiz (shu skript bilan qayta tiklash mumkin)
const current = {};
for (const [name, Model] of plan) current[name] = await Model.find().lean();
const stamp = new Date(Date.now() + 5 * 36e5).toISOString().slice(0, 19).replace(/[T:]/g, "-");
const safetyFile = path.resolve(process.cwd(), `pto-avto-zaxira-${stamp}.json`);
const [materials, products, days, orders, settings] = plan.map(([name]) => current[name]);
fs.writeFileSync(
  safetyFile,
  JSON.stringify({
    app: "pto",
    format: 1,
    createdAt: new Date().toISOString(),
    createdBy: "restore.js (tiklashdan oldingi holat)",
    counts: { materials: materials.length, products: products.length, days: days.length, orders: orders.length },
    data: { materials, products, days, orders, settings, users: [] },
  })
);
console.log(`Joriy baza saqlandi: ${path.basename(safetyFile)}`);

// 3) Almashtirish. Xato bo'lsa, allaqachon o'zgargan jadvallar avvalgi holatiga qaytariladi
const touched = [];
try {
  for (const [name, Model, rows] of plan) {
    touched.push([name, Model]);
    await Model.deleteMany({});
    if (rows?.length) await Model.insertMany(rows, { ordered: true });
    console.log(`✓ ${name}: ${rows?.length || 0}`);
  }
} catch (err) {
  console.log(`\n✗ Tiklashda xato: ${err?.message}`);
  console.log("Avvalgi holat qaytarilmoqda…");
  try {
    for (const [name, Model] of touched) {
      await Model.deleteMany({});
      if (current[name].length) await Model.insertMany(current[name], { ordered: true });
      console.log(`  ↺ ${name}: ${current[name].length}`);
    }
    await Counter.deleteOne({ _id: "order" });
    console.log("Baza avvalgi holatiga qaytarildi.");
  } catch (err2) {
    console.log(`Avvalgi holatni qaytarib bo'lmadi: ${err2?.message}`);
    console.log(`Qo'lda tiklang: npm run restore -- ${path.basename(safetyFile)} --yes`);
  }
  await mongoose.disconnect();
  process.exit(1);
}
// buyurtma raqami hisoblagichi keyingi buyurtmada tiklangan buyurtmalardagi eng katta raqamdan qayta boshlanadi
await Counter.deleteOne({ _id: "order" });
console.log("Tiklandi.");
console.log(`(Kerak bo'lsa, avvalgi holat: npm run restore -- ${path.basename(safetyFile)} --yes)`);
await mongoose.disconnect();
