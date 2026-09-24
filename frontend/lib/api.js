const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
const KEY = "pto.token";

export function getToken() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}
export function setToken(t) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
    localStorage.removeItem("pto.password"); // eski versiyadan qolgan
  } catch {}
}

async function request(path, { method = "GET", body, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    const e = new Error("Serverga ulanib bo'lmadi. Internet yoki NEXT_PUBLIC_API_URL ni tekshiring.");
    e.status = 0;
    throw e;
  }
  if (raw && res.ok) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const e = new Error(data?.error || `Xatolik (${res.status})`);
    e.status = res.status;
    if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("pto:unauthorized"));
    throw e;
  }
  return data;
}

export const api = (path, opts) => request(path, opts);

/** Faylni yuklab olish (masalan, zaxira nusxa) */
export async function download(path, fallbackName) {
  const res = await request(path, { raw: true });
  const cd = res.headers.get("content-disposition") || "";
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export async function login(username, password) {
  let res;
  try {
    res = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error("Serverga ulanib bo'lmadi");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Kirishda xatolik");
  setToken(data.token);
  return data.user;
}

export function logout() {
  setToken("");
}
