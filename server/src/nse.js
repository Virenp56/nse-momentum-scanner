import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

// Attach stealth plugin to trick anti-bot systems
chromium.use(stealthPlugin());

let browser;
let context;
let page;

async function getPage() {
  if (page && !page.isClosed()) return page;

  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
    },
  });

  page = await context.newPage();

  // Navigate to homepage to collect cookies/session
  // Use 'domcontentloaded' instead of 'networkidle'
  await page.goto("https://www.nseindia.com", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Brief pause to allow initial cookies to set
  await page.waitForTimeout(2000);

  return page;
}

async function request(index) {
  const p = await getPage();

  // Fetch via page context so browser cookies/session are included
  const response = await p.request.get(
    `https://www.nseindia.com/api/live-analysis-variations?index=${index}`,
    {
      headers: {
        accept: "application/json, text/plain, */*",
        referer: "https://www.nseindia.com/market-data/top-gainers-losers",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
    }
  );

  if (!response.ok()) {
    throw new Error(
      `NSE returned status: ${response.status()} ${response.statusText()}`
    );
  }

  return await response.json();
}

export const fetchGainers = () => request("gainers");
export const fetchLosers = () => request("losers");
