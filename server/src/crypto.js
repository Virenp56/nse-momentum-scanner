// src/crypto.js
import axios from "axios";

const bybitClient = axios.create({
  baseURL: "https://api.bybit.com/v5/market",
  timeout: 6000,
  headers: {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36",
  },
});

const EXCLUDED_STABLES = [
  "USDCUSDT",
  "FDUSDUSDT",
  "TUSDUSDT",
  "BUSDUSDT",
  "EURUSDT",
  "DAIUSDT",
  "USDEUSDT",
  "USDYUSDT",
];

/**
 * 1. Fetch Top 24h Spot Gainers, High-Volume Movers, and Breakout Candidates
 */
export async function fetchCryptoGainersLosers() {
  try {
    const { data } = await bybitClient.get("/tickers", {
      params: { category: "spot" },
    });

    const list = data?.result?.list || [];

    const usdtPairs = list
      .filter(
        (item) =>
          item.symbol.endsWith("USDT") &&
          !EXCLUDED_STABLES.includes(item.symbol)
      )
      .map((item) => {
        const lastPrice = parseFloat(item.lastPrice) || 0;
        const prevPrice24h = parseFloat(item.prevPrice24h) || lastPrice;
        const priceChangePercent =
          prevPrice24h > 0
            ? parseFloat(
                (((lastPrice - prevPrice24h) / prevPrice24h) * 100).toFixed(2)
              )
            : parseFloat(item.price24hPcnt || 0) * 100;

        return {
          symbol: item.symbol.replace("USDT", ""),
          pair: item.symbol,
          market: "CRYPTO",
          lastPrice,
          priceChangePercent,
          quoteVolume:
            parseFloat(item.turnover24h) || parseFloat(item.volume24h) || 0,
          highPrice: parseFloat(item.highPrice24h) || lastPrice,
          lowPrice: parseFloat(item.lowPrice24h) || lastPrice,
          prevPrice24h,
        };
      })
      .filter((coin) => coin.quoteVolume > 1000000 && coin.lastPrice > 0);

    const gainers = [...usdtPairs]
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
      .slice(0, 15);
    const volumeMovers = [...usdtPairs]
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 10);

    // Combine unique candidate discovery pools
    const combinedMap = new Map();
    [...gainers, ...volumeMovers].forEach((c) => combinedMap.set(c.symbol, c));

    return { gainers: Array.from(combinedMap.values()), losers: [] };
  } catch (err) {
    console.error("Error fetching Bybit crypto gainers:", err.message);
    return { gainers: [], losers: [] };
  }
}

/**
 * 2. Fetch Multi-Timeframe OHLCV Candlestick Data
 * Returns complete OHLCV objects: { time, open, high, low, close, volume, turnover }
 */
export async function fetchCryptoKlines(symbol, interval = "15", limit = 50) {
  const pair = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  try {
    const { data } = await bybitClient.get("/kline", {
      params: {
        category: "spot",
        symbol: pair,
        interval: interval.replace("m", ""),
        limit,
      },
    });

    const list = data?.result?.list || [];
    // Bybit returns newest candles first [startTime, open, high, low, close, volume, turnover]
    // Reverse to chronological order (oldest to newest)
    return list.reverse().map((k) => ({
      time: parseInt(k[0], 10),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      turnover: parseFloat(k[6] || 0),
    }));
  } catch (err) {
    console.error(
      `Error fetching klines for ${symbol} (${interval}):`,
      err.message
    );
    return [];
  }
}

/**
 * 3. Fetch Comprehensive BTC Benchmark & Market Regime Data
 */
export async function fetchBtcContext() {
  try {
    const [tickerRes, klines15m] = await Promise.all([
      bybitClient.get("/tickers", {
        params: { category: "spot", symbol: "BTCUSDT" },
      }),
      fetchCryptoKlines("BTCUSDT", "15", 30),
    ]);

    const btcTicker = tickerRes.data?.result?.list?.[0];
    const lastPrice = parseFloat(btcTicker?.lastPrice) || 0;
    const prevPrice = parseFloat(btcTicker?.prevPrice24h) || lastPrice;
    const change24h =
      prevPrice > 0
        ? parseFloat((((lastPrice - prevPrice) / prevPrice) * 100).toFixed(2))
        : 0;

    let change15m = 0;
    let change1h = 0;
    if (klines15m.length >= 4) {
      const cNow = klines15m[klines15m.length - 1].close;
      const c15Prev = klines15m[klines15m.length - 2].close;
      const c1hPrev = klines15m[klines15m.length - 4].close;
      change15m = parseFloat((((cNow - c15Prev) / c15Prev) * 100).toFixed(2));
      change1h = parseFloat((((cNow - c1hPrev) / c1hPrev) * 100).toFixed(2));
    }

    return {
      change15m,
      change1h,
      change24h,
      trend: change24h >= 0 ? "BULLISH" : "NEUTRAL",
    };
  } catch (err) {
    console.error("Error fetching BTC context:", err.message);
    return { change15m: 0, change1h: 0, change24h: 0, trend: "NEUTRAL" };
  }
}

/**
 * 4. Fetch Optional Derivatives Data (Funding Rate & Open Interest)
 */
export async function fetchDerivativesData(symbol) {
  const pair = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  try {
    const [fundingRes, oiRes] = await Promise.all([
      bybitClient
        .get("/funding/history", {
          params: { category: "linear", symbol: pair, limit: 1 },
        })
        .catch(() => null),
      bybitClient
        .get("/open-interest", {
          params: {
            category: "linear",
            symbol: pair,
            intervalTime: "5min",
            limit: 2,
          },
        })
        .catch(() => null),
    ]);

    const fundingRate = parseFloat(
      fundingRes?.data?.result?.list?.[0]?.fundingRate || 0
    );
    const oiList = oiRes?.data?.result?.list || [];
    let oiDelta = 0;
    if (oiList.length >= 2) {
      const curOI = parseFloat(oiList[0].openInterest || 0);
      const prevOI = parseFloat(oiList[1].openInterest || 0);
      if (prevOI > 0) oiDelta = ((curOI - prevOI) / prevOI) * 100;
    }

    return { fundingRate, oiDelta, available: true };
  } catch {
    return { fundingRate: 0, oiDelta: 0, available: false };
  }
}
