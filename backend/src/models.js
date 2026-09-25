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
export const MATERIAL_GROUPS = ["beton", "xomashyo", "metall", "zaklad", "yoqilgi", "ehtiyot", "boshqa", "xizmat"];
export const MOVE_TYPES = ["in", "out"]; // ombor: kirim / chiqim
export const TARGET_KINDS = ["department", "vehicle"]; // chiqim manzili: bo'lim/sex yoki texnika
export const ROW_TYPES = ["m3", "kg", "pctPrev", "pctSS", "fixed"];
export const STATUSES = ["yangi", "jarayonda", "tayyor", "topshirildi"];

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
    sort: { type: Number, default: 0 },
  },
  opts
);

/* ---------- Kunlik hisobot ---------- */
const prodLine = new Schema(
  { productId: ref("Product"), plan: qty, fact: qty, note: { type: String, default: "", maxlength: 300 } },
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
const orderSchema = new Schema(
  {
    no: { type: Number, index: true },
    customer: { type: String, required: [true, "Buyurtmachi kiritilmagan"], trim: true, maxlength: 200 },
    productId: ref("Product"),
    qty: { type: Number, required: true, min: [1, "Soni kamida 1 bo'lishi kerak"] },
    price: { type: Number, default: 0, min: 0 },
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
    calcTemplate: { type: Schema.Types.Mixed, default: null }, // yangi mahsulot kalkulyatsiyasi uchun andoza
    company: { type: String, default: "" },
    signers: { type: [String], default: [] },
  },
  opts
);

/* ---------- Foydalanuvchilar ---------- */
export const ROLE_LIST = ["admin", "pto", "omborchi", "rahbar", "kurator"];
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
    role: { type: String, enum: ROLE_LIST, default: "rahbar" },
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

/* ---------- Ombor: chiqim manzillari va harakatlar ---------- */
const targetSchema = new Schema(
  {
    kind: { type: String, enum: TARGET_KINDS, required: true },
    name: { type: String, required: [true, "Nomi kiritilmagan"], trim: true, maxlength: 120 },
    code: { type: String, default: "", trim: true, maxlength: 40 }, // davlat raqami yoki sex kodi
    archived: { type: Boolean, default: false },
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
    note: { type: String, default: "", trim: true, maxlength: 300 },
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
