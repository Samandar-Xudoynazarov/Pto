"use client";
import { useState } from "react";
import { tr } from "@/lib/i18n";
import { exportSheets } from "@/lib/xlsx-export";
import Icon from "./Icon";

/**
 * «Excel» (yuklab olish) va «Ulashish» (Telegram, pochta…) tugmalari — barcha rollar uchun.
 * build: () => ({ filename, sheets }) — bosilganda chaqiriladi (async bo'lishi mumkin)
 */
export default function ExportButtons({ build, company, notify, disabled, label = "Excel", shareLabel = "Ulashish" }) {
  const [busy, setBusy] = useState(false);
  async function run(share) {
    setBusy(true);
    try {
      const spec = await build();
      if (!spec) return;
      const r = await exportSheets({ ...spec, company, share });
      if (r === "downloaded-fallback") notify?.("Bu qurilmada ulashish yo'q — fayl yuklab olindi");
    } catch (e) {
      notify?.(e.message || "Excel faylni tayyorlab bo'lmadi");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="export-btns">
      <button type="button" className="btn" onClick={() => run(false)} disabled={busy || disabled} title={tr("Excel faylni yuklab olish")}>
        <Icon name="download" /> {busy ? tr("Tayyorlanmoqda…") : tr(label)}
      </button>
      <button type="button" className="btn" onClick={() => run(true)} disabled={busy || disabled} title={tr("Telegram, pochta va boshqalarga yuborish")}>
        <Icon name="share" /> {tr(shareLabel)}
      </button>
    </span>
  );
}
