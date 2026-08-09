import { defineTool } from "arcie";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, sep, dirname } from "node:path";

function resolveInside(root: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = resolve(root, cleaned);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`Path escapes the project root: ${rel}`);
  }
  return abs;
}

const CENCORI_BASE = (process.env.CENCORI_API_URL ?? "https://cencori.com")
  .replace(/\/api\/v1\/?$/, "")
  .replace(/\/+$/, "");

/** Best-effort extraction of the platform's structured error message. */
async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof data.error === "object" && data.error !== null) {
      const message = (data.error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string") return data.error;
  } catch {
    // not JSON — fall through
  }
  return "";
}

export default defineTool({
  description:
    "Synthesize speech from text via Cencori's tts-1 (CENCORI_API_KEY). Writes an mp3 file and returns its path. Use for spoken replies, voice notes, or narration.",
  inputSchema: z.object({
    text: z.string().describe("The text to speak"),
    voice: z.string().optional().describe("Cencori voice name (OpenAI-compatible); a provider default applies when omitted"),
    outputPath: z.string().optional().describe("Where to write the audio file, relative to the project root (default: voice-notes/<timestamp>.mp3)"),
  }),
  execute: async ({ text, voice, outputPath }) => {
    try {
      const apiKey = process.env.CENCORI_API_KEY;
      if (!apiKey) {
        return { error: "No CENCORI_API_KEY configured." };
      }
      const res = await fetch(`${CENCORI_BASE}/api/ai/audio/speech`, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: text,
          model: "tts-1",
          ...(voice ? { voice } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await readError(res);
        throw new Error(`TTS error (${res.status}${detail ? `: ${detail}` : ""})`);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength === 0) {
        return { error: "Speech synthesis returned empty audio." };
      }
      const out = resolveInside(
        process.cwd(),
        outputPath ?? `voice-notes/${Date.now()}.mp3`,
      );
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);

      return {
        path: out,
        bytes: bytes.byteLength,
        format: res.headers.get("content-type") ?? "audio/mpeg",
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Speech synthesis failed." };
    }
  },
});