import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { connectDB } from "./db.js";
import { Material, Product, Day, Order, Settings, User, AuditLog, Counter, Target, Movement, Inventory, Supplier, ProductMove, VehicleLog, AcctReport, VEHICLE_LOG_KINDS, DATE_RE, MOVE_TYPES, TARGET_KINDS, MATERIAL_GROUPS, BRAK_REASONS } from "./models.js";
import { stockReport } from "./stock.js";
import { planOrders, checkNewOrder, planConfig, addDays } from "./plan.js";
import { vehicleStats } from "./fleet.js";
import { DEFAULT_SCHEMES, assignSchemes } from "./schemes.js";
import { ROLES, ADMIN_ROLES, WRITE_ROLES, ACCT_ROLES, STORE_ROLES, DAY_ROLES, hashPassword, verifyPassword, safeEqual, passwordProblem, issueToken, readToken, publicUser } from "./auth.js";
import { audit, diff } from "./audit.js";
import { meterFactor } from "./metal.js";
import { cleanItems, itemsOf, orderView, planLines, shippedMap } from "./orders.js";
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

// Yozish huquqlari:
//   admin, rahbar — hammasi, shu jumladan foydalanuvchilar, zaxira va o'zgarishlar tarixi
//   pto          — hammasi (foydalanuvchilarsiz)
//   omborchi     — ombor harakatlari, sex/texnika, material qo'shish/tahrirlash (narx va retseptsiz)
//   buxgalter    — hamma narsani ko'radi, faqat oylik material hisobotini (/acct-reports) saqlaydi
//   kuzatuvchi, kurator — faqat ko'radi va yuklab oladi. O'z parolini almashtirish hammaga ruxsat.
const STORE_PATH = /^\/(movements|targets|inventories|suppliers|vehicle-logs)(\/|$)/;
app.use("/api", (req, res, next) => {
  // /plan/check — faqat hisoblaydi, hech narsa yozmaydi: hamma ko'ra oladi
  if (req.method === "GET" || req.path === "/me/password" || (req.method === "POST" && req.path === "/plan/check")) return next();
  const role = req.user.role;
  if (WRITE_ROLES.includes(role)) return next();
  if (ACCT_ROLES.includes(role) && /^\/acct-reports(\/|$)/.test(req.path)) return next();
  if (STORE_ROLES.includes(role) && (STORE_PATH.test(req.path) || (/^\/materials(\/|$)/.test(req.path) && req.method !== "DELETE"))) return next();
  // sex boshlig'i (usta): faqat kunlik hisobotni saqlaydi, o'chira olmaydi
  if (DAY_ROLES.includes(role) && req.method === "PUT" && /^\/days\/[^/]+$/.test(req.path)) return next();
  // tayyor mahsulotni brakka chiqarish: ПТО, admin va usta
  if (DAY_ROLES.includes(role) && /^\/product-moves(\/|$)/.test(req.path)) return next();
  return res.status(403).json({ error: "Sizda bu amal uchun ruxsat yo'q" });
});

const adminOnly = (req, res, next) =>
  ADMIN_ROLES.includes(req.user.role) ? next() : res.status(403).json({ error: "Bu bo'lim faqat administrator uchun" });

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
  return User.countDocuments({ role: { $in: ADMIN_ROLES }, active: true, _id: { $ne: exceptId } });
}

app.put("/api/users/:id", adminOnly, async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const user = await User.findById(req.params.id);
  if (!user) return notFound(res);
  const before = publicUser(user);
  const b = req.body || {};
  if (b.role !== undefined && !ROLES.includes(b.role)) return res.status(400).json({ error: "Rol noto'g'ri" });

  const losesAdmin = ADMIN_ROLES.includes(user.role) && ((b.role && !ADMIN_ROLES.includes(b.role)) || b.active === false);
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
  if (ADMIN_ROLES.includes(user.role) && user.active && !(await adminsLeft(user._id))) return res.status(400).json({ error: "Kamida bitta faol administrator qolishi kerak" });
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
  const [materials, products, days, orders, settings, users, targets, movements, inventories, suppliers, productMoves, vehicleLogs, acctReports] = await Promise.all([
    Material.find().lean(),
    Product.find().lean(),
    Day.find().sort({ date: 1 }).lean(),
    Order.find().sort({ no: 1 }).lean(),
    Settings.find().lean(),
    User.find().select("-passwordHash -tokenVersion -failedLogins -lockUntil").lean(),
    Target.find().lean(),
    Movement.find().sort({ date: 1 }).lean(),
    Inventory.find().sort({ no: 1 }).lean(),
    Supplier.find().sort({ name: 1 }).lean(),
    ProductMove.find().sort({ date: 1 }).lean(),
    VehicleLog.find().sort({ date: 1 }).lean(),
    AcctReport.find().sort({ month: 1 }).lean(),
  ]);
  const now = new Date();
  const stamp = new Date(now.getTime() + 5 * 36e5).toISOString().slice(0, 16).replace(/[T:]/g, "-");
  await audit(req, {
    action: "backup",
    entity: "backup",
    label: `${materials.length} material, ${products.length} mahsulot, ${days.length} kun, ${orders.length} buyurtma, ${movements.length} ombor harakati`,
  });
  res.setHeader("Content-Disposition", `attachment; filename="pto-backup-${stamp}.json"`);
  res.json({
    app: "pto",
    format: 1,
    createdAt: now.toISOString(),
    createdBy: req.user.username,
    counts: { materials: materials.length, products: products.length, days: days.length, orders: orders.length, users: users.length, targets: targets.length, movements: movements.length, inventories: inventories.length, suppliers: suppliers.length, productMoves: productMoves.length, vehicleLogs: vehicleLogs.length, acctReports: acctReports.length },
    data: { materials, products, days, orders, settings, users, targets, movements, inventories, suppliers, productMoves, vehicleLogs, acctReports },
  });
});

/* ---------- Materiallar ---------- */
const MATERIAL_FIELDS = ["name", "unit", "group", "price", "stock", "electrodeBase", "isElectrode", "code", "minQty", "kgPerM", "archived", "recipe", "writeoff", "sort"];
const STORE_MATERIAL_FIELDS = ["name", "unit", "group", "code", "minQty"]; // omborchi shularnigina o'zgartira oladi
const materialFields = (req) => (WRITE_ROLES.includes(req.user.role) ? MATERIAL_FIELDS : STORE_MATERIAL_FIELDS);

app.get("/api/materials", async (_req, res) => {
  res.json(await Material.find().sort({ sort: 1, name: 1 }));
});
app.post("/api/materials", async (req, res) => {
  const last = await Material.findOne().sort({ sort: -1 }).select("sort");
  const doc = await Material.create({ sort: (last?.sort || 0) + 1, ...pick(req.body, materialFields(req)) });
  await audit(req, { action: "create", entity: "material", entityId: doc._id, label: doc.name, after: doc });
  res.status(201).json(doc);
});
app.put("/api/materials/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const before = await Material.findById(req.params.id).lean();
  if (!before) return notFound(res);
  const doc = await Material.findByIdAndUpdate(req.params.id, pick(req.body, materialFields(req)), upd);
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
    (await Day.exists({ "materials.materialId": id })) ||
    (await Movement.exists({ materialId: id }));
  if (used) return res.status(409).json({ error: "Material normalarda, retseptda, kunlik hisobotda yoki ombor tarixida ishlatilgan — o'chirib bo'lmaydi. Uni arxivga o'tkazing." });
  const doc = await Material.findByIdAndDelete(id);
  if (!doc) return notFound(res);
  await audit(req, { action: "delete", entity: "material", entityId: doc._id, label: doc.name, before: doc });
  res.json({ ok: true });
});

/* ---------- Mahsulotlar ---------- */
const PRODUCT_FIELDS = ["code", "name", "group", "norms", "calc", "notes", "sort", "forms", "cycleDays"];

/**
 * Xarajat andozalari birinchi marta: ikki sxema yaratiladi va mahsulotlar qiymatiga qarab taqsimlanadi.
 * Mahsulotlarning o'z qatorlari o'chirilmaydi (andozadan chiqarilsa, qaytadan ishlatiladi).
 */
let schemesInit = null;
async function ensureSchemes(req) {
  const s = await getSettings();
  if (Array.isArray(s.costSchemes)) return s;
  schemesInit ||= (async () => {
    const fresh = await Settings.findOne({ key: "main" });
    if (Array.isArray(fresh.costSchemes)) return;
    const products = await Product.find().select("group calc").lean();
    const map = assignSchemes(products, DEFAULT_SCHEMES);
    const ops = [...map].map(([id, scheme]) => ({ updateOne: { filter: { _id: id, "calc.scheme": { $in: ["", null] } }, update: { $set: { "calc.scheme": scheme } } } }));
    if (ops.length) await Product.bulkWrite(ops);
    fresh.costSchemes = DEFAULT_SCHEMES;
    fresh.markModified("costSchemes");
    await fresh.save();
    const n = (id) => [...map.values()].filter((x) => x === id).length;
    await audit(req, { action: "update", entity: "settings", entityId: "main", label: `Xarajat andozalari yaratildi: ${DEFAULT_SCHEMES.map((x) => `${x.name} — ${n(x.id)} ta mahsulot`).join("; ")}`, changes: [{ p: "costSchemes", a: null, b: DEFAULT_SCHEMES.map((x) => x.name).join(", ") }] });
  })().finally(() => (schemesInit = null));
  await schemesInit;
  return getSettings();
}

app.get("/api/products", async (req, res) => {
  await ensureSchemes(req);
  res.json(await Product.find().sort({ sort: 1, code: 1 }));
});
// bir nechta mahsulotni andozaga bog'lash: { scheme: "id" | "", productIds: [...] } ("" — o'z qatorlari)
app.post("/api/products/scheme", async (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.productIds) ? b.productIds.filter(isId).slice(0, 1000) : [];
  if (!ids.length) return res.status(400).json({ error: "Mahsulot tanlanmagan" });
  const scheme = String(b.scheme ?? "");
  const s = await ensureSchemes(req);
  if (scheme && !(s.costSchemes || []).some((x) => x.id === scheme)) return res.status(400).json({ error: "Bunday andoza yo'q" });
  const r = await Product.updateMany({ _id: { $in: ids } }, { $set: { "calc.scheme": scheme } });
  const name = (s.costSchemes || []).find((x) => x.id === scheme)?.name || "alohida";
  await audit(req, { action: "update", entity: "product", entityId: "scheme", label: `${r.modifiedCount} ta mahsulot → ${name}`, changes: [{ p: "calc.scheme", a: null, b: name }] });
  res.json({ ok: true, modified: r.modifiedCount });
});
app.post("/api/products", async (req, res) => {
  const data = pick(req.body, PRODUCT_FIELDS);
  if (!data.calc) {
    const st = await ensureSchemes(req);
    data.calc = st.costSchemes?.length ? { scheme: st.costSchemes[0].id } : st.calcTemplate || undefined;
  }
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
    (await Order.exists({ $or: [{ "items.productId": id }, { productId: id }] })) ||
    (await Day.exists({ $or: [{ "production.productId": id }, { "shipments.productId": id }] })) ||
    (await ProductMove.exists({ productId: id }));
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
  const before = await Day.findOne({ date }).lean();
  // Sex boshlig'i (usta) reja, fakt, xomashyo sarfi va izohni o'zgartiradi: kirim va jo'natish avvalgidek qoladi
  if (!WRITE_ROLES.includes(req.user.role)) {
    const old = before || { production: [], materials: [], shipments: [] };
    if (data.materials) {
      const kirim = new Map((old.materials || []).map((l) => [String(l.materialId), +l.kirim || 0]));
      const ids = new Set();
      data.materials = data.materials.map((l) => {
        ids.add(String(l.materialId));
        return { materialId: l.materialId, sarf: l.sarf, kirim: kirim.get(String(l.materialId)) || 0 };
      });
      for (const [id, k] of kirim) if (!ids.has(id) && k) data.materials.push({ materialId: id, sarf: 0, kirim: k });
    }
    delete data.shipments;
  }
  // bo'sh qatorlarni tashlab yuboramiz
  if (data.production)
    data.production = data.production
      .filter((l) => l.productId && ((+l.plan || 0) || (+l.fact || 0) || (+l.brak || 0) || l.note))
      .map((l) => ({ ...l, brakReason: +l.brak > 0 && BRAK_REASONS.includes(l.brakReason) ? l.brakReason : +l.brak > 0 ? "boshqa" : "" }));
  if (data.materials) data.materials = data.materials.filter((l) => l.materialId && ((+l.sarf || 0) || (+l.kirim || 0)));
  if (data.shipments)
    data.shipments = data.shipments
      .filter((l) => l.productId && +l.qty > 0)
      .map((l) => ({ ...l, orderId: isId(l.orderId) ? l.orderId : null }));
  // jo'natish faqat shu mahsulot bor buyurtmaga bog'lanadi (aks holda bog'lanmagan bo'lib qoladi)
  if (data.shipments?.some((l) => l.orderId)) {
    await migrateOrders();
    const ids = [...new Set(data.shipments.filter((l) => l.orderId).map((l) => String(l.orderId)))];
    const has = new Map((await Order.find({ _id: { $in: ids } }).select("items").lean()).map((o) => [String(o._id), new Set(itemsOf(o).map((i) => String(i.productId)))]));
    for (const l of data.shipments) if (l.orderId && !has.get(String(l.orderId))?.has(String(l.productId))) l.orderId = null;
  }
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
  const range = { $gte: opening.date || "0000-00-00", $lte: to };
  const [days, moves, pmoves] = await Promise.all([
    Day.find({ date: range }).lean(),
    Movement.find({ date: range }).select("type date materialId qty reason").lean(),
    ProductMove.find({ date: range }).select("date productId qty").lean(),
  ]);
  res.json(stockReport(opening, days, from, to, moves, pmoves));
});

/** Materialning hozirgi (barcha sanalar bo'yicha) qoldig'i */
async function balanceOf(materialId) {
  const s = await getSettings();
  const opening = s.opening?.date ? s.opening : { date: "", materials: {}, products: {} };
  const range = { $gte: opening.date || "0000-00-00" };
  const [days, moves] = await Promise.all([
    Day.find({ date: range, "materials.materialId": materialId }).select("date materials").lean(),
    Movement.find({ date: range, materialId }).select("type date materialId qty reason").lean(),
  ]);
  const r = stockReport(opening, days, "0000-00-00", "9999-12-31", moves);
  return r.materials[String(materialId)]?.end || 0;
}

/* ---------- Ombor: sex va texnika ---------- */
const TARGET_FIELDS = ["kind", "name", "code", "archived", "meterUnit", "fuelNorm", "serviceEvery"];
app.get("/api/targets", async (_req, res) => {
  res.json(await Target.find().sort({ kind: 1, archived: 1, name: 1 }));
});
app.post("/api/targets", async (req, res) => {
  const doc = await Target.create(pick(req.body, TARGET_FIELDS));
  await audit(req, { action: "create", entity: "target", entityId: doc._id, label: doc.name, after: doc });
  res.status(201).json(doc);
});
app.put("/api/targets/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const before = await Target.findById(req.params.id).lean();
  if (!before) return notFound(res);
  const doc = await Target.findByIdAndUpdate(req.params.id, pick(req.body, TARGET_FIELDS.filter((k) => k !== "kind")), upd);
  await audit(req, { action: "update", entity: "target", entityId: doc._id, label: doc.name, before, after: doc });
  res.json(doc);
});
app.delete("/api/targets/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Target.findById(req.params.id);
  if (!doc) return notFound(res);
  // tarixda ishlatilgan bo'lsa o'chirilmaydi — arxivga o'tadi
  if ((await Movement.exists({ $or: [{ departmentId: doc._id }, { vehicleId: doc._id }] })) || (await VehicleLog.exists({ vehicleId: doc._id }))) {
    doc.archived = true;
    await doc.save();
    await audit(req, { action: "update", entity: "target", entityId: doc._id, label: doc.name, changes: [{ p: "archived", a: false, b: true }] });
    return res.json({ ok: true, archived: true });
  }
  await doc.deleteOne();
  await audit(req, { action: "delete", entity: "target", entityId: doc._id, label: doc.name, before: doc });
  res.json({ ok: true });
});

/* ---------- Ombor: kirim / chiqim ---------- */
const todayTashkent = () => new Date(Date.now() + 5 * 36e5).toISOString().slice(0, 10);
const round3 = (x) => Math.round(x * 1000) / 1000;
const moveLabel = (m, mat) => `${m.type === "in" ? "Kirim" : "Chiqim"}: ${mat?.name || "?"} ${m.qty} ${mat?.unit || ""}`.trim();

// ?from=&to=&type=&materialId=&targetId=&limit=&page=
app.get("/api/movements", async (req, res) => {
  const { from, to, type, materialId, targetId } = req.query;
  const q = {};
  if (validDate(from) || validDate(to)) q.date = { ...(validDate(from) && { $gte: from }), ...(validDate(to) && { $lte: to }) };
  if (MOVE_TYPES.includes(type)) q.type = type;
  if (isId(materialId)) q.materialId = materialId;
  if (isId(targetId)) q.$or = [{ departmentId: targetId }, { vehicleId: targetId }];
  const limit = Math.min(2000, Math.max(1, +req.query.limit || 100));
  const page = Math.max(1, +req.query.page || 1);
  const list = await Movement.find(q).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1);
  res.json({ items: list.slice(0, limit), hasMore: list.length > limit, page });
});

app.post("/api/movements", async (req, res) => {
  const b = req.body || {};
  if (!MOVE_TYPES.includes(b.type)) return res.status(400).json({ error: "Harakat turi noto'g'ri (kirim yoki chiqim)" });
  const date = b.date === undefined || b.date === "" ? todayTashkent() : b.date;
  if (!validDate(date)) return res.status(400).json({ error: "Sana formati YYYY-MM-DD" });
  if (!isId(b.materialId)) return res.status(400).json({ error: "Materialni tanlang" });
  const mat = await Material.findById(b.materialId).lean();
  if (!mat || mat.archived) return res.status(400).json({ error: "Material topilmadi" });
  if (!mat.stock) return res.status(400).json({ error: "Bu material omborda hisobga olinmaydi" });

  // metrda yozilgan bo'lsa — koeffitsiyent serverda hisoblanadi (brauzerga ishonilmaydi)
  let qty;
  let conv = {};
  if (b.inputUnit === "m") {
    const f = meterFactor(mat);
    if (!f) return res.status(400).json({ error: "Bu material uchun metrdan aylantirish koeffitsiyenti yo'q" });
    const inputQty = round3(+b.inputQty);
    if (!(inputQty > 0)) return res.status(400).json({ error: "Miqdorni to'g'ri kiriting" });
    qty = Math.round(inputQty * f.perM * 1e6) / 1e6;
    conv = { inputQty, inputUnit: "m", factor: f.perM };
  } else qty = round3(+b.qty);
  if (!(qty > 0)) return res.status(400).json({ error: "Miqdorni to'g'ri kiriting" });

  const data = { type: b.type, date, materialId: mat._id, qty, ...conv, note: String(b.note ?? "").slice(0, 300), person: String(b.person ?? "").slice(0, 120) };
  if (b.type === "in") {
    data.price = Math.max(0, +b.price || 0);
    data.supplier = String(b.supplier ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
    data.docNumber = String(b.docNumber ?? "").slice(0, 60);
  } else {
    for (const [k, kind] of [["departmentId", "department"], ["vehicleId", "vehicle"]]) {
      if (b[k] === undefined || b[k] === null || b[k] === "") continue;
      if (!isId(b[k]) || !(await Target.exists({ _id: b[k], kind }))) return res.status(400).json({ error: kind === "vehicle" ? "Texnika topilmadi" : "Bo'lim topilmadi" });
      data[k] = b[k];
    }
    if (!data.departmentId && !data.vehicleId && !data.person) return res.status(400).json({ error: "Qayerga ketganini kiriting: bo'lim, texnika yoki mas'ul shaxs" });
    if (data.vehicleId && b.meter !== undefined && b.meter !== null && b.meter !== "") {
      const meter = round3(+b.meter);
      if (!(meter >= 0)) return res.status(400).json({ error: "Spidometr / motosoat ko'rsatkichi noto'g'ri" });
      const last = await lastMeter(data.vehicleId);
      if (last && last.meter > meter && last.date <= date) return res.status(400).json({ error: `Ko'rsatkich oldingisidan kam bo'lishi mumkin emas (${last.meter}, ${last.date})` });
      data.meter = meter;
    }
    data.price = +mat.price || 0;
    const bal = await balanceOf(mat._id);
    if (bal + 1e-9 < qty) return res.status(400).json({ error: `Omborda yetarli emas. Qoldiq: ${round3(bal)} ${mat.unit}` });
  }
  const u = req.user;
  data.createdBy = { id: String(u._id), username: u.username, name: u.name || u.username };
  const doc = await Movement.create(data);
  if (data.supplier) await rememberSupplier(data.supplier);
  await audit(req, { action: "create", entity: "movement", entityId: doc._id, label: moveLabel(doc, mat), after: doc });
  res.status(201).json(doc);
});

// Bekor qilish: admin va ПТО — istalganini; omborchi — o'zi kiritganini 24 soat ichida
app.delete("/api/movements/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Movement.findById(req.params.id);
  if (!doc) return notFound(res);
  const u = req.user;
  if (doc.reason === "inventar") return res.status(400).json({ error: "Bu inventarizatsiya to'g'rilashi — uni inventarizatsiya bo'limida bekor qiling" });
  if (!WRITE_ROLES.includes(u.role)) {
    const own = doc.createdBy?.id === String(u._id);
    if (!own || Date.now() - doc.createdAt > 24 * 36e5) return res.status(403).json({ error: "Faqat o'zingiz kiritgan yozuvni 24 soat ichida bekor qila olasiz" });
  }
  const mat = await Material.findById(doc.materialId).lean();
  if (doc.type === "in") {
    const bal = await balanceOf(doc.materialId);
    if (bal + 1e-9 < doc.qty) return res.status(400).json({ error: "Bu kirimdan keyin material ishlatilgan — bekor qilsangiz qoldiq manfiy bo'lib qoladi" });
  }
  await doc.deleteOne();
  await audit(req, { action: "delete", entity: "movement", entityId: doc._id, label: moveLabel(doc, mat), before: doc });
  res.json({ ok: true });
});

/* ---------- Grafiklar paneli: oyma-oy ko'rsatkichlar ---------- */
// ?months=12 — joriy oy bilan birga oxirgi N oy. Qiymatlar (so'm) brauzerda narx bo'yicha hisoblanadi —
// shuning uchun bu yerda miqdorlar qaytariladi: { month, plan, fact, brak, shipped, prod: {id: fakt}, sarf: {id: qty}, chiqim: {id: qty}, kirimSum }
/** Kunlik hisobot, ombor harakati va brakka chiqarishni `keyOf(sana)` bo'yicha guruhlab jamlaydi */
async function dashAggregate(keys, keyOf, from, to) {
  const [days, moves, pmoves] = await Promise.all([
    Day.find({ date: { $gte: from, $lte: to } }).select("date production materials shipments").lean(),
    Movement.find({ date: { $gte: from, $lte: to }, reason: { $ne: "inventar" } }).select("type date materialId qty price").lean(),
    ProductMove.find({ date: { $gte: from, $lte: to } }).select("date qty").lean(),
  ]);
  const M = new Map(keys.map((k) => [k, { key: k, plan: 0, fact: 0, brak: 0, writeoff: 0, shipped: 0, activeDays: 0, prod: {}, sarf: {}, chiqim: {}, kirimSum: 0 }]));
  const add = (o, k, v) => (o[k] = Math.round(((o[k] || 0) + v) * 1e6) / 1e6);
  for (const d of days) {
    const r = M.get(keyOf(d.date));
    if (!r) continue;
    let dayFact = 0;
    for (const l of d.production || []) {
      r.plan += +l.plan || 0;
      r.fact += +l.fact || 0;
      r.brak += +l.brak || 0;
      dayFact += +l.fact || 0;
      if (+l.fact) add(r.prod, String(l.productId), +l.fact);
    }
    if (dayFact) r.activeDays++;
    for (const l of d.shipments || []) r.shipped += +l.qty || 0;
    for (const l of d.materials || []) if (+l.sarf) add(r.sarf, String(l.materialId), +l.sarf);
  }
  for (const m of moves) {
    const r = M.get(keyOf(m.date));
    if (!r) continue;
    if (m.type === "out") add(r.chiqim, String(m.materialId), +m.qty || 0);
    else r.kirimSum += (+m.qty || 0) * (+m.price || 0);
  }
  for (const p of pmoves) {
    const r = M.get(keyOf(p.date));
    if (r) r.writeoff += +p.qty || 0;
  }
  return [...M.values()].map((r) => ({ ...r, kirimSum: Math.round(r.kirimSum) }));
}
const monthShift = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);

// ?months=12 — joriy oy bilan birga oxirgi N oy (oyma-oy).
// ?month=YYYY-MM — tanlangan oy kunma-kun (+ shu oy va o'tgan oy jami, solishtirish uchun).
// Qiymatlar (so'm) brauzerda narx bo'yicha hisoblanadi — shuning uchun bu yerda miqdorlar qaytariladi.
app.get("/api/dashboard", async (req, res) => {
  const today = todayTashkent();
  if (req.query.month !== undefined) {
    const ym = String(req.query.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym) || ym > today.slice(0, 7) || ym < "2000-01") return res.status(400).json({ error: "Oy noto'g'ri" });
    const last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
    const dates = [];
    for (let d = 1; d <= last; d++) {
      const s = `${ym}-${String(d).padStart(2, "0")}`;
      if (s <= today) dates.push(s);
    }
    const prev = monthShift(ym, -1);
    const [days, totals] = await Promise.all([
      dashAggregate(dates, (d) => d, dates[0], dates[dates.length - 1]),
      dashAggregate([prev, ym], (d) => d.slice(0, 7), `${prev}-01`, dates[dates.length - 1]),
    ]);
    return res.json({ month: ym, days, total: totals[1], prevTotal: totals[0] });
  }
  const n = Math.min(24, Math.max(1, Math.floor(+req.query.months || 12)));
  const months = [];
  for (let i = n - 1; i >= 0; i--) months.push(monthShift(today.slice(0, 7), -i));
  const rows = await dashAggregate(months, (d) => d.slice(0, 7), `${months[0]}-01`, today);
  res.json({ months: rows.map(({ key, ...r }) => ({ month: key, ...r })) });
});

/* ---------- Texnika hisobi ---------- */
/** Texnikaning oxirgi spidometr / motosoat ko'rsatkichi (chiqim yoki jurnal yozuvidan) */
async function lastMeter(vehicleId) {
  const [m, l] = await Promise.all([
    Movement.findOne({ vehicleId, meter: { $ne: null } }).sort({ date: -1, createdAt: -1 }).select("date meter").lean(),
    VehicleLog.findOne({ vehicleId, meter: { $ne: null } }).sort({ date: -1, createdAt: -1 }).select("date meter").lean(),
  ]);
  const c = [m, l].filter(Boolean).sort((a, b) => b.date.localeCompare(a.date) || b.meter - a.meter);
  return c[0] ? { meter: c[0].meter, date: c[0].date } : null;
}
async function fleetData(to, vehicleId) {
  const q = { type: "out", vehicleId: vehicleId || { $ne: null }, date: { $lte: to } };
  const [vehicles, moves, logs, mats] = await Promise.all([
    Target.find({ kind: "vehicle", ...(vehicleId && { _id: vehicleId }) }).sort({ archived: 1, name: 1 }).lean(),
    Movement.find(q).select("date createdAt qty price meter materialId vehicleId note person createdBy reason").lean(),
    VehicleLog.find({ ...(vehicleId ? { vehicleId } : {}), date: { $lte: to } }).lean(),
    Material.find().select("group name unit").lean(),
  ]);
  const g = new Map(mats.map((m) => [String(m._id), m]));
  for (const m of moves) m.group = g.get(String(m.materialId))?.group || "";
  return { vehicles, moves, logs };
}
// ?from=&to= — barcha texnika bo'yicha qisqa hisobot
app.get("/api/vehicles/report", async (req, res) => {
  const { from, to } = req.query;
  if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: "from va to sanalarini YYYY-MM-DD formatida bering" });
  const { vehicles, moves, logs } = await fleetData(to);
  const by = (arr, v) => arr.filter((x) => String(x.vehicleId) === String(v._id));
  res.json(
    vehicles.map((v) => ({
      vehicle: { id: String(v._id), name: v.name, code: v.code, archived: v.archived, meterUnit: v.meterUnit || "km", fuelNorm: v.fuelNorm || 0, serviceEvery: v.serviceEvery || 0 },
      ...vehicleStats({ id: String(v._id), meterUnit: v.meterUnit, fuelNorm: v.fuelNorm || 0, serviceEvery: v.serviceEvery || 0 }, by(moves, v), by(logs, v), from, to),
    }))
  );
});
// bitta texnika: hisob + davrdagi chiqimlar va jurnal
app.get("/api/vehicles/:id", async (req, res) => {
  const { from, to } = req.query;
  if (!isId(req.params.id)) return notFound(res);
  if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: "from va to sanalarini YYYY-MM-DD formatida bering" });
  const { vehicles, moves, logs } = await fleetData(to, req.params.id);
  const v = vehicles[0];
  if (!v) return notFound(res);
  const stats = vehicleStats({ id: String(v._id), meterUnit: v.meterUnit, fuelNorm: v.fuelNorm || 0, serviceEvery: v.serviceEvery || 0 }, moves, logs, from, to);
  const inP = (x) => x.date >= from && x.date <= to;
  const desc = (a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt));
  res.json({
    ...stats,
    moves: moves.filter(inP).sort(desc).map(({ _id, ...m }) => ({ ...m, id: String(_id), materialId: String(m.materialId) })),
    logs: logs.filter(inP).sort(desc).map(({ _id, ...l }) => ({ ...l, id: String(_id) })),
  });
});
app.get("/api/vehicles/:id/last", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  res.json(await lastMeter(req.params.id));
});
app.post("/api/vehicle-logs", async (req, res) => {
  const b = req.body || {};
  if (!isId(b.vehicleId) || !(await Target.exists({ _id: b.vehicleId, kind: "vehicle" }))) return res.status(400).json({ error: "Texnika topilmadi" });
  const date = b.date === undefined || b.date === "" ? todayTashkent() : b.date;
  if (!validDate(date) || date > todayTashkent()) return res.status(400).json({ error: "Sana noto'g'ri" });
  const kind = VEHICLE_LOG_KINDS.includes(b.kind) ? b.kind : "tamir";
  const data = { vehicleId: b.vehicleId, date, kind, cost: Math.max(0, Math.round(+b.cost || 0)), note: String(b.note ?? "").slice(0, 300), createdBy: who(req.user) };
  if (b.meter !== undefined && b.meter !== null && b.meter !== "") {
    const meter = round3(+b.meter);
    if (!(meter >= 0)) return res.status(400).json({ error: "Spidometr / motosoat ko'rsatkichi noto'g'ri" });
    const last = await lastMeter(b.vehicleId);
    if (last && last.meter > meter && last.date <= date) return res.status(400).json({ error: `Ko'rsatkich oldingisidan kam bo'lishi mumkin emas (${last.meter}, ${last.date})` });
    data.meter = meter;
  } else if (kind === "meter") return res.status(400).json({ error: "Ko'rsatkichni kiriting" });
  const doc = await VehicleLog.create(data);
  const v = await Target.findById(b.vehicleId).lean();
  await audit(req, { action: "create", entity: "vehicleLog", entityId: doc._id, label: `${v?.name}: ${kind} ${date}`, after: doc });
  res.status(201).json(doc);
});
app.delete("/api/vehicle-logs/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await VehicleLog.findById(req.params.id);
  if (!doc) return notFound(res);
  if (!WRITE_ROLES.includes(req.user.role) && (doc.createdBy?.id !== String(req.user._id) || Date.now() - doc.createdAt > 24 * 36e5))
    return res.status(403).json({ error: "Faqat o'zingiz kiritgan yozuvni 24 soat ichida bekor qila olasiz" });
  await doc.deleteOne();
  await audit(req, { action: "delete", entity: "vehicleLog", entityId: doc._id, label: `${doc.kind} ${doc.date}`, before: doc });
  res.json({ ok: true });
});

/* ---------- Tayyor mahsulot ombori va brak ---------- */
async function productStockAt(date) {
  const s = await getSettings();
  const opening = s.opening?.date ? s.opening : { date: "", materials: {}, products: {} };
  const range = { $gte: opening.date || "0000-00-00", $lte: date };
  const [days, pmoves] = await Promise.all([
    Day.find({ date: range }).select("date production shipments").lean(),
    ProductMove.find({ date: range }).select("date productId qty").lean(),
  ]);
  return stockReport(opening, days, date, date, [], pmoves).products;
}
const pmLabel = (m, p) => `Brakka chiqarildi: ${p?.code || "?"} ${m.qty} dona (${m.date})`;

// ?from=&to=&productId= — davr bo'yicha tayyor mahsulot harakati va brak ro'yxati
app.get("/api/finished", async (req, res) => {
  const { from, to, productId } = req.query;
  if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: "from va to sanalarini YYYY-MM-DD formatida bering" });
  const s = await getSettings();
  const opening = s.opening?.date ? s.opening : { date: "", materials: {}, products: {} };
  const range = { $gte: opening.date || "0000-00-00", $lte: to };
  const [days, pmoves] = await Promise.all([
    Day.find({ date: range }).select("date production shipments").lean(),
    ProductMove.find({ date: range }).sort({ date: 1, createdAt: 1 }).lean(),
  ]);
  const report = stockReport(opening, days, from, to, [], pmoves);
  const brak = [];
  const events = [];
  const pid = isId(productId) ? String(productId) : null;
  for (const d of days) {
    if (d.date < from) continue;
    const ev = pid && { date: d.date, fact: 0, brak: 0, shipped: 0, writeoff: 0, customers: [] };
    for (const l of d.production || []) {
      if (+l.brak > 0) brak.push({ date: d.date, productId: String(l.productId), qty: +l.brak, reason: l.brakReason || "boshqa", source: "ishlab", note: l.note || "" });
      if (ev && String(l.productId) === pid) {
        ev.fact += +l.fact || 0;
        ev.brak += +l.brak || 0;
      }
    }
    if (ev)
      for (const l of d.shipments || [])
        if (String(l.productId) === pid) {
          ev.shipped += +l.qty || 0;
          if (l.customer) ev.customers.push(l.customer);
        }
    if (ev && (ev.fact || ev.brak || ev.shipped)) events.push(ev);
  }
  const list = [];
  for (const m of pmoves) {
    if (m.date < from) continue;
    const o = { id: String(m._id), date: m.date, productId: String(m.productId), qty: m.qty, reason: m.reason, source: "ombor", note: m.note, createdBy: m.createdBy, createdAt: m.createdAt };
    brak.push(o);
    list.push(o);
    if (pid && o.productId === pid) {
      let ev = events.find((e) => e.date === m.date);
      if (!ev) events.push((ev = { date: m.date, fact: 0, brak: 0, shipped: 0, writeoff: 0, customers: [] }));
      ev.writeoff += m.qty;
    }
  }
  brak.sort((a, b) => b.date.localeCompare(a.date));
  events.sort((a, b) => b.date.localeCompare(a.date));
  res.json({ from, to, openingDate: report.openingDate, products: report.products, brak, writeoffs: list, ...(pid && { events }) });
});
app.post("/api/product-moves", async (req, res) => {
  const b = req.body || {};
  const date = b.date === undefined || b.date === "" ? todayTashkent() : b.date;
  if (!validDate(date) || date > todayTashkent()) return res.status(400).json({ error: "Sana noto'g'ri" });
  if (!isId(b.productId)) return res.status(400).json({ error: "Mahsulot topilmadi" });
  const p = await Product.findById(b.productId).lean();
  if (!p) return res.status(400).json({ error: "Mahsulot topilmadi" });
  const qty = Math.floor(+b.qty);
  if (!(qty >= 1)) return res.status(400).json({ error: "Soni kamida 1" });
  const reason = BRAK_REASONS.includes(b.reason) ? b.reason : "boshqa";
  // qoldiq tekshiruvi: shu sanada ham, bugun ham (keyingi jo'natishlar hisobga olinsin)
  const [at, now] = await Promise.all([productStockAt(date), productStockAt(todayTashkent())]);
  const have = Math.min(at[String(p._id)]?.end || 0, now[String(p._id)]?.end || 0);
  if (have < qty) return res.status(400).json({ error: `Omborda yetarli emas. Qoldiq: ${Math.max(0, have)} dona` });
  const doc = await ProductMove.create({ type: "brak", date, productId: p._id, qty, reason, note: String(b.note ?? "").slice(0, 300), createdBy: who(req.user) });
  await audit(req, { action: "create", entity: "productMove", entityId: doc._id, label: pmLabel(doc, p), after: doc });
  res.status(201).json(doc);
});
// bekor qilish: ПТО/admin — istalganini; usta — o'zi kiritganini 24 soat ichida
app.delete("/api/product-moves/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await ProductMove.findById(req.params.id);
  if (!doc) return notFound(res);
  if (!WRITE_ROLES.includes(req.user.role) && (doc.createdBy?.id !== String(req.user._id) || Date.now() - doc.createdAt > 24 * 36e5))
    return res.status(403).json({ error: "Faqat o'zingiz kiritgan yozuvni 24 soat ichida bekor qila olasiz" });
  const p = await Product.findById(doc.productId).lean();
  await doc.deleteOne();
  await audit(req, { action: "delete", entity: "productMove", entityId: doc._id, label: pmLabel(doc, p), before: doc });
  res.json({ ok: true });
});

/* ---------- Inventarizatsiya ---------- */
// Omborchi (yoki ПТО) sanaydi va qoralama sifatida saqlaydi; ПТО yoki admin tasdiqlaganda farqlar
// kirim (ortiqcha) / chiqim (kamomad) harakati sifatida yoziladi — qoldiq haqiqiyga tenglashadi.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// ta'minotchi nomi bo'yicha qidirish: katta-kichik harf va ortiqcha bo'shliqlarga qaramay
const nameRe = (name) => new RegExp(`^\\s*${escRe(String(name).trim()).replace(/\s+/g, "\\s+")}\\s*$`, "i");
async function nextNo(name, Model) {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { returnDocument: "after" });
  if (c) return c.seq;
  const last = await Model.findOne().sort({ no: -1 }).select("no").lean();
  try {
    await Counter.create({ _id: name, seq: last?.no || 0 });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
  return nextNo(name, Model);
}
/** Barcha materiallarning `date` kuni oxiridagi qoldig'i */
async function stockAt(date) {
  const s = await getSettings();
  const opening = s.opening?.date ? s.opening : { date: "", materials: {}, products: {} };
  const range = { $gte: opening.date || "0000-00-00", $lte: date };
  const [days, moves] = await Promise.all([
    Day.find({ date: range }).select("date materials production shipments").lean(),
    Movement.find({ date: range }).select("type date materialId qty reason").lean(),
  ]);
  return stockReport(opening, days, date, date, moves);
}
const who = (u) => ({ id: String(u._id), username: u.username, name: u.name || u.username });
const invLabel = (d) => `Inventarizatsiya №${d.no} (${d.date})`;
const round6 = (x) => Math.round(x * 1e6) / 1e6;
/** Qoralamada hisobdagi qoldiq har ochilganda yangilanadi; yashirin sanashda omborchiga ko'rsatilmaydi */
async function invView(doc, user) {
  const o = doc.toJSON();
  if (o.status === "draft") {
    const st = (await stockAt(o.date)).materials;
    for (const l of o.lines) l.system = round6(st[String(l.materialId)]?.end || 0);
  }
  if (o.blind && o.status === "draft" && !WRITE_ROLES.includes(user.role)) for (const l of o.lines) l.system = null;
  return o;
}

app.get("/api/inventories", async (_req, res) => {
  const list = await Inventory.find().sort({ no: -1 }).limit(200).lean();
  res.json(
    list.map(({ _id, lines, ...d }) => {
      const counted = lines.filter((l) => l.actual !== null && l.actual !== undefined);
      const diff = (sign) => counted.reduce((s, l) => { const x = (l.actual - l.system) * (l.price || 0); return s + (sign * x > 0 ? Math.abs(x) : 0); }, 0);
      return { ...d, id: String(_id), total: lines.length, counted: counted.length, shortage: d.status === "done" ? Math.round(diff(-1)) : null, surplus: d.status === "done" ? Math.round(diff(1)) : null };
    })
  );
});
app.get("/api/inventories/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Inventory.findById(req.params.id);
  if (!doc) return notFound(res);
  res.json(await invView(doc, req.user));
});
app.post("/api/inventories", async (req, res) => {
  const b = req.body || {};
  const date = b.date || todayTashkent();
  if (!validDate(date) || date > todayTashkent()) return res.status(400).json({ error: "Inventarizatsiya sanasi noto'g'ri" });
  const group = MATERIAL_GROUPS.includes(b.group) ? b.group : "";
  if (await Inventory.exists({ status: "draft" })) return res.status(400).json({ error: "Tugallanmagan inventarizatsiya bor — avval uni tasdiqlang yoki o'chiring" });
  const mats = await Material.find({ stock: true, archived: { $ne: true }, ...(group && { group }) }).sort({ group: 1, sort: 1, name: 1 }).lean();
  if (!mats.length) return res.status(400).json({ error: "Sanash uchun material yo'q" });
  const st = (await stockAt(date)).materials;
  const doc = await Inventory.create({
    no: await nextNo("inventory", Inventory),
    date,
    group,
    blind: Boolean(b.blind) && WRITE_ROLES.includes(req.user.role),
    note: String(b.note ?? "").slice(0, 500),
    lines: mats.map((m) => ({ materialId: m._id, system: round6(st[String(m._id)]?.end || 0), actual: null, price: +m.price || 0 })),
    createdBy: who(req.user),
  });
  await audit(req, { action: "create", entity: "inventory", entityId: doc._id, label: invLabel(doc) });
  res.status(201).json(await invView(doc, req.user));
});
// sanalgan miqdorlarni saqlash (faqat qoralama): { lines: [{ materialId, actual }], note }
app.put("/api/inventories/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Inventory.findById(req.params.id);
  if (!doc) return notFound(res);
  if (doc.status !== "draft") return res.status(400).json({ error: "Tasdiqlangan inventarizatsiyani o'zgartirib bo'lmaydi" });
  const b = req.body || {};
  if (b.lines !== undefined && !Array.isArray(b.lines)) return res.status(400).json({ error: "«lines» ro'yxat (massiv) bo'lishi kerak" });
  const byMat = new Map(doc.lines.map((l) => [String(l.materialId), l]));
  for (const x of b.lines || []) {
    const l = byMat.get(String(x?.materialId));
    if (!l) continue;
    if (x.actual === null || x.actual === "" || x.actual === undefined) l.actual = null;
    else {
      const v = +x.actual;
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: "Manfiy son kiritib bo'lmaydi" });
      l.actual = round6(v);
    }
  }
  if (b.note !== undefined) doc.note = String(b.note).slice(0, 500);
  await doc.save();
  res.json(await invView(doc, req.user));
});
// tasdiqlash — faqat ПТО va admin
app.post("/api/inventories/:id/approve", async (req, res) => {
  if (!WRITE_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Inventarizatsiyani faqat ПТО yoki administrator tasdiqlaydi" });
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Inventory.findById(req.params.id);
  if (!doc) return notFound(res);
  if (doc.status !== "draft") return res.status(400).json({ error: "Bu inventarizatsiya allaqachon tasdiqlangan" });
  if (!doc.lines.some((l) => l.actual !== null && l.actual !== undefined)) return res.status(400).json({ error: "Hech bir material sanalmagan" });
  const st = (await stockAt(doc.date)).materials;
  const moves = [];
  for (const l of doc.lines) {
    l.system = round6(st[String(l.materialId)]?.end || 0);
    if (l.actual === null || l.actual === undefined) continue;
    const d = round6(l.actual - l.system);
    if (Math.abs(d) < 1e-6) continue;
    moves.push({
      type: d > 0 ? "in" : "out", date: doc.date, materialId: l.materialId, qty: Math.abs(d), price: l.price || 0, reason: "inventar", inventoryId: doc._id,
      person: `Inventarizatsiya №${doc.no}`, note: d > 0 ? "Ortiqcha (inventarizatsiya)" : "Kamomad (inventarizatsiya)", createdBy: who(req.user),
    });
  }
  doc.status = "done";
  doc.approvedBy = { ...who(req.user), at: new Date() };
  await doc.save();
  try {
    if (moves.length) await Movement.insertMany(moves);
  } catch (err) {
    await Movement.deleteMany({ inventoryId: doc._id });
    doc.status = "draft";
    doc.approvedBy = undefined;
    await doc.save();
    throw err;
  }
  await audit(req, { action: "update", entity: "inventory", entityId: doc._id, label: `${invLabel(doc)} tasdiqlandi: ${moves.length} ta to'g'rilash` });
  res.json({ ...(await invView(doc, req.user)), adjustments: moves.length });
});
// o'chirish: qoralama — muallif yoki ПТО/admin; tasdiqlangan — faqat ПТО/admin (to'g'rilashlar ham bekor qilinadi)
app.delete("/api/inventories/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Inventory.findById(req.params.id);
  if (!doc) return notFound(res);
  const boss = WRITE_ROLES.includes(req.user.role);
  if (doc.status === "done" && !boss) return res.status(403).json({ error: "Tasdiqlangan inventarizatsiyani faqat ПТО yoki administrator bekor qiladi" });
  if (doc.status === "draft" && !boss && doc.createdBy?.id !== String(req.user._id)) return res.status(403).json({ error: "Faqat o'zingiz boshlagan inventarizatsiyani o'chira olasiz" });
  const r = await Movement.deleteMany({ inventoryId: doc._id });
  await doc.deleteOne();
  await audit(req, { action: "delete", entity: "inventory", entityId: doc._id, label: `${invLabel(doc)} o'chirildi (${r.deletedCount} ta to'g'rilash bekor qilindi)` });
  res.json({ ok: true });
});

/* ---------- Ta'minotchilar ---------- */
async function rememberSupplier(name) {
  const n = String(name).trim().replace(/\s+/g, " ");
  if (!n) return;
  if (await Supplier.exists({ name: nameRe(n) })) return;
  try {
    await Supplier.create({ name: n });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
}
const SUPPLIER_FIELDS = ["name", "phone", "inn", "contact", "note", "archived"];
// ?from=&to= — shu davrdagi xaridlar statistikasi bilan
app.get("/api/suppliers", async (req, res) => {
  // ?lite=1 — faqat nomlar (kirim oynasidagi tavsiyalar uchun)
  if (req.query.lite) return res.json((await Supplier.find({ archived: { $ne: true } }).sort({ name: 1 }).select("name").lean()).map((s) => s.name));
  const { from, to } = req.query;
  const q = { type: "in", reason: { $ne: "inventar" }, supplier: { $nin: ["", null] } };
  if (validDate(from) || validDate(to)) q.date = { ...(validDate(from) && { $gte: from }), ...(validDate(to) && { $lte: to }) };
  const [list, moves] = await Promise.all([
    Supplier.find().sort({ name: 1 }).lean(),
    Movement.find(q).select("date materialId qty price supplier").sort({ date: 1, createdAt: 1 }).lean(),
  ]);
  const key = (s) => String(s).trim().replace(/\s+/g, " ").toLowerCase();
  const stats = new Map();
  for (const m of moves) {
    const k = key(m.supplier);
    const s = stats.get(k) || { name: m.supplier.trim(), count: 0, total: 0, first: m.date, last: m.date, materials: {} };
    s.count++;
    s.total += m.qty * (m.price || 0);
    s.last = m.date;
    const mid = String(m.materialId);
    const mt = (s.materials[mid] ||= { materialId: mid, qty: 0, total: 0, count: 0, minPrice: null, maxPrice: null, lastPrice: null, prevPrice: null, lastDate: "" });
    mt.qty += m.qty;
    mt.total += m.qty * (m.price || 0);
    mt.count++;
    if (m.price > 0) {
      mt.minPrice = mt.minPrice === null ? m.price : Math.min(mt.minPrice, m.price);
      mt.maxPrice = mt.maxPrice === null ? m.price : Math.max(mt.maxPrice, m.price);
      if (mt.lastPrice !== null && mt.lastPrice !== m.price) mt.prevPrice = mt.lastPrice;
      mt.lastPrice = m.price;
    }
    mt.lastDate = m.date;
    stats.set(k, s);
  }
  const out = list.map((s) => ({ ...s, id: String(s._id), _id: undefined, stats: stats.get(key(s.name)) || null }));
  // ro'yxatda yo'q, lekin kirimlarda uchragan nomlar (eski yozuvlar)
  for (const [k, st] of stats) if (!list.some((s) => key(s.name) === k)) out.push({ id: null, name: st.name, phone: "", inn: "", contact: "", note: "", archived: false, stats: st });
  for (const s of out) if (s.stats) s.stats = { ...s.stats, total: Math.round(s.stats.total), materials: Object.values(s.stats.materials).map((m) => ({ ...m, total: Math.round(m.total), qty: round6(m.qty) })) };
  res.json(out);
});
app.post("/api/suppliers", async (req, res) => {
  const data = pick(req.body, SUPPLIER_FIELDS);
  data.name = String(data.name ?? "").trim().replace(/\s+/g, " ");
  if (data.name && (await Supplier.exists({ name: nameRe(data.name) }))) return res.status(409).json({ error: "Bunday ta'minotchi allaqachon bor" });
  const doc = await Supplier.create(data);
  await audit(req, { action: "create", entity: "supplier", entityId: doc._id, label: doc.name, after: doc });
  res.status(201).json(doc);
});
app.put("/api/suppliers/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const before = await Supplier.findById(req.params.id).lean();
  if (!before) return notFound(res);
  const data = pick(req.body, SUPPLIER_FIELDS);
  if (data.name !== undefined) {
    data.name = String(data.name).trim().replace(/\s+/g, " ");
    if (await Supplier.exists({ _id: { $ne: before._id }, name: nameRe(data.name) })) return res.status(409).json({ error: "Bunday ta'minotchi allaqachon bor" });
  }
  const doc = await Supplier.findByIdAndUpdate(req.params.id, data, upd);
  // nomi o'zgarsa — eski kirimlardagi nom ham yangilanadi (statistika uzilmasin)
  if (data.name && data.name !== before.name) await Movement.updateMany({ type: "in", supplier: nameRe(before.name) }, { $set: { supplier: data.name } });
  await audit(req, { action: "update", entity: "supplier", entityId: doc._id, label: doc.name, before, after: doc });
  res.json(doc);
});
app.delete("/api/suppliers/:id", async (req, res) => {
  if (!WRITE_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Sizda bu amal uchun ruxsat yo'q" });
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Supplier.findById(req.params.id);
  if (!doc) return notFound(res);
  if (await Movement.exists({ type: "in", supplier: nameRe(doc.name) })) {
    doc.archived = true;
    await doc.save();
    return res.json({ ok: true, archived: true });
  }
  await doc.deleteOne();
  await audit(req, { action: "delete", entity: "supplier", entityId: doc._id, label: doc.name, before: doc });
  res.json({ ok: true });
});

/* ---------- Buyurtmalar ---------- */
// Bitta buyurtmada bir nechta mahsulot: items: [{ productId, qty, price, shippedBefore }]
// shippedBefore — tizim ishga tushishidan oldin jo'natilgani; qolgan jo'natish kunlik hisobotdan (orderId + productId) olinadi
const ORDER_FIELDS = ["customer", "contractNo", "date", "deadline", "status", "note"];
const orderLabel = (o) => `№${o.no} ${o.customer}${o.contractNo ? ` (shartnoma ${o.contractNo})` : ""}`;

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

/**
 * Eski (bitta mahsulotli) buyurtmalarni items ko'rinishiga o'tkazish — bir marta, avtomatik.
 * Zaxira nusxadan tiklangan eski buyurtmalar ham shu yerda ko'chadi.
 */
let ordersMigrated = null;
function migrateOrders() {
  ordersMigrated ||= Order.collection
    .updateMany(
      { productId: { $type: "objectId" }, $or: [{ items: { $exists: false } }, { items: { $size: 0 } }] },
      [
        { $set: { items: [{ productId: "$productId", qty: { $ifNull: ["$qty", 1] }, price: { $ifNull: ["$price", 0] }, shippedBefore: 0 }] } },
        { $unset: ["productId", "qty", "price"] },
      ]
    )
    .then((r) => r.modifiedCount && console.log(`buyurtmalar: ${r.modifiedCount} ta eski buyurtma yangi ko'rinishga o'tkazildi`))
    .catch((err) => {
      ordersMigrated = null;
      throw err;
    });
  return ordersMigrated;
}

/** Kunlik hisobotdagi jo'natishlar: buyurtma + mahsulot bo'yicha jami */
async function orderShipments(orderIds) {
  const rows = await Day.aggregate([
    { $unwind: "$shipments" },
    { $match: { "shipments.orderId": orderIds ? { $in: orderIds } : { $ne: null } } },
    { $group: { _id: { orderId: "$shipments.orderId", productId: "$shipments.productId" }, qty: { $sum: "$shipments.qty" } } },
  ]);
  return shippedMap(rows);
}
async function orderOut(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return orderView(o, await orderShipments([o._id]));
}

/** Body'dan buyurtma ma'lumotlari. Eski ko'rinish ({ productId, qty, price }) ham qabul qilinadi. */
async function orderData(body, { create }) {
  const data = pick(body, ORDER_FIELDS);
  for (const k of ["date", "deadline"]) if (data[k] !== undefined && data[k] !== "" && !validDate(data[k])) return { error: "Sana formati YYYY-MM-DD" };
  let raw = body?.items;
  if (raw === undefined && body?.productId !== undefined) raw = [{ productId: body.productId, qty: body.qty, price: body.price, shippedBefore: body.shippedBefore }];
  if (raw === undefined) return create ? { error: "Kamida bitta mahsulot qo'shing" } : { data };
  const r = cleanItems(raw, isId);
  if (r.error) return r;
  const ids = r.items.map((i) => i.productId);
  if ((await Product.countDocuments({ _id: { $in: ids } })) !== ids.length) return { error: "Mahsulot topilmadi" };
  return { data: { ...data, items: r.items } };
}

app.get("/api/orders", async (_req, res) => {
  await migrateOrders();
  const [orders, shipped] = await Promise.all([Order.find().sort({ no: 1 }).lean(), orderShipments()]);
  res.json(orders.map((o) => orderView(o, shipped)));
});
app.post("/api/orders", async (req, res) => {
  const r = await orderData(req.body, { create: true });
  if (r.error) return res.status(400).json({ error: r.error });
  const doc = await Order.create({ ...r.data, no: await nextOrderNo() });
  await audit(req, { action: "create", entity: "order", entityId: doc._id, label: orderLabel(doc), after: doc });
  res.status(201).json(await orderOut(doc));
});
app.put("/api/orders/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  await migrateOrders();
  const before = await Order.findById(req.params.id).lean();
  if (!before) return notFound(res);
  const r = await orderData(req.body, { create: false });
  if (r.error) return res.status(400).json({ error: r.error });
  // buyurtmadan olib tashlangan mahsulotga kunlik hisobotda jo'natish bog'langan bo'lsa — ruxsat yo'q
  if (r.data.items) {
    const keep = new Set(r.data.items.map((i) => i.productId));
    const gone = itemsOf(before).map((i) => String(i.productId)).filter((id) => !keep.has(id));
    if (gone.length && (await Day.exists({ shipments: { $elemMatch: { orderId: before._id, productId: { $in: gone } } } })))
      return res.status(400).json({ error: "Olib tashlanayotgan mahsulot kunlik hisobotda shu buyurtma bo'yicha jo'natilgan — avval o'sha jo'natishni boshqa buyurtmaga bog'lang" });
  }
  const doc = await Order.findByIdAndUpdate(req.params.id, r.data.items ? { $set: r.data, $unset: { productId: 1, qty: 1, price: 1 } } : { $set: r.data }, upd);
  if (!doc) return notFound(res);
  await audit(req, { action: "update", entity: "order", entityId: doc._id, label: orderLabel(doc), before: { ...before, items: itemsOf(before) }, after: doc });
  res.json(await orderOut(doc));
});
app.delete("/api/orders/:id", async (req, res) => {
  if (!isId(req.params.id)) return notFound(res);
  const doc = await Order.findByIdAndDelete(req.params.id);
  if (!doc) return notFound(res);
  await Day.updateMany({ "shipments.orderId": doc._id }, { $set: { "shipments.$[s].orderId": null } }, { arrayFilters: [{ "s.orderId": doc._id }] });
  await audit(req, { action: "delete", entity: "order", entityId: doc._id, label: orderLabel(doc), before: doc });
  res.json({ ok: true });
});

/* ---------- Buyurtmalar rejasi (qancha kunda tugatamiz) ---------- */
async function planInput() {
  const today = todayTashkent();
  const s = await getSettings();
  const opening = s.opening?.date ? s.opening : { date: "", materials: {}, products: {} };
  const histFrom = addDays(today, -60);
  await migrateOrders();
  const [products, materials, orders, shipped, days, recent, pmoves] = await Promise.all([
    Product.find().lean(),
    Material.find({ group: "beton" }).select("_id").lean(),
    Order.find().lean(),
    orderShipments(),
    Day.find({ date: { $gte: opening.date || "0000-00-00", $lte: today } }).select("date production shipments").lean(),
    Day.find({ date: { $gte: histFrom, $lt: today } }).select("date production").lean(),
    ProductMove.find({ date: { $gte: opening.date || "0000-00-00", $lte: today } }).select("date productId qty").lean(),
  ]);
  const beton = new Set(materials.map((m) => String(m._id)));
  // o'rtacha: oxirgi 60 kunda shu mahsulot ishlab chiqarilgan kunlar bo'yicha
  const hist = {};
  for (const d of recent)
    for (const l of d.production || [])
      if (+l.fact > 0) {
        const h = (hist[String(l.productId)] ||= { sum: 0, n: 0 });
        h.sum += +l.fact;
        h.n++;
      }
  const todayDoc = days.find((d) => d.date === today);
  const todayFact = {};
  for (const l of todayDoc?.production || []) todayFact[String(l.productId)] = (todayFact[String(l.productId)] || 0) + (+l.fact || 0) + (+l.brak || 0); // brak ham qolipni band qilgan
  const stock = stockReport(opening, days, today, today, [], pmoves).products;
  return {
    today,
    settings: s.plan,
    products: products.map((p) => ({
      id: String(p._id),
      code: p.code,
      forms: p.forms || 0,
      cycleDays: p.cycleDays || 1,
      volume: (p.norms || []).reduce((t, l) => t + (beton.has(String(l.materialId)) ? +l.norm || 0 : 0), 0),
    })),
    // har buyurtma qatori (mahsulot) alohida rejalashtiriladi
    orders: planLines(orders, shipped),
    stock: Object.fromEntries(Object.entries(stock).map(([k, v]) => [k, v.end])),
    history: Object.fromEntries(Object.entries(hist).map(([k, h]) => [k, Math.round((h.sum / h.n) * 100) / 100])),
    todayFact,
  };
}
app.get("/api/plan", async (_req, res) => {
  res.json(planOrders(await planInput()));
});
app.post("/api/plan/check", async (req, res) => {
  const b = req.body || {};
  if (!isId(b.productId) || !(await Product.exists({ _id: b.productId }))) return res.status(400).json({ error: "Mahsulot topilmadi" });
  const qty = Math.floor(+b.qty);
  if (!(qty >= 1 && qty <= 1e6)) return res.status(400).json({ error: "Soni kamida 1 bo'lishi kerak" });
  if (b.deadline && !validDate(b.deadline)) return res.status(400).json({ error: "Muddat sanasi noto'g'ri" });
  res.json(checkNewOrder(await planInput(), { productId: b.productId, qty, deadline: b.deadline || "", customer: String(b.customer || "").slice(0, 200) }));
});

/* ---------- Buxgalteriya: oylik material hisoboti ---------- */
const MONTH_RE = /^\d{4}-\d{2}$/;
// Saqlangan hisobot (bo'lmasa null) va oldingi hisobotdagi imzo qo'yuvchilar — yangi oy uchun
app.get("/api/acct-reports/:month", async (req, res) => {
  const month = req.params.month;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: "Oy formati YYYY-MM" });
  const [report, last] = await Promise.all([
    AcctReport.findOne({ month }),
    AcctReport.findOne({ month: { $ne: month } }).sort({ month: -1 }).select("director chief accountant").lean(),
  ]);
  res.json({ report, lastSigners: last ? { director: last.director, chief: last.chief, accountant: last.accountant } : null });
});
app.put("/api/acct-reports/:month", async (req, res) => {
  const month = req.params.month;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: "Oy formati YYYY-MM" });
  const b = req.body || {};
  if (b.date && !validDate(b.date)) return res.status(400).json({ error: "Sana formati YYYY-MM-DD" });
  if (!Array.isArray(b.rows) || b.rows.length > 300) return res.status(400).json({ error: "Qatorlar ro'yxati noto'g'ri" });
  const rows = b.rows.map((r) => ({
    productId: isId(r?.productId) ? r.productId : null,
    name: String(r?.name ?? "").slice(0, 200),
    unit: String(r?.unit ?? "м3").slice(0, 20),
    qty: +r?.qty || 0,
    m3: +r?.m3 || 0,
    unitCost: +r?.unitCost || 0,
    unitPrice: +r?.unitPrice || 0,
  }));
  const u = req.user;
  const doc = (await AcctReport.findOne({ month })) || new AcctReport({ month });
  const before = doc.isNew ? null : doc.toObject();
  doc.set({
    date: b.date || "",
    rows,
    otherCosts: +b.otherCosts || 0,
    director: String(b.director ?? "").slice(0, 120),
    chief: String(b.chief ?? "").slice(0, 120),
    accountant: String(b.accountant ?? "").slice(0, 120),
    updatedBy: { id: String(u._id), username: u.username, name: u.name || u.username },
  });
  await doc.save();
  await audit(req, { action: before ? "update" : "create", entity: "acct", entityId: month, label: `Material hisoboti ${month}`, before, after: doc });
  res.json(doc);
});
app.delete("/api/acct-reports/:month", async (req, res) => {
  const doc = await AcctReport.findOneAndDelete({ month: req.params.month });
  if (!doc) return notFound(res);
  await audit(req, { action: "delete", entity: "acct", entityId: doc.month, label: `Material hisoboti ${doc.month}`, before: doc });
  res.json({ ok: true });
});

/* ---------- Sozlamalar ---------- */
app.get("/api/settings", async (req, res) => {
  res.json(await ensureSchemes(req));
});
app.put("/api/settings", async (req, res) => {
  const s = await getSettings();
  const before = s.toObject();
  const b = req.body || {};
  if (b.electrodePct !== undefined) s.electrodePct = Math.max(0, +b.electrodePct || 0);
  if (b.company !== undefined) s.company = String(b.company).slice(0, 200);
  if (b.plan && typeof b.plan === "object") {
    const holidays = Array.isArray(b.plan.holidays) ? b.plan.holidays : s.plan?.holidays || [];
    if (holidays.some((d) => !validDate(d))) return res.status(400).json({ error: "Dam olish kuni sanasi noto'g'ri" });
    const c = planConfig({ ...(s.toObject().plan || {}), ...b.plan, holidays: [...new Set(holidays)].sort().slice(-400) });
    s.plan = c;
    s.markModified("plan");
  }
  if (Array.isArray(b.signers)) s.signers = b.signers.map((x) => String(x).slice(0, 120)).slice(0, 6);
  if (b.costSchemes !== undefined) {
    if (!Array.isArray(b.costSchemes) || b.costSchemes.length > 20) return res.status(400).json({ error: "Andozalar ro'yxati noto'g'ri" });
    const clean = [];
    const seen = new Set();
    for (const x of b.costSchemes) {
      if (!x || typeof x !== "object") return res.status(400).json({ error: "Andozalar ro'yxati noto'g'ri" });
      const id = String(x.id ?? "").trim();
      const name = String(x.name ?? "").trim().slice(0, 80);
      if (!/^[a-z0-9-]{1,40}$/.test(id) || seen.has(id)) return res.status(400).json({ error: "Andoza kodi noto'g'ri" });
      if (!name) return res.status(400).json({ error: "Andoza nomi kiritilmagan" });
      seen.add(id);
      const probe = new Product({ code: "andoza", calc: { prodRows: x.prodRows, otherRows: x.otherRows, margin: x.margin, vat: x.vat } });
      await probe.validate(["calc"]);
      const c = probe.toObject().calc;
      clean.push({ id, name, prodRows: c.prodRows, otherRows: c.otherRows, margin: c.margin, vat: c.vat });
    }
    // o'chirilayotgan andozaga mahsulot bog'langan bo'lsa — ruxsat yo'q
    const gone = (s.costSchemes || []).map((x) => x.id).filter((id) => !seen.has(id));
    if (gone.length) {
      const used = await Product.countDocuments({ "calc.scheme": { $in: gone } });
      if (used) return res.status(400).json({ error: `O'chirilayotgan andozaga ${used} ta mahsulot bog'langan — avval ularni boshqa andozaga o'tkazing` });
    }
    s.costSchemes = clean;
    s.markModified("costSchemes");
  }
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
