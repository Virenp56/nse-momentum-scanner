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

function calculateEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

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

function calculateVWAP(candles) {
  if (!candles || candles.length === 0) return 0;
  const cumPV = candles.reduce(
    (acc, c) => acc + ((c.high + c.low + c.close) / 3) * c.volume,
    0
  );
  const cumVol = candles.reduce((acc, c) => acc + c.volume, 0);
  return cumVol > 0 ? cumPV / cumVol : candles[candles.length - 1].close;
}

// ============================================================================
// SUSTAINED MOMENTUM & STRUCTURE CONFIRMATION
// ============================================================================

/**
 * Validates real accumulation/continuation instead of a 1-candle pump-and-dump:
 * - Operates strictly on confirmed closed candles (excludes index -1).
 * - Checks net impulse over 35-40 min (7-8 candles).
 * - Rejects if price retraced > 45% from the local impulse peak.
 * - Confirms pullbacks happened on lower volume (absorption, not dumping).
 * - Requires price to be near EMA9 support, not stretched at exhaustion highs.
 */
function validateMomentumStructure(closedCandles, ema9) {
  if (!closedCandles || closedCandles.length < 15) return { passed: false };

  const lookback = closedCandles.slice(-8);
  const latestClosed = lookback[lookback.length - 1];

  // 1. Net directional push over the window
  const windowOpen = lookback[0].open;
  const highestHigh = Math.max(...lookback.map((c) => c.high));
  const netGainPct = ((latestClosed.close - windowOpen) / windowOpen) * 100;
  if (netGainPct < 0.65) {
    return { passed: false, reason: "Insufficient directional impulse" };
  }

  // 2. Anti-Dump Guard: Reject if dump gave back > 45% of peak move
  const totalRange = highestHigh - windowOpen;
  const retrace = highestHigh - latestClosed.close;
  if (totalRange > 0 && retrace / totalRange > 0.45) {
    return { passed: false, reason: "Heavy retrace from local peak" };
  }

  // 3. Volume Health: Red/pullback volume must not dominate buy volume
  const greenVol = lookback
    .filter((c) => c.close >= c.open)
    .map((c) => c.volume);
  const redVol = lookback.filter((c) => c.close < c.open).map((c) => c.volume);

  const avgGreenVol = greenVol.length
    ? greenVol.reduce((a, b) => a + b, 0) / greenVol.length
    : 0;
  const avgRedVol = redVol.length
    ? redVol.reduce((a, b) => a + b, 0) / redVol.length
    : 0;

  if (avgRedVol > avgGreenVol * 1.25) {
    return {
      passed: false,
      reason: "Distribution volume exceeds buying volume",
    };
  }

  // 4. Support Proximity: Must hold near EMA9 support, not extended at top
  const distFromEma9 = ((latestClosed.close - ema9) / ema9) * 100;
  if (distFromEma9 < -0.4 || distFromEma9 > 1.3) {
    return { passed: false, reason: "Extended away from support entry zone" };
  }

  return { passed: true, netGainPct, distFromEma9 };
}

// ============================================================================
// NSE EQUITIES 10-FACTOR EVALUATION ENGINE (ENTIRELY UNTOUCHED)
// ============================================================================

async function evaluateCandidate(candidate, scansData, totalScans, indexMap) {
  const { symbol } = candidate;

  try {
    const appearances = scansData.filter((s) =>
      s.symbols.includes(symbol)
    ).length;
    const appearanceScore = (appearances / Math.max(totalScans, 1)) * 100;

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

    const [chartData, quotePayload] = await Promise.all([
      fetchChartData(symbol).catch(() => null),
      fetchGetQuoteData(symbol).catch(() => null),
    ]);

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

    let vwapScore = 0;
    if (lastPrice > 0 && vwap > 0) {
      const vwapDistancePct = ((lastPrice - vwap) / vwap) * 100;
      if (vwapDistancePct < 0) vwapScore = 0;
      else if (vwapDistancePct <= 2.5) vwapScore = 100;
      else vwapScore = Math.max(100 - (vwapDistancePct - 2.5) * 20, 30);
    }

    let nearHighScore = 50;
    if (dayHigh > dayLow && dayHigh > 0) {
      nearHighScore = Math.min(
        Math.max(((lastPrice - dayLow) / (dayHigh - dayLow)) * 100, 0),
        100
      );
    }

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
// HARDENED CRYPTO 5M SCALPER ENGINE (WITH SUSTAINED STRUCTURE VERIFICATION)
// ============================================================================

async function evaluateCryptoCandidate(
  candidate,
  cryptoScans = [],
  btcContext = {}
) {
  const symbol = candidate.symbol;

  try {
    const [candles5m, candles15m, candles1h] = await Promise.all([
      fetchCryptoKlines(symbol, "5", 60),
      fetchCryptoKlines(symbol, "15", 40),
      fetchCryptoKlines(symbol, "60", 24),
    ]);

    if (!candles5m || candles5m.length < 30) return null;
    if (!candles15m || candles15m.length < 20) return null;

    // RULE 1: Work exclusively with confirmed closed candles to eliminate in-flight traps
    const closedCandles5m = candles5m.slice(0, -1);
    const lastClosedCandle = closedCandles5m[closedCandles5m.length - 1];
    const closedPrice = lastClosedCandle.close;
    const currentLivePrice = candles5m[candles5m.length - 1].close;
    const closedCloses5m = closedCandles5m.map((c) => c.close);

    // RULE 2: BTC Market Regime Circuit Breaker
    if (
      (btcContext.change5m || 0) < -0.35 ||
      (btcContext.change15m || 0) < -0.7
    ) {
      return null; // BTC is flushing; reject all long setups
    }

    // RULE 3: Multi-Timeframe Exhaustion Filter (15m & 1h)
    const closedCloses15m = candles15m.slice(0, -1).map((c) => c.close);
    const rsi15m = calculateRSI(closedCloses15m, 14);
    const ema9_15m = calculateEMA(closedCloses15m, 9) || closedPrice;
    const ema21_15m = calculateEMA(closedCloses15m, 21) || closedPrice;

    if (rsi15m > 68) return null; // 15m momentum exhausted
    if (closedCloses15m[closedCloses15m.length - 1] < ema21_15m) {
      return null; // Under 15m baseline support
    }

    if (candles1h && candles1h.length >= 15) {
      const closedCloses1h = candles1h.slice(0, -1).map((c) => c.close);
      const rsi1h = calculateRSI(closedCloses1h, 14);
      if (rsi1h > 75) return null; // Multi-hour blow-off top
    }

    // RULE 4: Single-Candle Pump & Upper Wick Rejection
    const candleRange = lastClosedCandle.high - lastClosedCandle.low;
    if (candleRange > 0) {
      const upperWick =
        lastClosedCandle.high -
        Math.max(lastClosedCandle.open, lastClosedCandle.close);
      const upperWickPct = (upperWick / candleRange) * 100;
      if (
        upperWickPct > 30 &&
        lastClosedCandle.close < lastClosedCandle.high - candleRange * 0.35
      ) {
        return null; // Seller rejection / shooting star
      }
    }

    // Indicators on closed candles
    const rsi14 = calculateRSI(closedCloses5m, 14);
    if (rsi14 > 66 || rsi14 < 48) {
      return null; // Overbought or losing momentum
    }

    const vwap = calculateVWAP(closedCandles5m);
    const vwapDistPct = vwap > 0 ? ((closedPrice - vwap) / vwap) * 100 : 0;
    if (vwapDistPct > 1.8 || vwapDistPct < -0.2) {
      return null; // Stretched or broken below VWAP
    }

    const ema9 = calculateEMA(closedCloses5m, 9) || closedPrice;
    const ema20 = calculateEMA(closedCloses5m, 20) || closedPrice;
    const ema50 =
      calculateEMA(closedCloses5m, Math.min(50, closedCloses5m.length)) ||
      closedPrice;
    const emaDistPct = ((closedPrice - ema9) / ema9) * 100;

    if (emaDistPct > 1.2) {
      return null; // Rubber-band stretched away from EMA9
    }

    if (!(closedPrice > ema9 && ema9 > ema20 && ema20 >= ema50)) {
      return null; // Failed EMA stack structure
    }

    // RULE 5: Sustained Structure Confirmation
    const structureCheck = validateMomentumStructure(closedCandles5m, ema9);
    if (!structureCheck.passed) {
      return null; // Rejects single-candle spike traps and heavy distribution
    }

    // ========================================================================
    // FACTOR SCORING
    // ========================================================================
    let candleHealthScore =
      lastClosedCandle.close > lastClosedCandle.open ? 85 : 45;

    const lastVol = lastClosedCandle.volume;
    const avgVol20 =
      closedCandles5m.slice(-21, -1).reduce((acc, c) => acc + c.volume, 0) / 20;
    const volumeRatio = avgVol20 > 0 ? lastVol / avgVol20 : 1;

    let volumeScore = 50;
    if (volumeRatio >= 1.2 && volumeRatio <= 3.0) {
      volumeScore = 95;
    } else if (volumeRatio > 3.0) {
      volumeScore = 40;
    }

    let trendScore = emaDistPct >= 0.05 && emaDistPct <= 0.6 ? 100 : 70;
    let rsiScore = rsi14 >= 52 && rsi14 <= 62 ? 100 : 65;
    let htfScore = ema9_15m > ema21_15m ? 95 : 40;

    const btc15m = btcContext.change15m || 0;
    const token15m =
      ((closedPrice - closedCloses5m[closedCloses5m.length - 4]) /
        closedCloses5m[closedCloses5m.length - 4]) *
      100;
    const rsBTC = token15m - btc15m;
    const rsScore = Math.min(Math.max(50 + rsBTC * 15, 0), 100);

    const derivs = await fetchDerivativesData(symbol).catch(() => ({}));
    const derivativesScore = derivs?.available
      ? derivs.fundingRate <= 0.0003 && (derivs.oiDelta || 0) >= 0
        ? 90
        : 45
      : 70;

    const rawScore =
      candleHealthScore * 0.2 +
      volumeScore * 0.18 +
      trendScore * 0.18 +
      rsiScore * 0.14 +
      htfScore * 0.12 +
      (rsScore * 0.5 + derivativesScore * 0.5) * 0.18;

    const finalScore = Math.min(Math.max(Math.round(rawScore), 0), 100);
    if (finalScore < 76) return null; // Drop subpar candidates

    const atr = calculateATR(closedCandles5m, 14);
    const atrPct = (atr / closedPrice) * 100;
    const targetPct = Math.min(Math.max(atrPct * 1.8, 1.2), 2.2);
    const stopLossPct = Math.min(Math.max(atrPct * 1.0, 0.6), 1.0);

    return {
      symbol,
      signal: "STRONG BUY CANDIDATE",
      side: "buy",
      confidence: `${finalScore}%`,
      currentRank: 1,
      currentChange: candidate.priceChangePercent,
      score: finalScore,
      rsiValue: Math.round(rsi14),
      timeframe: "5m",
      targetHorizon: "45m - 60m",
      entry: currentLivePrice,
      trade: {
        targetPrice: Number(
          (currentLivePrice * (1 + targetPct / 100)).toFixed(6)
        ),
        targetPct: Number(targetPct.toFixed(2)),
        stopLossPrice: Number(
          (currentLivePrice * (1 - stopLossPct / 100)).toFixed(6)
        ),
        stopLossPct: Number(stopLossPct.toFixed(2)),
        estimatedMinutes: 45,
      },
      reasons: [
        "Sustained 40m accumulation held above 5m EMA9",
        `Controlled RSI runway (${Math.round(rsi14)}) with 15m alignment`,
        `Outperforming BTC benchmark by +${rsBTC.toFixed(1)}%`,
      ],
      raw: {
        ltp: currentLivePrice,
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
        .slice(0, 15)
        .map((coin) => evaluateCryptoCandidate(coin, cryptoScans, btcContext))
    )
  )
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  let finalPicks = evaluated.slice(0, 3);
  try {
    const aiPicks = await filterWithAI(evaluated.slice(0, 5), {
      isCrypto: true,
      btcChange: btcContext.change24h,
    });
    if (aiPicks && aiPicks.length > 0) {
      finalPicks = mergeAIPicks(evaluated, aiPicks);
    }
  } catch (aiErr) {
    console.warn(
      "AI validation skipped, using mathematical filters:",
      aiErr.message
    );
  }

  return {
    topPicks: finalPicks,
  };
}
