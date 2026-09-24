// Foydalanuvchi yaratish yoki parolini tiklash (masalan, administrator parolini unutsa).
//
//   npm run user -- admin YangiParol123            — "admin" parolini tiklaydi (yo'q bo'lsa, administrator yaratadi)
//   npm run user -- aziz Parol123 pto "Aziz Karimov"  — rol: admin | pto | rahbar
import mongoose from "mongoose";
import { connectDB } from "../src/db.js";
import { User } from "../src/models.js";
import { ROLES, hashPassword, passwordProblem } from "../src/auth.js";

const [username, password, role = "admin", ...nameParts] = process.argv.slice(2);
if (!username || !password) {
  console.log('Foydalanish: npm run user -- <login> <parol> [admin|pto|rahbar] ["Ism Familiya"]');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.log(`Rol noto'g'ri: ${role}. Mumkin: ${ROLES.join(", ")}`);
  process.exit(1);
}
const problem = passwordProblem(password);
if (problem) {
  console.log(problem);
  process.exit(1);
}

await connectDB();
const login = username.trim().toLowerCase();
const existing = await User.findOne({ username: login });
const passwordHash = await hashPassword(password);
if (existing) {
  existing.passwordHash = passwordHash;
  existing.active = true;
  existing.lockUntil = null;
  existing.failedLogins = 0;
  existing.tokenVersion = (existing.tokenVersion || 0) + 1;
  existing.mustChangePassword = true;
  await existing.save();
  console.log(`✓ ${login}: parol yangilandi (rol: ${existing.role})`);
} else {
  await User.create({ username: login, name: nameParts.join(" ") || login, role, passwordHash, mustChangePassword: true });
  console.log(`✓ ${login} yaratildi (rol: ${role})`);
}
await mongoose.disconnect();
