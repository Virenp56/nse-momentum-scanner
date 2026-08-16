// src/nse.js
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

let browserInstance = null;
let sharedContext = null;
let isWarmedUp = false;

export async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  browserInstance = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-http2",
      "--window-size=1920,1080",
    ],
  });

  return browserInstance;
}

export async function getSharedContext() {
  if (sharedContext) return sharedContext;

  const browser = await getBrowser();
  sharedContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "Asia/Kolkata",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "*/*",
      "Sec-Ch-Ua":
        '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    },
  });

  return sharedContext;
}

async function warmupSession() {
  if (isWarmedUp) return;
  const context = await getSharedContext();
  const page = await context.newPage();

  try {
    const res = await page.goto("https://www.nseindia.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!res || !res.ok()) {
      throw new Error(
        `Warmup page returned non-200 status: ${
          res ? res.status() : "No response"
        }`
      );
    }
    await page.waitForTimeout(2000);
    isWarmedUp = true;
  } catch (err) {
    isWarmedUp = false;
    throw new Error(`NSE Session Warmup Failed: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

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

// Strictly fetch JSON data via browser session context; throws error on failure
async function fetchNseApiData(apiUrl) {
  await warmupSession();
  const context = await getSharedContext();

  const response = await context.request.get(apiUrl, {
    headers: {
      Referer: "https://www.nseindia.com/market-data/top-gainers-loosers",
      "X-Requested-With": "XMLHttpRequest",
    },
    timeout: 20000,
  });

  if (!response.ok()) {
    throw new Error(
      `NSE API request failed [Status ${response.status()}]: ${apiUrl}`
    );
  }

  const data = await response.json();
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    throw new Error(`NSE API returned empty payload for: ${apiUrl}`);
  }

  return data;
}

export async function fetchGainers() {
  const data = await fetchNseApiData(
    "https://www.nseindia.com/api/live-analysis-variations?index=gainers"
  );
  if (!data.NIFTY && !data.FOSec && !data.data) {
    throw new Error("Invalid gainers payload structure received from NSE API.");
  }
  return data;
}

export async function fetchLosers() {
  try {
    return await fetchNseApiData(
      "https://www.nseindia.com/api/live-analysis-variations?index=loosers"
    );
  } catch {
    return await fetchNseApiData(
      "https://www.nseindia.com/api/live-analysis-variations?index=losers"
    );
  }
}

export async function fetchAllIndices() {
  const data = await fetchNseApiData("https://www.nseindia.com/api/allIndices");
  if (!Array.isArray(data?.data)) {
    throw new Error("Invalid market indices payload received from NSE API.");
  }
  return data.data;
}

export async function fetchGetQuoteData(symbol) {
  const url = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol=${encodeURIComponent(
    symbol
  )}`;
  const data = await fetchNseApiData(url);
  const quote = data?.equityResponse?.[0];
  if (!quote) {
    throw new Error(`Quote data not available for symbol: ${symbol}`);
  }
  return quote;
}

export async function fetchChartData(symbol) {
  const toDate = Math.floor(Date.now() / 1000);
  const fromDate = getTodayMarketOpenTimestamp();
  const encodedSym = encodeURIComponent(symbol + "-EQ");
  const url = `https://charting.nseindia.com/v1/charts/symbolHistoricalData?token=2031&fromDate=${fromDate}&toDate=${toDate}&symbol=${encodedSym}&symbolType=Equity&chartType=I&timeInterval=1`;

  return await fetchNseApiData(url);
}
