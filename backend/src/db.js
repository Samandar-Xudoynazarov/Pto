import mongoose from "mongoose";

// Vercel serverless funksiyalarida ulanishni qayta ishlatish uchun kesh
const cached = globalThis.__ptoMongo || (globalThis.__ptoMongo = { conn: null, promise: null });

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI muhit o'zgaruvchisi o'rnatilmagan");
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
      dbName: process.env.MONGODB_DB || undefined,
    });
  }
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}
