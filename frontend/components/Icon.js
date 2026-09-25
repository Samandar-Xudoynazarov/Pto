// Oddiy chiziqli ikonkalar (24×24, stroke = joriy rang)
const P = {
  day: "M9 4h6M9 4a1 1 0 0 0-1 1v1h8V5a1 1 0 0 0-1-1M8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4",
  month: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  stock: "M3 9l9-5 9 5v11H3zM7 20v-6h10v6M7 17h10",
  ord: "M4 5h2l2 11h10l2-8H7M10 20a1 1 0 1 0 0 .01M17 20a1 1 0 1 0 0 .01",
  cost: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 11h2M12 11h2M16 11v6M8 15h2M12 15h2M8 18.5h6",
  cat: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  mat: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  share: "M18 8a3 3 0 1 0-2.8-4M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 10.7l6.8-3.9M8.6 13.3l6.8 3.9",
  print: "M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  shareIos: "M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1",
  save: "M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4zM8 4v5h7V4M8 20v-6h8v6",
  plus: "M12 5v14M5 12h14",
  chevL: "M15 6l-6 6 6 6",
  chevR: "M9 6l6 6-6 6",
  admin: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9.5 12l2 2 3.5-4",
  wh: "M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10M10 9h4",
  moves: "M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4",
  targets: "M3 17h2l2-5h7l3 5h4v3H3zM7 20a1.5 1.5 0 1 0 0 .01M17 20a1.5 1.5 0 1 0 0 .01M9 12V7h5l2 5",
  in: "M12 4v12M7 11l5 5 5-5M5 20h14",
  out: "M12 16V4M7 9l5-5 5 5M5 20h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  key: "M14.5 9.5a4 4 0 1 0-3.9 4.9L9 16h-2v2H5v2H3v-2.5l6.6-6.6M15 7.5h.01",
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] || ""} />
    </svg>
  );
}
