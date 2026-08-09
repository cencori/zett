import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadAgent, loadAgentById, discoverAgents } from "../loader";
import { transcribeAudio as transcribeVoice, synthesizeSpeech, type AudioAttachment } from "./voice";
import { discoverAgent } from "../discover/index";
import { streamAgent, type RunOptions } from "../runner/index";
import { FileStore } from "../memory/file-store";
import { buildAgentManifest } from "./manifest";
import { loadArcieConfig, type LoadedArcieConfig } from "../config/arcie-json";
import type { StreamEvent } from "../protocol/events";
import type { ChannelRequest, ChannelResponse } from "../types";

/**
 * The Cencori Runtime Contract server.
 *
 * A deployed Arcie agent is a container that answers a fixed set of HTTP
 * routes on `$PORT`. This module boots exactly that surface by wiring each
 * route to Arcie's existing internals — no Next.js, no framework shell:
 *
 *   GET  /_health          → 200 once the process is up
 *   POST /invoke           → run one agent turn (→ streamAgent)
 *   POST /channels/:name   → inbound channel event (→ channel handler)
 *   POST /schedules/:name  → fire a named schedule (→ schedule handler)
 *   GET  /_manifest        → the built agent manifest
 *
 * `/invoke` streams NDJSON by default (one JSON event per line — the format
 * the bundled `<agent-chat>` widget consumes) and Server-Sent Events when the
 * caller sends `Accept: text/event-stream`. Pass `stream: false` in the body
 * for a single buffered JSON reply.
 */
export interface ContractServerOptions {
  /** Directory holding the agent (its `agent.ts` and sibling slots). */
  agentDir: string;
  /** Port to bind. Defaults to `$PORT` then 8080. */
  port?: number;
  /** Host interface. Defaults to `0.0.0.0` so containers are reachable. */
  host?: string;
  /**
   * Cache-bust every agent import so edits land without a restart. `arcie dev`
   * turns this on; a deployed container leaves it off.
   */
  hotReload?: boolean;
  /**
   * Persist working/semantic memory under `<agentDir>/sessions/.memory`.
   * On by default; set false for a fully stateless runtime.
   */
  memory?: boolean;
  /**
   * Fail requests (and refuse boot on config problems) when a slot file
   * — tool, skill, channel, ... — fails to import instead of serving with
   * the file silently missing. On by default: this is the production entry,
   * where a broken tool must surface as an error, not as a quietly smaller
   * agent.
   */
  strict?: boolean;
}

export interface ContractHandlerOptions {
  agentDir: string;
  hotReload?: boolean;
  memory?: boolean;
  /** Same semantics as `ContractServerOptions.strict`, off by default so
   *  `arcie dev` keeps editing frictionless (warnings instead of refusals). */
  strict?: boolean;
}

/**
 * The routes this server actually serves, keyed by the `runtime.contract`
 * slot in arcie.json. `health` accepts the `/health` alias; every other slot
 * has exactly one canonical route.
 */
const CONTRACT_SLOTS: ReadonlyArray<{
  key: keyof NonNullable<LoadedArcieConfig["contract"]>;
  supported: readonly string[];
}> = [
  { key: "health", supported: ["GET /_health", "GET /health"] },
  { key: "invoke", supported: ["POST /invoke"] },
  { key: "channel", supported: ["POST /channels/:name"] },
  { key: "schedule", supported: ["POST /schedules/:name"] },
  { key: "manifest", supported: ["GET /_manifest"] },
];

/** One declared `runtime.contract` route the server does not serve. */
export interface ContractMismatch {
  key: string;
  /** What arcie.json declares, e.g. `"POST /chat"`. */
  declared: string;
  /** What this server actually answers for that slot. */
  supported: readonly string[];
}

/**
 * Compares the contract declared in `arcie.json` (`runtime.contract`) with
 * the routes this server actually serves. Returns one entry per declared
 * route the server does not answer. A config with no `contract` block
 * declares nothing and always validates — that is the escape hatch for a
 * platform serving a custom surface of its own.
 */
export function checkContractMismatches(config: LoadedArcieConfig | null): ContractMismatch[] {
  if (!config) return [];
  const mismatches: ContractMismatch[] = [];
  for (const { key, supported } of CONTRACT_SLOTS) {
    const declared = config.contract[key];
    if (declared === undefined) continue;
    if (!supported.includes(declared)) {
      mismatches.push({ key, declared, supported });
    }
  }
  return mismatches;
}

function contractMismatchError(mismatches: ContractMismatch[]): Error {
  const lines = [
    "arcie.json declares a runtime contract this server does not serve:",
    ...mismatches.map(
      (m) => `  ${m.key}: "${m.declared}" — server serves ${m.supported.join(", ")}`,
    ),
    "Fix runtime.contract in arcie.json, or remove the block to accept the defaults.",
  ];
  return new Error(lines.join("\n"));
}

interface InvokeFile {
  name: string;
  type: string;
  dataUrl: string;
}

interface InvokeBody {
  input?: string;
  /** Alias accepted from the chat widget. */
  message?: string;
  sessionId?: string;
  threadId?: string;
  agentId?: string;
  stream?: boolean;
  files?: InvokeFile[];
  resume?: {
    toolCalls: Array<{ actionId: string; name: string; args: unknown; approved: boolean }>;
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function audioAttachment(name: string, mime: string, bytes: Buffer): AudioAttachment {
  return { name, mime, bytes };
}

/** Cencori's STT accepts roughly 25 MB per file; refuse anything bigger. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Transcribes an audio attachment to text — ElevenLabs Scribe when
 * ELEVENLABS_API_KEY is set, else Cencori's whisper-1. Returns a textual
 * annotation the model can reason about: the widget's mic recordings,
 * voice notes, and meeting uploads all land here as text instead of a
 * bare file placeholder.
 */
async function transcribeAudio(f: InvokeFile): Promise<string> {
  const [header, base64] = f.dataUrl.slice(5).split(";base64,");
  const mimeType = header ?? "audio/mpeg";
  const bytes = Buffer.from(base64 ?? "", "base64");
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return `[Audio attached: ${f.name} — too large to transcribe (${(bytes.byteLength / 1048576).toFixed(1)} MB, max 25 MB)]`;
  }
  try {
    const { text, provider } = await transcribeVoice(audioAttachment(f.name, mimeType, bytes));
    return text.length > 0
      ? `[Audio transcribed from ${f.name} — ${provider}]\n${text}`
      : `[Audio attached: ${f.name} — empty transcript]`;
  } catch (err) {
    return `[Audio attached: ${f.name} — ${err instanceof Error ? err.message : "transcription failed"}]`;
  }
}

/**
 * Best-effort image understanding for uploaded files. Mirrors the behaviour
 * the retired Next.js chat route offered: images are described through
 * Cencori Vision (when a key is present) so a text-only model can reason
 * about them; audio is transcribed to text; everything else becomes a short
 * textual placeholder.
 */
export async function describeFiles(files: InvokeFile[]): Promise<string> {
  const apiKey = process.env.CENCORI_API_KEY;
  const base = (process.env.CENCORI_API_URL ?? "https://cencori.com")
    .replace(/\/api\/v1\/?$/, "")
    .replace(/\/+$/, "");

  const parts = await Promise.all(
    files.map(async (f) => {
      if (f.type.startsWith("audio/")) {
        return transcribeAudio(f);
      }
      if (!f.type.startsWith("image/")) {
        return `[File attached: ${f.name} — ${(f.dataUrl.length / 1024).toFixed(0)} KB]`;
      }
      if (!apiKey || apiKey === "local-dev-key") {
        return `[Image attached: ${f.name} — set CENCORI_API_KEY for vision analysis]`;
      }
      try {
        const [header, base64] = f.dataUrl.slice(5).split(";base64,");
        const res = await fetch(`${base}/api/ai/vision`, {
          method: "POST",
          signal: AbortSignal.timeout(30_000),
          headers: { CENCORI_API_KEY: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: base64,
            mime_type: header ?? "image/jpeg",
            prompt:
              "Describe this image concisely for a text-only language model that cannot see it. Include all visible details: objects, people, text, colors, layout, setting.",
            model: "gemini-2.5-flash",
            response_format: "text",
          }),
        });
        if (!res.ok) return `[Image attached: ${f.name} — vision analysis failed (${res.status})]`;
        const data = (await res.json()) as { analysis?: string };
        return `[Image attached: ${f.name}]\n[Vision analysis: ${data.analysis ?? ""}]`;
      } catch {
        return `[Image attached: ${f.name} — vision API unreachable]`;
      }
    }),
  );

  return parts.join("\n\n");
}

/**
 * Builds a request handler for the Runtime Contract routes. Returns `true`
 * when it handled the request, `false` otherwise — so it can be mounted
 * alongside other middleware (as `arcie dev` does).
 */
export function contractRequestHandler(
  options: ContractHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const agentDir = resolve(process.cwd(), options.agentDir);
  const hotReload = options.hotReload ?? false;
  const useMemory = options.memory ?? true;
  const strict = options.strict ?? false;

  // The deployed project carries arcie.json (if it has one). Its
  // runtime.contract is a promise about what routes this process answers —
  // refuse to boot when the promise and the route table disagree instead of
  // silently serving a different surface than the platform provisioned.
  const config = loadArcieConfig(agentDir);
  const mismatches = checkContractMismatches(config);
  if (mismatches.length > 0) {
    throw contractMismatchError(mismatches);
  }

  const memoryStore =
    useMemory && existsSync(agentDir)
      ? new FileStore(resolve(agentDir, "sessions", ".memory"))
      : undefined;

  const invoke = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: InvokeBody;
    try {
      body = JSON.parse(await readBody(req)) as InvokeBody;
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    const resumeCalls = body.resume?.toolCalls;
    const isResume = Array.isArray(resumeCalls) && resumeCalls.length > 0;

    let input = body.input ?? body.message ?? "";
    if (body.files && body.files.length > 0) {
      const described = await describeFiles(body.files);
      input = input.length > 0 ? `${input}\n\n${described}` : described;
    }

    if (!isResume && input.length === 0) {
      sendJson(res, 400, { error: "input (or message/files) is required" });
      return;
    }
    if (isResume && (typeof body.sessionId !== "string" || body.sessionId.length === 0)) {
      sendJson(res, 400, { error: "resume requires sessionId" });
      return;
    }

    const runOpts: RunOptions = {
      hotReload,
      strict,
      ...(memoryStore ? { memoryStore, workingMemoryDir: resolve(agentDir, "sessions") } : {}),
      resourceId: "runtime",
      ...(body.agentId && body.agentId.length > 0 ? { agentId: body.agentId } : {}),
      ...(body.sessionId && body.sessionId.length > 0 ? { sessionId: body.sessionId } : {}),
      ...(body.threadId && body.threadId.length > 0 ? { threadId: body.threadId } : {}),
      ...(isResume ? { resume: body.resume } : {}),
    };

    const wantsSse = (req.headers.accept ?? "").includes("text/event-stream");
    const streaming = body.stream !== false;

    if (!streaming) {
      // Buffered mode: drain the stream, return the final assistant text.
      let output = "";
      let sessionId = body.sessionId ?? "";
      try {
        for await (const event of streamAgent(agentDir, input, runOpts)) {
          if (event.type === "session.started") sessionId = event.data.sessionId;
          if (event.type === "message.completed" && event.data.text) output = event.data.text;
        }
        sendJson(res, 200, { output, sessionId });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    const encode = wantsSse
      ? (e: StreamEvent) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`
      : (e: StreamEvent) => `${JSON.stringify(e)}\n`;

    res.writeHead(200, {
      "Content-Type": wantsSse ? "text/event-stream" : "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    try {
      for await (const event of streamAgent(agentDir, input, runOpts)) {
        res.write(encode(event));
      }
    } catch (err) {
      const failure: StreamEvent = {
        type: "session.failed",
        data: {
          code: "runtime_error",
          message: err instanceof Error ? err.message : String(err),
          sessionId: body.sessionId ?? "",
        },
      };
      res.write(encode(failure));
    } finally {
      if (wantsSse) res.write("event: done\ndata: [DONE]\n\n");
      res.end();
    }
  };

  const channelEvent = async (
    req: IncomingMessage,
    res: ServerResponse,
    channelName: string,
  ): Promise<void> => {
    const agent = await loadAgent(agentDir, { hotReload, strict });
    const channel = agent.manifest.channels[channelName];
    if (!channel) {
      sendJson(res, 404, { error: `channel "${channelName}" not found` });
      return;
    }
    const raw = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    const channelReq: ChannelRequest = {
      body: parsed,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v ?? ""]),
      ),
      method: req.method ?? "POST",
      rawBody: raw,
    };
    try {
      const result: ChannelResponse = await channel.handler(channelReq);
      sendJson(res, result.status, result.body);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const scheduleEvent = async (
    req: IncomingMessage,
    res: ServerResponse,
    scheduleName: string,
  ): Promise<void> => {
    const agent = await loadAgent(agentDir, { hotReload, strict });
    const schedule = agent.manifest.schedules[scheduleName];
    if (!schedule) {
      sendJson(res, 404, { error: `schedule "${scheduleName}" not found` });
      return;
    }
    try {
      await schedule.handler();
      sendJson(res, 200, { status: "ok", schedule: scheduleName });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const manifest = async (res: ServerResponse, agentId?: string): Promise<void> => {
    try {
      const agent = agentId
        ? await loadAgentById(agentDir, agentId, { hotReload, strict })
        : await loadAgent(agentDir, { hotReload, strict });
      const { agent: discovered } = discoverAgent(agentDir);
      // The deployed project carries arcie.json (if it has one) — merge its
      // deploy metadata into the manifest so the platform can provision
      // env / start command straight from this endpoint.
      const config = loadArcieConfig(agentDir);
      sendJson(res, 200, buildAgentManifest(agent, discovered, config));
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const agentsList = async (res: ServerResponse): Promise<void> => {
    const discovered = discoverAgents(agentDir);
    const agents = await Promise.all(
      discovered.map(async ({ id }) => {
        try {
          const loaded = await loadAgentById(agentDir, id, { hotReload, strict });
          const { config } = loaded.manifest;
          return { id, name: config.name ?? id, model: config.model, description: config.description ?? "" };
        } catch {
          return { id, name: id, model: "", description: "" };
        }
      }),
    );
    sendJson(res, 200, agents);
  };

  /**
   * Synthesizes speech from text — ElevenLabs when ELEVENLABS_API_KEY is
   * set, else Cencori's tts-1 — and returns the audio bytes. A convenience
   * route for the widget's "speak" button, deliberately outside the
   * Runtime Contract slots so the platform can ignore it freely.
   */
  const speech = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: { input?: string; voice?: string; format?: string };
    try {
      body = JSON.parse(await readBody(req)) as { input?: string; voice?: string; format?: string };
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    const input = (body.input ?? "").trim();
    if (input.length === 0) {
      sendJson(res, 400, { error: "input is required" });
      return;
    }

    try {
      const { bytes, mime } = await synthesizeSpeech({
        text: input,
        ...(body.voice ? { voice: body.voice } : {}),
        ...(body.format ? { format: body.format } : {}),
      });
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": bytes.byteLength,
        "Cache-Control": "no-cache, no-transform",
      });
      res.end(bytes);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } else {
        res.end();
      }
    }
  };

  /**
   * Converts an audio upload to text — ElevenLabs Scribe when the key is
   * set, else Cencori's whisper-1. The widget's mic button uses this so
   * voice arrives as an editable text draft rather than a raw audio
   * attachment. Convenience route, like /speech.
   */
  const transcribe = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: { name?: string; type?: string; dataUrl?: string };
    try {
      body = JSON.parse(await readBody(req)) as { name?: string; type?: string; dataUrl?: string };
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    const dataUrl = body.dataUrl ?? "";
    if (!dataUrl.startsWith("data:")) {
      sendJson(res, 400, { error: "dataUrl is required" });
      return;
    }

    const [header, base64] = dataUrl.slice(5).split(";base64,");
    const mimeType = header ?? "audio/mpeg";
    const bytes = Buffer.from(base64 ?? "", "base64");
    if (bytes.byteLength === 0) {
      sendJson(res, 400, { error: "empty audio payload" });
      return;
    }
    if (bytes.byteLength > MAX_AUDIO_BYTES) {
      sendJson(res, 413, { error: `audio too large (${(bytes.byteLength / 1048576).toFixed(1)} MB, max 25 MB)` });
      return;
    }

    try {
      const { text, provider } = await transcribeVoice(audioAttachment(body.name ?? "voice", mimeType, bytes));
      sendJson(res, 200, { text, provider });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const pathname = rawUrl.split("?")[0]!;

    if (method === "GET" && (pathname === "/_health" || pathname === "/health")) {
      sendJson(res, 200, { status: "ok" });
      return true;
    }

    if (method === "GET" && pathname === "/_manifest") {
      const agentId = new URL(rawUrl, "http://local").searchParams.get("agentId") ?? undefined;
      await manifest(res, agentId);
      return true;
    }

    // Convenience for the widget's agent selector — not part of the RC.
    if (method === "GET" && pathname === "/_agents") {
      await agentsList(res);
      return true;
    }

    // Convenience for the widget's speak button — not part of the RC.
    if (method === "POST" && pathname === "/speech") {
      await speech(req, res);
      return true;
    }

    // Convenience for the widget's mic button (audio → text) — not part of the RC.
    if (method === "POST" && pathname === "/transcribe") {
      await transcribe(req, res);
      return true;
    }

    if (method === "POST" && pathname === "/invoke") {
      await invoke(req, res);
      return true;
    }

    const channelMatch = pathname.match(/^\/channels\/([^/]+)\/?$/);
    if (method === "POST" && channelMatch) {
      await channelEvent(req, res, decodeURIComponent(channelMatch[1]!));
      return true;
    }

    const scheduleMatch = pathname.match(/^\/schedules\/([^/]+)\/?$/);
    if (method === "POST" && scheduleMatch) {
      await scheduleEvent(req, res, decodeURIComponent(scheduleMatch[1]!));
      return true;
    }

    return false;
  };
}

/**
 * Boots a standalone HTTP server answering the Runtime Contract on `$PORT`.
 * This is the entry a deployed Arcie container runs.
 */
export function startContractServer(options: ContractServerOptions): Promise<{ server: Server; port: number }> {
  const port = options.port ?? (process.env.PORT ? Number(process.env.PORT) : 8080);
  const host = options.host ?? "0.0.0.0";

  return new Promise((resolvePromise, reject) => {
    let handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
    try {
      handler = contractRequestHandler({
        agentDir: options.agentDir,
        hotReload: options.hotReload,
        memory: options.memory,
        strict: options.strict ?? true,
      });
    } catch (err) {
      // Validation (arcie.json contract mismatch, malformed config) fails
      // the boot as a rejection so every caller sees one async error path.
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const server = createServer(async (req, res) => {
      try {
        if (await handler(req, res)) return;
        sendJson(res, 404, { error: "not found" });
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        } else {
          res.end();
        }
      }
    });

    server.once("error", reject);
    server.listen(port, host, () => resolvePromise({ server, port }));
  });
}
