# NSE Momentum Scanner

A personal-use dashboard that records NSE top gainers and losers in the first market hour, then ranks observed momentum from multiple scans. It does not place trades or predict future market movement.

## Project layout

- `client/` — React + Vite dashboard, ready for Netlify
- `server/` — Express API, NSE session handling, cron scheduler, and JSON storage, ready for Railway
- `server/data/` — runtime `today.json` and `history.json` files (created automatically)

## Local setup

1. Install Node.js 20+.
2. From the repository root, run `npm install` and then `npm run install:all`.
3. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env` if you need different URLs.
4. Run `npm run dev`.
5. Open `http://localhost:5173`.

The API runs on port `4000`. NSE calls are made only by the server, which establishes the required NSE cookies and browser-like headers.

## Scheduled scans

Weekdays in the `Asia/Kolkata` timezone: 09:30, 09:45, 10:00, and 10:15. A time is saved once only, even if cron is triggered more than once. Use **Manual scan** for testing or an ad-hoc capture.

## Deployment

**Railway**: deploy the repository with root directory `server`, build command `npm install`, and start command `npm start`. Add `CLIENT_ORIGIN` as your Netlify URL and set `TZ=Asia/Kolkata`. Railway’s ephemeral filesystem means JSON data can be lost on redeploy; attach a persistent volume mounted at `/app/data` and update `server/src/storage.js` to its mount if persistence is required.

**Netlify**: set base directory to `client`, build command to `npm run build`, publish directory to `client/dist`, and set `VITE_API_URL=https://your-railway-url/api`.

## Recommendation scoring

Each candidate is calculated from the scans available that day: appearance consistency (35%), average rank (20%), percentage-change momentum (20%), volume growth (15%), and rank-trend improvement (10%). Gainers create Buy signals; losers use identical evidence and create Sell signals. Missing scans reduce no score artificially—the calculations use the scans that are available.
