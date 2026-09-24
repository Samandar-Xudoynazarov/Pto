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
import { Material, Product, Day, Order, Settings } from "../src/models.js";

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

for (const [name, Model, rows] of plan) {
  await Model.deleteMany({});
  if (rows?.length) await Model.insertMany(rows, { ordered: true });
  console.log(`✓ ${name}: ${rows?.length || 0}`);
}
console.log("Tiklandi.");
await mongoose.disconnect();
