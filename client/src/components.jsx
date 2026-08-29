const value = (row, keys) => keys.map((key) => row?.[key]).find((item) => item !== undefined && item !== null);
export const number = (item) => Number(String(item ?? 0).replace(/,/g, '')) || 0;

export function stocks(payload) {
  // Extract potential target
  const candidate = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.NIFTY?.data)
    ? payload.NIFTY.data
    : Array.isArray(payload?.NIFTY)
    ? payload.NIFTY
    : [];

  // Guarantee candidate is an array
  const rows = Array.isArray(candidate) ? candidate : [];

  return rows.slice(0, 10).map((row, index) => ({
    name: value(row, ['symbol', 'companyName', 'identifier']) || '—',
    rank: number(value(row, ['rank'])) || index + 1,
    change: number(value(row, ['pChange', 'perChange', 'percentChange', 'change'])),
    volume: number(value(row, ['totalTradedVolume', 'volume'])),
  }));
}

export function StockList({ title, data, kind }) {
  const rows = stocks(data);
  return (
    <section className="card stock-card">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <span>Top 10</span>
        </div>
        <span className={`dot ${kind}`} />
      </div>
      {rows.length ? (
        <div className="stock-list">
          {rows.map((row) => (
            <div className="stock-row" key={`${row.name}-${row.rank}`}>
              <span className="rank">{row.rank}</span>
              <b>{row.name}</b>
              <span className={kind === 'gain' ? 'positive' : 'negative'}>
                {row.change >= 0 ? '+' : ''}
                {row.change.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="No scan data yet" />
      )}
    </section>
  );
}

export function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

// src/components.jsx

export function Recommendation({ item }) {
  if (!item) return <Empty text="No recommendations available." />;
  
  const tone = item.side === 'buy' || !item.side ? 'gain' : 'loss';
  const isCrypto = item.raw?.isCrypto || false;
  const currency = isCrypto ? '$' : '₹';
  
  const entryPrice = Number(item.raw?.ltp || 0);
  const targetPct = isCrypto ? 1.03 : 1.01;
  const slPct = isCrypto ? 0.985 : 0.995;

  const targetPrice = (entryPrice * targetPct).toFixed(entryPrice < 1 ? 4 : 2);
  const stopLossPrice = (entryPrice * slPct).toFixed(entryPrice < 1 ? 4 : 2);
  const displayEntry = entryPrice < 1 ? entryPrice.toFixed(4) : entryPrice.toFixed(2);

  return (
    <article className="recommendation">
      <div className="recommendation-top">
        <div>
          <span className={`pill ${tone}`}>{item.signal}</span>
          <h3>{item.symbol}</h3>
          <small>
            {item.currentChange >= 0 ? '+' : ''}{item.currentChange?.toFixed(2)}%
          </small>
        </div>
        <div className={`score ${tone}`}>
          <b>{item.confidence}</b>
          <small>confidence</small>
        </div>
      </div>

      {entryPrice > 0 && (
        <div className="target-levels">
          <div>
            <small>Entry</small>
            <b>{currency}{displayEntry}</b>
          </div>
          <div>
            <small>Target</small>
            <b className="pos">{currency}{targetPrice}</b>
          </div>
          <div>
            <small>SL</small>
            <b className="neg">{currency}{stopLossPrice}</b>
          </div>
        </div>
      )}

      <ul>
        {item.reasons?.slice(0, 3).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </article>
  );
}