// src/App.jsx
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Empty, Recommendation } from './components';
import { Calculator } from './Calculator';

export const NSE_SCAN_TIMES = [
  "09:45", "10:00", "10:15", "10:30", "10:45",
  "12:45", "13:00", "13:15", "13:30", "13:45"
];

export const CRYPTO_SCAN_TIMES = [
  "20:00", "20:15", "20:30", "20:45", "21:00", "21:15", "21:30", "21:45", "22:00"
];

const clock = () =>
  new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const currentIstHourMinute = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());

function getActiveScanTimes(overrideMarket) {
  if (overrideMarket === 'crypto') return CRYPTO_SCAN_TIMES;
  if (overrideMarket === 'nse') return NSE_SCAN_TIMES;
  
  // Auto-detect based on IST time (>= 18:00 is Crypto Evening Session)
  const current = currentIstHourMinute();
  return current >= "18:00" ? CRYPTO_SCAN_TIMES : NSE_SCAN_TIMES;
}

function nextScan(scans, activeSchedule) {
  return activeSchedule.find((time) => !scans.some((scan) => scan.time === time)) || 'Complete';
}

export default function App() {
  const [day, setDay] = useState(null);
  const [recommendations, setRecommendations] = useState({});
  const [page, setPage] = useState('home');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [error, setError] = useState('');
  const [time, setTime] = useState(clock());
  const [activeMarket, setActiveMarket] = useState(currentIstHourMinute() >= "18:00" ? 'crypto' : 'nse');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [scans, recs] = await Promise.all([
        api.get('/scans'),
        api.get('/recommendations'),
      ]);
      setDay(scans.data);
      setRecommendations(recs.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not connect to the scanner API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      setTime(clock());
    }, 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const activeSchedule = getActiveScanTimes(activeMarket);
  const next = nextScan(day?.scans || [], activeSchedule);

  const manualScan = async () => {
    setBusy(true);
    setScanStatus(activeMarket === 'crypto' ? 'Fetching Binance Crypto Data…' : 'Fetching live NSE market data…');
    setError('');
    try {
      await api.post('/scan');
      setScanStatus('Running technical evaluation & RSI/EMA…');
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || 'Scan failed.');
    } finally {
      setBusy(false);
      setScanStatus('');
    }
  };

  const analyse = async () => {
    setBusy(true);
    setScanStatus('Running technical evaluation…');
    try {
      const result = await api.get('/recommendations');
      setRecommendations(result.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Analysis failed.');
    } finally {
      setBusy(false);
      setScanStatus('');
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(day, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market-scans-${day?.date || 'today'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clear = async () => {
    if (!window.confirm("Clear today's scan data?")) return;
    setBusy(true);
    try {
      setDay((await api.delete('/today')).data);
      setRecommendations({});
    } catch {
      setError('Could not clear today’s data.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="eyebrow">{activeMarket === 'crypto' ? 'BINANCE CRYPTO MOMENTUM' : 'PERSONAL MARKET RESEARCH'}</p>
          <h1>{activeMarket === 'crypto' ? 'Crypto Momentum ' : 'NSE Momentum '}<em>Scanner</em></h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            className={`chip ${activeMarket === 'nse' ? 'active' : ''}`} 
            onClick={() => setActiveMarket('nse')}
          >
            NSE
          </button>
          <button 
            className={`chip ${activeMarket === 'crypto' ? 'active' : ''}`} 
            onClick={() => setActiveMarket('crypto')}
          >
            Crypto
          </button>
        
          <button className="icon-button" onClick={refresh} aria-label="Refresh">
            ↻
          </button>
        </div>
      </header>

      <nav>
        <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>
          Dashboard
        </button>
        <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}>
          History
        </button>
        <button className={page === 'calc' ? 'active' : ''} onClick={() => setPage('calc')}>
          Calculator
        </button>
        <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>
          Settings
        </button>
      </nav>

      {busy && (
        <div className="progress-banner">
          <div className="progress-text">
            <span>{scanStatus || 'Processing market scan...'}</span>
            <span className="spinner">◌</span>
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill" />
          </div>
        </div>
      )}

      {error && (
        <div className="alert">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading market workspace…</div>
      ) : page === 'home' ? (
        <Dashboard
          day={day}
          recommendations={recommendations}
          time={time}
          next={next}
          activeSchedule={activeSchedule}
          activeMarket={activeMarket}
        />
      ) : page === 'history' ? (
        <History 
          scans={day?.scans || []} 
          activeSchedule={activeSchedule} 
          activeMarket={activeMarket}
        />
      ) : page === 'calc' ? (
        <Calculator defaultMarket={activeMarket} />
      ) : (
        <Settings
          busy={busy}
          manualScan={manualScan}
          analyse={analyse}
          exportJson={exportJson}
          clear={clear}
        />
      )}

      <footer>
        Confidence reflects observed momentum from collected scans — it is not a prediction or trading advice.
      </footer>
    </main>
  );
}

function StrategyGuide({ activeMarket }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card strategy-card">
      <div className="section-heading strategy-toggle" onClick={() => setOpen(!open)}>
        <div>
          <span className="eyebrow strategy-badge">EXECUTION PLAYBOOK</span>
          <h2>{activeMarket === 'crypto' ? 'Crypto 15m Momentum Playbook' : 'NSE Intraday Strategy & Rules'}</h2>
        </div>
        <button className="collapse-btn">{open ? '▲ Hide' : '▼ View Strategy'}</button>
      </div>

      {open && (
        <div className="strategy-body">
          {activeMarket === 'crypto' ? (
            <div className="strategy-grid">
              <div className="strategy-step highlight">
                <span className="step-badge green">20:00 - 20:30</span>
                <h4>1. Evening Surge</h4>
                <p>Identify coins outperforming BTC with RSI between 55–72. Target +3.0%, SL -1.5%.</p>
              </div>
              <div className="strategy-step">
                <span className="step-badge">21:00</span>
                <h4>2. High Volume Break</h4>
                <p>Filter tokens with 24h Volume &gt; $5M breaking above 15m EMA 9/20.</p>
              </div>
              <div className="strategy-step danger">
                <span className="step-badge red">22:00</span>
                <h4>3. Session Close</h4>
                <p>Lock profits and trail stops. Avoid entering fresh scalps into low liquidity hours.</p>
              </div>
            </div>
          ) : (
            <div className="strategy-grid">
              <div className="strategy-step">
                <span className="step-badge">09:45 AM</span>
                <h4>1. Observation</h4>
                <p>Do <b>not</b> buy immediately. Let the opening noise settle and record baseline VWAP.</p>
              </div>
              <div className="strategy-step highlight">
                <span className="step-badge green">10:30 AM</span>
                <h4>2. Primary Entry</h4>
                <p>Execute entry on Top AI picks with <b>Streak ≥ 2</b> that hold above VWAP. Target +1.0%, SL -0.5%.</p>
              </div>
              <div className="strategy-step danger">
                <span className="step-badge red">13:00 / 1:00 PM</span>
                <h4>3. Trailing & Exit</h4>
                <p><b>No fresh entries.</b> Trail stop-loss to entry price. Close MIS positions before 3:15 PM.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Dashboard({ day, recommendations, time, next, activeSchedule, activeMarket }) {
  // Only count scans that belong to the active schedule
  const scanCount = activeSchedule.filter((scheduledTime) =>
    day?.scans?.some((scan) => scan.time === scheduledTime)
  ).length;

  const foTop3 = Array.isArray(recommendations?.foTop3)
    ? recommendations.foTop3.slice(0, 3)
    : [];
  const overallTop3 = Array.isArray(recommendations?.overallTop3)
    ? recommendations.overallTop3.slice(0, 3)
    : [];

  return (
    <>
      <section className="status-grid">
        <div className="card market">
          <span className="label">MARKET STATUS</span>
          <strong>{scanCount ? `Tracking live (${activeMarket.toUpperCase()})` : 'Waiting for session scan'}</strong>
          <span className="market-time">IST · {time}</span>
        </div>
        <div className="card market">
          <span className="label">NEXT SCAN</span>
          <strong>{next}</strong>
          <span className="market-time">
            {next === 'Complete' ? 'Session run complete' : 'Scheduled automatically'}
          </span>
        </div>
      </section>

      <StrategyGuide activeMarket={activeMarket} />

      <section className="card progress">
        <div className="section-heading">
          <div>
            <h2>{activeMarket === 'crypto' ? 'Crypto Scan Progress (8:00 - 10:00 PM)' : 'NSE Scan Progress'}</h2>
            <span>{day?.date || 'Today'}</span>
          </div>
          <b>
            {scanCount}/{activeSchedule.length}
          </b>
        </div>
        <div className="scan-steps">
          {activeSchedule.map((time) => {
            const scan = day?.scans?.find((item) => item.time === time);
            return (
              <div key={time} className={scan ? 'done' : ''}>
                <i>{scan ? '✓' : '·'}</i>
                <span>{time}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card recommendations">
        <div className="section-heading">
          <div>
            <h2>{activeMarket === 'crypto' ? 'Crypto Momentum Picks' : 'Momentum recommendations'}</h2>
            <span>{activeMarket === 'crypto' ? 'Top High Volume vs Outperforming Candidates' : 'Top 3 F&O vs. Top 3 Overall'}</span>
          </div>
          <span className="spark">✦</span>
        </div>

        <div className="dual-rec-container">
          <div className="rec-group">
            <div className="rec-group-title">
              <h3>{activeMarket === 'crypto' ? 'Top Momentum Alts' : 'F&O Top 3'}</h3>
              <span className="tag fo-tag">{activeMarket === 'crypto' ? 'High Volume' : 'Zero Circuit Risk'}</span>
            </div>
            <div className="recommend-grid">
              {foTop3.length > 0 ? (
                foTop3.map((item) => <Recommendation key={`rec-1-${item.symbol}`} item={item} />)
              ) : (
                <Empty text={`No ${activeMarket.toUpperCase()} recommendations analyzed yet.`} />
              )}
            </div>
          </div>

          <div className="rec-group">
            <div className="rec-group-title">
              <h3>{activeMarket === 'crypto' ? 'Trend Outperformers' : 'Overall Top 3'}</h3>
              <span className="tag overall-tag">Max Momentum</span>
            </div>
            <div className="recommend-grid">
              {overallTop3.length > 0 ? (
                overallTop3.map((item) => <Recommendation key={`rec-2-${item.symbol}`} item={item} />)
              ) : (
                <Empty text={`No ${activeMarket.toUpperCase()} overall recommendations analyzed yet.`} />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function History({ scans, activeSchedule, activeMarket }) {
  // Filter history chips to ONLY show time slots matching the active schedule
  const visibleScans = scans.filter((s) => activeSchedule.includes(s.time));
  const [selectedTime, setSelectedTime] = useState(visibleScans[0]?.time || null);

  useEffect(() => {
    if (visibleScans.length > 0) {
      // If current selected time is not part of this session, select the latest session scan
      if (!visibleScans.some((s) => s.time === selectedTime)) {
        setSelectedTime(visibleScans[visibleScans.length - 1].time);
      }
    }
  }, [visibleScans, selectedTime]);

  if (!visibleScans || visibleScans.length === 0) {
    return (
      <section className="card history-card">
        <div className="section-heading">
          <div>
            <h2>{activeMarket.toUpperCase()} Scan History</h2>
            <span>Historical time-slot snapshots</span>
          </div>
        </div>
        <Empty text={`No ${activeMarket.toUpperCase()} scans recorded yet today.`} />
      </section>
    );
  }

  const activeScan = visibleScans.find((s) => s.time === selectedTime) || visibleScans[visibleScans.length - 1];
  const recs = activeScan?.recommendations || {};
  const foTop3 = Array.isArray(recs.foTop3) ? recs.foTop3.slice(0, 3) : [];
  const overallTop3 = Array.isArray(recs.overallTop3) ? recs.overallTop3.slice(0, 3) : [];

  return (
    <section className="card history-card">
      <div className="section-heading">
        <div>
          <h2>{activeMarket.toUpperCase()} Scan History</h2>
          <span>View recommendations generated at each time slot</span>
        </div>
        <span className="history-badge">{visibleScans.length} Scans Saved</span>
      </div>

      <div className="time-chips-container">
        <label className="time-chips-label">SELECT {activeMarket.toUpperCase()} TIME SLOT:</label>
        <div className="time-chips">
          {visibleScans.map((scan) => (
            <button
              key={scan.time}
              className={`chip ${scan.time === activeScan?.time ? 'active' : ''}`}
              onClick={() => setSelectedTime(scan.time)}
            >
              <span>{scan.time}</span>
              {scan.time === activeScan?.time && <i className="chip-dot" />}
            </button>
          ))}
        </div>
      </div>

      {activeScan && (
        <div className="history-details">
          <div className="history-timestamp-bar">
            <div>
              <span className="label">EVALUATED TIME SLOT</span>
              <h3>
                <b>{activeScan.time} IST</b> ({activeMarket.toUpperCase()})
              </h3>
            </div>
            <span className="history-time-meta">
              Captured: {new Date(activeScan.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>

          <div className="dual-rec-container">
            <div className="rec-group">
              <div className="rec-group-title">
                <h3>{activeMarket === 'crypto' ? 'Top Momentum' : 'F&O Top 3'}</h3>
                <span className="tag fo-tag">{activeScan.time} Slot</span>
              </div>
              <div className="recommend-grid">
                {foTop3.length > 0 ? (
                  foTop3.map((item) => (
                    <Recommendation key={`hist-1-${item.symbol}-${activeScan.time}`} item={item} />
                  ))
                ) : (
                  <Empty text={`No picks analyzed for ${activeScan.time}.`} />
                )}
              </div>
            </div>

            <div className="rec-group">
              <div className="rec-group-title">
                <h3>{activeMarket === 'crypto' ? 'Trend Outperformers' : 'Overall Top 3'}</h3>
                <span className="tag overall-tag">{activeScan.time} Slot</span>
              </div>
              <div className="recommend-grid">
                {overallTop3.length > 0 ? (
                  overallTop3.map((item) => (
                    <Recommendation key={`hist-2-${item.symbol}-${activeScan.time}`} item={item} />
                  ))
                ) : (
                  <Empty text={`No picks analyzed for ${activeScan.time}.`} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Settings({ busy, manualScan, analyse, exportJson, clear }) {
  return (
    <section className="settings">
      <div className="section-title">
        <h2>Settings & tools</h2>
        <span>Manage this device’s market data</span>
      </div>
      <button className="action primary" disabled={busy} onClick={manualScan}>
        <span>◉</span>
        <div>
          <b>{busy ? 'Scanning…' : 'Manual scan'}</b>
          <small>Fetch gainers and losers now</small>
        </div>
        <i>›</i>
      </button>
      <button className="action" disabled={busy} onClick={analyse}>
        <span>✦</span>
        <div>
          <b>Run analysis</b>
          <small>Recalculate momentum scores across candidates</small>
        </div>
        <i>›</i>
      </button>
      <button className="action" onClick={exportJson}>
        <span>↓</span>
        <div>
          <b>Export JSON</b>
          <small>Download today’s raw scan data</small>
        </div>
        <i>›</i>
      </button>
      <button className="action danger" disabled={busy} onClick={clear}>
        <span>⌫</span>
        <div>
          <b>Clear today’s data</b>
          <small>Remove current scans from this device</small>
        </div>
        <i>›</i>
      </button>
    </section>
  );
}