// src/recommendations.js
import { fetchChartData, fetchGetQuoteData, fetchAllIndices } from "./nse.js";
import { filterWithAI } from "./aiAnalyzer.js";
import {
  fetchCryptoKlines,
  fetchBtcContext,
  fetchDerivativesData,
} from "./crypto.js";

// ============================================================================
// TECHNICAL INDICATOR UTILITIES
// ============================================================================

/**
 * 14-Period RSI Calculation
 */
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;
  let gains = 0,
    losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period,
    avgLoss = losses / period;

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
  return 100 - 100 / (1 + avgGain / avgLoss);
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
 * Average True Range (ATR) Calculation
 */
function calculateATR(candles, period = 14) {
  if (!candles || candles.length < 2) return 0;
  let trList = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trList.push(tr);
  }
  const slice = trList.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Moving Average Convergence Divergence (MACD) Calculation
 */
function calculateMACD(closes) {
  if (!closes || closes.length < 26) {
    return { macd: 0, signal: 0, histogram: 0, bullishCross: false };
  }
  const ema12 = calculateEMA(closes, 12) || 0;
  const ema26 = calculateEMA(closes, 26) || 0;
  const macdVal = ema12 - ema26;
  const signalVal = macdVal * 0.9;
  const histogram = macdVal - signalVal;
  return {
    macd: macdVal,
    signal: signalVal,
    histogram,
    bullishCross: histogram > 0,
  };
}

// ============================================================================
// NSE EQUITIES 10-FACTOR EVALUATION ENGINE (UNCHANGED)
// ============================================================================

/**
 * Full 10-Factor Evaluation for NSE Equities with Continuous Metrics & Optimized Weights
 */
async function evaluateCandidate(candidate, scansData, totalScans, indexMap) {
  const { symbol } = candidate;

  try {
    // -------------------------------------------------------------
    // FACTOR 1: Scan Appearance (10%)
    // -------------------------------------------------------------
    const appearances = scansData.filter((s) =>
      s.symbols.includes(symbol)
    ).length;
    const appearanceScore = (appearances / Math.max(totalScans, 1)) * 100;

    // -------------------------------------------------------------
    // FACTOR 2: Current & Max Streak Persistence (5%)
    // -------------------------------------------------------------
    let currentStreak = 0;
    for (let i = scansData.length - 1; i >= 0; i--) {
      if (scansData[i].symbols.includes(symbol)) currentStreak++;
      else break;
    }

    let maxStreak = 0,
      tempStreak = 0;
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
    // FACTOR 3: Smooth Rank Progression Trend (5%)
    // -------------------------------------------------------------
    const rankHistory = scansData
      .map((s) => s.symbols.indexOf(symbol) + 1)
      .filter((r) => r !== 0);
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
    const changeTrend = [];
    const recentScansWithSymbol = scansData.filter((s) =>
      s.symbols.includes(symbol)
    );

    recentScansWithSymbol.forEach((s) => {
      const p = s.pChangeMap.get(symbol);
      if (p !== undefined) changeTrend.push(p);
    });

    if (recentScansWithSymbol.length >= 2) {
      const latestScanPos =
        recentScansWithSymbol[recentScansWithSymbol.length - 1];
      const prevScanPos =
        recentScansWithSymbol[recentScansWithSymbol.length - 2];
      const pChangeLatest = latestScanPos.pChangeMap.get(symbol) || 0;
      const pChangePrev = prevScanPos.pChangeMap.get(symbol) || 0;
      priceVelocityScore = Math.min(
        Math.max(50 + (pChangeLatest - pChangePrev) * 20, 0),
        100
      );
    }

    // -------------------------------------------------------------
    // FACTOR 5: Rolling Average Volume Spike (15%)
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
    // FETCH LIVE TECHNICAL & QUOTE DATA
    // -------------------------------------------------------------
    const [chartData, quotePayload] = await Promise.all([
      fetchChartData(symbol).catch(() => null),
      fetchGetQuoteData(symbol).catch(() => null),
    ]);

    // Fallback Values for Off-Market Debugging
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
      totalTradedVolume: candidate.volume || 100000,
    };

    const secInfo = quotePayload?.secInfo || { pdSectorInd: "NIFTY IT" };

    const lastPrice =
      meta?.closePrice || tradeInfo?.lastPrice || candidate.lastPrice || 0;
    const vwap = meta?.averagePrice || 0;
    const dayHigh = meta?.dayHigh || 0;
    const dayLow = meta?.dayLow || 0;
    const stockPChange = meta?.pChange || candidate.latestPChange || 0;
    const delPct = parseFloat(tradeInfo?.deliveryToTradedQuantity || 0);
    const totalTradedQty =
      tradeInfo?.totalTradedVolume || candidate.volume || 0;

    // -------------------------------------------------------------
    // FACTOR 6: Distance-Based Continuous VWAP Score (15%)
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
      nearHighScore = Math.min(
        Math.max(((lastPrice - dayLow) / (dayHigh - dayLow)) * 100, 0),
        100
      );
    }

    // -------------------------------------------------------------
    // FACTOR 8 & 9: Dynamic Relative Strength vs NIFTY & Sector (25%)
    // -------------------------------------------------------------
    const niftyPChange = indexMap.get("NIFTY 50") || 0;
    const sectorName = (secInfo?.pdSectorInd || "").trim();
    const sectorPChange = indexMap.get(sectorName) || niftyPChange;

    const rsNiftyDelta = stockPChange - niftyPChange;
    const rsSectorDelta = stockPChange - sectorPChange;

    const rsNiftyScore = Math.min(
      Math.max(
        rsNiftyDelta >= 0 ? 50 + rsNiftyDelta * 20 : 50 + rsNiftyDelta * 30,
        0
      ),
      100
    );
    const rsSectorScore = Math.min(
      Math.max(
        rsSectorDelta >= 0 ? 50 + rsSectorDelta * 20 : 50 + rsSectorDelta * 30,
        0
      ),
      100
    );

    // -------------------------------------------------------------
    // FACTOR 10: Technical RSI & EMA Trend (10%)
    // -------------------------------------------------------------
    let technicalScore = 50;
    let rsiValue = 50;
    let isEmaBullish = false;

    if (
      chartData &&
      Array.isArray(chartData.data) &&
      chartData.data.length > 14
    ) {
      const closes = chartData.data.map((c) => c[4]);
      rsiValue = Math.round(calculateRSI(closes));

      let rsiPart =
        rsiValue >= 55 && rsiValue <= 75 ? 100 : rsiValue > 75 ? 60 : 30;

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
    // RE-BALANCED COMPOSITE SCORE
    // -------------------------------------------------------------
    let baseScore =
      appearanceScore * 0.1 +
      persistenceScore * 0.05 +
      rankImprovementScore * 0.05 +
      priceVelocityScore * 0.1 +
      volumeScore * 0.15 +
      vwapScore * 0.15 +
      nearHighScore * 0.05 +
      rsNiftyScore * 0.15 +
      rsSectorScore * 0.1 +
      technicalScore * 0.1;

    const minTradedQty = 250000;
    const liquidityPenalty =
      totalTradedQty > 0 && totalTradedQty < minTradedQty ? 0.85 : 1.0;
    const finalScore = baseScore * liquidityPenalty;

    const confidenceScore = `${Math.round(finalScore)}%`;
    const signalText = finalScore >= 70 ? "STRONG BUY" : "BUY";

    const reasons = [];
    reasons.push(
      `Appeared in ${appearances}/${totalScans} scans (${currentStreak} streak)`
    );
    if (lastPrice > vwap && vwap > 0)
      reasons.push(`Trading above VWAP (₹${vwap.toFixed(1)})`);
    if (isEmaBullish)
      reasons.push(`Bullish EMA alignment (Price > EMA9 > EMA20)`);
    if (rsiValue >= 55 && rsiValue <= 75)
      reasons.push(`RSI momentum in optimal zone (${rsiValue})`);
    if (rsSectorDelta > 0)
      reasons.push(
        `Outperforming ${sectorName || "Sector"} by +${rsSectorDelta.toFixed(
          1
        )}%`
      );
    if (delPct > 35)
      reasons.push(`High institutional delivery volume (${delPct}%)`);

    return {
      symbol,
      signal: signalText,
      side: "buy",
      confidence: confidenceScore,
      currentRank:
        rankHistory.length > 0 ? rankHistory[rankHistory.length - 1] : 1,
      currentChange: stockPChange,
      rankTrend: rankHistory.length > 0 ? rankHistory : [1],
      changeTrend: changeTrend.length > 0 ? changeTrend : [stockPChange],
      reasons: reasons.slice(0, 3),
      raw: { ltp: lastPrice, vwap, dayHigh, deliveryPct: delPct },
      score: finalScore,
      rsiValue,
    };
  } catch (err) {
    console.error(`Error calculating factors for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Merge AI analysis back onto candidate objects ensuring UI field safety
 */
function mergeAIPicks(candidates, aiPicks) {
  if (!aiPicks || !Array.isArray(aiPicks) || aiPicks.length === 0) {
    return candidates.slice(0, 3);
  }

  const map = new Map(candidates.map((c) => [c.symbol, c]));
  const merged = [];

  for (const pick of aiPicks) {
    const original = map.get(pick.symbol);
    if (original) {
      merged.push({
        ...original,
        confidence: pick.confidence?.includes("%")
          ? pick.confidence
          : `${pick.confidence || original.confidence}%`,
        signal: pick.signal || original.signal,
        reasons:
          Array.isArray(pick.aiReasoning) && pick.aiReasoning.length > 0
            ? pick.aiReasoning.slice(0, 4)
            : original.reasons,
      });
    }
  }

  return merged.length > 0 ? merged.slice(0, 3) : candidates.slice(0, 3);
}

/**
 * Extracts candidates specifically for a target section key (e.g., 'FOSec' or 'NIFTY')
 */
function extractCategoryScans(scans, categoryKey) {
  const symbolMap = new Map();

  const scansData = scans.map((scan) => {
    const gainerObj = scan?.gainers || {};
    const rawList = gainerObj[categoryKey]?.data || gainerObj.data || [];

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
          symbolMap.set(sym, {
            symbol: sym,
            appearances: 1,
            latestPChange: pChange,
            lastPrice: ltp,
            volume: vol,
          });
        } else {
          const existing = symbolMap.get(sym);
          existing.appearances += 1;
          existing.latestPChange = pChange;
          if (ltp > 0) existing.lastPrice = ltp;
          if (vol > 0) existing.volume = vol;
        }
      }
    });

    return { time: scan.time, symbols, volumeMap, pChangeMap };
  });

  return { candidates: Array.from(symbolMap.values()), scansData };
}

export async function buildRecommendations(scans = []) {
  if (!scans || !Array.isArray(scans) || scans.length === 0) {
    return { topPicks: [] };
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

    const marketContext = {
      niftyPChange: indexMap.get("NIFTY 50") || 0,
    };

    // Extract & Rank ONLY F&O Securities
    const foData = extractCategoryScans(scans, "FOSec");
    const shortlistedFo = foData.candidates
      .sort(
        (a, b) =>
          b.appearances - a.appearances || b.latestPChange - a.latestPChange
      )
      .slice(0, 10);

    const evaluatedFo = (
      await Promise.all(
        shortlistedFo.map((cand) =>
          evaluateCandidate(cand, foData.scansData, totalScans, indexMap)
        )
      )
    )
      .filter((item) => item && item.score > 0)
      .sort((a, b) => b.score - a.score);

    const aiFoPicks = await filterWithAI(
      evaluatedFo.slice(0, 7),
      marketContext
    );

    return {
      topPicks: mergeAIPicks(evaluatedFo, aiFoPicks),
    };
  } catch (err) {
    console.error("Failed to build NSE recommendations:", err.message);
    return { topPicks: [] };
  }
}

// ============================================================================
// CRYPTO V2 MULTI-FACTOR EVALUATION ENGINE
// ============================================================================

async function evaluateCryptoCandidate(
  candidate,
  cryptoScans = [],
  btcContext = {}
) {
  const symbol = candidate.symbol;

  try {
    // Fetch multi-timeframe OHLCV candle data concurrently
    const [candles15m, candles1h, candles4h] = await Promise.all([
      fetchCryptoKlines(symbol, "15", 50),
      fetchCryptoKlines(symbol, "60", 25),
      fetchCryptoKlines(symbol, "240", 15),
    ]);

    if (!candles15m || candles15m.length < 15) return null;

    const closes15m = candles15m.map((c) => c.close);
    const currentPrice = closes15m[closes15m.length - 1];

    // --- FACTOR 1: MULTI-TIMEFRAME MOMENTUM (15%) ---
    const m15 =
      closes15m.length >= 2
        ? ((currentPrice - closes15m[closes15m.length - 2]) /
            closes15m[closes15m.length - 2]) *
          100
        : 0;
    const m30 =
      closes15m.length >= 3
        ? ((currentPrice - closes15m[closes15m.length - 3]) /
            closes15m[closes15m.length - 3]) *
          100
        : m15;
    const m1h =
      candles1h.length >= 2
        ? ((currentPrice - candles1h[candles1h.length - 2].close) /
            candles1h[candles1h.length - 2].close) *
          100
        : m15;
    const m4h =
      candles4h.length >= 2
        ? ((currentPrice - candles4h[candles4h.length - 2].close) /
            candles4h[candles4h.length - 2].close) *
          100
        : m1h;

    // Acceleration check across recent 15m scan snapshots
    let isAccelerating = true;
    if (cryptoScans.length >= 2) {
      const prevScan = cryptoScans[cryptoScans.length - 2];
      const prevCandidate = prevScan.gainers?.find((g) => g.symbol === symbol);
      if (prevCandidate) {
        isAccelerating =
          candidate.priceChangePercent >= prevCandidate.priceChangePercent;
      }
    }

    const momentumScore = Math.min(
      Math.max(
        (m15 * 3 + m1h * 2 + m4h + (isAccelerating ? 15 : 0)) * 5 + 50,
        0
      ),
      100
    );

    // --- FACTOR 2: VOLUME (15%) ---
    const recentVol = candles15m[candles15m.length - 1].volume;
    const avgVol =
      candles15m.slice(-10).reduce((acc, c) => acc + c.volume, 0) / 10;
    const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;
    const isPriceVolumeBullish =
      currentPrice >= candles15m[candles15m.length - 2].close &&
      volumeRatio >= 1.0;

    const volumeScore = Math.min(
      Math.max(volumeRatio * 25 + (isPriceVolumeBullish ? 25 : 0), 0),
      100
    );

    // --- FACTOR 3: TREND / EMA (12%) ---
    const ema9 = calculateEMA(closes15m, 9) || currentPrice;
    const ema20 = calculateEMA(closes15m, 20) || currentPrice;
    const ema50 =
      calculateEMA(closes15m, Math.min(50, closes15m.length)) || currentPrice;

    const isBullishTrend =
      currentPrice > ema9 && ema9 > ema20 && ema20 >= ema50;
    const trendScore = isBullishTrend ? 90 : currentPrice > ema20 ? 70 : 40;

    // --- FACTOR 4: RSI (8%) ---
    const rsi14 = calculateRSI(closes15m, 14);
    let rsiScore = 50;
    if (rsi14 >= 55 && rsi14 <= 75) rsiScore = 85;
    else if (rsi14 > 75 && rsi14 <= 85) rsiScore = 70;
    else if (rsi14 < 45) rsiScore = 30;
    else rsiScore = 60;

    // --- FACTOR 5: RELATIVE STRENGTH VS BTC (8%) ---
    const btc1h = btcContext.change1h || 0;
    const rsDelta = m1h - btc1h;
    const relativeStrengthScore = Math.min(Math.max(50 + rsDelta * 15, 0), 100);

    // --- FACTOR 6: BREAKOUT (8%) ---
    const recentHigh20 = Math.max(...candles15m.slice(-20).map((c) => c.high));
    const isBreakout =
      currentPrice >= recentHigh20 * 0.995 && volumeRatio > 1.2;
    const breakoutScore = isBreakout ? 90 : 50;

    // --- FACTOR 7: PRICE STRUCTURE (6%) ---
    const h1 = candles15m[candles15m.length - 1].high;
    const h2 = candles15m[candles15m.length - 3]?.high || h1;
    const l1 = candles15m[candles15m.length - 1].low;
    const l2 = candles15m[candles15m.length - 3]?.low || l1;
    const isHigherHighLow = h1 >= h2 && l1 >= l2;
    const structureScore = isHigherHighLow ? 85 : 55;

    // --- FACTOR 8: VWAP (5%) ---
    const cumPV = candles15m.reduce(
      (acc, c) => acc + ((c.high + c.low + c.close) / 3) * c.volume,
      0
    );
    const cumVol = candles15m.reduce((acc, c) => acc + c.volume, 0);
    const vwap = cumVol > 0 ? cumPV / cumVol : currentPrice;
    const vwapScore = currentPrice >= vwap ? 85 : 45;

    // --- FACTOR 9: VOLATILITY (5%) ---
    const atr = calculateATR(candles15m, 14);
    const atrPct = (atr / currentPrice) * 100;
    const volatilityScore = atrPct >= 1.0 && atrPct <= 8.0 ? 80 : 50;

    // --- FACTOR 10: MACD (4%) ---
    const macdData = calculateMACD(closes15m);
    const macdScore = macdData.bullishCross ? 85 : 50;

    // --- FACTOR 11: MARKET REGIME (5%) ---
    const regimeScore = btcContext.trend === "BULLISH" ? 85 : 50;

    // --- FACTOR 12: LIQUIDITY (4%) ---
    const liquidityScore = candidate.quoteVolume > 10000000 ? 90 : 70;

    // --- FACTOR 13: DERIVATIVES (5%) ---
    const derivs = await fetchDerivativesData(symbol);
    const derivativesScore = derivs.available
      ? derivs.fundingRate <= 0.0005 && derivs.oiDelta >= 0
        ? 85
        : 60
      : 70;

    // --- FACTOR 14: SCAN PERSISTENCE ---
    let persistenceBonus = 0;
    if (cryptoScans.length > 1) {
      const ranks = cryptoScans.map((scan) => {
        const found = scan.gainers?.findIndex((g) => g.symbol === symbol);
        return found !== undefined && found !== -1 ? found + 1 : 99;
      });
      if (ranks[ranks.length - 1] <= (ranks[0] || 99)) {
        persistenceBonus = 5;
      }
    }

    // Normalized 100% Weight Calculation
    const rawScore =
      momentumScore * 0.15 +
      volumeScore * 0.15 +
      trendScore * 0.12 +
      rsiScore * 0.08 +
      relativeStrengthScore * 0.08 +
      breakoutScore * 0.08 +
      structureScore * 0.06 +
      vwapScore * 0.05 +
      volatilityScore * 0.05 +
      macdScore * 0.04 +
      regimeScore * 0.05 +
      liquidityScore * 0.04 +
      derivativesScore * 0.05 +
      persistenceBonus;

    const finalScore = Math.min(Math.max(Math.round(rawScore), 0), 100);

    // Explicit Non-Guarantee Signal Classification
    let signal = "NEUTRAL";
    if (finalScore >= 80) signal = "STRONG BUY CANDIDATE";
    else if (finalScore >= 70) signal = "BUY CANDIDATE";
    else if (finalScore >= 60) signal = "WATCH";
    else if (finalScore >= 50) signal = "NEUTRAL";
    else signal = "AVOID";

    // Descriptive Quantitative Reasons
    const reasons = [];
    if (volumeRatio > 1.5) {
      reasons.push(
        `Volume is ${volumeRatio.toFixed(1)}x the recent 15m average`
      );
    }
    if (isBullishTrend) {
      reasons.push(`Bullish EMA alignment (Price > EMA9 > EMA20)`);
    }
    if (m1h > btc1h) {
      reasons.push(
        `Outperforming BTC by +${(m1h - btc1h).toFixed(1)}% over 1h`
      );
    }
    if (isBreakout) {
      reasons.push(`20-candle resistance breakout confirmed by volume`);
    }
    if (rsi14 >= 55 && rsi14 <= 75) {
      reasons.push(`RSI at ${Math.round(rsi14)} in optimal momentum zone`);
    }

    return {
      symbol,
      signal,
      side: "buy",
      confidence: `${finalScore}%`,
      currentRank: 1,
      currentChange: candidate.priceChangePercent,
      score: finalScore,
      rsiValue: Math.round(rsi14),
      scores: {
        momentum: Math.round(momentumScore),
        volume: Math.round(volumeScore),
        trend: Math.round(trendScore),
        rsi: Math.round(rsiScore),
        relativeStrength: Math.round(relativeStrengthScore),
        breakout: Math.round(breakoutScore),
        structure: Math.round(structureScore),
        vwap: Math.round(vwapScore),
        volatility: Math.round(volatilityScore),
        macd: Math.round(macdScore),
        marketRegime: Math.round(regimeScore),
        liquidity: Math.round(liquidityScore),
        derivatives: Math.round(derivativesScore),
      },
      risk: {
        level: finalScore >= 80 ? "LOW" : finalScore >= 70 ? "MEDIUM" : "HIGH",
        score: Math.max(0, 100 - finalScore),
        penalties: rsi14 > 75 ? ["Overheated RSI"] : [],
      },
      marketRegime: btcContext.trend || "NEUTRAL",
      momentum: Math.round(m15 * 10) / 10,
      volumeRatio: Math.round(volumeRatio * 10) / 10,
      breakout: isBreakout,
      reasons: reasons.slice(0, 4),
      raw: {
        ltp: currentPrice,
        vwap,
        volume: candidate.quoteVolume,
        isCrypto: true,
      },
    };
  } catch (err) {
    console.error(`Error evaluating crypto candidate ${symbol}:`, err.message);
    return null;
  }
}

export async function buildCryptoRecommendations(cryptoScans = []) {
  if (!cryptoScans.length) return { topPicks: [] };

  const latestScan = cryptoScans[cryptoScans.length - 1];
  const gainers = latestScan.gainers || [];
  const btcContext = await fetchBtcContext();

  const evaluated = (
    await Promise.all(
      gainers
        .slice(0, 12)
        .map((coin) => evaluateCryptoCandidate(coin, cryptoScans, btcContext))
    )
  )
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // AI Re-ranking (with automatic fallback to deterministic ranking)
  const aiPicks = await filterWithAI(evaluated.slice(0, 7), {
    isCrypto: true,
    btcChange: btcContext.change24h,
  });

  return {
    topPicks: mergeAIPicks(evaluated, aiPicks),
  };
}
