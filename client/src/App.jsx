// src/App.jsx
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Empty, Recommendation } from './components';

const SCAN_TIMES = ['09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00'];

const clock = () =>
  new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function nextScan(scans) {
  return SCAN_TIMES.find((time) => !scans.some((scan) => scan.time === time)) || 'Complete';
}

export default function App() {
  const [day, setDay] = useState(null);
  const [recommendations, setRecommendations] = useState({});
  const [page, setPage] = useState('home'); // 'home' | 'history' | 'settings'
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [error, setError] = useState('');
  const [time, setTime] = useState(clock());

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
    const interval = setInterval(() => setTime(clock()), 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const next = nextScan(day?.scans || []);

  const manualScan = async () => {
    setBusy(true);
    setScanStatus('Fetching live NSE market data…');
    setError('');
    try {
      await api.post('/scan');
      setScanStatus('Analyzing Top 10 stocks via 1-min charts, RSI & EMA…');
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
    setScanStatus('Running technical evaluation across Top 10 candidates…');
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
    a.download = `nse-scans-${day?.date || 'today'}.json`;
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
          <p className="eyebrow">PERSONAL MARKET RESEARCH</p>
          <h1>NSE Momentum <em>Scanner</em></h1>
        </div>
        <button className="icon-button" onClick={refresh} aria-label="Refresh">
          ↻
        </button>
      </header>

      {/* Navigation Tabs */}
      <nav>
        <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>
          Dashboard
        </button>
        <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}>
          History
        </button>
        <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>
          Settings
        </button>
      </nav>

      {/* Dynamic Scan Progress Banner */}
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
        />
      ) : page === 'history' ? (
        <History scans={day?.scans || []} />
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

function Dashboard({ day, recommendations, time, next }) {
  const scanCount = SCAN_TIMES.filter((scheduledTime) =>
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
          <strong>{scanCount ? 'Tracking live' : 'Waiting for first scan'}</strong>
          <span className="market-time">IST · {time}</span>
        </div>
        <div className="card market">
          <span className="label">NEXT SCAN</span>
          <strong>{next}</strong>
          <span className="market-time">
            {next === 'Complete' ? 'Morning run complete' : 'Scheduled automatically (15m interval)'}
          </span>
        </div>
      </section>

      <section className="card progress">
        <div className="section-heading">
          <div>
            <h2>Scan progress</h2>
            <span>{day?.date || 'Today'}</span>
          </div>
          <b>
            {scanCount}/{SCAN_TIMES.length}
          </b>
        </div>
        <div className="scan-steps">
          {SCAN_TIMES.map((time) => {
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
            <h2>Momentum recommendations</h2>
            <span>Top 3 F&O vs. Top 3 Overall (Filtered from Top 10 Analysis)</span>
          </div>
          <span className="spark">✦</span>
        </div>

        <div className="dual-rec-container">
          <div className="rec-group">
            <div className="rec-group-title">
              <h3>F&O Top 3</h3>
              <span className="tag fo-tag">Zero Circuit Risk</span>
            </div>
            <div className="recommend-grid">
              {foTop3.length > 0 ? (
                foTop3.map((item) => <Recommendation key={`fo-${item.symbol}`} item={item} />)
              ) : (
                <Empty text="No F&O recommendations analyzed yet." />
              )}
            </div>
          </div>

          <div className="rec-group">
            <div className="rec-group-title">
              <h3>Overall Top 3</h3>
              <span className="tag overall-tag">Max Momentum</span>
            </div>
            <div className="recommend-grid">
              {overallTop3.length > 0 ? (
                overallTop3.map((item) => <Recommendation key={`all-${item.symbol}`} item={item} />)
              ) : (
                <Empty text="No overall recommendations analyzed yet." />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function History({ scans }) {
  const [selectedTime, setSelectedTime] = useState(scans[0]?.time || null);

  useEffect(() => {
    if (scans.length > 0 && !selectedTime) {
      setSelectedTime(scans[scans.length - 1].time);
    }
  }, [scans, selectedTime]);

  if (!scans || scans.length === 0) {
    return (
      <section className="card history-card">
        <div className="section-heading">
          <div>
            <h2>Scan History</h2>
            <span>Historical time-slot snapshots</span>
          </div>
        </div>
        <Empty text="No scans recorded yet for today." />
      </section>
    );
  }

  const activeScan = scans.find((s) => s.time === selectedTime) || scans[scans.length - 1];

  // Extract recommendations generated specifically at this time slot
  const recs = activeScan?.recommendations || {};
  const foTop3 = Array.isArray(recs.foTop3) ? recs.foTop3.slice(0, 3) : [];
  const overallTop3 = Array.isArray(recs.overallTop3) ? recs.overallTop3.slice(0, 3) : [];

  return (
    <section className="card history-card">
      <div className="section-heading">
        <div>
          <h2>Scan History</h2>
          <span>View momentum recommendations generated at each time slot</span>
        </div>
        <span className="history-badge">{scans.length} Scans Saved</span>
      </div>

      {/* Time Slot Selector Chips */}
      <div className="time-chips-container">
        <label className="time-chips-label">SELECT SCAN TIME:</label>
        <div className="time-chips">
          {scans.map((scan) => (
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

      {/* Recommended Stocks for Selected Time Slot */}
      {activeScan && (
        <div className="history-details">
          <div className="history-timestamp-bar">
            <div>
              <span className="label">EVALUATED TIME SLOT</span>
              <h3>
                <b>{activeScan.time} IST</b> Snapshot
              </h3>
            </div>
            <span className="history-time-meta">
              Captured: {new Date(activeScan.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>

          <div className="dual-rec-container">
            {/* F&O Category Top 3 at Selected Time */}
            <div className="rec-group">
              <div className="rec-group-title">
                <h3>F&O Top 3</h3>
                <span className="tag fo-tag">{activeScan.time} Slot</span>
              </div>
              <div className="recommend-grid">
                {foTop3.length > 0 ? (
                  foTop3.map((item) => (
                    <Recommendation key={`hist-fo-${item.symbol}-${activeScan.time}`} item={item} />
                  ))
                ) : (
                  <Empty text={`No F&O recommendations analyzed for ${activeScan.time}.`} />
                )}
              </div>
            </div>

            {/* Overall Category Top 3 at Selected Time */}
            <div className="rec-group">
              <div className="rec-group-title">
                <h3>Overall Top 3</h3>
                <span className="tag overall-tag">{activeScan.time} Slot</span>
              </div>
              <div className="recommend-grid">
                {overallTop3.length > 0 ? (
                  overallTop3.map((item) => (
                    <Recommendation key={`hist-all-${item.symbol}-${activeScan.time}`} item={item} />
                  ))
                ) : (
                  <Empty text={`No overall recommendations analyzed for ${activeScan.time}.`} />
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
          <small>Recalculate momentum scores across Top 10</small>
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