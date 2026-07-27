import axios from 'axios';

const baseURL = 'https://www.nseindia.com';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-IN,en;q=0.9',
  Referer: 'https://www.nseindia.com/market-data/live-market-indices'
};
let cookie = '';

async function refreshSession() {
  const response = await axios.get(baseURL, { headers, timeout: 15000 });
  cookie = (response.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
}
async function request(index, retried = false) {
  try {
    if (!cookie) await refreshSession();
    const response = await axios.get(`${baseURL}/api/live-analysis-variations?index=${index}`, {
      headers: { ...headers, Cookie: cookie }, timeout: 20000
    });
    return response.data;
  } catch (error) {
    if (!retried) { cookie = ''; return request(index, true); }
    const status = error.response?.status;
    throw new Error(`NSE data is unavailable${status ? ` (HTTP ${status})` : ''}. Please try again shortly.`);
  }
}

export const fetchGainers = () => request('gainers');
export const fetchLosers = () => request('losers');
