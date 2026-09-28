"use client";
import { createContext, useContext } from "react";

// nomlar o'zbekcha lotinda — ko'rsatishda t() bilan tarjima qilinadi
export const ROLES = [
  ["admin", "Administrator"],
  ["rahbar", "Rahbar (to'liq huquq)"],
  ["pto", "ПТО muhandisi"],
  ["usta", "Sex boshlig'i (usta)"],
  ["omborchi", "Omborchi"],
  ["kuzatuvchi", "Kuzatuvchi (ko'rish va yuklab olish)"],
  ["kurator", "Kurator (faqat ko'rish)"],
];
export const roleLabel = (r) => ROLES.find(([k]) => k === r)?.[1] || r;
const ADMIN = ["admin", "rahbar"]; // to'liq huquq
export const canStoreRole = (r) => [...ADMIN, "pto", "omborchi"].includes(r);

export const UserContext = createContext(null);

/** Joriy foydalanuvchi va huquqlari */
export function useUser() {
  const user = useContext(UserContext);
  return {
    user,
    canEdit: [...ADMIN, "pto"].includes(user?.role), // ПТО ma'lumotlari
    canStore: canStoreRole(user?.role), // ombor kirim/chiqimi
    canDay: [...ADMIN, "pto", "usta"].includes(user?.role), // kunlik hisobot: reja, fakt, sarf, izoh
    isAdmin: ADMIN.includes(user?.role),
  };
}
