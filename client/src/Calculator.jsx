// src/Calculator.jsx
import { useState, useMemo } from 'react';

// Round to NSE tick size (₹0.05)
function roundToTick(val, tick = 0.05) {
  return Math.round(val / tick) * tick;
}

export function Calculator({ defaultMarket = 'nse' }) {
  const [market, setMarket] = useState(defaultMarket); // 'nse' | 'crypto'
  const [side, setSide] = useState('buy'); // 'buy' | 'sell'
  const [capital, setCapital] = useState(20000);
  const [entryPrice, setEntryPrice] = useState(45.54);
  const [targetPct, setTargetPct] = useState(0.5);
  const [stopLossPct, setStopLossPct] = useState(1.0);
  const [leverage, setLeverage] = useState(5);

  const calc = useMemo(() => {
    const cap = Number(capital) || 0;
    const entry = Number(entryPrice) || 0;
    const lev = Number(leverage) || 1;
    const tpPct = Number(targetPct) || 0;
    const slPct = Number(stopLossPct) || 0;

    if (cap <= 0 || entry <= 0) {
      return null;
    }

    const totalBuyingPower = cap * lev;
    const isCrypto = market === 'crypto';

    // 1. Quantity & Position Size
    let quantity = isCrypto
      ? totalBuyingPower / entry
      : Math.floor(totalBuyingPower / entry);

    const positionSize = quantity * entry;
    const marginUtilized = positionSize / lev;

    // 2. TP & SL Prices
    let rawTpPrice = side === 'buy'
      ? entry * (1 + tpPct / 100)
      : entry * (1 - tpPct / 100);

    let rawSlPrice = side === 'buy'
      ? entry * (1 - slPct / 100)
      : entry * (1 + slPct / 100);

    const tpPrice = isCrypto ? rawTpPrice : roundToTick(rawTpPrice, 0.05);
    const slPrice = isCrypto ? rawSlPrice : roundToTick(rawSlPrice, 0.05);

    // 3. Gross P&L
    const grossProfit = side === 'buy'
      ? (tpPrice - entry) * quantity
      : (entry - tpPrice) * quantity;

    const grossLoss = side === 'buy'
      ? (slPrice - entry) * quantity
      : (entry - slPrice) * quantity;

    // 4. Brokerage & Regulatory Charges
    let profitCharges = 0;
    let lossCharges = 0;

    if (!isCrypto) {
      // --- Groww NSE Intraday MIS Charges ---
      const buyTurnover = positionSize;
      const targetSellTurnover = quantity * tpPrice;
      const slSellTurnover = quantity * slPrice;

      const calcNseCharges = (sellTurnover) => {
        // Groww Brokerage: ₹20 or 0.05% per executed order (whichever is lower)
        const buyBrokerage = Math.min(20, buyTurnover * 0.0005);
        const sellBrokerage = Math.min(20, sellTurnover * 0.0005);
        const totalBrokerage = buyBrokerage + sellBrokerage;

        // STT / CTT: 0.025% on sell turnover (Intraday Equity)
        const stt = sellTurnover * 0.00025;

        // NSE Exchange Transaction Charge: 0.00297% on both legs
        const txnCharge = (buyTurnover + sellTurnover) * 0.0000297;

        // SEBI Charges: ₹10 per crore (0.0001%)
        const sebiCharge = (buyTurnover + sellTurnover) * 0.000001;

        // Stamp Duty: 0.003% on buy turnover
        const stampDuty = buyTurnover * 0.00003;

        // GST: 18% on (Brokerage + Exchange Txn + SEBI)
        const gst = (totalBrokerage + txnCharge + sebiCharge) * 0.18;

        return totalBrokerage + stt + txnCharge + sebiCharge + stampDuty + gst;
      };

      profitCharges = calcNseCharges(targetSellTurnover);
      lossCharges = calcNseCharges(slSellTurnover);
    } else {
      // --- Binance Spot / Futures Charges (approx. 0.05% per leg) ---
      const feeRate = 0.0005; // 0.05%
      profitCharges = (positionSize + quantity * tpPrice) * feeRate;
      lossCharges = (positionSize + quantity * slPrice) * feeRate;
    }

    const netProfit = grossProfit - profitCharges;
    const netLoss = grossLoss - lossCharges;
    const rewardRiskRatio = slPct > 0 ? (tpPct / slPct).toFixed(2) : '—';

    return {
      quantity,
      positionSize,
      marginUtilized,
      tpPrice,
      slPrice,
      grossProfit,
      grossLoss,
      profitCharges,
      lossCharges,
      netProfit,
      netLoss,
      rewardRiskRatio,
      currency: isCrypto ? '$' : '₹',
    };
  }, [market, side, capital, entryPrice, targetPct, stopLossPct, leverage]);

  return (
    <div className="card calculator-card">
      <div className="section-heading">
        <div>
          <h2>Trade & Position Calculator</h2>
          <span>Instant sizing, SL/TP levels & net regulatory fee calculation</span>
        </div>
        <div className="calc-market-switch">
          <button
            className={`chip ${market === 'nse' ? 'active' : ''}`}
            onClick={() => {
              setMarket('nse');
              setLeverage(5);
            }}
          >
            Groww NSE (₹)
          </button>
          <button
            className={`chip ${market === 'crypto' ? 'active' : ''}`}
            onClick={() => {
              setMarket('crypto');
              setLeverage(1);
            }}
          >
            Crypto ($)
          </button>
        </div>
      </div>

      <div className="calculator-layout">
        {/* Input Form */}
        <div className="calc-inputs-grid">
          <div className="form-group">
            <label>Trade Direction</label>
            <div className="side-toggle">
              <button
                className={`side-btn ${side === 'buy' ? 'active-buy' : ''}`}
                onClick={() => setSide('buy')}
              >
                Buy (Long)
              </button>
              <button
                className={`side-btn ${side === 'sell' ? 'active-sell' : ''}`}
                onClick={() => setSide('sell')}
              >
                Sell (Short)
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Wallet Capital ({market === 'crypto' ? '$' : '₹'})</label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(parseFloat(e.target.value) || 0)}
              min="0"
              step="any"
            />
          </div>

          <div className="form-group">
            <label>Entry Price ({market === 'crypto' ? '$' : '₹'})</label>
            <input
              type="number"
              value={entryPrice}
              onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
              min="0"
              step="any"
            />
          </div>

          <div className="form-group">
            <label>Leverage</label>
            <input
              type="number"
              value={leverage}
              onChange={(e) => setLeverage(parseFloat(e.target.value) || 1)}
              min="1"
              max={market === 'nse' ? 5 : 50}
            />
          </div>

          <div className="form-group">
            <label>Target % (TP)</label>
            <input
              type="number"
              value={targetPct}
              onChange={(e) => setTargetPct(parseFloat(e.target.value) || 0)}
              step="0.1"
              min="0"
            />
          </div>

          <div className="form-group">
            <label>Stop Loss % (SL)</label>
            <input
              type="number"
              value={stopLossPct}
              onChange={(e) => setStopLossPct(parseFloat(e.target.value) || 0)}
              step="0.1"
              min="0"
            />
          </div>
        </div>

        {/* Results Overview */}
        {calc ? (
          <div className="calc-results-panel">
            <div className="calc-metrics-row">
              <div className="metric-box">
                <small>Shares / Quantity</small>
                <b>{market === 'crypto' ? calc.quantity.toFixed(4) : calc.quantity.toLocaleString('en-IN')}</b>
              </div>
              <div className="metric-box">
                <small>Total Position Size</small>
                <b>{calc.currency}{calc.positionSize.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</b>
              </div>
              <div className="metric-box">
                <small>Margin Utilized</small>
                <b>{calc.currency}{calc.marginUtilized.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</b>
              </div>
              <div className="metric-box">
                <small>Risk : Reward</small>
                <b style={{ color: '#60a5fa' }}>1 : {calc.rewardRiskRatio}</b>
              </div>
            </div>

            <div className="calc-levels-row">
              <div className="level-card target">
                <span className="level-tag">TARGET (+{targetPct}%)</span>
                <h3>{calc.currency}{calc.tpPrice.toFixed(market === 'crypto' && calc.tpPrice < 1 ? 4 : 2)}</h3>
                <div className="pnl-breakdown">
                  <span>Gross Gain: <b>+{calc.currency}{calc.grossProfit.toFixed(2)}</b></span>
                  <span>Est. Charges: <b>-{calc.currency}{calc.profitCharges.toFixed(2)}</b></span>
                  <span className="net-pnl positive">Net Profit: +{calc.currency}{calc.netProfit.toFixed(2)}</span>
                </div>
              </div>

              <div className="level-card stoploss">
                <span className="level-tag red">STOP LOSS (-{stopLossPct}%)</span>
                <h3>{calc.currency}{calc.slPrice.toFixed(market === 'crypto' && calc.slPrice < 1 ? 4 : 2)}</h3>
                <div className="pnl-breakdown">
                  <span>Gross Loss: <b>{calc.currency}{calc.grossLoss.toFixed(2)}</b></span>
                  <span>Est. Charges: <b>-{calc.currency}{calc.lossCharges.toFixed(2)}</b></span>
                  <span className="net-pnl negative">Net Loss: {calc.currency}{calc.netLoss.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <p className="calc-footnote">
              {market === 'nse'
                ? '* Charges include Groww Intraday MIS brokerage (₹20 cap), STT (0.025% on sell), NSE turnover fees, Stamp Duty, and 18% GST.'
                : '* Crypto charges estimated at 0.05% per execution leg.'}
            </p>
          </div>
        ) : (
          <div className="empty">Enter capital and entry price to compute order specifications.</div>
        )}
      </div>
    </div>
  );
}