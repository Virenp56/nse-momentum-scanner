// src/aiAnalyzer.js
import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export async function filterWithAI(candidates, marketContext = {}) {
  if (!ai || !candidates || candidates.length === 0) return null;

  const candidateData = candidates.map((c) => ({
    symbol: c.symbol,
    ltp: c.raw?.ltp || c.lastPrice || 0,
    vwap: c.raw?.vwap || 0,
    dayHigh: c.raw?.dayHigh || 0,
    deliveryPct: c.raw?.deliveryPct || 0,
    pChange: c.currentChange || c.latestPChange || 0,
    rsi: c.rsiValue || 50,
    ruleScore: Math.round(c.score || 0),
    appearances: c.reasons?.length || 1,
  }));

  const prompt = `
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
`;

  try {
    const interaction = await ai.interactions.create({
      model: "gemini-3.7-flash",
      input: prompt,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "stock_recommendations",
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                symbol: { type: "string" },
                confidence: { type: "string" },
                signal: { type: "string" },
                aiReasoning: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["symbol", "confidence", "signal", "aiReasoning"],
            },
          },
        },
      },
    });

    const parsedResults = JSON.parse(
      interaction.output_text || interaction.text || "[]"
    );
    return Array.isArray(parsedResults) && parsedResults.length > 0
      ? parsedResults
      : null;
  } catch (err) {
    console.warn(
      "AI Analysis bypassed (falling back to math rules):",
      err.message
    );
    return null;
  }
}
