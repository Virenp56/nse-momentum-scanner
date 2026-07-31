// storage.js
import mongoose from "mongoose";

// 1. Connect to MongoDB using Railway's environment variable
const MONGO_URI = process.env.MONGO_URL || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.warn("MongoDB URI missing! Check process.env.MONGO_URL on Railway.");
} else {
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log("Connected to MongoDB successfully"))
    .catch((err) => console.error("MongoDB connection error:", err.message));
}

// 2. Define Day Schema (Matching your current JSON structure)
const DaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // e.g., '2026-07-31'
    scans: { type: Array, default: [] },
    recommendations: { type: Object, default: {} },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Day = mongoose.model("Day", DaySchema);

// Helper for IST Date Key
const dateKey = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date()
  );

// 3. Database Storage Methods
export async function getToday() {
  const todayDate = dateKey();
  let day = await Day.findOne({ date: todayDate });

  if (!day) {
    day = await Day.create({
      date: todayDate,
      scans: [],
      recommendations: {},
      archived: false,
    });
  }

  return day;
}

export async function saveToday(data) {
  const todayDate = dateKey();
  return await Day.findOneAndUpdate(
    { date: todayDate },
    { scans: data.scans, recommendations: data.recommendations },
    { new: true, upsert: true }
  );
}

export async function clearToday() {
  const todayDate = dateKey();
  return await Day.findOneAndUpdate(
    { date: todayDate },
    { scans: [], recommendations: {} },
    { new: true }
  );
}

export async function getHistory() {
  const todayDate = dateKey();
  // Return all past trading days excluding today
  return await Day.find({ date: { $ne: todayDate } }).sort({ date: -1 });
}

export async function getDay(date) {
  return await Day.findOne({ date });
}