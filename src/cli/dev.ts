import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, watch, type FSWatcher } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgent } from "../loader";
import { discoverAgent } from "../discover/index";
import { loadArcieConfig, pickAgentDir, missingEnvVars } from "../config/arcie-json";
import { showHeader } from "./banner";
import { grey, dimmed } from "./style";
import { startBlockChat } from "./tui/renderer/start-block-chat";
import { handleSessionsRequest, getProviderApiKey, resolveProviderForModel } from "../server/index";
import { createChannelMiddleware } from "../channels/server";
import { contractRequestHandler } from "../server/contract";
import {
  copyBundledUiFavicon,
  resolveBundledUiFavicon,
  resolveUiSources,
  UI_FAVICON_HREF,
  uiBuildOptions,
  uiHtml,
} from "./ui-build";

/**
 * Locates the prebuilt `<agent-chat>` widget bundle inside the installed
 * arcie package. The CLI bundle lands at various dist depths (tsup splitting),
 * so walk up from this module until `dist/web/agent-chat.js` appears.
 */
function resolveWidgetDir(): string | undefined {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(current, "dist", "web");
    if (existsSync(join(candidate, "agent-chat.js"))) return candidate;
    const sibling = resolve(current, "web");
    if (existsSync(join(sibling, "agent-chat.js"))) return sibling;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

const WIDGET_DIR = resolveWidgetDir();

function widgetHostPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>arcie</title>
<link rel="icon" href="/${UI_FAVICON_HREF}" sizes="48x48" type="image/x-icon" />
<style>html,body{margin:0;height:100%;background:#000}</style>
</head>
<body>
<agent-chat endpoint="/invoke" agents-endpoint="/_agents" speech-endpoint="/speech"></agent-chat>
<script src="/agent-chat.js"></script>
</body>
</html>`;
}

/**
 * Serves the built-in chat widget: the host page at `/` and the bundle at
 * `/agent-chat.js` (plus its stylesheet). Returns true when it handled the
 * request. Replaces the retired Next.js `web/` app entirely.
 */
function serveWidget(req: IncomingMessage, res: ServerResponse): boolean {
  const method = req.method ?? "GET";
  const url = (req.url ?? "/").split("?")[0]!;
  if (method !== "GET") return false;

  if (url === "/" || url === "/index.html") {
    const html = widgetHostPage();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return true;
  }

  if (url === "/favicon.ico") {
    res.writeHead(200, { "Content-Type": "image/x-icon", "Cache-Control": "no-cache" });
    res.end(readFileSync(resolveBundledUiFavicon()));
    return true;
  }

  if (url === "/agent-chat.js" || url === "/agent-chat.css") {
    if (!WIDGET_DIR) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("agent-chat bundle not found — run `npm run build` in the arcie package");
      return true;
    }
    const file = join(WIDGET_DIR, url.slice(1));
    if (!existsSync(file)) return false;
    const type = url.endsWith(".css") ? "text/css" : "text/javascript";
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-cache" });
    res.end(readFileSync(file));
    return true;
  }

  return false;
}

/** A running dev-mode UI build: serves the compiled assets and rebuilds on edit. */
interface DevUi {
  serve(req: IncomingMessage, res: ServerResponse): boolean;
  close(): Promise<void>;
}

const DEV_UI_FILES: Record<string, string> = {
  "/app.js": "text/javascript",
  "/app.css": "text/css",
  "/app.js.map": "application/json",
  "/app.css.map": "application/json",
  "/favicon.ico": "image/x-icon",
};

/**
 * Compiles the project's `ui/` in watch mode and serves it at `/`.
 *
 * Returns null when there is no `ui/` — dev then falls back to the built-in
 * `<agent-chat>` page, which is what a project that deleted its frontend (or
 * predates the `ui/` convention) should still get.
 *
 * A failing build is deliberately non-fatal: the watcher stays up, the error
 * prints, and the next successful rebuild pushes a reload to the browser. Dev
 * servers that exit on a typo are miserable.
 */
async function startDevUi(projectRoot: string, title: string): Promise<DevUi | null> {
  let sources;
  try {
    sources = resolveUiSources(projectRoot);
  } catch (err) {
    console.log(`  ${grey("⚠")} ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!sources) return null;

  let esbuild: typeof import("esbuild");
  try {
    esbuild = await import("esbuild");
  } catch {
    console.log(`  ${grey("⚠")} ui/ found but esbuild is unavailable — serving the default chat page`);
    return null;
  }

  const outDir = join(projectRoot, ".arcie", "dev");
  mkdirSync(outDir, { recursive: true });

  const clients = new Set<ServerResponse>();
  const reloadPlugin: import("esbuild").Plugin = {
    name: "arcie-dev-reload",
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          for (const e of result.errors) {
            console.log(`  ${grey("✖")} ui · ${e.text}`);
          }
          return;
        }
        for (const client of clients) client.write("data: reload\n\n");
      });
    },
  };

  const ctx = await esbuild.context({
    ...uiBuildOptions(projectRoot, sources, join(outDir, "app.js"), "development"),
    plugins: [reloadPlugin],
  });

  // Build once up front so the first request is served something, then watch.
  try {
    await ctx.rebuild();
  } catch {
    /* errors already reported by the onEnd hook */
  }
  await ctx.watch();

  writeFileSync(join(outDir, "index.html"), uiHtml(title, { liveReload: true }));
  copyBundledUiFavicon(outDir);

  return {
    serve(req, res) {
      if ((req.method ?? "GET") !== "GET") return false;
      const url = (req.url ?? "/").split("?")[0]!;

      if (url === "/" || url === "/index.html") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(readFileSync(join(outDir, "index.html")));
        return true;
      }

      // Long-lived reload channel. Held open until the browser goes away.
      if (url === "/_arcie/dev") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 1000\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return true;
      }

      const type = DEV_UI_FILES[url];
      if (type) {
        const file = join(outDir, url.slice(1));
        if (!existsSync(file)) return false;
        res.writeHead(200, {
          "Content-Type": type.startsWith("image/") ? type : `${type}; charset=utf-8`,
          "Cache-Control": "no-cache",
        });
        res.end(readFileSync(file));
        return true;
      }

      return false;
    },
    async close() {
      for (const client of clients) client.end();
      clients.clear();
      await ctx.dispose();
    },
  };
}

export interface DevOptions {
  port: string;
  agentDir?: string;
  input?: boolean;
  /** Serve the Runtime Contract API only — skip the built-in chat widget. */
  noWeb?: boolean;
  /** Skip auto-opening the browser at the chat widget URL. */
  noOpen?: boolean;
}

function checkProviderKeys(modelId: string): string[] {
  const provider = resolveProviderForModel(modelId);
  const missing: string[] = [];

  const envVar = PROVIDER_KEY_NAMES[provider];
  if (envVar && !process.env[envVar] && !getProviderApiKey(provider)) {
    missing.push(envVar);
  }

  return missing;
}

const MAX_PORT_ATTEMPTS = 10;

function tryListen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

async function listenWithFallback(
  server: ReturnType<typeof createServer>,
  startPort: number,
): Promise<number> {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;
    try {
      await tryListen(server, port);
      return port;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error(
    `Could not find a free port in ${startPort}..${startPort + MAX_PORT_ATTEMPTS - 1}`,
  );
}

function isPortFree(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    if (host) probe.listen(port, host);
    else probe.listen(port);
  });
}

async function findFreePort(startPort: number, maxAttempts = MAX_PORT_ATTEMPTS, host?: string): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    // A wildcard bind can succeed while 127.0.0.1 is separately taken
    // (and vice versa), so a port only counts as free when both are —
    // otherwise "localhost" in the browser can resolve to a different
    // server than the one we started.
    const free = host
      ? await isPortFree(port, host)
      : (await isPortFree(port)) && (await isPortFree(port, "127.0.0.1"));
    if (free) return port;
  }
  throw new Error(`No free port in ${startPort}..${startPort + maxAttempts - 1}`);
}

/**
 * The local engine's gateway lives well away from the 3000-range that
 * Next.js walks when its preferred port is taken — otherwise the
 * gateway can occupy the exact port Next falls back to (or vice versa)
 * and the browser lands on the wrong server.
 */
const LOCAL_GATEWAY_BASE_PORT = 41100;

const CLOUD_ENDPOINT = "https://cencori.com/api/v1";

const PROVIDER_KEY_NAMES: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY",
  google: "GOOGLE_API_KEY",
  meta: "TOGETHER_API_KEY",
};

function providerKeyName(provider: string): string {
  return PROVIDER_KEY_NAMES[provider] ?? `${provider.toUpperCase()}_API_KEY`;
}

/** A real Cencori key, not the placeholder we inject for keyless local dev. */
function hasCencoriKey(): boolean {
  const key = process.env.CENCORI_API_KEY;
  return typeof key === "string" && key.length > 0 && key !== "local-dev-key";
}

/** Reachable = any HTTP response at all; only network-level failures count as down. */
async function isReachable(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

interface EngineChoice {
  mode: "explicit" | "cloud" | "local" | "failover" | "cloud-unreachable";
  provider: string;
}

/**
 * Decides which engine serves the agent loop. The product contract is:
 * a CENCORI_API_KEY is the only key a user needs — models come from
 * Cencori. So the cloud gateway is canonical whenever that key exists,
 * and the local engine (direct provider calls) is either a BYOK mode
 * for users without a Cencori key, or an automatic failover when
 * cencori.com is unreachable and a provider key happens to be present.
 * CENCORI_API_URL overrides everything.
 */
async function chooseEngine(agentModel: string): Promise<EngineChoice> {
  const provider = agentModel ? resolveProviderForModel(agentModel) : "";
  const providerKeyAvailable = provider !== "" && getProviderApiKey(provider) !== undefined;

  if (process.env.CENCORI_API_URL) return { mode: "explicit", provider };

  if (hasCencoriKey()) {
    if (await isReachable(CLOUD_ENDPOINT)) return { mode: "cloud", provider };
    if (providerKeyAvailable) return { mode: "failover", provider };
    return { mode: "cloud-unreachable", provider };
  }

  if (providerKeyAvailable) return { mode: "local", provider };
  return { mode: "cloud", provider };
}

function describeEngine(engine: EngineChoice): string {
  switch (engine.mode) {
    case "explicit":
      return process.env.CENCORI_API_URL!;
    case "cloud":
    case "cloud-unreachable":
      return `cencori cloud`;
    case "failover":
      return `local (${engine.provider} direct) ${grey("\xB7")} cloud failover`;
    case "local":
      return `local (${engine.provider} direct)`;
  }
}

/**
 * Boots the local sessions gateway on a loopback port and returns its
 * base URL, or undefined when no port is available.
 */
async function startLocalGateway(): Promise<string | undefined> {
  const gateway = createServer(async (req, res) => {
    if (await handleSessionsRequest(req, res)) return;
    res.writeHead(404);
    res.end();
  });
  try {
    const port = await findFreePort(LOCAL_GATEWAY_BASE_PORT, MAX_PORT_ATTEMPTS, "127.0.0.1");
    await new Promise<void>((resolveListen, rejectListen) => {
      gateway.once("error", rejectListen);
      gateway.listen(port, "127.0.0.1", resolveListen);
    });
    return `http://127.0.0.1:${port}/v1`;
  } catch {
    return undefined;
  }
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start"
      : "xdg-open";
  try {
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.unref();
  } catch {
    // Non-fatal: user can copy the URL from the console.
  }
}

export async function devCommand(options: DevOptions): Promise<void> {
  const config = loadArcieConfig(process.cwd());
  const agentDirPath = pickAgentDir(process.cwd(), options.agentDir, config);
  const requestedPort = parseInt(options.port, 10);
  if (config) {
    for (const warning of config.warnings) console.warn(`  ${grey("⚠")} ${warning}`);
  }

  // Load .env.local from the project root before anything reads env keys.
  // The user puts CENCORI_API_KEY here; if we don't load it, both this
  // process and the spawned `next dev` see nothing.
  loadDotEnv(join(dirname(agentDirPath), ".env.local"));

  if (!process.env.CENCORI_API_KEY) process.env.CENCORI_API_KEY = "local-dev-key";

  showHeader();

  const { diagnostics } = discoverAgent(agentDirPath);
  if (diagnostics.some((d) => d.severity === "error")) {
    for (const d of diagnostics) console.error(`  ${grey("✖")} ${d.code}: ${d.message}`);
    process.exit(1);
  }
  for (const d of diagnostics) console.warn(`  ${grey("⚠")} ${d.code}: ${d.message}`);

  let modelLine = agentDirPath;
  let missingKeys: string[] = [];
  let agentModel = "";
  let agentName = "";
  let channelMiddleware: ((req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<boolean>) | null = null;
  try {
    const agent = await loadAgent(agentDirPath);
    agentModel = agent.manifest.config.model;
    agentName = agent.manifest.config.name ?? "";
    modelLine = `${agentDirPath} ${grey("\xB7")} ${grey(agent.manifest.config.model)}`;
    missingKeys = checkProviderKeys(agent.manifest.config.model);
    channelMiddleware = createChannelMiddleware(agent.manifest.channels);
  } catch {
    /* fall through — dev still runs, /api/chat will error clearly */
  }
  console.log(`  ${modelLine}`);
  console.log();

  // One process, one port, no Next.js: the dev server bundles the local
  // sessions gateway (for BYOK / failover), the built-in <agent-chat> widget,
  // and the Runtime Contract routes the deployed agent will answer.
  const wantsWidget = !options.input && options.noWeb !== true;

  // A project with a ui/ directory serves *its* frontend at "/"; everything
  // else falls back to the built-in widget page.
  const devUi = wantsWidget
    ? await startDevUi(dirname(agentDirPath), agentName || "arcie agent")
    : null;

  const contractHandler = contractRequestHandler({
    agentDir: agentDirPath,
    hotReload: true,
    memory: true,
  });

  const server = createServer(async (req, res) => {
    // Local sessions gateway — serves the agent loop in BYOK mode and as
    // failover when cencori.com is unreachable (mounted at /v1/sessions).
    if (await handleSessionsRequest(req, res)) return;
    // The project's own frontend, compiled from ui/ and rebuilt on save.
    if (devUi?.serve(req, res)) return;
    // Built-in chat widget: host page at "/" + the prebuilt bundle.
    if (wantsWidget && serveWidget(req, res)) return;
    // Runtime Contract: /invoke, /_health, /_manifest, /_agents,
    // /channels/:name, /schedules/:name — the exact surface arcie serve
    // exposes in production, so dev and prod hit the same routes.
    if (await contractHandler(req, res)) return;
    // User-defined channel routes (/api/channels/...).
    if (channelMiddleware && await channelMiddleware(req, res)) return;
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  let boundPort: number;
  try {
    boundPort = await listenWithFallback(server, requestedPort);
  } catch (err) {
    console.error();
    console.error(`  ${grey("✗")} ${err instanceof Error ? err.message : String(err)}`);
    console.error(`  ${dimmed("try: arcie dev --port <n>    # pick your own starting port")}`);
    console.error();
    process.exit(1);
  }

  // A Cencori key means Cencori models — this process's built-in gateway
  // (mounted above at /v1/sessions) only serves the loop in BYOK mode or as
  // failover when cencori.com is unreachable.
  const engine = await chooseEngine(agentModel);
  if (!process.env.CENCORI_API_URL && (engine.mode === "local" || engine.mode === "failover")) {
    process.env.CENCORI_API_URL = `http://127.0.0.1:${boundPort}/v1`;
  }
  console.log(`  ${dimmed(`engine ${grey("\xB7")} ${describeEngine(engine)}`)}`);
  if (engine.mode === "failover") {
    console.log(`  ${grey("!")} cencori.com unreachable ${grey("\xB7")} failing over to local ${engine.provider} until it's back`);
  }
  if (engine.mode === "cloud-unreachable") {
    console.log(`  ${grey("⚠")} cencori.com is unreachable — requests will fail until it recovers`);
    console.log(`  ${dimmed(`  (set ${engine.provider ? providerKeyName(engine.provider) : "a provider key"} in .env.local to fail over locally)`)}`);
  }

  if (boundPort !== requestedPort) {
    console.log(`  ${grey("!")} port ${requestedPort} was in use ${grey("\xB7")} using ${boundPort}`);
  }
  const localUrl = `http://localhost:${boundPort}`;
  if (wantsWidget) {
    console.log(`  ${dimmed(`${devUi ? "ui     " : "chat   "}${localUrl}`)}`);
    if (!devUi && !WIDGET_DIR) {
      console.log(`  ${grey("⚠")} widget bundle missing — run \`npm run build\` in the arcie package`);
    }
  }
  console.log(`  ${dimmed(`api    ${localUrl}/invoke`)}`);
  console.log();
  console.log(`  ${dimmed("set CENCORI_API_KEY to use Cencori models")}`);
  console.log();
  console.log(`  ${dimmed("hot reload  edits to agent/*.ts land on the next request")}`);
  if (devUi) {
    console.log(`  ${dimmed("            edits to ui/* rebuild and refresh the browser")}`);
  }
  console.log();
  console.log(`  ${dimmed("Ctrl+C to stop")}`);
  console.log();

  if (wantsWidget && options.noOpen !== true) openBrowser(localUrl);

  const watcher = startAgentWatcher(agentDirPath);
  const shutdown = () => {
    watcher?.close();
    void devUi?.close();
    server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (options.input) {
    void startBlockChat({ agentDir: agentDirPath });
  }
}

/**
 * Watches the agent directory for `.ts` / `.md` changes and logs which files
 * changed. Actual hot-reload happens in the loader (cache-busted import per
 * request) — the watcher is purely informational.
 */
function startAgentWatcher(agentDirPath: string): FSWatcher | undefined {
  try {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    return watch(agentDirPath, { recursive: true }, (_event, filename) => {
      if (typeof filename !== "string") return;
      if (!filename.endsWith(".ts") && !filename.endsWith(".md")) return;
      seen.add(filename);
      if (debounce !== undefined) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const files = [...seen].sort();
        seen.clear();
        for (const file of files) {
          console.log(`  ${dimmed(`reload · ${file}`)}`);
        }
      }, 150);
    });
  } catch {
    return undefined;
  }
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && value && !process.env[key]) process.env[key] = value;
    }
  } catch {
    /* ignore */
  }
}
