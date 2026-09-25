"use client";
import { useEffect, useState } from "react";
import { lsGet, lsSet } from "@/lib/calc";
import Icon from "./Icon";

/**
 * Telefonga o'rnatish taklifi.
 * Android (Chrome): "O'rnatish" tugmasi tizim oynasini ochadi.
 * iPhone (Safari): tizim oynasi yo'q — qo'lda qilish yo'riqnomasi ko'rsatiladi.
 */
export default function InstallHint() {
  const [mode, setMode] = useState(null); // null | "android" | "ios"
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (standalone || lsGet("pto.installHidden", false)) return;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) setMode("ios");
    const onPrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!mode) return null;
  const hide = () => {
    lsSet("pto.installHidden", true);
    setMode(null);
  };
  async function install() {
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    setPrompt(null);
    setMode(null);
  }

  return (
    <div className="install no-print" role="note">
      <div className="install-ico">ПТО</div>
      <div className="install-txt">
        <strong>Telefonga ilova qilib o&apos;rnating</strong>
        {mode === "ios" ? (
          <span>
            Safari pastidagi <b>Ulashish</b> <Icon name="shareIos" size={15} /> tugmasini bosing, so&apos;ng <b>«На экран Домой» / «Add to Home Screen»</b> ni tanlang.
          </span>
        ) : (
          <span>Bosh ekranda ikonka paydo bo&apos;ladi va ilova brauzersiz ochiladi.</span>
        )}
      </div>
      {mode === "android" && (
        <button className="btn primary sm" onClick={install}>
          O&apos;rnatish
        </button>
      )}
      <button className="icon-btn install-x" onClick={hide} aria-label="Yopish">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
