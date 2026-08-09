import { defineTool } from "arcie";
import { z } from "zod";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, sep, basename } from "node:path";

function resolveInside(root: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = resolve(root, cleaned);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`Path escapes the project root: ${rel}`);
  }
  return abs;
}

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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
    "Transcribe an audio file (voice note, recording, meeting) to text via Cencori's whisper-1 (CENCORI_API_KEY). Files up to 25 MB.",
  inputSchema: z.object({
    filePath: z.string().describe("Relative path to the audio file from the project root, e.g. 'voice-notes/note.m4a', 'uploads/call.wav'"),
    language: z.string().optional().describe("ISO language code of the audio, e.g. 'en'"),
    prompt: z.string().optional().describe("Optional context to guide transcription, e.g. domain terms or speaker names"),
  }),
  execute: async ({ filePath, language, prompt }) => {
    let abs: string;
    try {
      abs = resolveInside(process.cwd(), filePath);
    } catch (err) {
      return { file: filePath, error: err instanceof Error ? err.message : String(err) };
    }

    if (!existsSync(abs)) {
      return { file: filePath, error: "File not found." };
    }

    const size = statSync(abs).size;
    if (size > MAX_AUDIO_BYTES) {
      return {
        file: filePath,
        error: `File too large to transcribe: ${(size / 1048576).toFixed(1)} MB (max 25 MB).`,
      };
    }

    const apiKey = process.env.CENCORI_API_KEY;
    if (!apiKey) {
      return { file: filePath, error: "No CENCORI_API_KEY configured." };
    }

    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(readFileSync(abs))], { type: "audio/mpeg" }), basename(filePath));
      form.append("model", "whisper-1");
      form.append("response_format", "json");
      if (language) form.append("language", language);
      if (prompt) form.append("prompt", prompt);
      const res = await fetch(`${CENCORI_BASE}/api/ai/audio/transcriptions`, {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const detail = await readError(res);
        throw new Error(`STT error (${res.status}${detail ? `: ${detail}` : ""})`);
      }
      const data = (await res.json()) as { text?: string };
      return { file: filePath, text: (data.text ?? "").trim() };
    } catch (err) {
      return { file: filePath, error: err instanceof Error ? err.message : "Transcription failed." };
    }
  },
});