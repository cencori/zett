import { Buffer } from "node:buffer";

/**
 * Voice primitives over Cencori's first-party STT/TTS and ElevenLabs.
 *
 * Providers are picked by what is configured: when `ELEVENLABS_API_KEY` is
 * set the request goes to ElevenLabs directly (high-quality voices, scribe
 * transcription); otherwise it falls back to Cencori's gateway (whisper-1 /
 * tts-1) so the one-key setup still works out of the box.
 */

const ELEVEN_BASE = "https://api.elevenlabs.io";
const DEFAULT_ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM";

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
  provider: "elevenlabs" | "cencori";
  text: string;
}

async function elevenTranscribe(audio: AudioAttachment): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), audio.name);
  form.append("model_id", "scribe_v1");
  const res = await fetch(`${ELEVEN_BASE}/speech-to-text`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
    body: form,
  });
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(`ElevenLabs STT error (${res.status}${detail ? `: ${detail}` : ""})`);
  }
  const data = (await res.json()) as { text?: unknown };
  if (typeof data.text !== "string" || data.text.trim().length === 0) {
    throw new Error("ElevenLabs STT returned an empty transcript");
  }
  return data.text.trim();
}

async function cencoriTranscribe(audio: AudioAttachment): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), audio.name);
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  const res = await fetch(`${cencoriBaseUrl()}/api/ai/audio/transcriptions`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${process.env.CENCORI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(`Cencori STT error (${res.status}${detail ? `: ${detail}` : ""})`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/**
 * Transcribes audio to text, preferring ElevenLabs Scribe when
 * ELEVENLABS_API_KEY is set. Throws with a descriptive message when no
 * transcription provider is available or the upstream call fails.
 */
export async function transcribeAudio(audio: AudioAttachment): Promise<TranscribeResult> {
  if (process.env.ELEVENLABS_API_KEY) {
    return { provider: "elevenlabs", text: await elevenTranscribe(audio) };
  }
  if (process.env.CENCORI_API_KEY && process.env.CENCORI_API_KEY !== "local-dev-key") {
    return { provider: "cencori", text: await cencoriTranscribe(audio) };
  }
  throw new Error("no transcription provider configured — set ELEVENLABS_API_KEY or CENCORI_API_KEY");
}

export interface SpeechInput {
  text: string;
  /** ElevenLabs voice id, or a Cencori/OpenAI voice name when openai is the provider. */
  voice?: string;
  /** Output format hint; ElevenLabs: mp3_44100_128 / pcm_24000 / etc. */
  format?: string;
}

export interface SpeechResult {
  provider: "elevenlabs" | "cencori";
  mime: string;
  bytes: Buffer;
}

async function elevenSpeech(input: SpeechInput): Promise<SpeechResult> {
  const voice = input.voice ?? DEFAULT_ELEVEN_VOICE;
  const format = input.format ?? "mp3_44100_128";
  const res = await fetch(`${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(voice)}`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      model_id: "eleven_multilingual_v2",
      output_format: format,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(`ElevenLabs TTS error (${res.status}${detail ? `: ${detail}` : ""})`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("ElevenLabs TTS returned empty audio");
  return {
    provider: "elevenlabs",
    mime: format.startsWith("pcm") ? "audio/pcm" : "audio/mpeg",
    bytes,
  };
}

async function cencoriSpeech(input: SpeechInput): Promise<SpeechResult> {
  const res = await fetch(`${cencoriBaseUrl()}/api/ai/audio/speech`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${process.env.CENCORI_API_KEY}`,
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

/**
 * Synthesize speech, preferring ElevenLabs when ELEVENLABS_API_KEY is set.
 * Throws with a descriptive message when no TTS provider is available.
 */
export async function synthesizeSpeech(input: SpeechInput): Promise<SpeechResult> {
  if (process.env.ELEVENLABS_API_KEY) {
    return elevenSpeech(input);
  }
  if (process.env.CENCORI_API_KEY && process.env.CENCORI_API_KEY !== "local-dev-key") {
    return cencoriSpeech(input);
  }
  throw new Error("no speech provider configured — set ELEVENLABS_API_KEY or CENCORI_API_KEY");
}