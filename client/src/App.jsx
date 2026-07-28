import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Empty, Recommendation, StockList, stocks } from './components';

const SCAN_TIMES = ['09:25', '09:35', '09:45', '09:55', '10:05', '10:15', '10:25'];
const clock = () => new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function nextScan(scans) { return SCAN_TIMES.find((time) => !scans.some((scan) => scan.time === time)) || 'Complete'; }

export default function App() {
  const [day, setDay] = useState(null); const [recommendations, setRecommendations] = useState({});
  const [page, setPage] = useState('home'); const [history, setHistory] = useState([]); const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [time, setTime] = useState(clock());
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { const [scans, recs] = await Promise.all([api.get('/scans'), api.get('/recommendations')]); setDay(scans.data); setRecommendations(recs.data); } catch (e) { setError(e.response?.data?.error || 'Could not connect to the scanner API.'); } finally { setLoading(false); } }, []);
  useEffect(() => { refresh(); const interval = setInterval(() => setTime(clock()), 1000); return () => clearInterval(interval); }, [refresh]);
  const latest = day?.scans?.at(-1); const next = nextScan(day?.scans || []);
  const manualScan = async () => { setBusy(true); setError(''); try { await api.post('/scan'); await refresh(); } catch (e) { setError(e.response?.data?.error || 'Scan failed.'); } finally { setBusy(false); } };
  const analyse = async () => { setBusy(true); try { const result = await api.get('/recommendations'); setRecommendations(result.data); } catch (e) { setError(e.response?.data?.error || 'Analysis failed.'); } finally { setBusy(false); } };
  const loadHistory = async () => { setPage('history'); try { setHistory((await api.get('/history')).data); } catch { setError('History could not be loaded.'); } };
  const exportJson = () => { const blob = new Blob([JSON.stringify(day, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `nse-scans-${day?.date || 'today'}.json`; a.click(); URL.revokeObjectURL(url); };
  const clear = async () => { if (!window.confirm("Clear today's scan data?")) return; setBusy(true); try { setDay((await api.delete('/today')).data); setRecommendations({}); } catch { setError('Could not clear today’s data.'); } finally { setBusy(false); } };
  const dayToShow = selected || day;
  return <main className="app-shell"><header><div><p className="eyebrow">PERSONAL MARKET RESEARCH</p><h1>NSE Momentum <em>Scanner</em></h1></div><button className="icon-button" onClick={refresh} aria-label="Refresh">↻</button></header>
    <nav><button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>Dashboard</button><button className={page === 'history' ? 'active' : ''} onClick={loadHistory}>History</button><button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>Settings</button></nav>
    {error && <div className="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    {loading ? <div className="loading">Loading market workspace…</div> : page === 'home' ? <Dashboard day={day} latest={latest} recommendations={recommendations} time={time} next={next} /> : page === 'history' ? <History history={history} selected={selected} setSelected={setSelected} day={dayToShow} /> : <Settings busy={busy} manualScan={manualScan} analyse={analyse} exportJson={exportJson} clear={clear} />}
    <footer>Confidence reflects observed momentum from collected scans — it is not a prediction or trading advice.</footer>
  </main>;
}
// src/App.jsx

function Dashboard({ day, latest, recommendations, time, next }) { 
  const scanCount = SCAN_TIMES.filter((scheduledTime) => day?.scans?.some((scan) => scan.time === scheduledTime)).length; 
  
  // Extract top 3 items safely
  const topBuys = Array.isArray(recommendations?.buy) ? recommendations.buy.slice(0, 3) : [];
  const topSells = Array.isArray(recommendations?.sell) ? recommendations.sell.slice(0, 3) : [];

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
          <span className="market-time">{next === 'Complete' ? 'Morning run complete' : 'Scheduled automatically'}</span>
        </div>
      </section>

      <section className="card progress">
        <div className="section-heading">
          <div><h2>Scan progress</h2><span>{day?.date || 'Today'}</span></div>
          <b>{scanCount}/{SCAN_TIMES.length}</b>
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

      <div className="two-column">
        <StockList title="Top Gainers" data={latest?.gainers} kind="gain"/>
        <StockList title="Top Losers" data={latest?.losers} kind="loss"/>
      </div>

      <section className="card recommendations">
        <div className="section-heading">
          <div><h2>Momentum recommendations</h2><span>Top 3 multi-factor analysis</span></div>
          <span className="spark">✦</span>
        </div>
        
        <div className="recommend-grid">
          {/* Top 3 Buy Recommendations */}
          {topBuys.length > 0 ? (
            topBuys.map((item) => <Recommendation key={item.symbol} item={item} />)
          ) : (
            <Recommendation item={null} />
          )}

          {/* Top 3 Sell Recommendations */}
          {topSells.length > 0 ? (
            topSells.map((item) => <Recommendation key={item.symbol} item={item} />)
          ) : (
            <Recommendation item={null} />
          )}
        </div>
      </section>
    </> 
  );
}
function History({ history, selected, setSelected, day }) { return <section className="history"><div className="section-title"><h2>Market history</h2><span>Previous saved sessions</span></div>{history.length ? <div className="history-list">{history.map((item) => <button key={item.date} className={selected?.date === item.date ? 'selected' : ''} onClick={() => setSelected(item)}><b>{item.date}</b><span>{item.scans?.length || 0} scans</span><i>›</i></button>)}</div> : <Empty text="No previous trading days have been archived yet."/>}{selected && <div className="detail"><h2>{day.date} scans</h2>{day.scans?.map((scan) => <div className="card scan-detail" key={scan.time}><h3>{scan.time}</h3><div><StockList title="Gainers" data={scan.gainers} kind="gain"/><StockList title="Losers" data={scan.losers} kind="loss"/></div></div>)}</div>}</section> }
function Settings({ busy, manualScan, analyse, exportJson, clear }) { return <section className="settings"><div className="section-title"><h2>Settings & tools</h2><span>Manage this device’s market data</span></div><button className="action primary" disabled={busy} onClick={manualScan}><span>◉</span><div><b>{busy ? 'Scanning…' : 'Manual scan'}</b><small>Fetch gainers and losers now</small></div><i>›</i></button><button className="action" disabled={busy} onClick={analyse}><span>✦</span><div><b>Run analysis</b><small>Recalculate momentum scores</small></div><i>›</i></button><button className="action" onClick={exportJson}><span>↓</span><div><b>Export JSON</b><small>Download today’s raw scan data</small></div><i>›</i></button><button className="action danger" disabled={busy} onClick={clear}><span>⌫</span><div><b>Clear today’s data</b><small>Remove current scans from this device</small></div><i>›</i></button></section> }
