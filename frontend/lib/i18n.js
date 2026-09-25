"use client";
/**
 * Uch til: o'zbekcha (lotin) — asosiy, o'zbekcha (kirill), ruscha.
 *
 * Kalit — o'zbekcha lotin matn:  t("Saqlash"), t("{n} ta material", { n: 5 })
 *  - kirill: lug'atdagi (DICT.kr) tarjima, bo'lmasa lotindan avtomatik o'giriladi
 *  - rus:    lug'atdagi (DICT.ru) tarjima, bo'lmasa lotincha qoladi
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DICT } from "./dict";

export const LANGS = [
  { code: "uz", label: "O'zbekcha", short: "UZ" },
  { code: "kr", label: "Ўзбекча", short: "ЎЗ" },
  { code: "ru", label: "Русский", short: "RU" },
];
const KEY = "pto.lang";

/* ---------- lotin → kirill ---------- */
const VOWELS = "aeiouAEIOUоОo'";
const APOS = /[ʻʼ‘’`']/g;
const PAIRS = [
  ["o'", "ў"], ["O'", "Ў"], ["g'", "ғ"], ["G'", "Ғ"],
  ["sh", "ш"], ["Sh", "Ш"], ["SH", "Ш"], ["ch", "ч"], ["Ch", "Ч"], ["CH", "Ч"],
  ["yo", "ё"], ["Yo", "Ё"], ["YO", "Ё"], ["yu", "ю"], ["Yu", "Ю"], ["YU", "Ю"],
  ["ya", "я"], ["Ya", "Я"], ["YA", "Я"], ["ye", "е"], ["Ye", "Е"], ["YE", "Е"],
];
const SINGLE = {
  a: "а", b: "б", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "й", z: "з", c: "ц", w: "в",
};
// o'girilmaydigan so'zlar (brend, qisqartma)
const KEEP = /^(Excel|PDF|Telegram|iPhone|Android|Safari|Chrome|ID|IP|PWA|APK|JSON|M\d+|B\d+)$/;

// o'zlashma so'zlar: «ts» + unli → «ц» (kalkulyatsiya, retsept, koeffitsiyent), «-abr» oylari → «-абрь»
const LOAN = [[/ts(?=[aeiouy])/g, "ц"], [/Ts(?=[aeiouy])/g, "Ц"]];

// o'zakdagi yumshoq belgi va boshqa istisnolar: [lotin o'zak, kirill o'zak]
const STEMS = [
  ["kalkulyatsi", "калькуляци"], ["koeffitsiyent", "коэффициент"], ["sentyabr", "сентябрь"], ["oktyabr", "октябрь"],
  ["noyabr", "ноябрь"], ["dekabr", "декабрь"], ["yanvar", "январь"], ["fevral", "февраль"], ["aprel", "апрель"], ["iyun", "июнь"], ["iyul", "июль"],
  ["elektr", "электр"], ["tonna", "тонна"], ["film", "фильм"], ["relef", "рельеф"],
];

function cyrWord(w) {
  if (KEEP.test(w) || (/^[A-Z0-9-]{2,}$/.test(w) && !/[aeiou]/.test(w))) return w;
  const low = w.toLowerCase();
  const stem = STEMS.find(([l]) => low.startsWith(l));
  if (stem) {
    const head = w[0] === w[0].toUpperCase() ? stem[1][0].toUpperCase() + stem[1].slice(1) : stem[1];
    return head + (w.length > stem[0].length ? cyrWord(w.slice(stem[0].length)) : "");
  }
  for (const [re, to] of LOAN) w = w.replace(re, to);
  let out = "";
  for (let i = 0; i < w.length; ) {
    const two = w.slice(i, i + 2);
    const pair = PAIRS.find(([l]) => l === two);
    if (pair) {
      out += pair[1];
      i += 2;
      continue;
    }
    const ch = w[i];
    if (ch === "'" ) {
      out += "ъ";
      i++;
      continue;
    }
    const low = ch.toLowerCase();
    let c = SINGLE[low];
    if (c === undefined) {
      out += ch;
      i++;
      continue;
    }
    // so'z boshida va unlidan keyin «e» → «э»
    if (low === "e" && (i === 0 || VOWELS.includes(w[i - 1]))) c = "э";
    out += ch === low ? c : c.toUpperCase();
    i++;
  }
  return out;
}

export function toCyr(text) {
  // {o'rinbosar} va kirillcha qismlarga tegmaymiz
  return String(text)
    .replace(APOS, "'")
    .split(/(\{[^}]*\})/)
    .map((part) => (part.startsWith("{") ? part : part.replace(/[A-Za-z']+/g, (w) => (w === "'" ? w : cyrWord(w)))))
    .join("");
}

/* ---------- tarjima ---------- */
function toRu(s) {
  if (DICT.ru[s] !== undefined) return DICT.ru[s];
  for (const [re, to] of DICT.ruPatterns) if (re.test(s)) return s.replace(re, to);
  if (s.includes("; ")) return s.split("; ").map(toRu).join("; "); // bir nechta xato birga
  return s;
}

export function translate(lang, key, vars) {
  if (key === undefined || key === null) return "";
  let out = String(key);
  if (lang === "ru") out = toRu(out);
  else if (lang === "kr") out = DICT.kr[out] ?? toCyr(out);
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

let current = "uz";
/** React tashqarisida (masalan, api.js, excel.js) ishlatish uchun */
export const tr = (key, vars) => translate(current, key, vars);
export const currentLang = () => current;

const Ctx = createContext({ lang: "uz", setLang: () => {}, t: (k, v) => translate("uz", k, v) });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState("uz");
  useEffect(() => {
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    if (!LANGS.some((l) => l.code === saved)) saved = (navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "uz";
    current = saved;
    setLangState(saved);
  }, []);
  useEffect(() => {
    current = lang;
    document.documentElement.lang = lang === "ru" ? "ru" : lang === "kr" ? "uz-Cyrl" : "uz";
  }, [lang]);
  const setLang = useCallback((l) => {
    current = l;
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {}
  }, []);
  const value = useMemo(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
