// src/aiAnalyzer.js
import { GoogleGenAI } from "@google/genai";

export async function filterWithAI(candidates, marketContext = {}) {
  const apiKey = process.env.GEMINI_API_KEY; //[cite: 1]

  if (!apiKey || !candidates || candidates.length === 0) {
    //[cite: 1]
    return null; //[cite: 1]
  }

  const ai = new GoogleGenAI({ apiKey }); //[cite: 1]
  const isCrypto = Boolean(marketContext.isCrypto); //[cite: 1]

  const candidateData = candidates.map((c) => ({
    symbol: c.symbol, //[cite: 1]
    price: c.raw?.ltp || c.lastPrice || 0, //[cite: 1]
    vwap: c.raw?.vwap || 0, //[cite: 1]
    pChange: c.currentChange || c.latestPChange || 0, //[cite: 1]
    rsi: c.rsiValue || 50, //[cite: 1]
    volumeUsdOrQty: c.raw?.volume || c.raw?.deliveryPct || 0, //[cite: 1]
    ruleScore: Math.round(c.score || 0), //[cite: 1]
    targetPrice: c.trade?.targetPrice,
    stopLossPrice: c.trade?.stopLossPrice,
  }));

  const prompt = isCrypto
    ? `
You are a quantitative intraday crypto trader specializing in 5-minute candle breakouts with a strict execution horizon of 1 to 1.5 hours (12 to 18 candles).

BTC 24h Trend: ${marketContext.btcChange || "0"}%

Candidates (Pre-screened against upper-wick rejections and overextension):
${JSON.stringify(candidateData, null, 2)}

Strict Anti-Trap Guidelines:
1. REJECT any token that appears to have completed its move (e.g., 24h change > 15% with decelerating 5m momentum).
2. REJECT tokens where RSI > 68 or price is more than 2% above VWAP.
3. PRIORITIZE tokens consolidating near 5m EMA9 support with healthy continuation volume.
4. Select ONLY the Top 3 highest conviction setups for a 60-90 minute scalp (+1.5% to +2.5% target).
5. Return symbol, confidence (e.g. "85%"), signal ("STRONG BUY" or "BUY"), and concise technical reasons focusing on 5m candle support.
`
    : `
You are a senior algorithmic intraday trader focusing on the Indian NSE Market.
Review the following shortlist of mathematically screened momentum gainers:

Market Benchmark:
- NIFTY 50 Change: ${marketContext.niftyPChange || "0"}%

Candidates:
${JSON.stringify(candidateData, null, 2)}

Instructions:
1. Reject stocks that are chasing overextended momentum (e.g. RSI > 78 or trading too far above VWAP).
2. Reject stocks with low institutional backing (e.g. delivery % < 25%).
3. Select the Top 3 highest probability momentum continuations for intraday long entries (+1% target, 0.5% stop loss).
4. Provide structured reasons, updated signal (STRONG BUY or BUY), and a confidence score for each selected symbol.
`; //[cite: 1]

  try {
    const interaction = await ai.interactions.create({
      model: "gemini-3.7-flash",
      input: prompt, //[cite: 1]
      response_format: {
        type: "array", //[cite: 1]
        schema: {
          type: "array", //[cite: 1]
          items: {
            type: "object", //[cite: 1]
            properties: {
              symbol: { type: "string" }, //[cite: 1]
              confidence: { type: "string" }, //[cite: 1]
              signal: { type: "string" }, //[cite: 1]
              aiReasoning: {
                type: "array", //[cite: 1]
                items: { type: "string" }, //[cite: 1]
              },
            },
            required: ["symbol", "confidence", "signal", "aiReasoning"], //[cite: 1]
          },
        },
      },
    });

    const output = interaction.output_text || interaction.text || "[]"; //[cite: 1]
    const cleanOutput = output.replace(/```json\n?|```/g, "").trim(); //[cite: 1]
    const parsedResults = JSON.parse(cleanOutput); //[cite: 1]

    return Array.isArray(parsedResults) && parsedResults.length > 0
      ? parsedResults
      : null; //[cite: 1]
  } catch (err) {
    console.error("Error during AI analysis:", err.message); //[cite: 1]
    return null; //[cite: 1]
  }
}
