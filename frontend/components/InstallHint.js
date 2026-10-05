"use client";
import { tr } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { lsGet, lsSet } from "@/lib/calc";
import Icon from "./Icon";

/**
 * Telefonga o'rnatish.
 *  Android (Chrome, Edge, Samsung): «O'rnatish» tugmasi tizim oynasini ochadi (beforeinstallprompt).
 *  iPhone/iPad: Apple avtomatik o'rnatish oynasini umuman bermaydi — faqat qo'lda «Bosh ekranga qo'shish».
 *    Shuning uchun brauzerga qarab qadamma-qadam yo'riqnoma ko'rsatiladi:
 *    Safari (iOS 26 da «Ulashish» «•••» menyusi ichida), iOS uchun Chrome/Edge/Firefox,
 *    Telegram/Instagram ichidagi brauzer — u yerdan o'rnatib bo'lmaydi, Safari'da ochish kerak.
 *  Banner yopilsa — 7 kundan keyin yana chiqadi; menyudagi va kirish oynasidagi «Telefonga o'rnatish» tugmasi yo'riqnomani darhol ochadi.
 */

const OPEN_EVENT = "pto:install";
let deferred = null; // Android: brauzer bergan o'rnatish oynasi (sahifa yuklanganda bir marta keladi)
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    window.dispatchEvent(new Event("pto:installready"));
  });
  window.addEventListener("appinstalled", () => (deferred = null));
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

const HIDE_KEY = "pto.installHidden";
const HIDE_DAYS = 7;
const isHidden = () => {
  const v = lsGet(HIDE_KEY, 0);
  return typeof v === "number" && v > Date.now();
};

/** Qurilma va brauzer */
function detect() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  // iOS 26 dan boshlab Safari UA'da OS versiyasi «18_6» da muzlatilgan — haqiqiy versiya «Version/26.x» da
  const iosVer = Math.max(+(/OS (\d+)[_.]\d/.exec(ua)?.[1] || 0), ios ? +(/Version\/(\d+)/.exec(ua)?.[1] || 0) : 0);
  // ilova ichidagi brauzerlar: u yerda «Bosh ekranga qo'shish» yo'q
  const inApp = /Telegram|Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|OKApp|VKClient|Snapchat|TikTok|musical_ly|; wv\)/i.test(ua);
  let browser = "other";
  if (ios) {
    if (/CriOS/.test(ua)) browser = "chrome";
    else if (/EdgiOS/.test(ua)) browser = "edge";
    else if (/FxiOS/.test(ua)) browser = "firefox";
    else if (/YaBrowser/.test(ua)) browser = "yandex";
    else if (inApp || !/Safari\//.test(ua)) browser = "inapp"; // WKWebView'da «Safari/» yo'q
    else browser = "safari";
  } else if (android) {
    if (inApp) browser = "inapp";
    else if (/SamsungBrowser/.test(ua)) browser = "samsung";
    else if (/YaBrowser/.test(ua)) browser = "yandex";
    else if (/Firefox/.test(ua)) browser = "firefox";
    else browser = "chrome";
  }
  return { ios, android, iosVer, browser, mobile: ios || android };
}

/** Tarjima qilingan gapga JSX bo'laklarni qo'yish: rich("{share} ni tanlang", { share: <b>…</b> }) */
function rich(key, parts = {}) {
  return tr(key)
    .split(/(\{\w+\})/)
    .map((x, i) => {
      const k = /^\{(\w+)\}$/.exec(x)?.[1];
      return k && k in parts ? <span key={i}>{parts[k]}</span> : x;
    });
}

/** iPhone/iPad qadamlari */
function iosSteps({ browser, iosVer }) {
  const p = {
    add: <b>{tr("«На экран Домой» / «Add to Home Screen»")}</b>,
    share: (
      <b>
        {tr("Ulashish")} <Icon name="shareIos" size={15} />
      </b>
    ),
    more: <b>«•••»</b>,
    ok: <b>{tr("«Qo'shish» / «Add»")}</b>,
    safari: <b>Safari</b>,
  };
  if (browser === "safari") {
    const steps =
      iosVer >= 26
        ? ["Safari pastidagi {more} tugmasini bosing", "{share} ni tanlang", "Ro'yxatni pastga suring va {add} ni tanlang", "«Veb-ilova sifatida ochish» yoqilgan bo'lsin, so'ng {ok} ni bosing"]
        : ["Safari pastidagi {share} tugmasini bosing (iPad'da — yuqorida)", "Ro'yxatni pastga suring va {add} ni tanlang", "O'ng yuqoridagi {ok} ni bosing"];
    return { steps: steps.map((k) => rich(k, p)) };
  }
  if (browser === "chrome" || browser === "edge") {
    const old = iosVer > 0 && iosVer < 17;
    return {
      steps: [rich(browser === "chrome" ? "Chrome manzil qatoridagi {share} tugmasini bosing" : "Edge manzil qatoridagi {share} tugmasini bosing", p), rich("{add} ni tanlang", p), rich("{ok} ni bosing", p)],
      note: old ? tr("Bu iOS versiyasida faqat Safari orqali o'rnatiladi — havolani Safari'da oching.") : "",
      safari: old,
    };
  }
  // Telegram, Instagram va boshqa ilovalar ichida, Firefox, Yandex — Safari'da ochish kerak
  return {
    steps: ["Havolani nusxalang (pastdagi tugma)", "{safari} ni oching va manzil qatoriga qo'ying", "Safari'da {share} → {add}"].map((k) => rich(k, p)),
    note:
      browser === "inapp"
        ? tr("Siz ilovani Telegram (yoki boshqa ilova) ichidagi brauzerda ochgansiz — u yerdan bosh ekranga qo'shib bo'lmaydi.")
        : tr("Bu brauzerdan bosh ekranga qo'shib bo'lmaydi — Safari kerak."),
    safari: true,
  };
}

function androidSteps({ browser }) {
  const p = {
    dots: <b>⋮</b>,
    burger: <b>☰</b>,
    open: <b>{tr("«Brauzerda ochish» / «Open in Chrome»")}</b>,
    install: <b>{tr("«Ilovani o'rnatish» / «Установить приложение»")}</b>,
    samsung: <b>{tr("«Добавить страницу» → «Главный экран»")}</b>,
  };
  if (browser === "inapp")
    return {
      steps: [rich("O'ng yuqoridagi {dots} menyusidan {open} ni tanlang", p), rich("Chrome'da {dots} → {install}", p)],
      note: tr("Siz ilovani Telegram (yoki boshqa ilova) ichidagi brauzerda ochgansiz — u yerdan o'rnatib bo'lmaydi."),
      safari: true,
    };
  if (browser === "samsung") return { steps: [rich("Pastdagi {burger} menyusini oching", p), rich("{samsung} ni tanlang", p)] };
  return { steps: [rich("O'ng yuqoridagi {dots} menyusini oching", p), rich("{install} ni tanlang (yoki «Bosh ekranga qo'shish»)", p)] };
}

/** Menyu uchun tugma: yo'riqnomani ochadi (banner yopilgan bo'lsa ham) */
export function InstallButton({ className = "side-logout", mobileOnly = false }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(!isStandalone() && (!mobileOnly || detect().mobile)), []);
  if (!show) return null;
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      <Icon name="download" /> {tr("Telefonga o'rnatish")}
    </button>
  );
}

export default function InstallHint() {
  const [env, setEnv] = useState(null);
  const [banner, setBanner] = useState(false);
  const [guide, setGuide] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const e = detect();
    setEnv(e);
    setCanPrompt(Boolean(deferred));
    if (e.mobile && !isHidden()) {
      setBanner(true);
      if (e.ios) setGuide(true); // iPhone'da o'rnatish tugmasi yo'q — qadamlar darhol ko'rinadi
    }
    const ready = () => {
      setCanPrompt(true);
      if (!isHidden()) setBanner(true);
    };
    const open = () => setGuide(true);
    window.addEventListener("pto:installready", ready);
    window.addEventListener(OPEN_EVENT, open);
    return () => {
      window.removeEventListener("pto:installready", ready);
      window.removeEventListener(OPEN_EVENT, open);
    };
  }, []);

  if (!env || (!banner && !guide)) return null;

  const hide = () => {
    lsSet(HIDE_KEY, Date.now() + HIDE_DAYS * 864e5);
    setBanner(false);
    setGuide(false);
  };
  async function install() {
    if (!deferred) return setGuide(true);
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    deferred = null;
    setCanPrompt(false);
    if (r?.outcome === "accepted") {
      setBanner(false);
      setGuide(false);
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.origin + "/");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(tr("Havolani nusxalang"), location.origin + "/"); // eslint-disable-line no-alert
    }
  }

  const g = env.ios ? iosSteps(env) : env.android && !canPrompt ? androidSteps(env) : null;
  const short = env.ios
    ? env.browser === "safari"
      ? tr("Pastdagi tugma orqali «Bosh ekranga qo'shish» — qanday qilishni ko'rsatamiz.")
      : tr("iPhone'da o'rnatish uchun sahifani Safari'da ochish kerak bo'lishi mumkin.")
    : tr("Bosh ekranda ikonka paydo bo'ladi va ilova brauzersiz ochiladi.");

  return (
    <div className="install no-print" role="note">
      <div className="install-ico">ПТО</div>
      <div className="install-txt">
        <strong>{tr("Telefonga ilova qilib o'rnating")}</strong>
        {!guide && <span>{short}</span>}
        {guide && g && (
          <>
            {g.note && <span className="warn-text">{g.note}</span>}
            <ol className="install-steps">
              {g.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </>
        )}
        {guide && !g && !canPrompt && <span>{tr("Kompyuterda: Chrome yoki Edge manzil qatoridagi «O'rnatish» belgisini bosing.")}</span>}
        <div className="install-acts">
          {canPrompt && <button type="button" className="btn primary sm" onClick={install}>{tr("O'rnatish")}</button>}
          {!canPrompt && !guide && <button type="button" className="btn primary sm" onClick={() => setGuide(true)}>{tr("Qanday?")}</button>}
          {guide && g?.safari && <button type="button" className="btn sm" onClick={copyLink}>{copied ? tr("Nusxalandi ✓") : tr("Havolani nusxalash")}</button>}
        </div>
      </div>
      <button type="button" className="icon-btn install-x" onClick={hide} aria-label={tr("Yopish")}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
