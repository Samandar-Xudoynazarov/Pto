"use client";
import { useEffect, useState } from "react";

/** Ikki bosqichli o'chirish: birinchi bosish — "Tasdiqlash", ikkinchisi — o'chiradi */
export default function DeleteButton({ onConfirm, label = "O'chirish" }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn sm danger${armed ? " armed" : ""}`}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? "Tasdiqlash" : label}
    </button>
  );
}
