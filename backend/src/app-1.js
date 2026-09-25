import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { connectDB } from "./db.js";
import { Material, Product, Day, Order, Settings, User, AuditLog, Counter, DATE_RE } from "./models.js";
import { stockReport } from "./stock.js";
import { ROLES, WRITE_ROLES, hashPassword, verifyPassword, safeEqual, passwordProblem, issueToken, readToken, publicUser } from "./auth.js";
import { audit, diff } from "./audit.js";
import { USER_LIMIT, USER_LOCK_MIN, IP_LIMIT, IP_LOCK_MIN, clientIp, userKey, ipKey, takeAttempt, lock, loginSucceeded, clearUserLocks } from "./limits.js";

const app = express();

/* ---------- CORS ---------- */
// "https://site.vercel.app/" kabi oxiridagi "/" brauzer yuboradigan Origin bilan mos kelmaydi — olib tashlaymiz
const origins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
app.use(
  cors({
    origin: origins.includes("*") ? true : origins,
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);
app.use(express.json({ limit: "2mb" }));

/* ---------- ochiq yo'llar ---------- */
app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api", async (_req, _res, next) => {
  await connectDB();
  next();
});

const BAD_LOGIN = "Login yoki parol noto'g'ri";
// mavjud bo'lmagan login uchun ham scrypt ishlatiladi — javob vaqtidan login borligini bilib bo'lmaydi
const DUMMY_HASH = hashPassword("pto-dummy-password");

app.post("/api/login", async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase().slice(0, 60);
  const password = String(req.body?.password || "");
  if (!username || !password) return res.status(400).json({ error: "Login va parolni kiriting" });

  const ip = clientIp(req);
  const locked = (until) => {
    const min = Math.max(1, Math.ceil((new Date(until) - Date.now()) / 60000));
    return res.status(429).json({ error: `Ko'p marta noto'g'ri parol kiritildi. ${min} daqiqadan keyin urinib ko'ring` });
  };
  const ipTry = await takeAttempt(ipKey(ip), IP_LIMIT, IP_LOCK_MIN);
  if (ipTry.locked) return locked(ipTry.locked);
  const key = userKey(username, ip);
  const userTry = await takeAttempt(key, USER_LIMIT, USER_LOCK_MIN);
  if (userTry.locked) return locked(userTry.locked);
  const failed = async () => {
    if (userTry.count >= USER_LIMIT) await lock(key, USER_LOCK_MIN);
    return res.status(401).json({ error: BAD_LOGIN });
  };

  // Birinchi kirish: bazada foydalanuvchi yo'q bo'lsa, "admin" + APP_PASSWORD bilan administrator yaratiladi
  if (!(await User.exists({}))) {
    const boot = process.env.APP_PASSWORD;
    if (!boot) return res.status(503).json({ error: "Foydalanuvchi yo'q. Birinchi kirish uchun serverda APP_PASSWORD ni o'rnating" });
    if (username !== "admin" || !safeEqual(password, boot)) return failed();
    const user = await User.create({
      username: "admin",
      name: "Administrator",
      role: "admin",
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      lastLoginAt: new Date(),
    });
    await loginSucceeded(username, ip);
    req.user = user;
    await audit(req, { action: "login", entity: "user", entityId: user._id, label: "Birinchi kirish — administrator yaratildi" });
    return res.json({ token: issueToken(user), user: publicUser(user) });
  }

  const user = await User.findOne({ username });
  const ok = await verifyPassword(password, user?.active ? user.passwordHash : await DUMMY_HASH);
  if (!user || !user.active || !ok) return failed();

  await loginSucceeded(username, ip);
  const lastLoginAt = new Date();
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt } });
  user.lastLoginAt = lastLoginAt;
  req.user = user;
  await audit(req, { action: "login", entity: "user", entityId: user._id, label: user.username });
  res.json({ token: issueToken(user), user: publicUser(user) });
});

/* ---------- himoya: token va rol ---------- */
app.use("/api", async (req, res, next) => {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const t = readToken(token);
  if (!t || !mongoose.isValidObjectId(t.u)) return res.status(401).json({ error: "Qaytadan kiring" });
  const user = await User.findById(t.u);
  if (!user || !user.active || (user.tokenVersion || 0) !== t.v) return res.status(401).json({ error: "Qaytadan kiring" });
  req.user = user;
  // Vaqtinchalik parol bilan kirgan foydalanuvchi o'z parolini o'rnatmaguncha faqat shu ikki yo'ldan foydalana oladi
  if (user.mustChangePassword && req.path !== "/me" && req.path !== "/me/password") {
    return res.status(403).json({ error: "Avval o'zingizning parolingizni o'rnating", code: "mustChangePassword" });
  }
  next();
});

// "Rahbar" faqat ko'radi. O'z parolini almashtirish hammaga ruxsat.
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.path === "/me/password") return next();
  if (!WRITE_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Sizda faqat ko'rish huquqi bor" });
  next();
});

const adminOnly = (req, res, next) =>
  req.user.role === "admin" ? next() : res.status(403).json({ error: "Bu bo'lim faqat administrator uchun" });

/* ---------- yordamchilar ---------- */
const isId = (v) => mongoose.isValidObjectId(v);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));
const notFound = (res) => res.status(404).json({ error: "Yozuv topilmadi" });
const upd = { returnDocument: "after", runValidators: true };
const validDate = (s) => typeof s === "string" && DATE_RE.test(s);

async function getSettings() {
  return (await Settings.findOne({ key: "main" })) || (await Settings.create({ key: "main" }));
}

/* ---------- Joriy foydalanuvchi ---------- */
app.get("/api/me", (req, res) => res.json(publicUser(req.user)));

app.put("/api/me/password", async (req, res) => {
  const { current, next: nextPw } = req.body || {};
  const u = req.user;
  if (!(await verifyPassword(current, u.passwordHash))) return res.status(400).json({ error: "Joriy parol noto'g'ri" });
  const problem = passwordProblem(nextPw);
  if (problem) return res.status(400).json({ error: problem });
  if (current === nextPw) return res.status(400).json({ error: "Yangi parol eskisidan farq qilsin" });
  u.passwordHash = await hashPassword(nextPw);
  u.mustChangePassword = false;
  u.tokenVersion = (u.tokenVersion || 0) + 1; // boshqa qurilmalardagi sessiyalar yopiladi
  await u.save();
  await audit(req, { action: "update", entity: "user", entityId: u._id, label: u.username, changes: [{ p: "password", a: "••••", b: "••••" }] });
  res.json({ token: issueToken(u), user: publicUser(u) });
});

/* ---------- Foydalanuvchilar (faqat admin) ---------- */
app.get("/api/users", adminOnly, async (_req, res) => {
  const list = await User.find().sort({ createdAt: 1 });
  res.json(list.map(publicUser));
});

app.post("/api/users", adminOnly, async (req, res) => {
  const { username, name, role, password } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Rol noto'g'ri" });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  const user = await User.create({ username, name, role, passwordHash: await hashPassword(password), mustChangePassword: true });
  await audit(req, { action: "create", entity: "user", entityId: user._id, label: user.username, after: publicUser(user) });
  res.status(201).json(publicUser(user));
});

async function adminsLeft(exceptId) {
  return User.countDocuments({ role: "admin", active: true, _id: { $ne: exceptId } });
}

app.put("/api/users/:id", adminOnly, async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const user = await User.findById(req.params.id);
  if (!user) return notFound(res);
  const before = publicUser(user);
  const b = req.body || {};
  if (b.role !== undefined && !ROLES.includes(b.role)) return res.status(400).json({ error: "Rol noto'g'ri" });

  const losesAdmin = user.role === "admin" && ((b.role && b.role !== "admin") || b.active === false);
  if (losesAdmin && !(await adminsLeft(user._id))) return res.status(400).json({ error: "Kamida bitta faol administrator qolishi kerak" });

  if (b.name !== undefined) user.name = String(b.name);
  if (b.role !== undefined) user.role = b.role;
  if (b.active !== undefined) {
    user.active = Boolean(b.active);
    if (!user.active) user.tokenVersion = (user.tokenVersion || 0) + 1;
  }
  let pwChanged = false;
  if (b.password) {
    const problem = passwordProblem(b.password);
    if (problem) return res.status(400).json({ error: problem });
    user.passwordHash = await hashPassword(b.password);
    user.mustChangePassword = true;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    pwChanged = true;
  }
  await user.save();
  if (pwChanged) await clearUserLocks(user.username);
  const after = publicUser(user);
  const changes = diff("user", before, after);
  if (pwChanged) changes.push({ p: "password", a: "••••", b: "yangi parol" });
  await audit(req, { action: "update", entity: "user", entityId: user._id, label: user.username, changes });
  res.json(after);
});

app.delete("/api/users/:id", adminOnly, async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  if (String(req.user._id) === req.params.id) return res.status(400).json({ error: "O'zingizni o'chira olmaysiz" });
  const user = await User.findById(req.params.id);
  if (!user) return notFound(res);
  if (user.role === "admin" && user.active && !(await adminsLeft(user._id))) return res.status(400).json({ error: "Kamida bitta faol administrator qolishi kerak" });
  await user.deleteOne();
  await audit(req, { action: "delete", entity: "user", entityId: user._id, label: user.username, before: publicUser(user) });
  res.json({ ok: true });
});

/* ---------- O'zgarishlar jurnali (faqat admin) ---------- */
app.get("/api/audit", adminOnly, async (req, res) => {
  const { entity, user, action, from, to, before } = req.query;
  const q = {};
  if (typeof entity === "string" && entity) q.entity = entity;
  if (typeof action === "string" && action) q.action = action;
  if (typeof user === "string" && user) q["user.id"] = user;
  const range = {};
  if (validDate(from)) range.$gte = new Date(`${from}T00:00:00+05:00`);
  if (validDate(to)) range.$lte = new Date(`${to}T23:59:59.999+05:00`);
  if (typeof before === "string" && !Number.isNaN(Date.parse(before))) range.$lt = new Date(before);
  if (Object.keys(range).length) q.createdAt = range;
  const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
  const list = await AuditLog.find(q).sort({ createdAt: -1 }).limit(limit + 1);
  res.json({ items: list.slice(0, limit), hasMore: list.length > limit });
});

/* ---------- Zaxira nusxa (faqat admin) ---------- */
app.get("/api/backup", adminOnly, async (req, res) => {
  const [materials, products, days, orders, settings, users] = await Promise.all([
    Material.find().lean(),
    Product.find().lean(),
    Day.find().sort({ date: 1 }).lean(),
    Order.find().sort({ no: 1 }).lean(),
    Settings.find().lean(),
    User.find().select("-passwordHash -tokenVersion -failedLogins -lockUntil").lean(),
  ]);
  const now = new Date();
  const stamp = new Date(now.getTime() + 5 * 36e5).toISOString().slice(0, 16).replace(/[T:]/g, "-");
  await audit(req, {
    action: "backup",
    entity: "backup",
    label: `${materials.length} material, ${products.length} mahsulot, ${days.length} kun, ${orders.length} buyurtma`,
  });
  res.setHeader("Content-Disposition", `attachment; filename="pto-backup-${stamp}.json"`);
  res.json({
    app: "pto",
    format: 1,
    createdAt: now.toISOString(),
    createdBy: req.user.username,
    counts: { materials: materials.length, products: products.length, days: days.length, orders: orders.length, users: users.length },
    data: { materials, products, days, orders, settings, users },
  });
});

/* ---------- Materiallar ---------- */
const MATERIAL_FIELDS = ["name", "unit", "group", "price", "stock", "electrodeBase", "recipe", "writeoff", "sort"];

app.get("/api/materials", async (_req, res) => {
  res.json(await Material.find().sort({ sort: 1, name: 1 }));
});
app.post("/api/materials", async (req, res) => {
  const last = await Material.findOne().sort({ sort: -1 }).select("sort");
  const doc = await Material.create({ sort: (last?.sort || 0) + 1, ...pick(req.body, MATERIAL_FIELDS) });
  await audit(req, { action: "create", entity: "material", entityId: doc._id, label: doc.name, after: doc });
  res.status(201).json(doc);
});
app.put("/api/materials/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const before = await Material.findById(req.params.id).lean();
  if (!before) return notFound(res);
  const doc = await Material.findByIdAndUpdate(req.params.id, pick(req.body, MATERIAL_FIELDS), upd);
  if (!doc) return notFound(res);
  await audit(req, { action: "update", entity: "material", entityId: doc._id, label: doc.name, before, after: doc });
  res.json(doc);
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
  if (!doc) return notFound(res);
  await audit(req, { action: "delete", entity: "material", entityId: doc._id, label: doc.name, before: doc });
  res.json({ ok: true });
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
  const doc = await Product.create({ sort: (last?.sort || 0) + 1, ...data });
  await audit(req, { action: "create", entity: "product", entityId: doc._id, label: doc.code, after: doc });
  res.status(201).json(doc);
});
app.put("/api/products/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const before = await Product.findById(req.params.id).lean();
  if (!before) return notFound(res);
  const doc = await Product.findByIdAndUpdate(req.params.id, pick(req.body, PRODUCT_FIELDS), upd);
  if (!doc) return notFound(res);
  await audit(req, { action: "update", entity: "product", entityId: doc._id, label: doc.code, before, after: doc });
  res.json(doc);
});
app.delete("/api/products/:id", async (req, res) => {
  const id = req.params.id;
  if (!isId(id)) return notFound(res);
  const used =
    (await Order.exists({ productId: id })) ||
    (await Day.exists({ $or: [{ "production.productId": id }, { "shipments.productId": id }] }));
  if (used) return res.status(409).json({ error: "Mahsulot buyurtma yoki kunlik hisobotda ishlatilgan — o'chirib bo'lmaydi" });
  const doc = await Product.findByIdAndDelete(id);
  if (!doc) return notFound(res);
  await audit(req, { action: "delete", entity: "product", entityId: doc._id, label: doc.code, before: doc });
  res.json({ ok: true });
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
  // ro'yxatlar massiv bo'lishi shart; ichidagi obyekt bo'lmagan elementlar (null, son, satr) tashlab yuboriladi
  for (const k of ["production", "materials", "shipments"]) {
    if (data[k] === undefined || data[k] === null) {
      delete data[k];
      continue;
    }
    if (!Array.isArray(data[k])) return res.status(400).json({ error: `«${k}» ro'yxat (massiv) bo'lishi kerak` });
    data[k] = data[k].filter((l) => l && typeof l === "object" && !Array.isArray(l));
  }
  // bo'sh qatorlarni tashlab yuboramiz
  if (data.production) data.production = data.production.filter((l) => l.productId && ((+l.plan || 0) || (+l.fact || 0) || l.note));
  if (data.materials) data.materials = data.materials.filter((l) => l.materialId && ((+l.sarf || 0) || (+l.kirim || 0)));
  if (data.shipments)
    data.shipments = data.shipments
      .filter((l) => l.productId && +l.qty > 0)
      .map((l) => ({ ...l, orderId: isId(l.orderId) ? l.orderId : null }));
  const before = await Day.findOne({ date }).lean();
  const doc = await Day.findOneAndUpdate({ date }, { $set: { ...data, date } }, { ...upd, upsert: true, setDefaultsOnInsert: true });
  await audit(req, { action: before ? "update" : "create", entity: "day", entityId: date, label: date, before, after: doc });
  res.json(doc);
});
app.delete("/api/days/:date", async (req, res) => {
  const doc = await Day.findOneAndDelete({ date: req.params.date });
  if (!doc) return notFound(res);
  await audit(req, { action: "delete", entity: "day", entityId: doc.date, label: doc.date, before: doc });
  res.json({ ok: true });
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
const orderLabel = (o) => `№${o.no} ${o.customer}`;

/** Keyingi buyurtma raqami. Birinchi chaqiruvda hisoblagich mavjud eng katta raqamdan boshlanadi. */
async function nextOrderNo() {
  const c = await Counter.findOneAndUpdate({ _id: "order" }, { $inc: { seq: 1 } }, { returnDocument: "after" });
  if (c) return c.seq;
  const last = await Order.findOne().sort({ no: -1 }).select("no").lean();
  try {
    await Counter.create({ _id: "order", seq: last?.no || 0 });
  } catch (err) {
    if (err?.code !== 11000) throw err; // boshqa so'rov allaqachon yaratgan — muammo yo'q
  }
  return nextOrderNo();
}

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
  const doc = await Order.create({ ...data, no: await nextOrderNo() });
  await audit(req, { action: "create", entity: "order", entityId: doc._id, label: orderLabel(doc), after: doc });
  res.status(201).json(doc);
});
app.put("/api/orders/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const before = await Order.findById(req.params.id).lean();
  if (!before) return notFound(res);
  const doc = await Order.findByIdAndUpdate(req.params.id, pick(req.body, ORDER_FIELDS), upd);
  if (!doc) return notFound(res);
  await audit(req, { action: "update", entity: "order", entityId: doc._id, label: orderLabel(doc), before, after: doc });
  res.json(doc);
});
app.delete("/api/orders/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Order.findByIdAndDelete(req.params.id);
  if (!doc) return notFound(res);
  await Day.updateMany({ "shipments.orderId": doc._id }, { $set: { "shipments.$[s].orderId": null } }, { arrayFilters: [{ "s.orderId": doc._id }] });
  await audit(req, { action: "delete", entity: "order", entityId: doc._id, label: orderLabel(doc), before: doc });
  res.json({ ok: true });
});

/* ---------- Sozlamalar ---------- */
app.get("/api/settings", async (_req, res) => {
  res.json(await getSettings());
});
app.put("/api/settings", async (req, res) => {
  const s = await getSettings();
  const before = s.toObject();
  const b = req.body || {};
  if (b.electrodePct !== undefined) s.electrodePct = Math.max(0, +b.electrodePct || 0);
  if (b.company !== undefined) s.company = String(b.company).slice(0, 200);
  if (Array.isArray(b.signers)) s.signers = b.signers.map((x) => String(x).slice(0, 120)).slice(0, 6);
  if (b.calcTemplate !== undefined) {
    if (b.calcTemplate === null) s.calcTemplate = null;
    else {
      // andoza mahsulot kalkulyatsiyasi sxemasi bo'yicha tekshiriladi va tozalanadi (noma'lum maydonlar, "$..." kalitlar tushib qoladi)
      if (typeof b.calcTemplate !== "object" || Array.isArray(b.calcTemplate)) return res.status(400).json({ error: "Kalkulyatsiya andozasi noto'g'ri" });
      const probe = new Product({ code: "andoza", calc: b.calcTemplate });
      await probe.validate(["calc"]);
      s.calcTemplate = { ...probe.toObject().calc, items: [] };
    }
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
  await audit(req, { action: "update", entity: "settings", entityId: "main", label: "Sozlamalar", before, after: s });
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
