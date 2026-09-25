"use client";
import { useEffect } from "react";

/**
 * Telefonda jadvallarni kartochkaga aylantirish uchun: har bir katakka (td) ustun nomini
 * data-label sifatida yozadi. CSS (globals.css → table.rt) kichik ekranda qatorni kartochka qiladi.
 * Sarlavhasi (thead) yo'q jadvallar va .no-rt jadvallar o'zgarmaydi.
 */
function label(table) {
  const heads = [...(table.tHead?.rows[0]?.cells || [])].flatMap((th) => Array(th.colSpan || 1).fill(th.textContent.trim()));
  if (!heads.length) return;
  table.classList.add("rt");
  for (const body of [...table.tBodies, table.tFoot].filter(Boolean)) {
    for (const tr of body.rows) {
      let i = 0;
      for (const td of tr.cells) {
        const span = td.colSpan || 1;
        const l = span > 1 ? "" : heads[i] || "";
        if (td.getAttribute("data-label") !== l) td.setAttribute("data-label", l);
        i += span;
      }
    }
  }
}

export function useCardTables() {
  useEffect(() => {
    let raf = 0;
    const run = () => {
      raf = 0;
      document.querySelectorAll("table:not(.no-rt)").forEach(label);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
