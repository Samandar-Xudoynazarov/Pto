"use client";
import { createContext, useContext } from "react";

export const ROLES = [
  ["admin", "Administrator"],
  ["pto", "ПТО muhandisi"],
  ["rahbar", "Rahbar (faqat ko'rish)"],
];
export const roleLabel = (r) => ROLES.find(([k]) => k === r)?.[1] || r;

export const UserContext = createContext(null);

/** Joriy foydalanuvchi va huquqlari */
export function useUser() {
  const user = useContext(UserContext);
  return {
    user,
    canEdit: user?.role === "admin" || user?.role === "pto",
    isAdmin: user?.role === "admin",
  };
}
