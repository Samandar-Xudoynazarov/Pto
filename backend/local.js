// Kompyuterda ishga tushirish uchun: npm run dev
import app from "./src/app.js";

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API ishga tushdi: http://localhost:${port}/api/health`));
