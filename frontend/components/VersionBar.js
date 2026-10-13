"use client";
import { tr } from "@/lib/i18n";
import { BASE_MONTH, monthText, thisMonth } from "@/lib/versions";

/**
 * Narx / norma qaysi oydan kuchga kirishini tanlash va oldingi versiyalar ro'yxati.
 * history — [{ from, ... }], from — tanlangan oy (YYYY-MM), describe(v) — versiyaning qisqa tavsifi (masalan, narx).
 * onDelete(from) berilsa, versiyani o'chirish tugmasi chiqadi (eng birinchisidan tashqari).
 */
export default function VersionBar({ id = "ver", history, from, setFrom, describe, onDelete, disabled }) {
  const list = [...(history || [])].sort((a, b) => (a.from < b.from ? 1 : -1));
  const cur = thisMonth();
  return (
    <div className="version-bar">
      <div className="field">
        <label htmlFor={`${id}-from`}>{tr("Qaysi oydan kuchga kiradi")}</label>
        <input
          id={`${id}-from`}
          type="month"
          value={from}
          disabled={disabled}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
        />
        <span className="u">
          {from < cur
            ? tr("Diqqat: o'tgan oy tanlandi — {m} va keyingi oylar (keyingi versiyagacha) qayta hisoblanadi.", { m: monthText(from) })
            : tr("O'tgan oylar hisoboti eski qiymatda qoladi.")}
        </span>
      </div>
      {list.length > 1 && (
        <div className="version-list">
          <span className="muted">{tr("Versiyalar:")}</span>
          {list.map((v) => (
            <span key={v.from} className={`chip${v.from === from ? " on" : ""}`}>
              <button type="button" className="linklike" onClick={() => setFrom(v.from === BASE_MONTH ? from : v.from)} disabled={v.from === BASE_MONTH || disabled}>
                {v.from === BASE_MONTH ? tr("boshidan") : monthText(v.from)}
              </button>
              {describe ? <> · {describe(v)}</> : null}
              {onDelete && v.from !== BASE_MONTH && !disabled && (
                <button
                  type="button"
                  className="x"
                  aria-label={tr("Versiyani o'chirish")}
                  title={tr("Versiyani o'chirish")}
                  onClick={() => {
                    // eslint-disable-next-line no-alert
                    if (window.confirm(tr("{m} versiyasini o'chirasizmi? Shu oydan boshlab oldingi qiymat qo'llanadi.", { m: monthText(v.from) }))) onDelete(v.from);
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
