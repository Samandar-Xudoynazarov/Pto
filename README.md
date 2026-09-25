# ПТО ish stoli

Temir-beton zavodi ПТО bo'limi uchun web-ilova: ishlab chiqarish hisoboti, buyurtmalar, materiallar sarfi, kalkulyatsiya va mahsulotlar katalogi.

```
pto-app/
├── backend/    Express 5 + Mongoose 9 (MongoDB Atlas) → alohida Vercel loyihasi
└── frontend/   Next.js 16 (App Router)               → alohida Vercel loyihasi
```

Vercel'da **ikkita loyiha** yaratiladi: biri backend uchun, biri frontend uchun.

---

## 1. MongoDB Atlas

1. https://cloud.mongodb.com da bepul **M0** klaster yarating.
2. **Database Access** bo'limida foydalanuvchi va parol qo'shing.
3. **Network Access** bo'limida `0.0.0.0/0` manzilini qo'shing. Vercel IP manzillari doimiy emas, shuning uchun bu kerak.
4. **Connect → Drivers** orqali ulanish qatorini nusxalang va `/?` oldiga baza nomini yozing:
   `mongodb+srv://user:parol@cluster0.xxxxx.mongodb.net/pto?retryWrites=true&w=majority`

## 2. Backend'ni Vercel'ga joylash

1. Loyihani GitHub'ga yuklang (yoki `vercel` CLI'dan foydalaning).
2. Vercel → **Add New → Project** → repozitoriyni tanlang.
3. **Root Directory**: `backend`, **Framework Preset**: *Other*.
4. **Environment Variables**:

   | Nomi | Qiymati |
   |---|---|
   | `MONGODB_URI` | Atlas ulanish qatori |
   | `APP_PASSWORD` | birinchi kirish paroli (pastda «Foydalanuvchilar» bo'limiga qarang) |
   | `AUTH_SECRET` | uzun tasodifiy satr — kirish tokenlarini imzolaydi |
   | `CORS_ORIGIN` | frontend manzili, masalan `https://pto-frontend.vercel.app` (birinchi deploy paytida `*` qo'ysangiz ham bo'ladi) |

5. **Deploy** tugmasini bosing. So'ng `https://<backend>.vercel.app/api/health` manzilini oching: `{"ok":true,...}` chiqishi kerak.

## 3. Frontend'ni Vercel'ga joylash

1. Vercel → **Add New → Project** → o'sha repozitoriy.
2. **Root Directory**: `frontend`. Framework avtomatik ravishda *Next.js* sifatida aniqlanadi.
3. **Environment Variables**: `NEXT_PUBLIC_API_URL` = `https://<backend>.vercel.app` (oxirida `/` qo'ymang).
4. **Deploy**.
5. Backend'dagi `CORS_ORIGIN` qiymatini frontend manziliga o'zgartiring va backend'ni **Redeploy** qiling.

> `NEXT_PUBLIC_API_URL` build vaqtida kodga yoziladi. Uni o'zgartirsangiz, frontend'ni qayta deploy qiling.

## 4. Excel ma'lumotlarini bazaga yuklash (bir marta)

`backend/scripts/data/pto-sentyabr-2026.json` faylida sizning Excel fayllaringizdan olingan ma'lumotlar bor:
48 ta material va narxlari, 3 ta beton retsepti, 50 ta mahsulotning normalari va kalkulyatsiyasi,
22.09.2026 boshiga boshlang'ich qoldiq (ombor faylidagi 21.09 oxiridagi «Остатка») hamda oylik statistika uchun 02.09–21.09 kunlik ma'lumotlari. Ombor hisobi 22-sentyabrdan boshlanadi.

Kompyuteringizda (Node.js 20.12 yoki undan yangi versiya kerak):

```bash
cd backend
cp .env.example .env      # MONGODB_URI ga Atlas ulanish qatorini yozing
npm install
npm run import            # bo'sh bazaga yuklaydi
# npm run import -- --reset   ← hammasini o'chirib, qaytadan yuklash
```

## Kompyuterda ishga tushirish

```bash
# 1-terminal
cd backend && cp .env.example .env && npm install && npm run dev    # http://localhost:4000
# 2-terminal
cd frontend && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3000
```

## Foydalanuvchilar va rollar

| Rol | Huquqlari |
|---|---|
| Administrator | hamma narsa + foydalanuvchilar, zaxira nusxa, o'zgarishlar tarixi («Boshqaruv» bo'limi) |
| ПТО muhandisi | hisobot, ombor, buyurtma, katalog, materiallarni tahrirlaydi |
| Rahbar | hamma bo'limni ko'radi, hech narsani o'zgartira olmaydi |
| Kurator | kuzatuvchi: hamma bo'limni ko'radi, hech narsani o'zgartira olmaydi |

**Birinchi kirish:** bazada foydalanuvchi bo'lmasa, login `admin` va parol sifatida `APP_PASSWORD` qiymati kiritiladi. Administrator avtomatik yaratiladi va darhol o'z parolini o'rnatishi so'raladi. Keyingi foydalanuvchilar «Boshqaruv» bo'limida qo'shiladi.

**Parol unutilsa** (kompyuterda, `backend` papkasida): `npm run user -- admin YangiParol123`

Ikki kishi bir kunlik hisobotni bir vaqtda tahrirlasa, ikkinchisi saqlashda ogohlantirish oladi va boshqaning ishi ustiga yozilmaydi. Saqlanmagan o'zgarishlar bo'lsa, boshqa bo'limga o'tish yoki sahifani yopishdan oldin so'raladi.

Bitta qurilmadan (IP) bir login uchun 5 marta noto'g'ri parol kiritilsa, shu login o'sha qurilmada 10 daqiqaga bloklanadi — boshqa joydan kirayotgan haqiqiy egasi bunga bog'liq emas. Bitta IP'dan barcha loginlarga jami 30 ta xato urinishdan keyin shu IP 15 daqiqaga bloklanadi. Administrator parolni tiklasa (yoki `npm run user`), shu loginning barcha bloklari olib tashlanadi. Barcha o'zgarishlar (kim, qachon, nimani, qaysi qiymatdan qaysi qiymatga) jurnalga yoziladi va 13 oy saqlanadi.

## Zaxira nusxa

«Boshqaruv → Zaxira nusxa → Yuklab olish» butun bazani JSON faylga beradi (parollarsiz). Tiklash:

```bash
cd backend
npm run restore -- pto-backup-2026-09-24-18-30.json         # nima tiklanishini ko'rsatadi
npm run restore -- pto-backup-2026-09-24-18-30.json --yes   # tiklaydi
```

Tiklashdan oldin joriy baza avtomatik ravishda `pto-before-restore-….json` fayliga saqlanadi. Almashtirish bitta tranzaksiyada bajariladi: o'rtada xato chiqsa, baza o'zgarmay qoladi.

## API

Barcha so'rovlarda `Authorization: Bearer <token>` sarlavhasi bo'lishi kerak (`/api/health` va `/api/login` bundan mustasno). Token `POST /api/login` (`{ username, password }`) javobida keladi.

| Metod | Yo'l | Tavsif |
|---|---|---|
| GET/POST, PUT/DELETE `:id` | `/api/materials` | materiallar, narxlar, beton retseptlari |
| GET/POST, PUT/DELETE `:id` | `/api/products` | mahsulotlar: sarf normasi + kalkulyatsiya |
| GET | `/api/days?month=YYYY-MM` | kunlik hisobotlar |
| GET/PUT/DELETE | `/api/days/:date` | bitta kun: reja/fakt, sarf/kirim, jo'natish |
| GET | `/api/stock?from=&to=` | ombor: davr boshi, harakat, oxiri |
| GET/POST, PUT/DELETE `:id` | `/api/orders` | buyurtmalar; GET javobida `shipped` bor |
| GET/PUT | `/api/settings` | boshlang'ich qoldiq, elektrod %, imzolar |
| GET, PUT `password` | `/api/me` | joriy foydalanuvchi, o'z parolini almashtirish |
| GET/POST, PUT/DELETE `:id` | `/api/users` | foydalanuvchilar (admin) |
| GET | `/api/audit` | o'zgarishlar tarixi (admin) |
| GET | `/api/backup` | zaxira nusxa (admin) |

## Hisoblash qoidalari

- **Sarf normasi (Норма)**: mahsulotning to'g'ridan-to'g'ri normalari, bunga qo'shimcha beton markasi koeffitsiyentlari bo'yicha qum, sement va sheben (masalan, М400: 0,609 / 0,59 / 1,036 t/m³) va elektrod (metall og'irligining 1,5 %, 3 xonagacha yaxlitlanadi).
- **Elektrod**: «Materiallar» bo'limida bitta materialga «Bu material — elektrod» belgisi qo'yiladi. Belgi yo'q bo'lsa, nomi «Электрод» bo'lgan material olinadi.
- **Ombor**: boshlang'ich qoldiq + kirim − haqiqiy sarf; tayyor mahsulot uchun boshlang'ich qoldiq + fakt − jo'natish.
- **Kalkulyatsiya** (Excel'dagi tartib bilan): materiallar → ФОТ, ЕСП → Производственная СС → Другие затраты → Итого → Маржа → НДС. Beton narxi retseptdan hisoblanadi.

## Kunlik hisobotni Excel'da olish

«Kunlik hisobot» sahifasida **Excel yuklab olish** tugmasi zavodning kundalik shaklini («Ежедневная информация о выпуске ЖБИ… на ДД.ММ.ГГГГ») yasaydi. Unda xomashyo va mahsulot jadvallari formulalari bilan, «Отгрузка» qatorlari va imzolar bor. **Ulashish** tugmasi telefonda faylni Telegram va boshqa ilovalarga yuboradi. Ulashish imkoni bo'lmagan qurilmada fayl shunchaki yuklab olinadi.

«Oylik hisobot» sahifasidagi **Oylik Excel** tugmasi oyning har bir kunini alohida varaqda (02, 03, …) beradi. Har bir varaqdagi «В начала» qiymati oldingi varaqning «Остатка» ustuniga formula bilan bog'langan. Metall Excel faylida tonnada, ilovada esa kg da yuritiladi.
