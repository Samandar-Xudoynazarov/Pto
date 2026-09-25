import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export const ROLES = ["admin", "pto", "omborchi", "rahbar", "kurator"];
export const WRITE_ROLES = ["admin", "pto"]; // ПТО ma'lumotlarini (hisobot, katalog, buyurtma, narx) o'zgartiradi
export const STORE_ROLES = ["admin", "pto", "omborchi"]; // ombor kirim/chiqimi, sex/texnika, yangi material
// rahbar va kurator — faqat ko'radi
const TOKEN_DAYS = 30;

/* ---------- parol xeshi (scrypt) ---------- */
export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(plain), salt, 32);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(plain, stored) {
  const [alg, saltB64, keyB64] = String(stored || "").split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64url");
  const key = await scrypt(String(plain ?? ""), Buffer.from(saltB64, "base64url"), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

/** Parol va boshqa satrlarni vaqt bo'yicha xavfsiz solishtirish */
export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const y = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(x, y);
}

export function passwordProblem(p) {
  if (typeof p !== "string" || p.length < 6) return "Parol kamida 6 belgidan iborat bo'lsin";
  if (p.length > 100) return "Parol juda uzun";
  return "";
}

/* ---------- token: base64url(JSON).imzo ---------- */
function secret() {
  const s = process.env.AUTH_SECRET || `pto:${process.env.MONGODB_URI || ""}`;
  return crypto.createHash("sha256").update(s).digest();
}
const sign = (body) => crypto.createHmac("sha256", secret()).update(body).digest("base64url");

export function issueToken(user) {
  const body = Buffer.from(
    JSON.stringify({ u: String(user._id || user.id), v: user.tokenVersion || 0, e: Date.now() + TOKEN_DAYS * 864e5 })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Imzo va muddatni tekshiradi. To'g'ri bo'lsa { u, v } qaytaradi */
export function readToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p?.u || !(p.e > Date.now())) return null;
    return p;
  } catch {
    return null;
  }
}

export const publicUser = (u) => ({
  id: String(u._id || u.id),
  username: u.username,
  name: u.name || u.username,
  role: u.role,
  active: u.active !== false,
  mustChangePassword: Boolean(u.mustChangePassword),
  lastLoginAt: u.lastLoginAt || null,
  createdAt: u.createdAt || null,
});
