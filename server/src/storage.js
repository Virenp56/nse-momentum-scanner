import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
const todayPath = path.join(dataDir, 'today.json');
const historyPath = path.join(dataDir, 'history.json');

const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const blankDay = () => ({ date: dateKey(), scans: [], recommendations: [] });

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function writeJson(file, data) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export async function getToday() {
  const today = await readJson(todayPath, blankDay());
  if (today.date === dateKey()) return today;
  // Preserve the preceding day before starting a fresh market day.
  if (today.scans?.length) await archiveDay(today);
  const next = blankDay();
  await writeJson(todayPath, next);
  return next;
}
export async function saveToday(day) { await writeJson(todayPath, day); }
export async function archiveDay(day) {
  const history = await readJson(historyPath, []);
  const withoutSameDay = history.filter((item) => item.date !== day.date);
  withoutSameDay.unshift(day);
  await writeJson(historyPath, withoutSameDay.slice(0, 90));
}
export async function getHistory() { return readJson(historyPath, []); }
export async function getDay(date) {
  const today = await getToday();
  if (!date || date === today.date) return today;
  return (await getHistory()).find((item) => item.date === date) || null;
}
export async function clearToday() { const day = blankDay(); await saveToday(day); return day; }
