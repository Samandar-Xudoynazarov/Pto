import { AuditLog } from "./models.js";

const MAX_CHANGES = 80;
const MAX_LEN = 160;
const SKIP = new Set(["_id", "id", "createdAt", "updatedAt", "__v", "passwordHash", "tokenVersion", "failedLogins", "lockUntil", "lastLoginAt"]);

const plain = (doc) => (doc ? JSON.parse(JSON.stringify(doc.toObject ? doc.toObject() : doc)) : null);

/** Ro'yxatni kalit bo'yicha obyektga aylantiradi, shunda qator tartibi o'zgarsa ham farq to'g'ri chiqadi */
function keyed(arr, key) {
  if (!Array.isArray(arr)) return arr;
  const out = {};
  for (const item of arr) {
    let k = String(item?.[key] ?? "?");
    let n = 2;
    while (out[k] !== undefined) k = `${item?.[key]}#${n++}`;
    const { [key]: _drop, ...rest } = item || {};
    out[k] = rest;
  }
  return out;
}

function normalize(entity, obj) {
  if (!obj) return {};
  const o = { ...obj };
  if (entity === "day") {
    o.production = keyed(o.production, "productId");
    o.materials = keyed(o.materials, "materialId");
  }
  if (entity === "material") {
    o.recipe = keyed(o.recipe, "materialId");
    o.writeoff = keyed(o.writeoff, "materialId");
  }
  if (entity === "product") {
    o.norms = keyed(o.norms, "materialId");
    if (o.calc) o.calc = { ...o.calc, items: keyed(o.calc.items, "materialId") };
  }
  return o;
}

function flatten(v, prefix, out) {
  if (v && typeof v === "object") {
    const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    if (!entries.length && prefix) out[prefix] = Array.isArray(v) ? "[]" : "{}";
    for (const [k, x] of entries) {
      if (!prefix && SKIP.has(k)) continue;
      flatten(x, prefix ? `${prefix}.${k}` : String(k), out);
    }
  } else if (prefix) out[prefix] = v;
  return out;
}

const empty = (v) => v === undefined || v === null || v === "" || v === 0 || v === false || v === "[]" || v === "{}";
const short = (v) => {
  if (v === undefined || v === null) return null;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN)}…` : v;
};

/** Ikki holat orasidagi farqlar: [{ p: yo'l, a: oldin, b: keyin }] */
export function diff(entity, before, after) {
  const a = flatten(normalize(entity, plain(before)), "", {});
  const b = flatten(normalize(entity, plain(after)), "", {});
  const changes = [];
  for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[p];
    const y = b[p];
    if (x === y || (empty(x) && empty(y))) continue;
    changes.push({ p, a: short(x), b: short(y) });
  }
  return changes;
}

/**
 * O'zgarishni jurnalga yozadi. Xato bo'lsa asosiy so'rovni buzmaydi.
 * action: create | update | delete | login | backup
 */
export async function audit(req, { action, entity, entityId = "", label = "", before = null, after = null, changes }) {
  try {
    const list = changes ?? (action === "update" || action === "create" || action === "delete" ? diff(entity, before, after) : []);
    if (action === "update" && !list.length) return; // hech narsa o'zgarmagan
    const u = req.user;
    await AuditLog.create({
      user: u ? { id: String(u._id), username: u.username, name: u.name || u.username } : { id: "", username: "?", name: "?" },
      action,
      entity,
      entityId: String(entityId || ""),
      label: String(label || "").slice(0, 200),
      changes: list.slice(0, MAX_CHANGES),
      more: Math.max(0, list.length - MAX_CHANGES),
    });
  } catch (err) {
    console.error("audit:", err?.message);
  }
}
