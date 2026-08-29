// src/aiAnalyzer.js
import { GoogleGenAI } from "@google/genai";

export async function filterWithAI(candidates, marketContext = {}) {
  const apiKey = process.env.GEMINI_API_KEY; //[cite: 15]

  if (!apiKey || !candidates || candidates.length === 0) {
    //[cite: 15]
    return null; //[cite: 15]
  }

  const ai = new GoogleGenAI({ apiKey }); //[cite: 15]
  const isCrypto = Boolean(marketContext.isCrypto);

  const candidateData = candidates.map((c) => ({
    symbol: c.symbol, //[cite: 15]
    price: c.raw?.ltp || c.lastPrice || 0, //[cite: 15]
    vwap: c.raw?.vwap || 0, //[cite: 15]
    pChange: c.currentChange || c.latestPChange || 0, //[cite: 15]
    rsi: c.rsiValue || 50, //[cite: 15]
    volumeUsdOrQty: c.raw?.volume || c.raw?.deliveryPct || 0,
    ruleScore: Math.round(c.score || 0), //[cite: 15]
  }));

  const prompt = isCrypto
    ? `
You are a senior algorithmic cryptocurrency trader focusing on Binance USDT momentum breakouts.
Review the following shortlist of mathematically screened crypto momentum gainers:

Market Benchmark:
- Bitcoin (BTC) 24h Change: ${
        marketContext.btcChange || marketContext.niftyPChange || "0"
      }%

Candidates:
${JSON.stringify(candidateData, null, 2)}

Instructions:
1. Reject tokens chasing extreme overbought momentum (e.g., RSI > 76 or trading >4% above VWAP).
2. Prioritize tokens demonstrating high relative strength against BTC and sustained trading volume.
3. Select the Top 3 highest probability continuation setups for 15-minute scalp entries (+3.0% target, -1.5% stop-loss).
4. Provide structured concise reasons, updated signal (STRONG BUY or BUY), and a confidence score for each selected symbol.
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
`; //[cite: 15]

  try {
    const interaction = await ai.interactions.create({
      model: "gemini-3.7-flash",
      input: prompt, //[cite: 15]
      response_format: {
        type: "array", //[cite: 15]
        schema: {
          type: "array", //[cite: 15]
          items: {
            type: "object", //[cite: 15]
            properties: {
              symbol: { type: "string" }, //[cite: 15]
              confidence: { type: "string" }, //[cite: 15]
              signal: { type: "string" }, //[cite: 15]
              aiReasoning: {
                type: "array", //[cite: 15]
                items: { type: "string" }, //[cite: 15]
              },
            },
            required: ["symbol", "confidence", "signal", "aiReasoning"], //[cite: 15]
          },
        },
      },
    });

    const output = interaction.output_text || interaction.text || "[]"; //[cite: 15]
    const cleanOutput = output.replace(/```json\n?|```/g, "").trim(); //[cite: 15]
    const parsedResults = JSON.parse(cleanOutput); //[cite: 15]

    return Array.isArray(parsedResults) && parsedResults.length > 0
      ? parsedResults
      : null; //[cite: 15]
  } catch (err) {
    console.error("Error during AI analysis:", err.message); //[cite: 15]
    return null; //[cite: 15]
  }
}
