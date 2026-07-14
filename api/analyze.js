// /api/analyze.js
// Vercel serverless function. Runs server-side only — the Anthropic API key
// never reaches the browser. The frontend calls this endpoint with POST.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  const { dealText, criteria, sector, ownership, geography } = req.body || {};

  if (!dealText || typeof dealText !== "string" || !dealText.trim()) {
    res.status(400).json({ error: "dealText is required" });
    return;
  }

  const systemPrompt = `You are supporting the first-pass screening step that a junior private equity
analyst normally performs by hand: reading an unstructured company summary (a CIM excerpt, teaser,
or management overview) and turning it into a structured screening memo.

Stay strictly within this scope:
- Extract and organize what is stated or reasonably implied in the text.
- Compare the deal against the stated investment criteria.
- Flag risks and open questions a diligence team would want to chase down.
Do NOT do any of the following, even if asked:
- Do not estimate a valuation or purchase price.
- Do not predict investment outcomes, returns, or IRR.
- Do not give a binary invest/pass recommendation — frame everything as a preliminary read that still
  requires human diligence.

Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:
{
  "overview": "2-4 sentence plain-language summary of the business",
  "fit": "2-4 sentence assessment of how this aligns with the stated investment criteria",
  "risks": ["risk 1", "risk 2", "risk 3"],
  "opportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "questions": ["diligence question 1", "diligence question 2", "diligence question 3"],
  "recommendation": "2-3 sentence preliminary read — NOT a go/no-go call, just what this first pass suggests about where to focus next"
}
Each array should have 3-5 items. Keep every field grounded in the text provided; if the text doesn't
mention something (e.g. customer concentration), don't invent a number or fact for it.`;

  const userPrompt = `Investment Criteria:
${criteria || "(none provided)"}

Deal Metadata:
- Sector: ${sector || "Unknown"}
- Ownership Type: ${ownership || "Unknown"}
- Geography: ${geography || "Unknown"}

Deal Description:
${dealText}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ error: "Anthropic API error", detail: errText });
      return;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No text content returned from model" });
      return;
    }

    // Model is instructed to return raw JSON, but strip fences defensively in case it doesn't.
    const cleaned = textBlock.text.trim().replace(/^```json\s*|^```\s*|```$/g, "");

    let memo;
    try {
      memo = JSON.parse(cleaned);
    } catch (parseErr) {
      res.status(502).json({ error: "Model did not return valid JSON", raw: cleaned });
      return;
    }

    res.status(200).json(memo);
  } catch (err) {
    res.status(500).json({ error: "Unexpected server error", detail: String(err) });
  }
}
