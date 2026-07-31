// index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { fetchGainers, fetchLosers } from "./nse.js";
import { getToday, getDay, saveToday, clearToday } from "./storage.js";
import { buildRecommendations } from "./recommendations.js";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(",") || "*" }));
app.use(express.json());

// Updated to 15-minute intervals
const scanTimes = [
  "09:30",
  "09:45",
  "10:00",
  "10:15",
  "10:30",
  "10:45",
  "11:00",
];
let scanning = false;

const indiaTime = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

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
    day.scans.push({
      time,
      timestamp: new Date().toISOString(),
      gainers,
      losers,
    });
    day.scans.sort((a, b) => a.time.localeCompare(b.time));
    if (
      time === "11:00" ||
      scanTimes.every((scheduledTime) =>
        day.scans.some((scan) => scan.time === scheduledTime)
      )
    ) {
      day.recommendations = await buildRecommendations(day.scans);
    }
    await saveToday(day);
    return day;
  } finally {
    scanning = false;
  }
}

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
    res.json(
      day.recommendations?.foTop3
        ? day.recommendations
        : await buildRecommendations(day.scans)
    );
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
app.listen(port, () => console.log(`NSE Momentum API listening on ${port}`));
