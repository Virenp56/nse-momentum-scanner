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
    },
  });

  sharedPage = await sharedContext.newPage();

  // Warmup NSE cookies once
  try {
    await sharedPage.goto("https://www.nseindia.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sharedPage.waitForTimeout(1500);
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

// 1. Fetch Detailed Stock Quote Payload
export async function fetchGetQuoteData(symbol) {
  try {
    const page = await getSharedPage();
    return await page.evaluate(async (sym) => {
      try {
        const url = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol=${encodeURIComponent(
          sym
        )}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json, text/plain, */*" },
          credentials: "include",
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.equityResponse?.[0] || null;
      } catch {
        return null;
      }
    }, symbol);
  } catch (err) {
    console.warn(`Quote fetch error for ${symbol}:`, err.message);
    sharedPage = null;
    return null;
  }
}

// 2. Fetch Market Indices Performance (Nifty 50 + Sectoral Indices)
export async function fetchAllIndices() {
  try {
    const page = await getSharedPage();
    return await page.evaluate(async () => {
      try {
        const res = await fetch("https://www.nseindia.com/api/allIndices", {
          headers: { Accept: "application/json, text/plain, */*" },
          credentials: "include",
        });
        if (!res.ok) return [];
        const json = await res.json();
        return json?.data || [];
      } catch {
        return [];
      }
    });
  } catch (err) {
    console.warn("Error fetching market indices:", err.message);
    sharedPage = null;
    return [];
  }
}

// 3. Fetch Historical Minute Candle Chart Data
export async function fetchChartData(symbol) {
  try {
    const page = await getSharedPage();
    const toDate = Math.floor(Date.now() / 1000);
    const fromDate = getTodayMarketOpenTimestamp();

    return await page.evaluate(
      async ({ sym, from, to }) => {
        try {
          const encodedSym = encodeURIComponent(sym + "-EQ");
          const url = `https://charting.nseindia.com/v1/charts/symbolHistoricalData?token=2031&fromDate=${from}&toDate=${to}&symbol=${encodedSym}&symbolType=Equity&chartType=I&timeInterval=1`;

          const res = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json, text/plain, */*",
              Referer: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(
                sym
              )}`,
            },
            credentials: "include",
          });

          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      },
      { sym: symbol, from: fromDate, to: toDate }
    );
  } catch (err) {
    console.error(`Error fetching chart data for ${symbol}:`, err.message);
    sharedPage = null;
    return null;
  }
}

// Helper to fetch live scan arrays
async function fetchNseApiData(apiUrl) {
  const page = await getSharedPage();
  return await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json, text/plain, */*" },
        credentials: "include",
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, apiUrl);
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
    const data = await fetchNseApiData(
      "https://www.nseindia.com/api/live-analysis-variations?index=losers"
    );
    return data || {};
  } catch (e) {
    console.error("Failed to fetch losers:", e.message);
    return {};
  }
}
