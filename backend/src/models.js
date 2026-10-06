import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// JSON javobida _id o'rniga id qaytariladi
const jsonOpts = {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
};
const opts = { timestamps: true, toJSON: jsonOpts, minimize: false };
const sub = { _id: false };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// texnika — ombordagi asbob-uskuna va jihozlar (generator, payvand apparati…); mashinalarning o'zi «Sex va texnika»da (chiqim manzili)
export const MATERIAL_GROUPS = ["beton", "xomashyo", "metall", "zaklad", "yoqilgi", "ehtiyot", "texnika", "asbob", "xojalik", "kiyim", "elektr", "boshqa", "xizmat"];
export const MOVE_TYPES = ["in", "out"]; // ombor: kirim / chiqim
export const TARGET_KINDS = ["department", "vehicle"]; // chiqim manzili: bo'lim/sex yoki texnika
export const ROW_TYPES = ["m3", "kg", "pctPrev", "pctSS", "fixed"];
export const STATUSES = ["yangi", "jarayonda", "tayyor", "topshirildi"];
// brak sabablari: yoriq, o'lcham, armatura ochiq, beton sifati, qolipdan chiqarishda, tashish/yuklashda, saqlashda, boshqa
export const BRAK_REASONS = ["yoriq", "olcham", "armatura", "beton", "qolip", "tashish", "saqlash", "boshqa"];

const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name, required: true });
const qty = { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] };

/* ---------- Materiallar (narx ro'yxati) ---------- */
const normLine = new Schema({ materialId: ref("Material"), norm: { type: Number, required: true, min: 0 } }, sub);

const materialSchema = new Schema(
  {
    name: { type: String, required: [true, "Nomi kiritilmagan"], trim: true, maxlength: 160 },
    unit: { type: String, default: "шт", trim: true, maxlength: 20 },
    group: { type: String, enum: MATERIAL_GROUPS, default: "boshqa" },
    price: { type: Number, default: 0, min: 0 }, // so'm / birlik (beton uchun retseptdan hisoblanadi)
    stock: { type: Boolean, default: true }, // omborda hisobga olinadimi
    electrodeBase: { type: Boolean, default: false }, // elektrod normasi shu metall og'irligidan
    isElectrode: { type: Boolean, default: false }, // shu material — elektrod (norma metall og'irligidan avtomatik)
    code: { type: String, default: "", trim: true, maxlength: 40 }, // artikul / ichki kod
    minQty: { type: Number, default: 0, min: 0 }, // shundan kam qolsa «Kam qoldi» belgisi
    kgPerM: { type: Number, default: null, min: 0 }, // 1 metr og'irligi, kg (bo'sh — nomdan avtomatik, src/metal.js)
    archived: { type: Boolean, default: false }, // ro'yxatlarda ko'rinmaydi, tarixi saqlanadi
    recipe: { type: [normLine], default: [] }, // beton: 1 m³ narxi uchun tarkib (kalkulyatsiya)
    writeoff: { type: [normLine], default: [] }, // beton: 1 m³ uchun ombordan yoziladigan xomashyo (Норма)
    sort: { type: Number, default: 0 },
  },
  opts
);

/* ---------- Mahsulotlar ---------- */
const costRow = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ROW_TYPES, default: "m3" },
    value: { type: Number, default: 0 },
  },
  sub
);
const calcSchema = new Schema(
  {
    items: { type: [normLine], default: [] },
    metalKg: { type: Number, default: 0, min: 0 },
    prodRows: { type: [costRow], default: [] },
    otherRows: { type: [costRow], default: [] },
    margin: { type: Number, default: 20 },
    vat: { type: Number, default: 12 },
    // xarajat andozasi (Settings.costSchemes[].id): berilsa — ФОТ, ЕСП, boshqa xarajatlar, marja va QQS andozadan olinadi,
    // yuqoridagi prodRows/otherRows/margin/vat esa ishlatilmaydi (eski qiymat sifatida saqlanib turadi)
    scheme: { type: String, default: "", trim: true, maxlength: 40 },
  },
  sub
);
const productSchema = new Schema(
  {
    code: { type: String, required: [true, "Marka kiritilmagan"], trim: true, maxlength: 60 },
    name: { type: String, default: "", trim: true, maxlength: 160 },
    group: { type: String, default: "Бошқа", trim: true, maxlength: 60 },
    norms: { type: [normLine], default: [] }, // ishlab chiqarish sarf normasi (1 dona)
    calc: { type: calcSchema, default: () => ({}) },
    notes: { type: [String], default: [] },
    excelPrice: { type: Number, default: null }, // import paytidagi Excel narxi (solishtirish uchun)
    forms: { type: Number, default: 0, min: [0, "Qoliplar soni manfiy bo'lmaydi"] }, // qoliplar (opalubka) soni — rejalashtirish uchun
    cycleDays: { type: Number, default: 1, min: [0.1, "Aylanish muddati kamida 0,1 kun"] }, // 1 qolip necha kunda bo'shaydi
    sort: { type: Number, default: 0 },
  },
  opts
);

/* ---------- Kunlik hisobot ---------- */
// fact — sifatli (omborga kirgan) dona; brak — shu kuni chiqqan yaroqsiz dona (omborga kirmaydi, lekin material sarflangan)
const prodLine = new Schema(
  {
    productId: ref("Product"),
    plan: qty,
    fact: qty,
    brak: qty,
    brakReason: { type: String, enum: ["", ...BRAK_REASONS], default: "" },
    note: { type: String, default: "", maxlength: 300 },
  },
  sub
);
const matLine = new Schema({ materialId: ref("Material"), sarf: qty, kirim: qty }, sub);
const shipLine = new Schema(
  {
    productId: ref("Product"),
    qty: { type: Number, required: true, min: [1, "Soni kamida 1"] },
    customer: { type: String, default: "", maxlength: 160 },
    vehicle: { type: String, default: "", maxlength: 40 },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
  },
  sub
);
const daySchema = new Schema(
  {
    date: { type: String, required: true, match: [DATE_RE, "Sana formati YYYY-MM-DD"], unique: true },
    note: { type: String, default: "", maxlength: 1000 },
    production: { type: [prodLine], default: [] },
    materials: { type: [matLine], default: [] },
    shipments: { type: [shipLine], default: [] },
  },
  opts
);

/* ---------- Buyurtmalar ---------- */
// Bitta buyurtmada bir nechta mahsulot. Har mahsulot buyurtmada bir marta uchraydi.
// shippedBefore — tizim ishga tushishidan OLDIN jo'natilgan miqdor (kunlik hisobotda yo'q, ombor qoldig'iga ta'sir qilmaydi)
const orderItem = new Schema(
  {
    productId: ref("Product"),
    qty: { type: Number, required: true, min: [1, "Soni kamida 1 bo'lishi kerak"] },
    price: { type: Number, default: 0, min: [0, "Narx manfiy bo'lmaydi"] }, // so'm/dona QQS bilan, 0 — kalkulyatsiyadan
    shippedBefore: { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] },
  },
  sub
);
const orderSchema = new Schema(
  {
    no: { type: Number, index: true },
    customer: { type: String, required: [true, "Buyurtmachi kiritilmagan"], trim: true, maxlength: 200 },
    contractNo: { type: String, default: "", trim: true, maxlength: 60 }, // shartnoma (договор) raqami, masalan «ЕКМ 13»
    items: { type: [orderItem], default: [] },
    // eski (bitta mahsulotli) buyurtmalar maydonlari — migrateOrders() ularni items ga ko'chiradi
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: undefined },
    qty: { type: Number, default: undefined },
    price: { type: Number, default: undefined },
    date: { type: String, default: "" },
    deadline: { type: String, default: "" },
    status: { type: String, enum: STATUSES, default: "yangi" },
    note: { type: String, default: "", maxlength: 500 },
  },
  opts
);

/* ---------- Sozlamalar ---------- */
const settingsSchema = new Schema(
  {
    key: { type: String, default: "main", unique: true },
    electrodePct: { type: Number, default: 1.5 }, // elektrod = metall og'irligining 1,5 %
    opening: {
      date: { type: String, default: "" }, // boshlang'ich qoldiq sanasi (shu kun boshiga)
      materials: { type: Schema.Types.Mixed, default: () => ({}) }, // { materialId: miqdor }
      products: { type: Schema.Types.Mixed, default: () => ({}) }, // { productId: dona }
    },
    calcTemplate: { type: Schema.Types.Mixed, default: null }, // yangi mahsulot kalkulyatsiyasi uchun andoza (eski)
    // umumiy xarajat andozalari: [{ id, name, prodRows, otherRows, margin, vat }]; null — hali yaratilmagan
    costSchemes: { type: Schema.Types.Mixed, default: null },
    plan: {
      concretePerDay: { type: Number, default: 0, min: 0 }, // kuniga qorish mumkin bo'lgan beton, m³ (0 — cheklanmagan)
      workDays: { type: [Number], default: () => [1, 2, 3, 4, 5, 6] }, // 0 = yakshanba
      holidays: { type: [String], default: [] }, // dam olish / bayram kunlari
    },
    company: { type: String, default: "" },
    signers: { type: [String], default: [] },
  },
  opts
);

/* ---------- Tayyor mahsulot harakati ----------
 * brak — ombordagi tayyor mahsulot yaroqsiz bo'lib qolsa (qoldiqdan ayriladi)
 * fix  — xato kiritilgan markani tuzatish (пересортица): productId dan qty ayriladi, toProductId ga qo'shiladi
 */
export const PRODUCT_MOVE_TYPES = ["brak", "fix"];
const productMoveSchema = new Schema(
  {
    type: { type: String, enum: PRODUCT_MOVE_TYPES, default: "brak" },
    date: { type: String, required: true, match: [DATE_RE, "Sana formati YYYY-MM-DD"] },
    productId: ref("Product"),
    toProductId: { type: Schema.Types.ObjectId, ref: "Product", default: null }, // faqat «fix»: to'g'ri marka
    qty: { type: Number, required: true, min: [1, "Soni kamida 1"] },
    reason: { type: String, enum: BRAK_REASONS, default: "boshqa" },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    createdBy: { id: String, username: String, name: String },
  },
  opts
);
productMoveSchema.index({ date: 1 });

/* ---------- Texnika jurnali: ta'mir, texnik xizmat, ko'rsatkich ---------- */
export const VEHICLE_LOG_KINDS = ["tamir", "to", "meter", "boshqa"];
const vehicleLogSchema = new Schema(
  {
    vehicleId: ref("Target"),
    date: { type: String, required: true, match: [DATE_RE, "Sana formati YYYY-MM-DD"] },
    kind: { type: String, enum: VEHICLE_LOG_KINDS, default: "tamir" },
    cost: { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] }, // tashqi xizmat / usta haqi, so'm (ombordan olingan qismlar alohida)
    meter: { type: Number, default: null, min: [0, "Manfiy son kiritib bo'lmaydi"] },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    createdBy: { id: String, username: String, name: String },
  },
  opts
);
vehicleLogSchema.index({ vehicleId: 1, date: 1 });

/* ---------- Inventarizatsiya (omborni sanab chiqish) ---------- */
const invLine = new Schema(
  {
    materialId: ref("Material"),
    system: { type: Number, default: 0 }, // hisob bo'yicha qoldiq (sana oxiriga)
    actual: { type: Number, default: null, min: [0, "Manfiy son kiritib bo'lmaydi"] }, // sanalgan; null — hali sanalmagan
    price: { type: Number, default: 0 },
  },
  sub
);
const inventorySchema = new Schema(
  {
    no: { type: Number, index: true },
    date: { type: String, required: true, match: [DATE_RE, "Sana formati YYYY-MM-DD"] },
    status: { type: String, enum: ["draft", "done"], default: "draft" },
    group: { type: String, default: "" }, // bo'sh — hamma material
    blind: { type: Boolean, default: false }, // omborchiga hisobdagi qoldiq ko'rsatilmaydi (yashirin sanash)
    note: { type: String, default: "", trim: true, maxlength: 500 },
    lines: { type: [invLine], default: [] },
    createdBy: { id: String, username: String, name: String },
    approvedBy: { id: String, username: String, name: String, at: Date },
  },
  opts
);

/* ---------- Ta'minotchilar ---------- */
const supplierSchema = new Schema(
  {
    name: { type: String, required: [true, "Nomi kiritilmagan"], trim: true, maxlength: 160, unique: true },
    phone: { type: String, default: "", trim: true, maxlength: 60 },
    inn: { type: String, default: "", trim: true, maxlength: 20 }, // STIR
    contact: { type: String, default: "", trim: true, maxlength: 120 }, // mas'ul shaxs
    note: { type: String, default: "", trim: true, maxlength: 300 },
    archived: { type: Boolean, default: false },
  },
  opts
);

/* ---------- Foydalanuvchilar ---------- */
export const ROLE_LIST = ["admin", "rahbar", "pto", "usta", "omborchi", "buxgalter", "kuzatuvchi", "kurator"];
const userSchema = new Schema(
  {
    username: {
      type: String,
      required: [true, "Login kiritilmagan"],
      trim: true,
      lowercase: true,
      unique: true,
      minlength: [3, "Login kamida 3 belgi"],
      maxlength: 40,
      match: [/^[a-z0-9._-]+$/, "Login faqat lotin harflari, raqam, nuqta, _ va - dan iborat bo'lsin"],
    },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    role: { type: String, enum: ROLE_LIST, default: "kuzatuvchi" },
    passwordHash: { type: String, required: true },
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 }, // oshirilsa, eski tokenlar bekor bo'ladi
    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  opts
);

/* ---------- Buxgalteriya: oylik material hisoboti («…ойида куйилган махсулотлар руйхати») ---------- */
// Buxgalter oldindan to'ldirilgan jadvalni tuzatib saqlaydi; DOCX shu yozuvdan tuziladi
const acctRow = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null }, // null — qo'lda qo'shilgan qator
    name: { type: String, default: "", trim: true, maxlength: 200 },
    unit: { type: String, default: "м3", trim: true, maxlength: 20 },
    qty: { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] },
    m3: { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] },
    unitCost: { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] }, // 1 dona uchun material xarajati, so'm
    unitPrice: { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] }, // 1 dona narxi QQSsiz (kalkulyatsiya) — ish haqi va boshqa xarajatlar = narx − material
  },
  sub
);
const acctReportSchema = new Schema(
  {
    month: { type: String, required: true, unique: true, match: [/^\d{4}-\d{2}$/, "Oy formati YYYY-MM"] },
    date: { type: String, default: "" }, // hujjat sanasi
    rows: { type: [acctRow], default: [] },
    otherCosts: { type: Number, default: 0 }, // Иш хаки, фойда ва бошка харажатлар жами = Σ (QQSsiz narx − material xarajati) × soni
    director: { type: String, default: "", trim: true, maxlength: 120 },
    chief: { type: String, default: "", trim: true, maxlength: 120 }, // Цех бошлиги
    accountant: { type: String, default: "", trim: true, maxlength: 120 }, // Моддий хисобчи
    updatedBy: { id: String, username: String, name: String },
  },
  opts
);

/* ---------- Ombor: chiqim manzillari va harakatlar ---------- */
const targetSchema = new Schema(
  {
    kind: { type: String, enum: TARGET_KINDS, required: true },
    name: { type: String, required: [true, "Nomi kiritilmagan"], trim: true, maxlength: 120 },
    code: { type: String, default: "", trim: true, maxlength: 40 }, // davlat raqami yoki sex kodi
    archived: { type: Boolean, default: false },
    // faqat texnika uchun
    meterUnit: { type: String, enum: ["km", "soat"], default: "km" }, // spidometr (km) yoki motosoat
    fuelNorm: { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] }, // l/100 km yoki l/soat
    serviceEvery: { type: Number, default: 0, min: [0, "Manfiy son kiritib bo'lmaydi"] }, // har necha km/soatda texnik xizmat (0 — kuzatilmaydi)
  },
  opts
);
targetSchema.index({ kind: 1, name: 1 }, { unique: true });

// Omborchi yozadigan kirim/chiqim. Ombor qoldig'i = boshlang'ich + kunlik hisobot (sarf/kirim) + shu harakatlar
const movementSchema = new Schema(
  {
    type: { type: String, enum: MOVE_TYPES, required: true },
    date: { type: String, required: true, match: [DATE_RE, "Sana formati YYYY-MM-DD"] },
    materialId: ref("Material"),
    qty: { type: Number, required: true, min: [0.0001, "Miqdor 0 dan katta bo'lishi kerak"] }, // material birligida (kg, t, dona…)
    // omborchi boshqa birlikda yozgan bo'lsa (masalan, 120 m armatura): kiritilgan son, birlik va koeffitsiyent
    inputQty: { type: Number, default: null },
    inputUnit: { type: String, default: "" }, // "m" — metr
    factor: { type: Number, default: null }, // 1 inputUnit = factor × material birligi
    price: { type: Number, default: 0, min: 0 }, // birlik narxi (kirimda — kiritilgan, chiqimda — material narxi)
    // kirim
    supplier: { type: String, default: "", trim: true, maxlength: 160 },
    docNumber: { type: String, default: "", trim: true, maxlength: 60 }, // nakladnoy raqami
    // chiqim
    departmentId: { type: Schema.Types.ObjectId, ref: "Target", default: null },
    vehicleId: { type: Schema.Types.ObjectId, ref: "Target", default: null },
    person: { type: String, default: "", trim: true, maxlength: 120 }, // kim oldi / kim qabul qildi
    meter: { type: Number, default: null, min: [0, "Manfiy son kiritib bo'lmaydi"] }, // texnikaga berilganda: spidometr yoki motosoat
    note: { type: String, default: "", trim: true, maxlength: 300 },
    reason: { type: String, enum: ["", "inventar"], default: "" }, // "inventar" — inventarizatsiya natijasidagi to'g'rilash
    inventoryId: { type: Schema.Types.ObjectId, ref: "Inventory", default: null },
    createdBy: { id: String, username: String, name: String },
  },
  opts
);
movementSchema.index({ date: -1, createdAt: -1 });
movementSchema.index({ materialId: 1, date: 1 });

/* ---------- O'zgarishlar jurnali ---------- */
const auditSchema = new Schema(
  {
    user: { id: String, username: String, name: String },
    action: { type: String, required: true }, // create | update | delete | login | backup
    entity: { type: String, default: "" }, // material | product | day | order | settings | user
    entityId: { type: String, default: "" },
    label: { type: String, default: "" },
    changes: { type: [new Schema({ p: String, a: Schema.Types.Mixed, b: Schema.Types.Mixed }, sub)], default: [] },
    more: { type: Number, default: 0 },
  },
  { ...opts, timestamps: { createdAt: true, updatedAt: false } }
);
auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 }); // ~13 oydan keyin o'chadi
auditSchema.index({ entity: 1, createdAt: -1 });

/* ---------- Hisoblagichlar (buyurtma raqami va h.k.) ---------- */
// { _id: "order", seq: 17 } — $inc bilan atomik oshiriladi, bir vaqtdagi so'rovlar bir xil raqam olmaydi
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, { versionKey: false });

/* ---------- Kirish urinishlari (cheklash uchun, limits.js) ---------- */
// _id: "u:<login>|<ip>" yoki "ip:<ip>". expiresAt o'tgach MongoDB hujjatni o'zi o'chiradi.
const loginAttemptSchema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);
loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Material = models.Material || model("Material", materialSchema);
export const Product = models.Product || model("Product", productSchema);
export const Day = models.Day || model("Day", daySchema);
export const Order = models.Order || model("Order", orderSchema);
export const Settings = models.Settings || model("Settings", settingsSchema);
export const User = models.User || model("User", userSchema);
export const AuditLog = models.AuditLog || model("AuditLog", auditSchema);
export const Counter = models.Counter || model("Counter", counterSchema);
export const LoginAttempt = models.LoginAttempt || model("LoginAttempt", loginAttemptSchema);
export const Target = models.Target || model("Target", targetSchema);
export const Movement = models.Movement || model("Movement", movementSchema);
export const Inventory = models.Inventory || model("Inventory", inventorySchema);
export const Supplier = models.Supplier || model("Supplier", supplierSchema);
export const ProductMove = models.ProductMove || model("ProductMove", productMoveSchema);
export const VehicleLog = models.VehicleLog || model("VehicleLog", vehicleLogSchema);
export const AcctReport = models.AcctReport || model("AcctReport", acctReportSchema);
