const asNum = (value) => Number(String(value ?? 0).replace(/,/g, '')) || 0;
const symbolOf = (row) => row.symbol || row.meta?.symbol || row.companyName || row.identifier || 'Unknown';
const changeOf = (row) => asNum(row.pChange ?? row.perChange ?? row.percentChange ?? row.change);
const volumeOf = (row) => asNum(row.totalTradedVolume ?? row.volume ?? row.totalTradedValue ?? 0);
const rankOf = (row, index) => asNum(row.rank) || index + 1;

function normalise(rows) {
  const list = Array.isArray(rows) ? rows : (rows?.data || rows?.NIFTY || []);
  return list.slice(0, 10).map((row, index) => ({ symbol: symbolOf(row), rank: rankOf(row, index), change: changeOf(row), volume: volumeOf(row), raw: row }));
}
// A trend earns full credit only when every comparison improves. Flat readings are
// deliberately not called improvements; partial improvement receives partial credit.
const rising = (values, direction = 1) => {
  if (values.length < 2) return 0.5;
  const steps = values.slice(1).map((value, index) => direction * (value - values[index]));
  const improvingSteps = steps.filter((step) => step > 0).length;
  return improvingSteps === steps.length ? 1 : improvingSteps / (steps.length * 2);
};

function calculate(scans, side) {
  const records = new Map();
  scans.forEach((scan) => normalise(scan[side]).forEach((stock) => {
    if (!records.has(stock.symbol)) records.set(stock.symbol, []);
    records.get(stock.symbol).push({ ...stock, time: scan.time });
  }));
  const total = scans.length || 1;
  return [...records.entries()].map(([symbol, points]) => {
    const ranks = points.map((point) => point.rank);
    const changes = points.map((point) => Math.abs(point.change));
    const volumes = points.map((point) => point.volume);
    const appearance = points.length / total;
    const averageRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    const rankScore = Math.max(0, (11 - averageRank) / 10);
    const momentum = rising(changes);
    const volumeGrowth = rising(volumes);
    const improvement = rising(ranks, -1);
    const confidence = Math.round(Math.min(100, 100 * (appearance * .35 + rankScore * .20 + momentum * .20 + volumeGrowth * .15 + improvement * .10)));
    const latest = points.at(-1);
    const reasons = [
      `Appeared in ${points.length} of ${total} scans`,
      averageRank <= 3 ? `Strong average rank: #${averageRank.toFixed(1)}` : `Average rank: #${averageRank.toFixed(1)}`,
      momentum >= .8 ? `${side === 'gainers' ? 'Gain' : 'Loss'} strengthened across scans` : 'Momentum monitored across scans',
      volumeGrowth >= .8 ? 'Increasing volume' : 'Volume trend considered',
      improvement >= .8 ? 'Rank improved over time' : 'Rank trend considered'
    ];
    const signal = confidence >= 80 ? `Strong ${side === 'gainers' ? 'Buy' : 'Sell'}` : confidence >= 60 ? (side === 'gainers' ? 'Buy' : 'Sell') : confidence >= 40 ? 'Watch' : 'Avoid';
    return { symbol, side: side === 'gainers' ? 'buy' : 'sell', signal, confidence, reasons, currentRank: latest.rank, currentChange: latest.change, rankTrend: ranks, changeTrend: points.map((p) => p.change), volumeTrend: volumes, raw: latest.raw };
  }).sort((a, b) => b.confidence - a.confidence || a.currentRank - b.currentRank);
}
export function buildRecommendations(scans) {
  return { buy: calculate(scans, 'gainers'), sell: calculate(scans, 'losers') };
}
