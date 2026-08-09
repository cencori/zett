import { describe, it, expect, vi, afterEach } from "vitest";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describeFiles, contractRequestHandler, MAX_AUDIO_BYTES } from "../src/server/contract";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/agent");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.CENCORI_API_KEY;
  delete process.env.CENCORI_API_URL;
});

function audioFile(base64: string, name = "voice-note.webm", type = "audio/webm") {
  return { name, type, dataUrl: `data:${type};base64,${base64}` };
}

describe("describeFiles — audio transcription", () => {
  it("transcribes audio through Cencori's STT endpoint with Bearer auth", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: "hello from the voice note" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await describeFiles([audioFile(Buffer.from("fake-audio").toString("base64"))]);

    expect(out).toContain("hello from the voice note");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cencori.com/api/ai/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer csk_test");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("model")).toBe("whisper-1");
  });

  it("honors CENCORI_API_URL when set to the legacy /api/v1 form", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    vi.stubEnv("CENCORI_API_URL", "https://cencori.com/api/v1");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await describeFiles([audioFile("YXVkaW8=")]);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://cencori.com/api/ai/audio/transcriptions");
  });

  it("falls back to a placeholder without an API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const out = await describeFiles([audioFile("YXVkaW8=")]);

    expect(out).toContain("no transcription provider configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses oversized audio without calling the API", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const big = "A".repeat(Math.ceil((MAX_AUDIO_BYTES / 3) * 4) + 1024);

    const out = await describeFiles([audioFile(big)]);

    expect(out).toContain("too large to transcribe");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still turns non-audio, non-image files into plain placeholders", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const out = await describeFiles([{ name: "notes.txt", type: "text/plain", dataUrl: "data:text/plain;base64,aGVsbG8=" }]);

    expect(out).toContain("[File attached: notes.txt");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /speech", () => {
  function fakeResponse() {
    const chunks: Buffer[] = [];
    let status = 200;
    let headers: Record<string, string | number> = {};
    return {
      res: {
        headersSent: false,
        writeHead: (s: number, h: Record<string, string | number>) => {
          status = s;
          headers = h;
        },
        write: (c: unknown) => {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
        },
        end: (c?: unknown) => {
          if (c !== undefined) {
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
          }
        },
      },
      status: () => status,
      headers: () => headers,
      body: () => Buffer.concat(chunks),
    };
  }

  function post(url: string, body: unknown) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as {
      method: string;
      url: string;
      headers: Record<string, string>;
    } & Readable;
    req.method = "POST";
    req.url = url;
    req.headers = { "content-type": "application/json" };
    return req;
  }

  it("returns synthesized audio bytes with the upstream content type", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    const audio = Buffer.from("fake-mp3-bytes");
    const fetchMock = vi.fn(async () =>
      new Response(audio, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const handler = contractRequestHandler({ agentDir: FIXTURE });
    const fake = fakeResponse();
    const handled = await handler(post("/speech", { input: "hello" }), fake.res);

    expect(handled).toBe(true);
    expect(fake.status()).toBe(200);
    expect(fake.headers()["Content-Type"]).toBe("audio/mpeg");
    expect(fake.body().equals(audio)).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cencori.com/api/ai/audio/speech");
    expect(JSON.parse(String(init.body))).toMatchObject({ input: "hello", model: "tts-1" });
  });

  it("rejects an empty input", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    const handler = contractRequestHandler({ agentDir: FIXTURE });
    const fake = fakeResponse();
    const handled = await handler(post("/speech", { input: "   " }), fake.res);

    expect(handled).toBe(true);
    expect(fake.status()).toBe(400);
  });

  it("errors when CENCORI_API_KEY is missing", async () => {
    const handler = contractRequestHandler({ agentDir: FIXTURE });
    const fake = fakeResponse();
    const handled = await handler(post("/speech", { input: "hello" }), fake.res);

    expect(handled).toBe(true);
    expect(fake.status()).toBe(500);
    expect(JSON.parse(fake.body().toString())).toMatchObject({
      error: expect.stringContaining("CENCORI_API_KEY"),
    });
  });

  it("leaves non-speech paths to other handlers", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    const handler = contractRequestHandler({ agentDir: FIXTURE });
    const fake = fakeResponse();
    const handled = await handler(post("/invoke", {}), fake.res);

    expect(handled).toBe(true);
    expect(fake.status()).toBe(400);
  });
});

describe("POST /transcribe", () => {
  function fakeResponse() {
    const chunks: Buffer[] = [];
    let status = 200;
    return {
      res: {
        headersSent: false,
        writeHead: (s: number) => {
          status = s;
        },
        write: (c: unknown) => {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
        },
        end: (c?: unknown) => {
          if (c !== undefined) {
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
          }
        },
      },
      status: () => status,
      json: () => JSON.parse(Buffer.concat(chunks).toString()),
    };
  }

  function post(body: unknown) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as {
      method: string;
      url: string;
      headers: Record<string, string>;
    } & Readable;
    req.method = "POST";
    req.url = "/transcribe";
    req.headers = { "content-type": "application/json" };
    return req;
  }

  it("transcribes mic audio via Cencori whisper-1", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: "mic transcript" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const handler = contractRequestHandler({ agentDir: FIXTURE });
    const fake = fakeResponse();
    const handled = await handler(
      post({ name: "voice-note.webm", type: "audio/webm", dataUrl: `data:audio/webm;base64,${Buffer.from("audio").toString("base64")}` }),
      fake.res,
    );

    expect(handled).toBe(true);
    expect(fake.status()).toBe(200);
    expect(fake.json()).toMatchObject({ text: "mic transcript", provider: "cencori" });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://cencori.com/api/ai/audio/transcriptions");
  });

  it("errors when no provider is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const handler = contractRequestHandler({ agentDir: FIXTURE });
    const fake = fakeResponse();
    await handler(post({ type: "audio/webm", dataUrl: "data:audio/webm;base64,eA==" }), fake.res);

    expect(fake.status()).toBe(500);
    expect(fake.json().error).toContain("no transcription provider configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when dataUrl is missing", async () => {
    vi.stubEnv("CENCORI_API_KEY", "csk_test");
    const handler = contractRequestHandler({ agentDir: FIXTURE });
    const fake = fakeResponse();
    await handler(post({ type: "audio/webm" }), fake.res);

    expect(fake.status()).toBe(400);
  });
});
