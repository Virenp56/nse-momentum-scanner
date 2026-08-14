// src/nse.js
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

let browserInstance = null;
let sharedContext = null;
let sharedPage = null;

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
    ],
  });

  return browserInstance;
}

export async function getSharedPage() {
  if (sharedPage && !sharedPage.isClosed()) return sharedPage;

  const b = await getBrowser();
  sharedContext = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "application/json, text/plain, */*",
    },
  });

  sharedPage = await sharedContext.newPage();

  // Warmup NSE cookies on the actual top-gainers-loosers section
  try {
    await sharedPage.goto(
      "https://www.nseindia.com/market-data/top-gainers-loosers",
      {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }
    );
    await sharedPage.waitForTimeout(2500);
  } catch (e) {
    console.warn("NSE Warmup warning:", e.message);
  }

  return sharedPage;
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

// Helper to fetch live scan arrays with clear error debugging
async function fetchNseApiData(apiUrl) {
  try {
    const page = await getSharedPage();
    return await page.evaluate(async (url) => {
      try {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
        });
        if (!res.ok) {
          console.error(`NSE fetch failed with status: ${res.status}`);
          return null;
        }
        return await res.json();
      } catch (err) {
        console.error(`Browser fetch error: ${err.message}`);
        return null;
      }
    }, apiUrl);
  } catch (err) {
    console.error("fetchNseApiData error:", err.message);
    sharedPage = null; // Reset page on network failure
    return null;
  }
}

export async function fetchGainers() {
  try {
    const data = await fetchNseApiData(
      "https://www.nseindia.com/api/live-analysis-variations?index=gainers"
    );
    return data || {};
  } catch (e) {
    console.error("Failed to fetch gainers:", e.message);
    return {};
  }
}

export async function fetchLosers() {
  try {
    // Note: NSE supports both 'loosers' and 'losers', try primary
    let data = await fetchNseApiData(
      "https://www.nseindia.com/api/live-analysis-variations?index=loosers"
    );
    if (!data || Object.keys(data).length === 0) {
      data = await fetchNseApiData(
        "https://www.nseindia.com/api/live-analysis-variations?index=losers"
      );
    }
    return data || {};
  } catch (e) {
    console.error("Failed to fetch losers:", e.message);
    return {};
  }
}

export async function fetchAllIndices() {
  try {
    const data = await fetchNseApiData(
      "https://www.nseindia.com/api/allIndices"
    );
    return data?.data || [];
  } catch (err) {
    console.warn("Error fetching market indices:", err.message);
    return [];
  }
}

export async function fetchGetQuoteData(symbol) {
  try {
    const url = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol=${encodeURIComponent(
      symbol
    )}`;
    const data = await fetchNseApiData(url);
    return data?.equityResponse?.[0] || null;
  } catch (err) {
    console.warn(`Quote fetch error for ${symbol}:`, err.message);
    return null;
  }
}

export async function fetchChartData(symbol) {
  try {
    const toDate = Math.floor(Date.now() / 1000);
    const fromDate = getTodayMarketOpenTimestamp();
    const encodedSym = encodeURIComponent(symbol + "-EQ");
    const url = `https://charting.nseindia.com/v1/charts/symbolHistoricalData?token=2031&fromDate=${fromDate}&toDate=${toDate}&symbol=${encodedSym}&symbolType=Equity&chartType=I&timeInterval=1`;

    const data = await fetchNseApiData(url);
    return data;
  } catch (err) {
    console.error(`Error fetching chart data for ${symbol}:`, err.message);
    return null;
  }
}
