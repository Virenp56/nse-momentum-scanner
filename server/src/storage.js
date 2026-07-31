// storage.js
import mongoose from "mongoose";

// Railway automatically exposes MONGO_URL or MONGO_PRIVATE_URL
const MONGO_URI =
  process.env.MONGO_URL ||
  process.env.DATABASE_URL ||
  process.env.MONGO_PRIVATE_URL;

let isConnected = false;

export async function connectDB() {
  if (isConnected) return;

  if (!MONGO_URI) {
    throw new Error(
      "MongoDB Connection Error: Missing MONGO_URL environment variable on Railway!"
    );
  }

  try {
    // Disable buffering so queries fail immediately with clear errors if disconnected
    mongoose.set("bufferCommands", false);

    const db = await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // Fail fast after 5s instead of hanging for 10s
    });

    isConnected = db.connections[0].readyState === 1;
    console.log("Connected to MongoDB successfully");
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err.message);
    throw err;
  }
}

// Day Schema Definition
const DaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true },
    scans: { type: Array, default: [] },
    recommendations: { type: Object, default: {} },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Day = mongoose.models.Day || mongoose.model("Day", DaySchema);

const dateKey = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date()
  );

export async function getToday() {
  await connectDB();
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
  await connectDB();
  const todayDate = dateKey();
  return await Day.findOneAndUpdate(
    { date: todayDate },
    { scans: data.scans, recommendations: data.recommendations },
    { new: true, upsert: true }
  );
}

export async function clearToday() {
  await connectDB();
  const todayDate = dateKey();
  return await Day.findOneAndUpdate(
    { date: todayDate },
    { scans: [], recommendations: {} },
    { new: true }
  );
}
