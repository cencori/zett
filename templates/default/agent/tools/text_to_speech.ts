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

/** Default ElevenLabs voice when none is supplied. */
const DEFAULT_ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM";

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

async function speak(text: string, voice?: string): Promise<{ bytes: Buffer; mime: string }> {
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const cencoriKey = process.env.CENCORI_API_KEY;

  if (elevenKey) {
    const res = await fetch(
      `https://api.elevenlabs.io/text-to-speech/${encodeURIComponent(voice ?? DEFAULT_ELEVEN_VOICE)}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: {
          "xi-api-key": elevenKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          output_format: "mp3_44100_128",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );
    if (!res.ok) {
      const detail = await readError(res);
      throw new Error(`ElevenLabs TTS error (${res.status}${detail ? `: ${detail}` : ""})`);
    }
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  }

  if (cencoriKey) {
    const res = await fetch(`${CENCORI_BASE}/api/ai/audio/speech`, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${cencoriKey}`,
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
      throw new Error(`Cencori TTS error (${res.status}${detail ? `: ${detail}` : ""})`);
    }
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      mime: res.headers.get("content-type") ?? "audio/mpeg",
    };
  }

  throw new Error("no speech provider configured — set ELEVENLABS_API_KEY or CENCORI_API_KEY");
}

export default defineTool({
  description:
    "Synthesize speech from text. Uses ElevenLabs (eleven_multilingual_v2, high-quality voices) when ELEVENLABS_API_KEY is set, otherwise Cencori's tts-1 (CENCORI_API_KEY). Writes an mp3 file and returns its path. Use for spoken replies, voice notes, or narration.",
  inputSchema: z.object({
    text: z.string().describe("The text to speak"),
    voice: z.string().optional().describe("ElevenLabs voice id (provider-specific)"),
    outputPath: z.string().optional().describe("Where to write the audio file, relative to the project root (default: voice-notes/<timestamp>.mp3)"),
  }),
  execute: async ({ text, voice, outputPath }) => {
    try {
      const { bytes, mime } = await speak(text, voice);
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
        format: mime,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Speech synthesis failed." };
    }
  },
});