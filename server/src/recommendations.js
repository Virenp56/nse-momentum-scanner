// src/recommendations.js
import { fetchChartData, fetchGetQuoteData, fetchAllIndices } from "./nse.js";

/**
 * 14-Period RSI Calculation
 */
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Exponential Moving Average (EMA) Calculation
 */
function calculateEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Full 10-Factor Evaluation with Continuous Metrics
 */
async function evaluateCandidate(candidate, scansData, totalScans, indexMap) {
  const { symbol } = candidate;

  try {
    // -------------------------------------------------------------
    // FACTOR 1: Scan Appearance (15%)
    // -------------------------------------------------------------
    const appearances = scansData.filter((s) =>
      s.symbols.includes(symbol)
    ).length;
    const appearanceScore = (appearances / Math.max(totalScans, 1)) * 100;

    // -------------------------------------------------------------
    // FACTOR 2: Current & Max Streak Persistence (10%)
    // -------------------------------------------------------------
    let currentStreak = 0;
    for (let i = scansData.length - 1; i >= 0; i--) {
      if (scansData[i].symbols.includes(symbol)) currentStreak++;
      else break;
    }

    let maxStreak = 0;
    let tempStreak = 0;
    scansData.forEach((s) => {
      if (s.symbols.includes(symbol)) {
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    });

    const persistenceScore = Math.min(
      (currentStreak / 3) * 60 + (maxStreak / totalScans) * 40,
      100
    );

    // -------------------------------------------------------------
    // FACTOR 3: Smooth Rank Progression Trend (10%)
    // -------------------------------------------------------------
    const rankHistory = scansData
      .map((s) => s.symbols.indexOf(symbol))
      .filter((r) => r !== -1);

    let rankImprovementScore = 50;
    if (rankHistory.length > 1) {
      let positiveMoves = 0;
      for (let i = 1; i < rankHistory.length; i++) {
        if (rankHistory[i] < rankHistory[i - 1]) positiveMoves++;
      }
      const consistencyRatio = positiveMoves / (rankHistory.length - 1);
      const overallDelta = rankHistory[0] - rankHistory[rankHistory.length - 1];
      rankImprovementScore = Math.min(
        Math.max(50 + consistencyRatio * 30 + overallDelta * 5, 0),
        100
      );
    }

    // -------------------------------------------------------------
    // FACTOR 4: Price Velocity / Rate of Change (10%)
    // -------------------------------------------------------------
    let priceVelocityScore = 50;
    const recentScansWithSymbol = scansData.filter((s) =>
      s.symbols.includes(symbol)
    );
    if (recentScansWithSymbol.length >= 2) {
      const latestScanPos =
        recentScansWithSymbol[recentScansWithSymbol.length - 1];
      const prevScanPos =
        recentScansWithSymbol[recentScansWithSymbol.length - 2];
      const pChangeLatest = latestScanPos.pChangeMap.get(symbol) || 0;
      const pChangePrev = prevScanPos.pChangeMap.get(symbol) || 0;
      const velocityDelta = pChangeLatest - pChangePrev; // Intraday acceleration
      priceVelocityScore = Math.min(Math.max(50 + velocityDelta * 20, 0), 100);
    }

    // -------------------------------------------------------------
    // FACTOR 5: Rolling Average Volume Spike (10%)
    // -------------------------------------------------------------
    let volumeScore = 50;
    const historicalVolumes = scansData
      .map((s) => s.volumeMap.get(symbol))
      .filter((v) => v !== undefined && v > 0);

    if (historicalVolumes.length >= 2) {
      const currentVol = historicalVolumes[historicalVolumes.length - 1];
      const pastVolumes = historicalVolumes.slice(
        0,
        historicalVolumes.length - 1
      );
      const rollingAvgVol =
        pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length;

      const volumeRatio = rollingAvgVol > 0 ? currentVol / rollingAvgVol : 1;
      volumeScore = Math.min(Math.max((volumeRatio - 1) * 50 + 50, 0), 100);
    }

    // -------------------------------------------------------------
    // FETCH HEAVY LIVE DATA FOR SHORTLISTED CANDIDATES ONLY
    // -------------------------------------------------------------
    const [chartData, quotePayload] = await Promise.all([
      fetchChartData(symbol).catch(() => null),
      fetchGetQuoteData(symbol).catch(() => null),
    ]);

    const meta = quotePayload?.metaData || {};
    const tradeInfo = quotePayload?.tradeInfo || {};
    const secInfo = quotePayload?.secInfo || {};

    const lastPrice = meta?.closePrice || tradeInfo?.lastPrice || 0;
    const vwap = meta?.averagePrice || 0;
    const dayHigh = meta?.dayHigh || 0;
    const dayLow = meta?.dayLow || 0;
    const stockPChange = meta?.pChange || candidate.latestPChange || 0;
    const delPct = parseFloat(tradeInfo?.deliveryToTradedQuantity || 0);

    // -------------------------------------------------------------
    // FACTOR 6: Distance-Based Continuous VWAP Score (10%)
    // -------------------------------------------------------------
    let vwapScore = 0;
    if (lastPrice > 0 && vwap > 0) {
      const vwapDistancePct = ((lastPrice - vwap) / vwap) * 100;
      if (vwapDistancePct < 0) {
        vwapScore = 0; // Below VWAP
      } else if (vwapDistancePct >= 0 && vwapDistancePct <= 2.5) {
        vwapScore = 100; // Sweet spot: Above VWAP but not overextended
      } else {
        vwapScore = Math.max(100 - (vwapDistancePct - 2.5) * 20, 30); // Overextended penalty
      }
    }

    // -------------------------------------------------------------
    // FACTOR 7: Near Day High Proximity (5%)
    // -------------------------------------------------------------
    let nearHighScore = 50;
    if (dayHigh > dayLow && dayHigh > 0) {
      const proximity = ((lastPrice - dayLow) / (dayHigh - dayLow)) * 100;
      nearHighScore = Math.min(Math.max(proximity, 0), 100);
    }

    // -------------------------------------------------------------
    // FACTOR 8 & 9: True Relative Strength vs NIFTY & Sector (20%)
    // -------------------------------------------------------------
    const niftyPChange = indexMap.get("NIFTY 50") || 0;
    const sectorName = (secInfo?.pdSectorInd || "").trim();
    const sectorPChange = indexMap.get(sectorName) || niftyPChange;

    const rsNiftyDelta = stockPChange - niftyPChange;
    const rsSectorDelta = stockPChange - sectorPChange;

    const rsNiftyScore = Math.min(Math.max(50 + rsNiftyDelta * 15, 0), 100);
    const rsSectorScore = Math.min(Math.max(50 + rsSectorDelta * 15, 0), 100);

    // -------------------------------------------------------------
    // FACTOR 10: Technical RSI & EMA Trend (10%)
    // -------------------------------------------------------------
    let technicalScore = 50;
    if (
      chartData &&
      Array.isArray(chartData.data) &&
      chartData.data.length > 14
    ) {
      const closes = chartData.data.map((c) => c[4]);
      const currentRsi = calculateRSI(closes);

      let rsiPart = 50;
      if (currentRsi >= 55 && currentRsi <= 75) rsiPart = 100;
      else if (currentRsi > 75) rsiPart = 60;
      else rsiPart = 30;

      const ema9 = calculateEMA(closes, 9);
      const ema20 = calculateEMA(closes, 20);
      const latestClose = closes[closes.length - 1];

      let emaPart = 50;
      if (ema9 && ema20 && latestClose > ema9 && ema9 > ema20) emaPart = 100;
      else if (latestClose > ema20) emaPart = 70;
      else emaPart = 20;

      technicalScore = (rsiPart + emaPart) / 2;
    }

    // -------------------------------------------------------------
    // FINAL WEIGHTED COMPOSITE SCORE
    // -------------------------------------------------------------
    const totalScore =
      appearanceScore * 0.15 +
      persistenceScore * 0.1 +
      rankImprovementScore * 0.1 +
      priceVelocityScore * 0.1 +
      volumeScore * 0.1 +
      vwapScore * 0.1 +
      nearHighScore * 0.05 +
      rsNiftyScore * 0.12 +
      rsSectorScore * 0.08 +
      technicalScore * 0.1;

    return {
      symbol,
      score: Math.round(totalScore * 100) / 100,
      lastPrice,
      vwap,
      dayHigh,
      deliveryPct: delPct,
      sector: sectorName || "GENERAL",
      currentStreak,
      maxStreak,
    };
  } catch (err) {
    console.error(`Error calculating factors for ${symbol}:`, err.message);
    return { symbol, score: 0 };
  }
}

/**
 * Builds Top 3 F&O and Top 5 Overall Recommendations
 */
export async function buildRecommendations(scans = []) {
  if (!scans || !Array.isArray(scans) || scans.length === 0) {
    return { foTop3: [], overallTop3: [] };
  }

  try {
    const totalScans = scans.length;
    const symbolMetricsMap = new Map();

    // Fetch Live Nifty and Sector Benchmark Indices
    const indicesList = await fetchAllIndices().catch(() => []);
    const indexMap = new Map();
    if (Array.isArray(indicesList)) {
      indicesList.forEach((idx) => {
        if (idx?.key || idx?.index) {
          indexMap.set((idx.key || idx.index).trim(), idx.pChange || 0);
        }
      });
    }

    const scansData = scans.map((scan, idx) => {
      const gainerObj = scan?.gainers || {};

      // Extract array from NIFTY, FOSec, or allSec dynamically
      let gainersList = [];
      if (Array.isArray(gainerObj.data)) {
        gainersList = gainerObj.data;
      } else if (gainerObj.NIFTY?.data && Array.isArray(gainerObj.NIFTY.data)) {
        gainersList = gainerObj.NIFTY.data;
      } else if (gainerObj.FOSec?.data && Array.isArray(gainerObj.FOSec.data)) {
        gainersList = gainerObj.FOSec.data;
      } else if (
        gainerObj.allSec?.data &&
        Array.isArray(gainerObj.allSec.data)
      ) {
        gainersList = gainerObj.allSec.data;
      } else {
        // Fallback: search all object keys for a nested .data array
        for (const key of Object.keys(gainerObj)) {
          if (key !== "legends" && Array.isArray(gainerObj[key]?.data)) {
            gainersList = gainerObj[key].data;
            break;
          }
        }
      }

      const symbols = [];
      const volumeMap = new Map();
      const pChangeMap = new Map();

      gainersList.forEach((g) => {
        const sym = g.symbol || g.symbolName || g.identifier;
        if (sym) {
          symbols.push(sym);
          const vol = g.totalTradedVolume || g.volume || g.tradedQuantity || 0;
          const pChange = g.pChange || g.perChange || g.netPrice || 0;

          volumeMap.set(sym, vol);
          pChangeMap.set(sym, pChange);

          if (!symbolMetricsMap.has(sym)) {
            symbolMetricsMap.set(sym, {
              symbol: sym,
              appearances: 1,
              latestPChange: pChange,
            });
          } else {
            const existing = symbolMetricsMap.get(sym);
            existing.appearances += 1;
            existing.latestPChange = pChange;
          }
        }
      });

      console.log(
        `🔍 [DEBUG] Scan ${idx + 1} (${scan.time || "N/A"}): Extracted ${
          symbols.length
        } gainer symbols.`
      );
      return { time: scan.time, symbols, volumeMap, pChangeMap };
    });

    // -------------------------------------------------------------
    // TWEAK: SHORTLIST CANDIDATES BEFORE HEAVY API CALLS
    // Pre-sort by appearances & % change, then pick top 10 candidates
    // -------------------------------------------------------------
    const preShortlisted = Array.from(symbolMetricsMap.values())
      .sort((a, b) => {
        if (b.appearances !== a.appearances) {
          return b.appearances - a.appearances;
        }
        return b.latestPChange - a.latestPChange;
      })
      .slice(0, 10); // Max 10 candidates evaluate live to save speed & rate limits

    // Evaluate short-listed candidates in parallel
    const evaluated = await Promise.all(
      preShortlisted.map((cand) =>
        evaluateCandidate(cand, scansData, totalScans, indexMap)
      )
    );

    const ranked = evaluated
      .filter((item) => item && item.score > 0)
      .sort((a, b) => b.score - a.score);

    return {
      foTop3: ranked.slice(0, 3),
      overallTop3: ranked.slice(0, 5),
    };
  } catch (err) {
    console.error("Failed to build recommendations safely:", err.message);
    return { foTop3: [], overallTop3: [] };
  }
}
