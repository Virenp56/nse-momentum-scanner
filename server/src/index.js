// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { fetchGainers, fetchLosers } from "./nse.js";
import { fetchCryptoGainersLosers } from "./crypto.js";
import { getToday, saveToday, clearToday } from "./storage.js";
import {
  buildRecommendations,
  buildCryptoRecommendations,
} from "./recommendations.js";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(",") || "*" }));
app.use(express.json());

// Combined NSE (Morning/Afternoon) & Crypto (Evening) Scan Times
const scanTimes = [
  // NSE Morning
  "09:45",
  "10:00",
  "10:15",
  "10:30",
  "10:45",
  // NSE Afternoon
  "12:45",
  "13:00",
  "13:15",
  "13:30",
  "13:45",
  // Crypto Evening (8:00 PM - 10:00 PM IST)
  "20:00",
  "20:15",
  "20:30",
  "20:45",
  "21:00",
  "21:15",
  "21:30",
  "21:45",
  "22:00",
  "22:15",
  "22:30",
  "22:45",
  "23:00",
  "23:15",
  "23:30",
  "23:45",
];

let scanning = false;

const indiaTime = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

function isCryptoSession(time) {
  return time >= "18:00"; // Scans after 6:00 PM are treated as Crypto
}

async function runScan(forcedTime) {
  if (scanning) throw new Error("A scan is already in progress.");
  scanning = true;
  try {
    const time = forcedTime || indiaTime();
    const day = await getToday();
    if (day.scans.some((scan) => scan.time === time)) return day;

    let gainers, losers, marketType;

    if (isCryptoSession(time)) {
      marketType = "CRYPTO";
      const cryptoData = await fetchCryptoGainersLosers();
      gainers = cryptoData.gainers;
      losers = cryptoData.losers;
    } else {
      marketType = "NSE";
      [gainers, losers] = await Promise.all([fetchGainers(), fetchLosers()]);
    }

    const scanEntry = {
      time,
      market: marketType,
      timestamp: new Date().toISOString(),
      gainers,
      losers,
    };

    day.scans.push(scanEntry);
    day.scans.sort((a, b) => a.time.localeCompare(b.time));

    // Calculate recommendations
    if (marketType === "CRYPTO") {
      const cryptoScans = day.scans.filter((s) => s.market === "CRYPTO");
      const recs = await buildCryptoRecommendations(cryptoScans);
      scanEntry.recommendations = recs;
      day.recommendations = recs;
    } else {
      const nseScans = day.scans.filter((s) => s.market !== "CRYPTO");
      const recs = await buildRecommendations(nseScans);
      scanEntry.recommendations = recs;
      day.recommendations = recs;
    }

    await saveToday(day);
    return day;
  } finally {
    scanning = false;
  }
}

// Set up cron schedules (Monday to Sunday)
for (const time of scanTimes) {
  const [hour, minute] = time.split(":");
  cron.schedule(
    `${minute} ${hour} * * *`,
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
    res.json(day.recommendations || {});
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

// Add this route in src/index.js
app.get("/api/test-crypto", async (_, res, next) => {
  try {
    // Pass an evening time string (e.g. 20:00) to trigger crypto branch
    const result = await runScan("20:00");
    res.json({ message: "Crypto scan successful!", data: result });
  } catch (err) {
    next(err);
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Scanner API listening on port ${port}`));
