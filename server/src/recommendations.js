// src/recommendations.js
import { fetchChartData, fetchGetQuoteData, fetchAllIndices } from "./nse.js";

/**
 * 14-Period RSI Calculation
 */
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period, avgLoss = losses / period;

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
  return 100 - 100 / (1 + (avgGain / avgLoss));
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
    const appearances = scansData.filter((s) => s.symbols.includes(symbol)).length;
    const appearanceScore = (appearances / Math.max(totalScans, 1)) * 100;

    // -------------------------------------------------------------
    // FACTOR 2: Current & Max Streak Persistence (10%)
    // -------------------------------------------------------------
    let currentStreak = 0;
    for (let i = scansData.length - 1; i >= 0; i--) {
      if (scansData[i].symbols.includes(symbol)) currentStreak++;
      else break;
    }

    let maxStreak = 0, tempStreak = 0;
    scansData.forEach((s) => {
      if (s.symbols.includes(symbol)) {
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    });

    const persistenceScore = Math.min((currentStreak / 3) * 60 + (maxStreak / totalScans) * 40, 100);

    // -------------------------------------------------------------
    // FACTOR 3: Smooth Rank Progression Trend (10%)
    // -------------------------------------------------------------
    const rankHistory = scansData.map((s) => s.symbols.indexOf(symbol) + 1).filter((r) => r !== 0);
    let rankImprovementScore = 50;
    if (rankHistory.length > 1) {
      let positiveMoves = 0;
      for (let i = 1; i < rankHistory.length; i++) {
        if (rankHistory[i] < rankHistory[i - 1]) positiveMoves++;
      }
      const consistencyRatio = positiveMoves / (rankHistory.length - 1);
      const overallDelta = rankHistory[0] - rankHistory[rankHistory.length - 1];
      rankImprovementScore = Math.min(Math.max(50 + consistencyRatio * 30 + overallDelta * 5, 0), 100);
    }

    // -------------------------------------------------------------
    // FACTOR 4: Price Velocity / Rate of Change (10%)
    // -------------------------------------------------------------
    let priceVelocityScore = 50;
    const changeTrend = [];
    const recentScansWithSymbol = scansData.filter((s) => s.symbols.includes(symbol));

    recentScansWithSymbol.forEach((s) => {
      const p = s.pChangeMap.get(symbol);
      if (p !== undefined) changeTrend.push(p);
    });

    if (recentScansWithSymbol.length >= 2) {
      const latestScanPos = recentScansWithSymbol[recentScansWithSymbol.length - 1];
      const prevScanPos = recentScansWithSymbol[recentScansWithSymbol.length - 2];
      const pChangeLatest = latestScanPos.pChangeMap.get(symbol) || 0;
      const pChangePrev = prevScanPos.pChangeMap.get(symbol) || 0;
      priceVelocityScore = Math.min(Math.max(50 + (pChangeLatest - pChangePrev) * 20, 0), 100);
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
      const pastVolumes = historicalVolumes.slice(0, historicalVolumes.length - 1);
      const rollingAvgVol = pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length;
      const volumeRatio = rollingAvgVol > 0 ? currentVol / rollingAvgVol : 1;
      volumeScore = Math.min(Math.max((volumeRatio - 1) * 50 + 50, 0), 100);
    }

    // -------------------------------------------------------------
    // FETCH LIVE TECHNICAL & QUOTE DATA
    // -------------------------------------------------------------
    const [chartData, quotePayload] = await Promise.all([
      fetchChartData(symbol).catch(() => null),
      fetchGetQuoteData(symbol).catch(() => null),
    ]);

    // Fallback Mock Values for Off-Market Debugging
    const meta = quotePayload?.metaData || {
      closePrice: candidate.lastPrice || 1000,
      averagePrice: (candidate.lastPrice || 1000) * 0.99,
      dayHigh: (candidate.lastPrice || 1000) * 1.02,
      dayLow: (candidate.lastPrice || 1000) * 0.98,
      pChange: candidate.latestPChange || 2.5,
    };

    const tradeInfo = quotePayload?.tradeInfo || {
      deliveryToTradedQuantity: 40.0,
      lastPrice: candidate.lastPrice || 1000,
    };

    const secInfo = quotePayload?.secInfo || { pdSectorInd: "NIFTY IT" };

    const lastPrice = meta?.closePrice || tradeInfo?.lastPrice || candidate.lastPrice || 0;
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
      if (vwapDistancePct < 0) vwapScore = 0;
      else if (vwapDistancePct <= 2.5) vwapScore = 100;
      else vwapScore = Math.max(100 - (vwapDistancePct - 2.5) * 20, 30);
    }

    // -------------------------------------------------------------
    // FACTOR 7: Near Day High Proximity (5%)
    // -------------------------------------------------------------
    let nearHighScore = 50;
    if (dayHigh > dayLow && dayHigh > 0) {
      nearHighScore = Math.min(Math.max(((lastPrice - dayLow) / (dayHigh - dayLow)) * 100, 0), 100);
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
    let rsiValue = 50;
    let isEmaBullish = false;

    if (chartData && Array.isArray(chartData.data) && chartData.data.length > 14) {
      const closes = chartData.data.map((c) => c[4]);
      rsiValue = Math.round(calculateRSI(closes));

      let rsiPart = rsiValue >= 55 && rsiValue <= 75 ? 100 : rsiValue > 75 ? 60 : 30;

      const ema9 = calculateEMA(closes, 9);
      const ema20 = calculateEMA(closes, 20);
      const latestClose = closes[closes.length - 1];

      let emaPart = 50;
      if (ema9 && ema20 && latestClose > ema9 && ema9 > ema20) {
        emaPart = 100;
        isEmaBullish = true;
      } else if (latestClose > ema20) {
        emaPart = 70;
      } else {
        emaPart = 20;
      }

      technicalScore = (rsiPart + emaPart) / 2;
    }

    // -------------------------------------------------------------
    // FINAL WEIGHTED COMPOSITE SCORE
    // -------------------------------------------------------------
    const totalScore =
      appearanceScore * 0.15 +
      persistenceScore * 0.10 +
      rankImprovementScore * 0.10 +
      priceVelocityScore * 0.10 +
      volumeScore * 0.10 +
      vwapScore * 0.10 +
      nearHighScore * 0.05 +
      rsNiftyScore * 0.12 +
      rsSectorScore * 0.08 +
      technicalScore * 0.10;

    const confidenceScore = `${Math.round(totalScore)}%`;
    const signalText = totalScore >= 70 ? "STRONG BUY" : "BUY";

    const reasons = [];
    reasons.push(`Appeared in ${appearances}/${totalScans} scans (${currentStreak} streak)`);
    if (lastPrice > vwap && vwap > 0) reasons.push(`Trading above VWAP (₹${vwap.toFixed(1)})`);
    if (isEmaBullish) reasons.push(`Bullish EMA alignment (Price > EMA9 > EMA20)`);
    if (rsiValue >= 55 && rsiValue <= 75) reasons.push(`RSI momentum in optimal zone (${rsiValue})`);
    if (rsSectorDelta > 0) reasons.push(`Outperforming ${sectorName || "Sector"} by +${rsSectorDelta.toFixed(1)}%`);
    if (delPct > 35) reasons.push(`High institutional delivery volume (${delPct}%)`);

    // Payload Contract for Frontend Component
    return {
      symbol,
      signal: signalText,
      side: "buy",
      confidence: confidenceScore,
      currentRank: rankHistory.length > 0 ? rankHistory[rankHistory.length - 1] : 1,
      currentChange: stockPChange,
      rankTrend: rankHistory.length > 0 ? rankHistory : [1],
      changeTrend: changeTrend.length > 0 ? changeTrend : [stockPChange],
      reasons: reasons.slice(0, 3),
      raw: { ltp: lastPrice, vwap, dayHigh, deliveryPct: delPct },
      score: totalScore,
    };
  } catch (err) {
    console.error(`Error calculating factors for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Extracts candidates specifically for a target section key (e.g., 'FOSec' or 'NIFTY')
 */
function extractCategoryScans(scans, categoryKey) {
  const symbolMap = new Map();

  const scansData = scans.map((scan) => {
    const gainerObj = scan?.gainers || {};
    const rawList =
      gainerObj[categoryKey]?.data ||
      gainerObj.data ||
      [];

    const gainersList = Array.isArray(rawList) ? rawList : [];
    const symbols = [];
    const volumeMap = new Map();
    const pChangeMap = new Map();

    gainersList.forEach((g) => {
      const sym = g.symbol || g.symbolName || g.identifier;
      if (sym) {
        symbols.push(sym);
        const vol = g.totalTradedVolume || g.volume || g.trade_quantity || 0;
        const pChange = g.pChange || g.perChange || g.net_price || 0;
        const ltp = g.lastPrice || g.ltp || 0;

        volumeMap.set(sym, vol);
        pChangeMap.set(sym, pChange);

        if (!symbolMap.has(sym)) {
          symbolMap.set(sym, { symbol: sym, appearances: 1, latestPChange: pChange, lastPrice: ltp });
        } else {
          const existing = symbolMap.get(sym);
          existing.appearances += 1;
          existing.latestPChange = pChange;
          if (ltp > 0) existing.lastPrice = ltp;
        }
      }
    });

    return { time: scan.time, symbols, volumeMap, pChangeMap };
  });

  return { candidates: Array.from(symbolMap.values()), scansData };
}

export async function buildRecommendations(scans = []) {
  if (!scans || !Array.isArray(scans) || scans.length === 0) {
    return { foTop3: [], overallTop3: [] };
  }

  try {
    const totalScans = scans.length;

    const indicesList = await fetchAllIndices().catch(() => []);
    const indexMap = new Map();
    if (Array.isArray(indicesList)) {
      indicesList.forEach((idx) => {
        if (idx?.key || idx?.index) {
          indexMap.set((idx.key || idx.index).trim(), idx.pChange || 0);
        }
      });
    }

    // 1. Extract & Rank F&O Stocks separately from FOSec
    const foData = extractCategoryScans(scans, "FOSec");
    const shortlistedFo = foData.candidates
      .sort((a, b) => b.appearances - a.appearances || b.latestPChange - a.latestPChange)
      .slice(0, 10);

    const evaluatedFo = await Promise.all(
      shortlistedFo.map((cand) => evaluateCandidate(cand, foData.scansData, totalScans, indexMap))
    );

    const rankedFo = evaluatedFo
      .filter((item) => item && item.score > 0)
      .sort((a, b) => b.score - a.score);

    // 2. Extract & Rank Overall Stocks separately from NIFTY / allSec
    const overallData = extractCategoryScans(scans, "NIFTY");
    const shortlistedOverall = overallData.candidates
      .sort((a, b) => b.appearances - a.appearances || b.latestPChange - a.latestPChange)
      .slice(0, 10);

    const evaluatedOverall = await Promise.all(
      shortlistedOverall.map((cand) => evaluateCandidate(cand, overallData.scansData, totalScans, indexMap))
    );

    const rankedOverall = evaluatedOverall
      .filter((item) => item && item.score > 0)
      .sort((a, b) => b.score - a.score);

    return {
      foTop3: rankedFo.slice(0, 3),
      overallTop3: rankedOverall.slice(0, 3),
    };
  } catch (err) {
    console.error("Failed to build recommendations safely:", err.message);
    return { foTop3: [], overallTop3: [] };
  }
}