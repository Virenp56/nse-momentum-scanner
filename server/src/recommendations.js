// recommendations.js
import { fetchChartData } from "./nse.js";

const asNum = (value) => Number(String(value ?? 0).replace(/,/g, "")) || 0;
const symbolOf = (row) =>
  row.symbol ||
  row.meta?.symbol ||
  row.companyName ||
  row.identifier ||
  "Unknown";
const changeOf = (row) =>
  asNum(row.pChange ?? row.perChange ?? row.percentChange ?? row.change);
const volumeOf = (row) =>
  asNum(row.totalTradedVolume ?? row.volume ?? row.totalTradedValue ?? 0);
const rankOf = (row, index) => asNum(row.rank) || index + 1;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function calculateRSI(prices, period = 14) {
  if (!prices || prices.length <= period) return 50;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
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
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return prices?.at(-1) || 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return Number(ema.toFixed(2));
}

function normalise(rows, category) {
  let candidate = [];
  if (Array.isArray(rows)) {
    candidate = rows;
  } else if (category && rows?.[category]) {
    candidate = Array.isArray(rows[category]?.data)
      ? rows[category].data
      : Array.isArray(rows[category])
      ? rows[category]
      : [];
  } else if (Array.isArray(rows?.data)) {
    candidate = rows.data;
  } else if (Array.isArray(rows?.NIFTY?.data)) {
    candidate = rows.NIFTY.data;
  }

  const list = Array.isArray(candidate) ? candidate : [];

  // Extract up to 20 candidates per segment
  return list.slice(0, 20).map((row, index) => ({
    symbol: symbolOf(row),
    rank: rankOf(row, index),
    change: changeOf(row),
    volume: volumeOf(row),
    raw: row,
  }));
}

const rising = (values, direction = 1) => {
  if (values.length < 2) return 0.5;
  const steps = values
    .slice(1)
    .map((value, index) => direction * (value - values[index]));
  const improvingSteps = steps.filter((step) => step > 0).length;
  return improvingSteps === steps.length
    ? 1
    : improvingSteps / (steps.length * 2);
};

const chartCache = new Map();

async function getCachedChartData(symbol) {
  if (chartCache.has(symbol)) return chartCache.get(symbol);
  try {
    const data = await fetchChartData(symbol);
    chartCache.set(symbol, data);
    return data;
  } catch (err) {
    console.error(`Skipped live charts for ${symbol} (HTTP 403/Error)`);
    return null;
  }
}

async function calculate(scans, side, category = null) {
  const records = new Map();
  scans.forEach((scan) => {
    const rawData = scan[side];
    normalise(rawData, category).forEach((stock) => {
      if (!records.has(stock.symbol)) records.set(stock.symbol, []);
      records.get(stock.symbol).push({ ...stock, time: scan.time });
    });
  });

  const total = scans.length || 1;
  const candidateList = [...records.entries()].map(([symbol, points]) => {
    const ranks = points.map((p) => p.rank);
    const changes = points.map((p) => Math.abs(p.change));
    const volumes = points.map((p) => p.volume);

    const appearance = points.length / total;
    const averageRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    const rankScore = Math.max(0, (21 - averageRank) / 20);
    const momentum = rising(changes);
    const volumeGrowth = rising(volumes);
    const improvement = rising(ranks, -1);

    const baseScore =
      appearance * 0.35 +
      rankScore * 0.2 +
      momentum * 0.2 +
      volumeGrowth * 0.15 +
      improvement * 0.1;

    const latest = points.at(-1);

    return {
      symbol,
      points,
      ranks,
      changes,
      volumes,
      appearance,
      averageRank,
      baseScore,
      latest,
    };
  });

  candidateList.sort((a, b) => b.baseScore - a.baseScore);

  // Filter out upper circuit risks (>19% gains)
  const filteredCandidates = candidateList.filter(
    (c) => c.latest.change < 19.0
  );

  // Take TOP 10 candidates
  const top10Candidates = filteredCandidates.slice(0, 10);
  const verifiedResults = [];

  for (const candidate of top10Candidates) {
    let techScore = 0.5; // Default neutral score
    let rsi = 50;
    let ema9 = 0;
    let ema21 = 0;
    let isBullishEma = false;
    let hasVolumeSpike = false;

    await delay(1200); // 500ms delay to avoid rate limiting

    try {
      const chartRes = await getCachedChartData(candidate.symbol);

      if (
        chartRes &&
        Array.isArray(chartRes.data) &&
        chartRes.data.length > 20
      ) {
        const closes = chartRes.data.map(
          (tick) => tick.close || tick[4] || tick[1]
        );
        const minuteVolumes = chartRes.data.map(
          (tick) => tick.volume || tick[5] || 0
        );

        rsi = calculateRSI(closes, 14);
        ema9 = calculateEMA(closes, 9);
        ema21 = calculateEMA(closes, 21);

        isBullishEma = ema9 > ema21;
        const isRsiOptimal = rsi >= 55 && rsi <= 75;

        if (minuteVolumes.length >= 20) {
          const recentVol = minuteVolumes.at(-1);
          const avgVol =
            minuteVolumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
          hasVolumeSpike = avgVol > 0 && recentVol > 1.5 * avgVol;
        }

        if (isBullishEma && isRsiOptimal) {
          techScore = hasVolumeSpike ? 1.0 : 0.85;
        } else if (isBullishEma || isRsiOptimal) {
          techScore = 0.65;
        } else if (rsi > 80) {
          techScore = 0.2;
        }
      }
    } catch (err) {
      console.error(
        `Skipped live charts for ${candidate.symbol}, using scan score fallback.`
      );
    }

    // Calculate final confidence rating
    const finalConfidence = Math.round(
      Math.min(100, 100 * (candidate.baseScore * 0.7 + techScore * 0.3))
    );

    const reasons = [
      `Appeared in ${candidate.points.length} of ${total} scans`,
      candidate.averageRank <= 5
        ? `Strong average rank: #${candidate.averageRank.toFixed(1)}`
        : `Average rank: #${candidate.averageRank.toFixed(1)}`,
      isBullishEma ? "EMA Trend: Bullish (EMA9 > EMA21)" : "EMA Trend: Neutral",
      rsi >= 55 && rsi <= 75
        ? `Optimal RSI Momentum (${rsi})`
        : `RSI Level: ${rsi}`,
      ...(hasVolumeSpike ? ["Intraday Volume Spike Detected"] : []),
    ];

    const signal =
      finalConfidence >= 80
        ? `Strong ${side === "gainers" ? "Buy" : "Sell"}`
        : finalConfidence >= 60
        ? side === "gainers"
          ? "Buy"
          : "Sell"
        : "Watch";

    verifiedResults.push({
      symbol: candidate.symbol,
      side: side === "gainers" ? "buy" : "sell",
      signal,
      confidence: finalConfidence,
      reasons,
      rsi,
      ema9,
      ema21,
      currentRank: candidate.latest.rank,
      currentChange: candidate.latest.change,
      rankTrend: candidate.ranks,
      changeTrend: candidate.points.map((p) => p.change),
      volumeTrend: candidate.volumes,
      raw: candidate.latest.raw,
    });
  }

  // Return Top 3 calculated from the Top 10
  return verifiedResults
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

export async function buildRecommendations(scans) {
  chartCache.clear();

  const [foTop3, overallTop3] = await Promise.all([
    calculate(scans, "gainers", "FOSec"),
    calculate(scans, "gainers", "allSec"),
  ]);

  return {
    foTop3,
    overallTop3,
    buy: foTop3,
    sell: [],
  };
}
