import { LoginAttempt } from "./models.js";

/*
 * Kirish urinishlarini cheklash.
 *
 * Bloklash foydalanuvchining o'ziga emas, «login + IP» juftligiga qo'yiladi: begona odam boshqa
 * joydan `admin` ga 5 marta xato parol yozsa, faqat o'zi bloklanadi — zavoddagi administrator
 * odatdagidek kiraveradi. Bundan tashqari, bitta IP'dan barcha loginlarga jami urinishlar ham
 * cheklanadi (parolni ko'p loginlarda sinab ko'rishga qarshi).
 *
 * Mavjud va mavjud bo'lmagan loginlar bir xil hisoblanadi, shuning uchun javobdan login bor-yo'qligini bilib bo'lmaydi.
 */
export const USER_LIMIT = 5; // login + IP: shuncha xato urinishdan keyin
export const USER_LOCK_MIN = 10; //          shuncha daqiqaga bloklanadi
export const IP_LIMIT = 30; // bitta IP'dan jami xato urinishlar
export const IP_LOCK_MIN = 15;
const WINDOW_MIN = 15; // shuncha vaqt urinish bo'lmasa, hisob nolga tushadi (TTL)

const minutes = (m) => new Date(Date.now() + m * 60000);

/** Mijoz IP manzili. Vercel'da x-real-ip / x-forwarded-for ni Vercel o'zi yozadi (soxtalashtirib bo'lmaydi). */
export function clientIp(req) {
  if (process.env.VERCEL) {
    const ip = req.get("x-real-ip") || String(req.get("x-forwarded-for") || "").split(",")[0].trim();
    if (ip) return ip;
  }
  return req.socket?.remoteAddress || "?";
}

export const userKey = (username, ip) => `u:${username}|${ip}`;
export const ipKey = (ip) => `ip:${ip}`;

async function lockedUntil(key) {
  const d = await LoginAttempt.findById(key).select("lockUntil").lean();
  return d?.lockUntil && d.lockUntil > new Date() ? d.lockUntil : null;
}

/**
 * Parol tekshirilishidan OLDIN urinishni atomik ($inc) band qiladi — parallel so'rovlar hisobni aylanib o'ta olmaydi.
 * Natija: { locked: Date } yoki { count }.
 */
export async function takeAttempt(key, limit, lockMin, tries = 3) {
  const now = new Date();
  let doc;
  try {
    doc = await LoginAttempt.findOneAndUpdate(
      { _id: key, $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }] },
      { $inc: { count: 1 }, $set: { expiresAt: minutes(WINDOW_MIN) } },
      { upsert: true, returnDocument: "after" }
    );
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // 11000 ikki holatda: hujjat bloklangan (filtrga tushmadi) yoki parallel so'rov uni hozirgina yaratdi
    const until = await lockedUntil(key);
    if (until) return { locked: until };
    if (tries > 1) return takeAttempt(key, limit, lockMin, tries - 1);
    return { locked: minutes(1) };
  }
  if (doc.count > limit) return { locked: await lock(key, lockMin) };
  return { count: doc.count };
}

export async function lock(key, lockMin) {
  const until = minutes(lockMin);
  await LoginAttempt.updateOne({ _id: key }, { $set: { lockUntil: until, count: 0, expiresAt: until } });
  return until;
}

/** Muvaffaqiyatli kirish: login+IP hisobi o'chadi, IP hisobidan shu urinish qaytariladi (bir IP ortidagi ko'p xodim uchun) */
export async function loginSucceeded(username, ip) {
  await Promise.all([
    LoginAttempt.deleteOne({ _id: userKey(username, ip) }),
    LoginAttempt.updateOne({ _id: ipKey(ip), count: { $gt: 0 } }, { $inc: { count: -1 } }),
  ]);
}

/** Admin parolni tiklaganda — shu loginning barcha IP'lardagi bloklari olib tashlanadi */
export async function clearUserLocks(username) {
  const esc = String(username).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await LoginAttempt.deleteMany({ _id: { $regex: `^u:${esc}\\|` } });
}
