const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
const KEY = "pto.password";

export function getPassword() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}
export function setPassword(p) {
  try {
    if (p) localStorage.setItem(KEY, p);
    else localStorage.removeItem(KEY);
  } catch {}
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-app-password": getPassword() },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    const e = new Error("Serverga ulanib bo'lmadi. Internet yoki NEXT_PUBLIC_API_URL ni tekshiring.");
    e.status = 0;
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const e = new Error(data?.error || `Xatolik (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export async function login(password) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Kirishda xatolik");
  setPassword(password);
  return data;
}
