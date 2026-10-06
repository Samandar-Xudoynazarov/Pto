"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { GROUPS } from "@/lib/calc";
import Icon from "./Icon";

// omborchi tanlay oladigan guruhlar (beton retseptli, xizmat/energiya — ПТО ishi)
const STORE_GROUPS = GROUPS.filter(([k]) => k !== "beton" && k !== "xizmat");
const UNITS = ["шт", "кг", "т", "л", "м", "м²", "м³", "п/м", "комп", "пара", "рулон", "упак"];

// guruh tanlanganda — odatiy birlik va tez tanlash uchun namunaviy nomlar
const PRESETS = {
  yoqilgi: { unit: "л", names: ["Дизельное топливо (солярка)", "Бензин АИ-80", "Бензин АИ-92", "Пропан (газ)", "Моторное масло", "Гидравлическое масло", "Трансмиссионное масло", "Антифриз", "Солидол", "Тормозная жидкость"] },
  ehtiyot: { unit: "шт", names: ["Фильтр масляный", "Фильтр воздушный", "Фильтр топливный", "Шина", "Аккумулятор", "Тормозные колодки", "Подшипник", "Ремень", "Шланг гидравлический", "Свеча зажигания"] },
  texnika: { unit: "шт", names: ["Сварочный аппарат", "Генератор", "Компрессор", "Вибратор глубинный", "Насос", "Таль (подъёмник)", "Болгарка (УШМ)", "Перфоратор", "Дрель"] },
  asbob: { unit: "шт", names: ["Молоток", "Кувалда", "Лом", "Лопата", "Круг отрезной", "Круг зачистной", "Рулетка", "Набор ключей", "Держатель электрода", "Ножовка"] },
  xojalik: { unit: "шт", names: ["Метла", "Ведро", "Мыло", "Моющее средство", "Мешки для мусора", "Туалетная бумага", "Тряпка", "Хлорка"] },
  kiyim: { unit: "шт", names: ["Спецодежда (комбинезон)", "Каска", "Ботинки рабочие", "Перчатки", "Рукавицы", "Очки защитные", "Респиратор", "Сигнальный жилет", "Маска сварщика"] },
  elektr: { unit: "шт", names: ["Кабель", "Автоматический выключатель", "Розетка", "Лампа", "Прожектор", "Изолента", "Удлинитель"] },
  metall: { unit: "кг", names: [] },
  xomashyo: { unit: "т", names: [] },
};
const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[\s.,\-()]+/g, "");

/**
 * Yangi material / xo'jalik moli / ehtiyot qism / yoqilg'i va h.k. qo'shish (omborchi ham — narxsiz).
 * onSaved(doc) — saqlangan material bilan chaqiriladi (kirim oynasida darhol tanlanadi).
 */
export default function NewMaterialSheet({ open, initialName = "", materials = [], onClose, onSaved, canEdit, notify }) {
  const t = useT();
  const ref = useRef(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (open) {
      setF({ name: initialName || "", unit: "шт", group: "boshqa", code: "", minQty: "", price: "", unitTouched: false });
      setErr("");
      if (d && !d.open) d.showModal();
    } else if (d?.open) d.close();
  }, [open, initialName]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === "unit" && { unitTouched: true }) }));
  const chooseGroup = (g) => setF((x) => ({ ...x, group: g, unit: x.unitTouched ? x.unit : PRESETS[g]?.unit || "шт" }));
  const preset = PRESETS[f.group];

  // shu nomdagi (yoki juda o'xshash) material allaqachon bormi
  const same = useMemo(() => {
    const n = norm(f.name);
    if (n.length < 3) return [];
    return materials.filter((m) => norm(m.name) === n || (n.length >= 5 && norm(m.name).includes(n))).slice(0, 3);
  }, [f.name, materials]);
  const exact = same.find((m) => norm(m.name) === norm(f.name) && !m.archived);

  async function submit(e) {
    e.preventDefault();
    if (exact) return setErr(t("Bu nomdagi material allaqachon bor — yangisini qo'shmang, o'shani tanlang"));
    setBusy(true);
    setErr("");
    try {
      const body = { name: f.name.trim().replace(/\s+/g, " "), unit: f.unit.trim(), group: f.group, code: f.code.trim(), minQty: +f.minQty || 0, stock: true };
      if (canEdit) body.price = +f.price || 0;
      const doc = await api("/materials", { method: "POST", body });
      notify?.(t("Material qo'shildi"));
      await onSaved?.(doc);
      onClose();
    } catch (e2) {
      setErr(t(e2.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="bsheet" onClose={onClose}>
      {open && (
        <form onSubmit={submit}>
          <div className="bsheet-grip" aria-hidden="true" />
          <div className="bsheet-head">
            <h2>{t("Yangi material / mol")}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Yopish")}>
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="field">
            <span className="lbl">{t("Guruh")}</span>
            <div className="chips nm-groups">
              {STORE_GROUPS.map(([k, l]) => (
                <button type="button" key={k} className="chip" aria-pressed={f.group === k} onClick={() => chooseGroup(k)}>
                  <span className={`dot g-${k}`} aria-hidden="true" /> {t(l)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="nm-name">{t("Nomi")}</label>
            <input id="nm-name" list="nm-names" value={f.name} onChange={set("name")} required maxLength={160} autoFocus placeholder={preset?.names?.[0] || ""} />
            <datalist id="nm-names">
              {(preset?.names || []).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {preset?.names?.length > 0 && !f.name && (
              <div className="chips nm-suggest">
                {preset.names.slice(0, 6).map((n) => (
                  <button type="button" key={n} className="chip sm" onClick={() => setF((x) => ({ ...x, name: n }))}>
                    {n}
                  </button>
                ))}
              </div>
            )}
            {same.length > 0 && (
              <p className={`hint ${exact ? "warn-text" : ""}`}>
                {t(exact ? "Bunday material bor:" : "O'xshash materiallar bor:")} {same.map((m) => `${m.name} (${m.unit})${m.archived ? ` — ${t("arxivda")}` : ""}`).join("; ")}
              </p>
            )}
          </div>

          <div className="form-grid two">
            <div className="field">
              <label htmlFor="nm-unit">{t("Birlik")}</label>
              <input id="nm-unit" list="nm-units" value={f.unit} onChange={set("unit")} required maxLength={20} />
              <datalist id="nm-units">
                {UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="nm-min">{t("Minimal qoldiq")}</label>
              <input id="nm-min" type="number" inputMode="decimal" min="0" step="any" value={f.minQty} onChange={set("minQty")} />
            </div>
            <div className="field">
              <label htmlFor="nm-code">{t("Kod / artikul")}</label>
              <input id="nm-code" value={f.code} onChange={set("code")} maxLength={40} />
            </div>
            {canEdit && (
              <div className="field">
                <label htmlFor="nm-price">
                  {t("Narxi")} <span className="u">({t("so'm")})</span>
                </label>
                <input id="nm-price" type="number" inputMode="decimal" min="0" step="any" value={f.price} onChange={set("price")} />
              </div>
            )}
          </div>
          {!canEdit && <p className="hint">{t("Narx kirimda yoziladi (har xariddagi narx). Material narxini ПТО belgilaydi.")}</p>}
          {err && <p className="err">{err}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t("Bekor qilish")}
            </button>
            <button className="btn primary" disabled={busy || Boolean(exact)}>
              {busy ? t("Saqlanmoqda…") : t("Saqlash")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
