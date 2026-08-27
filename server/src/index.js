import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { fetchGainers, fetchLosers } from "./nse.js";
import { getToday, saveToday, clearToday } from "./storage.js";
import { buildRecommendations } from "./recommendations.js";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(",") || "*" }));
app.use(express.json());

// 15-minute scheduled scan slots
const scanTimes = [
  // Morning Session
  "09:45",
  "10:00",
  "10:15",
  "10:30",
  "10:45",

  // Afternoon Session
  "12:45",
  "13:00",
  "13:15",
  "13:30",
  "13:45",
];
let scanning = false;

const indiaTime = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
// Helper to filter scans by session window
function getSessionScans(scans, currentTime) {
  // Morning session: up to 11:30
  // Afternoon session: 12:45 onwards
  const isMorning = currentTime <= "11:30";

  return scans.filter((s) => {
    return isMorning ? s.time <= "11:30" : s.time >= "12:00";
  });
}

async function runScan(forcedTime) {
  if (scanning) throw new Error("A scan is already in progress.");
  scanning = true;
  try {
    const time = forcedTime || indiaTime();
    const day = await getToday();
    if (day.scans.some((scan) => scan.time === time)) return day;

    const [gainers, losers] = await Promise.all([
      fetchGainers(),
      fetchLosers(),
    ]);

    // Construct scan object
    const scanEntry = {
      time,
      timestamp: new Date().toISOString(),
      gainers,
      losers,
    };

    day.scans.push(scanEntry);
    day.scans.sort((a, b) => a.time.localeCompare(b.time));

    // Get ONLY the scans belonging to the current session
    const currentSessionScans = getSessionScans(day.scans, time);

    // Calculate recommendations isolated to this session
    const slotRecommendations = await buildRecommendations(currentSessionScans);

    // Attach evaluated recommendations to this scan slot
    scanEntry.recommendations = slotRecommendations;

    // Keep top-level recommendations updated with the latest slot
    day.recommendations = slotRecommendations;

    await saveToday(day);
    return day;
  } finally {
    scanning = false;
  }
}
// Set up cron schedules
for (const time of scanTimes) {
  const [hour, minute] = time.split(":");
  cron.schedule(
    `${minute} ${hour} * * 1-5`,
    () => runScan(time).catch(console.error),
    { timezone: "Asia/Kolkata" }
  );
}

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.post("/api/scan", async (req, res, next) => {
  try {
    res.json(await runScan(req.body?.time));
  } catch (e) {
    next(e);
  }
});

app.get("/api/scans", async (_, res, next) => {
  try {
    res.json(await getToday());
  } catch (e) {
    next(e);
  }
});

app.get("/api/recommendations", async (_, res, next) => {
  try {
    const day = await getToday();
    if (day.recommendations?.foTop3) {
      return res.json(day.recommendations);
    }

    const currentTime = indiaTime();
    const activeSessionScans = getSessionScans(day.scans, currentTime);

    res.json(await buildRecommendations(activeSessionScans));
  } catch (e) {
    next(e);
  }
});

app.delete("/api/today", async (_, res, next) => {
  try {
    res.json(await clearToday());
  } catch (e) {
    next(e);
  }
});

app.use((err, _, res, __) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Unexpected server error" });
});

const port = process.env.PORT || 8080;

// Start server directly without database connection wait
app.listen(port, () => {
  console.log(`NSE Momentum API listening on port ${port}`);
});
