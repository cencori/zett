import { Buffer } from "node:buffer";

/**
 * Voice primitives over Cencori's first-party STT/TTS gateway (whisper-1 /
 * tts-1) — the one-key setup: CENCORI_API_KEY only.
 */

export function cencoriBaseUrl(): string {
  return (
    (process.env.CENCORI_API_URL ?? "https://cencori.com")
      .replace(/\/api\/v1\/?$/, "")
      .replace(/\/+$/, "")
  );
}

/** Best-effort extraction of the platform's structured error message. */
export async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown };
    // Prefer the human-readable `message`: `error` is often just a code
    // like "provider_error" while `message` carries the upstream detail.
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

export interface AudioAttachment {
  name: string;
  mime: string;
  bytes: Buffer;
}

/** Transcribed result with the provider that produced it. */
export interface TranscribeResult {
  provider: "cencori";
  text: string;
}

/**
 * Transcribes audio to text via Cencori's whisper-1. Throws with a
 * descriptive message when no API key is available or the upstream call
 * fails.
 */
export async function transcribeAudio(audio: AudioAttachment): Promise<TranscribeResult> {
  const apiKey = process.env.CENCORI_API_KEY;
  if (!apiKey || apiKey === "local-dev-key") {
    throw new Error("no transcription provider configured — set CENCORI_API_KEY");
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), audio.name);
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  const res = await fetch(`${cencoriBaseUrl()}/api/ai/audio/transcriptions`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(`Cencori STT error (${res.status}${detail ? `: ${detail}` : ""})`);
  }
  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (text.length === 0) throw new Error("Cencori STT returned an empty transcript");
  return { provider: "cencori", text };
}

export interface SpeechInput {
  text: string;
  /** Cencori voice name (OpenAI-compatible); a provider default applies when omitted. */
  voice?: string;
  /** Output format hint, e.g. "mp3" or "wav" (OpenAI-compatible response_format). */
  format?: string;
}

export interface SpeechResult {
  provider: "cencori";
  mime: string;
  bytes: Buffer;
}

/**
 * Synthesizes speech via Cencori's tts-1. Throws with a descriptive
 * message when no API key is available or the upstream call fails.
 */
export async function synthesizeSpeech(input: SpeechInput): Promise<SpeechResult> {
  const apiKey = process.env.CENCORI_API_KEY;
  if (!apiKey || apiKey === "local-dev-key") {
    throw new Error("no speech provider configured — set CENCORI_API_KEY");
  }
  const res = await fetch(`${cencoriBaseUrl()}/api/ai/audio/speech`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: input.text,
      model: "tts-1",
      ...(input.voice ? { voice: input.voice } : {}),
      ...(input.format ? { response_format: input.format } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(`Cencori TTS error (${res.status}${detail ? `: ${detail}` : ""})`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("Cencori TTS returned empty audio");
  return {
    provider: "cencori",
    mime: res.headers.get("content-type") ?? "audio/mpeg",
    bytes,
  };
}
