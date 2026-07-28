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
    // 1. Visit NSE page to establish session cookies
    await page.goto("https://www.nseindia.com/market-data/top-gainers-losers", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Short pause for cookies to set
    await page.waitForTimeout(2500);

    // 2. Perform fetch inside the browser DOM (bypasses bot filters)
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
    // Clean up browser context after request
    await context.close().catch(() => {});
  }
}

export const fetchGainers = () => request("gainers");
export const fetchLosers = () => request("losers");
