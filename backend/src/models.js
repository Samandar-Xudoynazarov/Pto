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
export const MATERIAL_GROUPS = ["beton", "xomashyo", "metall", "zaklad", "boshqa", "xizmat"];
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

export const Material = models.Material || model("Material", materialSchema);
export const Product = models.Product || model("Product", productSchema);
export const Day = models.Day || model("Day", daySchema);
export const Order = models.Order || model("Order", orderSchema);
export const Settings = models.Settings || model("Settings", settingsSchema);
