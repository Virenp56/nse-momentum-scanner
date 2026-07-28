import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { fetchGainers, fetchLosers } from './nse.js';
import { getToday, getHistory, getDay, saveToday, clearToday } from './storage.js';
import { buildRecommendations } from './recommendations.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || '*'}));
app.use(express.json());
const scanTimes = ['09:25', '09:35', '09:45', '09:55', '10:05', '10:15', '10:25'];
let scanning = false;
const indiaTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

async function runScan(forcedTime) {
  if (scanning) throw new Error('A scan is already in progress.');
  scanning = true;
  try {
    const time = forcedTime || indiaTime();
    const day = await getToday();
    if (day.scans.some((scan) => scan.time === time)) return day;
    const [gainers, losers] = await Promise.all([fetchGainers(), fetchLosers()]);
    day.scans.push({ time, timestamp: new Date().toISOString(), gainers, losers });
    day.scans.sort((a, b) => a.time.localeCompare(b.time));
    if (time === '10:25' || scanTimes.every((scheduledTime) => day.scans.some((scan) => scan.time === scheduledTime))) day.recommendations = buildRecommendations(day.scans);
    await saveToday(day);
    return day;
  } finally { scanning = false; }
}
for (const time of scanTimes) {
  const [hour, minute] = time.split(':');
  cron.schedule(`${minute} ${hour} * * 1-5`, () => runScan(time).catch(console.error), { timezone: 'Asia/Kolkata' });
}

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/gainers', async (_, res, next) => { try { const day = await getToday(); res.json(day.scans.at(-1)?.gainers || await fetchGainers()); } catch (e) { next(e); } });
app.get('/api/losers', async (_, res, next) => { try { const day = await getToday(); res.json(day.scans.at(-1)?.losers || await fetchLosers()); } catch (e) { next(e); } });
app.post('/api/scan', async (req, res, next) => { try { res.json(await runScan(req.body?.time)); } catch (e) { next(e); } });
app.get('/api/scans', async (_, res, next) => { try { res.json(await getToday()); } catch (e) { next(e); } });
app.get('/api/recommendations', async (_, res, next) => { try { const day = await getToday(); res.json(day.recommendations?.buy ? day.recommendations : buildRecommendations(day.scans)); } catch (e) { next(e); } });
app.get('/api/history', async (_, res, next) => { try { res.json(await getHistory()); } catch (e) { next(e); } });
app.get('/api/history/:date', async (req, res, next) => { try { const day = await getDay(req.params.date); if (!day) return res.status(404).json({ error: 'Day not found' }); res.json(day); } catch (e) { next(e); } });
app.delete('/api/today', async (_, res, next) => { try { res.json(await clearToday()); } catch (e) { next(e); } });
app.use((err, _, res, __) => { console.error(err); res.status(500).json({ error: err.message || 'Unexpected server error' }); });
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`NSE Momentum API listening on ${port}`));
