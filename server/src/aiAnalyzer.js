// src/aiAnalyzer.js
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function filterWithAI(candidates, marketContext = {}) {
  if (!candidates || candidates.length === 0) return [];

  // Pass only relevant mathematical metrics to keep latency and tokens minimal
  const candidateData = candidates.map((c) => ({
    symbol: c.symbol,
    ltp: c.raw?.ltp || c.lastPrice,
    vwap: c.raw?.vwap,
    deliveryPct: c.raw?.deliveryPct,
    pChange: c.currentChange || c.latestPChange,
    rsi: c.rsiValue || 50,
    appearances: c.reasons?.length || 1,
  }));

  const prompt = `
You are a senior algorithmic intraday trader focusing on the Indian NSE Market.
Review the following shortlist of momentum gainers and their technical context:

Market Context:
- Nifty 50 Change: ${marketContext.niftyChange || "0"}%
- Sector Performance: ${marketContext.sector || "Mixed"}

Candidates:
${JSON.stringify(candidateData, null, 2)}

Instructions:
1. Reject stocks that are chasing extended momentum (e.g. RSI > 75 or trading far above VWAP).
2. Reject stocks with poor institutional backing (e.g. delivery % < 25%).
3. Select the Top 3 highest probability momentum continuations for intraday long entries (+1% target, 0.5% stop loss).
4. Provide a structured reason and updated confidence rating for each.
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              symbol: { type: Type.STRING },
              confidence: { type: Type.STRING },
              signal: { type: Type.STRING },
              aiReasoning: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestedTarget: { type: Type.NUMBER },
              suggestedStopLoss: { type: Type.NUMBER },
            },
            required: ["symbol", "confidence", "signal", "aiReasoning"],
          },
        },
      },
    });

    const parsedResults = JSON.parse(response.text);
    return parsedResults;
  } catch (err) {
    console.error(
      "AI Analysis failed, falling back to rule-based scores:",
      err.message
    );
    return [];
  }
}
