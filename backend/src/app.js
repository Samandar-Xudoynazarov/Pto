import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDB } from "./db.js";
import { Material, Product, Day, Order, Settings, DATE_RE } from "./models.js";
import { stockReport } from "./stock.js";

const app = express();

/* ---------- CORS ---------- */
const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: origins.includes("*") ? true : origins,
    allowedHeaders: ["Content-Type", "x-app-password"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);
app.use(express.json({ limit: "2mb" }));

/* ---------- ochiq yo'llar ---------- */
app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

function passwordOk(given) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true; // parol o'rnatilmagan bo'lsa himoya o'chiq
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

app.post("/api/login", (req, res) => {
  if (!passwordOk(req.body?.password)) return res.status(401).json({ error: "Parol noto'g'ri" });
  res.json({ ok: true, protected: Boolean(process.env.APP_PASSWORD) });
});

/* ---------- himoya va DB ulanish ---------- */
app.use("/api", (req, res, next) => {
  if (!passwordOk(req.get("x-app-password"))) return res.status(401).json({ error: "Kirish uchun parol kerak" });
  next();
});
app.use("/api", async (_req, _res, next) => {
  await connectDB();
  next();
});

/* ---------- yordamchilar ---------- */
const isId = (v) => mongoose.isValidObjectId(v);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));
const notFound = (res) => res.status(404).json({ error: "Yozuv topilmadi" });
const upd = { returnDocument: "after", runValidators: true };
const validDate = (s) => typeof s === "string" && DATE_RE.test(s);

async function getSettings() {
  return (await Settings.findOne({ key: "main" })) || (await Settings.create({ key: "main" }));
}

/* ---------- Materiallar ---------- */
const MATERIAL_FIELDS = ["name", "unit", "group", "price", "stock", "electrodeBase", "recipe", "writeoff", "sort"];

app.get("/api/materials", async (_req, res) => {
  res.json(await Material.find().sort({ sort: 1, name: 1 }));
});
app.post("/api/materials", async (req, res) => {
  const last = await Material.findOne().sort({ sort: -1 }).select("sort");
  res.status(201).json(await Material.create({ sort: (last?.sort || 0) + 1, ...pick(req.body, MATERIAL_FIELDS) }));
});
app.put("/api/materials/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Material.findByIdAndUpdate(req.params.id, pick(req.body, MATERIAL_FIELDS), upd);
  doc ? res.json(doc) : notFound(res);
});
app.delete("/api/materials/:id", async (req, res) => {
  const id = req.params.id;
  if (!isId(id)) return notFound(res);
  const used =
    (await Product.exists({ $or: [{ "norms.materialId": id }, { "calc.items.materialId": id }] })) ||
    (await Material.exists({ $or: [{ "recipe.materialId": id }, { "writeoff.materialId": id }] })) ||
    (await Day.exists({ "materials.materialId": id }));
  if (used) return res.status(409).json({ error: "Material normalarda, retseptda yoki kunlik hisobotda ishlatilgan — o'chirib bo'lmaydi" });
  const doc = await Material.findByIdAndDelete(id);
  doc ? res.json({ ok: true }) : notFound(res);
});

/* ---------- Mahsulotlar ---------- */
const PRODUCT_FIELDS = ["code", "name", "group", "norms", "calc", "notes", "sort"];

app.get("/api/products", async (_req, res) => {
  res.json(await Product.find().sort({ sort: 1, code: 1 }));
});
app.post("/api/products", async (req, res) => {
  const data = pick(req.body, PRODUCT_FIELDS);
  if (!data.calc) data.calc = (await getSettings()).calcTemplate || undefined;
  const last = await Product.findOne().sort({ sort: -1 }).select("sort");
  res.status(201).json(await Product.create({ sort: (last?.sort || 0) + 1, ...data }));
});
app.put("/api/products/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Product.findByIdAndUpdate(req.params.id, pick(req.body, PRODUCT_FIELDS), upd);
  doc ? res.json(doc) : notFound(res);
});
app.delete("/api/products/:id", async (req, res) => {
  const id = req.params.id;
  if (!isId(id)) return notFound(res);
  const used =
    (await Order.exists({ productId: id })) ||
    (await Day.exists({ $or: [{ "production.productId": id }, { "shipments.productId": id }] }));
  if (used) return res.status(409).json({ error: "Mahsulot buyurtma yoki kunlik hisobotda ishlatilgan — o'chirib bo'lmaydi" });
  const doc = await Product.findByIdAndDelete(id);
  doc ? res.json({ ok: true }) : notFound(res);
});

/* ---------- Kunlik hisobotlar ---------- */
const DAY_FIELDS = ["note", "production", "materials", "shipments"];

app.get("/api/days", async (req, res) => {
  const { from, to, month } = req.query;
  const q = {};
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) q.date = { $gte: `${month}-01`, $lte: `${month}-31` };
  else if (validDate(from) || validDate(to)) q.date = { ...(validDate(from) && { $gte: from }), ...(validDate(to) && { $lte: to }) };
  res.json(await Day.find(q).sort({ date: 1 }).limit(1000));
});
app.get("/api/days/:date", async (req, res) => {
  if (!validDate(req.params.date)) return res.status(400).json({ error: "Sana formati YYYY-MM-DD" });
  const doc = await Day.findOne({ date: req.params.date });
  res.json(doc || { date: req.params.date, note: "", production: [], materials: [], shipments: [], isNew: true });
});
app.put("/api/days/:date", async (req, res) => {
  const date = req.params.date;
  if (!validDate(date)) return res.status(400).json({ error: "Sana formati YYYY-MM-DD" });
  const data = pick(req.body, DAY_FIELDS);
  // bo'sh qatorlarni tashlab yuboramiz
  if (data.production) data.production = data.production.filter((l) => l.productId && ((+l.plan || 0) || (+l.fact || 0) || l.note));
  if (data.materials) data.materials = data.materials.filter((l) => l.materialId && ((+l.sarf || 0) || (+l.kirim || 0)));
  if (data.shipments)
    data.shipments = data.shipments
      .filter((l) => l.productId && +l.qty > 0)
      .map((l) => ({ ...l, orderId: isId(l.orderId) ? l.orderId : null }));
  const doc = await Day.findOneAndUpdate({ date }, { $set: { ...data, date } }, { ...upd, upsert: true, setDefaultsOnInsert: true });
  res.json(doc);
});
app.delete("/api/days/:date", async (req, res) => {
  const doc = await Day.findOneAndDelete({ date: req.params.date });
  doc ? res.json({ ok: true }) : notFound(res);
});

/* ---------- Ombor qoldig'i ---------- */
app.get("/api/stock", async (req, res) => {
  const { from, to } = req.query;
  if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: "from va to sanalarini YYYY-MM-DD formatida bering" });
  const s = await getSettings();
  const opening = s.opening?.date ? s.opening : { date: "", materials: {}, products: {} };
  const days = await Day.find({ date: { $gte: opening.date || "0000-00-00", $lte: to } }).lean();
  res.json(stockReport(opening, days, from, to));
});

/* ---------- Buyurtmalar ---------- */
const ORDER_FIELDS = ["customer", "productId", "qty", "price", "date", "deadline", "status", "note"];

app.get("/api/orders", async (_req, res) => {
  const [orders, shipped] = await Promise.all([
    Order.find().sort({ no: 1 }),
    Day.aggregate([
      { $unwind: "$shipments" },
      { $match: { "shipments.orderId": { $ne: null } } },
      { $group: { _id: "$shipments.orderId", qty: { $sum: "$shipments.qty" } } },
    ]),
  ]);
  const map = new Map(shipped.map((s) => [String(s._id), s.qty]));
  res.json(orders.map((o) => ({ ...o.toJSON(), shipped: map.get(o.id) || 0 })));
});
app.post("/api/orders", async (req, res) => {
  const data = pick(req.body, ORDER_FIELDS);
  if (!isId(data.productId) || !(await Product.exists({ _id: data.productId }))) return res.status(400).json({ error: "Mahsulot topilmadi" });
  const last = await Order.findOne().sort({ no: -1 }).select("no");
  res.status(201).json(await Order.create({ ...data, no: (last?.no || 0) + 1 }));
});
app.put("/api/orders/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Order.findByIdAndUpdate(req.params.id, pick(req.body, ORDER_FIELDS), upd);
  doc ? res.json(doc) : notFound(res);
});
app.delete("/api/orders/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Order.findByIdAndDelete(req.params.id);
  if (!doc) return notFound(res);
  await Day.updateMany({ "shipments.orderId": doc._id }, { $set: { "shipments.$[s].orderId": null } }, { arrayFilters: [{ "s.orderId": doc._id }] });
  res.json({ ok: true });
});

/* ---------- Sozlamalar ---------- */
app.get("/api/settings", async (_req, res) => {
  res.json(await getSettings());
});
app.put("/api/settings", async (req, res) => {
  const s = await getSettings();
  const b = req.body || {};
  if (b.electrodePct !== undefined) s.electrodePct = Math.max(0, +b.electrodePct || 0);
  if (b.company !== undefined) s.company = String(b.company).slice(0, 200);
  if (Array.isArray(b.signers)) s.signers = b.signers.map((x) => String(x).slice(0, 120)).slice(0, 6);
  if (b.calcTemplate !== undefined) {
    s.calcTemplate = b.calcTemplate;
    s.markModified("calcTemplate");
  }
  if (b.opening) {
    if (b.opening.date !== undefined && b.opening.date !== "" && !validDate(b.opening.date))
      return res.status(400).json({ error: "Boshlang'ich qoldiq sanasi noto'g'ri" });
    const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => isId(k) && Number.isFinite(+v) && +v !== 0).map(([k, v]) => [k, +v]));
    s.opening = {
      date: b.opening.date ?? s.opening?.date ?? "",
      materials: b.opening.materials ? clean(b.opening.materials) : s.opening?.materials || {},
      products: b.opening.products ? clean(b.opening.products) : s.opening?.products || {},
    };
    s.markModified("opening");
  }
  await s.save();
  res.json(s);
});

/* ---------- 404 va xatolar ---------- */
app.use("/api", (_req, res) => res.status(404).json({ error: "Bunday API yo'li yo'q" }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join("; ") });
  }
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: `Noto'g'ri qiymat: ${err.path}` });
  if (err?.code === 11000) return res.status(409).json({ error: "Bunday yozuv allaqachon bor" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "JSON noto'g'ri" });
  console.error(err);
  if (/ServerSelection|MongoNetwork|querySrv|Authentication/i.test(`${err?.name} ${err?.message}`)) {
    return res.status(503).json({ error: "Ma'lumotlar bazasiga ulanib bo'lmadi — MONGODB_URI va Atlas Network Access (0.0.0.0/0) ni tekshiring" });
  }
  res.status(500).json({ error: err?.message?.includes("MONGODB_URI") ? err.message : "Serverda xatolik" });
});

export default app;
