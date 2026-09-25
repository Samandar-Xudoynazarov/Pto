// Telefonga "ilova" sifatida o'rnatish uchun (PWA manifest)
export default function manifest() {
  return {
    name: "ПТО ish stoli",
    short_name: "ПТО",
    description: "Temir-beton zavodi ПТО bo'limi: ishlab chiqarish, ombor, buyurtmalar, kalkulyatsiya",
    lang: "uz",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#101828",
    theme_color: "#101828",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
