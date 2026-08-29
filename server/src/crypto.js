// src/crypto.js
import axios from 'axios';

const bybitClient = axios.create({
  baseURL: 'https://api.bybit.com/v5/market',
  timeout: 6000,
  headers: {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
  },
});

const EXCLUDED_STABLES = [
  'USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT',
  'EURUSDT', 'DAIUSDT', 'USDEUSDT', 'USDYUSDT'
];

/**
 * 1. Fetch Top 24h Spot Gainers and Losers
 */
export async function fetchCryptoGainersLosers() {
  const { data } = await bybitClient.get('/tickers', {
    params: { category: 'spot' },
  });

  const list = data?.result?.list || [];

  const usdtPairs = list
    .filter((item) => item.symbol.endsWith('USDT') && !EXCLUDED_STABLES.includes(item.symbol))
    .map((item) => {
      const lastPrice = parseFloat(item.lastPrice) || 0;
      const prevPrice24h = parseFloat(item.prevPrice24h) || lastPrice;
      const priceChangePercent = prevPrice24h > 0
        ? parseFloat((((lastPrice - prevPrice24h) / prevPrice24h) * 100).toFixed(2))
        : parseFloat(item.price24hPcnt || 0) * 100;

      return {
        symbol: item.symbol.replace('USDT', ''),
        pair: item.symbol,
        market: 'CRYPTO',
        lastPrice,
        priceChangePercent,
        quoteVolume: parseFloat(item.turnover24h) || parseFloat(item.volume24h) || 0, // 24h USD Turnover
        highPrice: parseFloat(item.highPrice24h) || lastPrice,
        lowPrice: parseFloat(item.lowPrice24h) || lastPrice,
        vwap: parseFloat(item.prevPrice24h) || lastPrice,
      };
    })
    .filter((coin) => coin.quoteVolume > 1000000 && coin.lastPrice > 0); // > $1M 24h volume

  const gainers = [...usdtPairs].sort((a, b) => b.priceChangePercent - a.priceChangePercent).slice(0, 10);
  const losers = [...usdtPairs].sort((a, b) => a.priceChangePercent - b.priceChangePercent).slice(0, 10);

  return { gainers, losers };
}

/**
 * 2. Fetch 15-minute Candlestick Klines for RSI / EMA
 */
export async function fetchCryptoKlines(symbol, interval = '15', limit = 30) {
  const pair = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
  const { data } = await bybitClient.get('/kline', {
    params: {
      category: 'spot',
      symbol: pair,
      interval: interval.replace('m', ''), // Bybit uses '15' instead of '15m'
      limit,
    },
  });

  const list = data?.result?.list || [];
  // Bybit returns newest candles first [startTime, open, high, low, close, volume, turnover]
  // Reverse to chronological order (oldest to newest)
  return list.reverse().map((k) => parseFloat(k[4])); // Returns array of close prices
}

/**
 * 3. Fetch BTC 24h Benchmark Trend
 */
export async function fetchBtcChange() {
  try {
    const { data } = await bybitClient.get('/tickers', {
      params: { category: 'spot', symbol: 'BTCUSDT' },
    });
    const btc = data?.result?.list?.[0];
    if (!btc) return 0;
    const lastPrice = parseFloat(btc.lastPrice) || 0;
    const prevPrice = parseFloat(btc.prevPrice24h) || lastPrice;
    return prevPrice > 0 ? parseFloat((((lastPrice - prevPrice) / prevPrice) * 100).toFixed(2)) : 0;
  } catch {
    return 0;
  }
}