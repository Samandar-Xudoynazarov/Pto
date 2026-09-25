// Saqlanmagan o'zgarishlar belgisi — bo'limlar orasida o'tishda va sahifani yopishda ogohlantirish uchun
let dirty = false;

export function setUnsaved(v) {
  dirty = Boolean(v);
}
export function hasUnsaved() {
  return dirty;
}
/** Saqlanmagan o'zgarish bo'lsa so'raydi. true — davom etish mumkin */
export function confirmLeave(msg = "Saqlanmagan o'zgarishlar bor. Ularni tashlab ketasizmi?") {
  if (!dirty) return true;
  if (!window.confirm(msg)) return false;
  dirty = false;
  return true;
}
