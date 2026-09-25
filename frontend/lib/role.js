"use client";
import { createContext, useContext } from "react";

// nomlar o'zbekcha lotinda — ko'rsatishda t() bilan tarjima qilinadi
export const ROLES = [
  ["admin", "Administrator"],
  ["pto", "ПТО muhandisi"],
  ["usta", "Sex boshlig'i (usta)"],
  ["omborchi", "Omborchi"],
  ["rahbar", "Rahbar (faqat ko'rish)"],
  ["kurator", "Kurator (faqat ko'rish)"],
];
export const roleLabel = (r) => ROLES.find(([k]) => k === r)?.[1] || r;
export const canStoreRole = (r) => r === "admin" || r === "pto" || r === "omborchi";

export const UserContext = createContext(null);

/** Joriy foydalanuvchi va huquqlari */
export function useUser() {
  const user = useContext(UserContext);
  return {
    user,
    canEdit: user?.role === "admin" || user?.role === "pto", // ПТО ma'lumotlari
    canStore: canStoreRole(user?.role), // ombor kirim/chiqimi
    canDay: ["admin", "pto", "usta"].includes(user?.role), // kunlik hisobot: reja, fakt, sarf, izoh
    isAdmin: user?.role === "admin",
  };
}
