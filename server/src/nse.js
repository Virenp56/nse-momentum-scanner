// nse.js
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(stealthPlugin());

let browser;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;

  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
    ],
  });

  return browser;
}

async function request(index) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const page = await context.newPage();

  try {
    await page.goto("https://www.nseindia.com/market-data/top-gainers-losers", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(2500);

    const data = await page.evaluate(async (targetIndex) => {
      const res = await fetch(
        `https://www.nseindia.com/api/live-analysis-variations?index=${targetIndex}`,
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          },
        }
      );

      if (!res.ok) {
        throw new Error(`NSE HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    }, index);

    return data;
  } finally {
    await context.close().catch(() => {});
  }
}

// Fetch 1-minute chart candles for technical indicator calculation
// nse.js

function getTodayMarketOpenTimestamp() {
  const now = new Date();
  const istDateStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [month, day, year] = istDateStr.split("/");
  const marketOpenIST = new Date(`${year}-${month}-${day}T09:15:00+05:30`);
  return Math.floor(marketOpenIST.getTime() / 1000);
}

export async function fetchChartData(symbol) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const page = await context.newPage();

  try {
    // 1. Warm up session and acquire cookies from main NSE site
    await page.goto(
      `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(
        symbol
      )}`,
      { waitUntil: "domcontentloaded", timeout: 20000 }
    );
    await page.waitForTimeout(1000);

    const toDate = Math.floor(Date.now() / 1000);
    const fromDate = getTodayMarketOpenTimestamp();
    const encodedSym = encodeURIComponent(symbol + "-EQ");
    const chartUrl = `https://charting.nseindia.com/v1/charts/symbolHistoricalData?token=2031&fromDate=${fromDate}&toDate=${toDate}&symbol=${encodedSym}&symbolType=Equity&chartType=I&timeInterval=1`;

    // 2. Fetch using page.goto / response evaluation to bypass 403 blocks
    const response = await page.goto(chartUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
      referer: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(
        symbol
      )}`,
    });

    if (!response || !response.ok()) {
      console.warn(`NSE HTTP ${response?.status()} for ${symbol}`);
      return null;
    }

    const chartData = await response.json();
    return chartData;
  } catch (err) {
    console.error(`Error fetching chart data for ${symbol}:`, err.message);
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

export const fetchGainers = () => request("gainers");
export const fetchLosers = () => request("losers");
