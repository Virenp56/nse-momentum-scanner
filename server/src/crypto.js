// src/crypto.js
import axios from "axios";

const BINANCE_BASE = "https://api.binance.com/api/v3";

export async function fetchCryptoGainersLosers() {
  const { data } = await axios.get(`${BINANCE_BASE}/ticker/24hr`);
  const excluded = [
    "USDCUSDT",
    "FDUSDUSDT",
    "TUSDUSDT",
    "BUSDUSDT",
    "EURUSDT",
    "DAIUSDT",
  ];

  const usdtPairs = data
    .filter(
      (item) => item.symbol.endsWith("USDT") && !excluded.includes(item.symbol)
    )
    .map((item) => ({
      symbol: item.symbol.replace("USDT", ""),
      market: "CRYPTO",
      lastPrice: parseFloat(item.lastPrice),
      priceChangePercent: parseFloat(item.priceChangePercent),
      quoteVolume: parseFloat(item.quoteVolume),
      vwap: parseFloat(item.weightedAvgPrice),
    }))
    .filter((coin) => coin.quoteVolume > 1000000); // Filter > $1M 24h volume

  const gainers = [...usdtPairs]
    .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
    .slice(0, 10);
  const losers = [...usdtPairs]
    .sort((a, b) => a.priceChangePercent - b.priceChangePercent)
    .slice(0, 10);

  return { gainers, losers };
}

export async function fetchCryptoKlines(symbol, interval = "15m", limit = 30) {
  const pair = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  const { data } = await axios.get(`${BINANCE_BASE}/klines`, {
    params: { symbol: pair, interval, limit },
  });
  return data.map((c) => parseFloat(c[4])); // Returns array of closing prices
}

export async function fetchBtcChange() {
  try {
    const { data } = await axios.get(
      `${BINANCE_BASE}/ticker/24hr?symbol=BTCUSDT`
    );
    return parseFloat(data.priceChangePercent) || 0;
  } catch {
    return 0;
  }
}
