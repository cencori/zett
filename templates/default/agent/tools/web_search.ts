import { defineTool } from "arcie";
import { z } from "zod";

// Cencori's first-party web index — the same API the official @cencori/mcp
// server calls. No third-party search key needed: CENCORI_API_KEY is all it
// takes. Handles CENCORI_API_URL being set to either https://cencori.com
// or the legacy https://cencori.com/api/v1 form.
const BASE = (process.env.CENCORI_API_URL ?? "https://cencori.com")
  .replace(/\/api\/v1\/?$/, "")
  .replace(/\/+$/, "");

export default defineTool({
  description:
    "Search the web for current information. Uses Cencori's first-party web index (own crawler, corpus, embeddings, and ranking — not a third-party API). Returns ranked results with evidence quotes and source URLs. Call fetch_url on any result to get the full page content.",
  inputSchema: z.object({
    query: z.string().describe("Natural-language web search query — be specific for best results"),
    limit: z.number().int().min(1).max(50).optional().default(5).describe("Maximum number of results to return (1-50)"),
    domain: z.string().optional().describe("Restrict results to one hostname, e.g. docs.cencori.com"),
    freshness: z.string().optional().describe("Recency filter: an ISO timestamp or a relative duration such as 24h, 7d, or 3m"),
  }),
  execute: async ({ query, limit, domain, freshness }) => {
    const apiKey = process.env.CENCORI_API_KEY;

    if (!apiKey) {
      return {
        engine: "cencori",
        query,
        count: 0,
        error: "CENCORI_API_KEY is not set",
        results: [],
        note: "Set CENCORI_API_KEY in .env.local to enable live web search.",
      };
    }

    try {
      const res = await fetch(`${BASE}/api/v1/web/search`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          limit: limit ?? 5,
          ...(domain ? { domain } : {}),
          ...(freshness ? { freshness } : {}),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          engine: "cencori",
          query,
          count: 0,
          error: `Cencori Web API error (${res.status}): ${text}`,
          results: [],
          note: "Check that CENCORI_API_KEY is valid and has web access enabled.",
        };
      }

      const data = (await res.json()) as {
        answer?: string;
        results?: unknown[];
      };
      const raw = Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [];
      const results = raw.slice(0, limit ?? 5).map((item) => {
        const r = item as Record<string, unknown>;
        return {
          title: typeof r.title === "string" ? r.title : (typeof r.name === "string" ? r.name : "Untitled"),
          url: typeof r.url === "string" ? r.url : (typeof r.link === "string" ? r.link : ""),
          snippet: typeof r.snippet === "string"
            ? r.snippet
            : (typeof r.content === "string"
              ? r.content
              : (typeof r.text === "string" ? r.text : (typeof r.evidence_quote === "string" ? r.evidence_quote : ""))),
          score: typeof r.score === "number" ? r.score : undefined,
        };
      });

      return {
        engine: "cencori",
        query,
        count: results.length,
        ...(typeof data.answer === "string" ? { answer: data.answer } : {}),
        results,
      };
    } catch (err) {
      return {
        engine: "cencori",
        query,
        count: 0,
        error: err instanceof Error ? err.message : "Search failed",
        results: [],
        note: "Cencori Web API unreachable. Check your network connection.",
      };
    }
  },
});
