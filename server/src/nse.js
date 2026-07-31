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
export async function fetchChartData(symbol) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto(
      "https://www.nseindia.com/get-quotes/equity?symbol=" +
        encodeURIComponent(symbol),
      {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      }
    );
    await page.waitForTimeout(1500);

    const toDate = Math.floor(Date.now() / 1000);
    const fromDate = toDate - 5 * 3600; // Past 5 hours

 const chartData = await page.evaluate(async ({ sym, from, to }) => {
  const encodedSym = encodeURIComponent(sym + "-EQ");
  const url = `https://charting.nseindia.com/v1/charts/symbolHistoricalData?token=2031&fromDate=${from}&toDate=${to}&symbol=${encodedSym}&symbolType=Equity&chartType=I&timeInterval=1`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}`,
    },
    credentials: "include", // Ensures cookies established by Playwright are sent
  });

  if (!res.ok) {
    console.warn(`NSE HTTP ${res.status} for ${sym}`);
    return null;
  }

  return await res.json();
}, { sym: symbol, from: fromDate, to: toDate });

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
