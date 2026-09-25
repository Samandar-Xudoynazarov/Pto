import "./globals.css";

export const metadata = {
  title: "Zavod ish stoli — ПТО va ombor",
  description: "Temir-beton zavodi: ishlab chiqarish hisoboti, ombor kirim-chiqimi, buyurtmalar, kalkulyatsiya",
  applicationName: "ПТО",
  // iPhone: "Bosh ekranga qo'shish"dan keyin brauzer panelisiz, ilova kabi ochiladi
  appleWebApp: { capable: true, title: "ПТО", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F5F9" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1420" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="uz">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
