#!/usr/bin/env node

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installHooks } from "../lib/install.js";

const LOG_PATH = "/tmp/claude-tg-hook.log.json";
const MAX_LOG_ENTRIES = 20;
const TELEGRAM_TIMEOUT_MS = 5_000;

export function formatEntry(entry) {
  const time = entry.timestamp?.replace("T", " ").replace(/\.\d+Z$/, "");
  const ok = entry.telegram_ok ? "+" : "x";
  return `[${ok}] ${time}  ${entry.event}  ${entry.text}`;
}

export function readLogs(logPath = LOG_PATH) {
  try {
    return JSON.parse(fs.readFileSync(logPath, "utf-8"));
  } catch {
    return [];
  }
}

async function readStdin(input = process.stdin) {
  const chunks = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function parsePayload(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function readPayload(args = [], input = process.stdin) {
  if (args[0]) {
    return parsePayload(args[0]);
  }

  return parsePayload(await readStdin(input));
}

function detectSource(data) {
  if (
    data.type === "agent-turn-complete" ||
    data.turn_id ||
    data["turn-id"]
  ) {
    return "codex";
  }

  return "claude";
}

function normalizeEvent(event, data) {
  if (
    event === "PermissionRequest" ||
    (event === "Notification" && data.notification_type === "permission_prompt")
  ) {
    return "approval_required";
  }

  if (event === "Stop" || event === "agent-turn-complete") {
    return "turn_complete";
  }

  return event || "unknown";
}

function getDescription(data) {
  return (
    data.message ||
    data.description ||
    data.tool_input?.description ||
    data.reason ||
    data.tool_name ||
    "Needs your attention"
  );
}

export function normalizePayload(data) {
  const source = detectSource(data);
  const event = data.hook_event_name || data.type || "unknown";

  return {
    source,
    event,
    normalizedEvent: normalizeEvent(event, data),
    cwd: data.cwd || null,
    sessionId: data.session_id || data["thread-id"] || null,
    description: getDescription(data),
    raw: data,
  };
}

function getProjectLabel(cwd) {
  return cwd ? cwd.split(path.sep).slice(-2).join("/") : "unknown";
}

export function buildMessage(payload) {
  const dir = getProjectLabel(payload.cwd);

  if (payload.source === "claude" && payload.event === "Notification") {
    return `${payload.description} [${dir}]`;
  }

  if (payload.normalizedEvent === "approval_required") {
    const prefix = payload.source === "codex" ? "Codex" : "Claude";
    return `${prefix} needs approval: ${payload.description} [${dir}]`;
  }

  if (payload.normalizedEvent === "turn_complete") {
    const suffix = payload.source === "codex" ? " [Codex]" : "";
    return `Done: ${dir}${suffix}`;
  }

  return `[${payload.event}] ${payload.description} [${dir}]`;
}

export function sendTelegram(
  token,
  chatId,
  text,
  request = https.request,
  timeoutMs = TELEGRAM_TIMEOUT_MS
) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ chat_id: chatId, text });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            finish({ ok: false, description: "Invalid JSON response" });
          }
        });
      }
    );

    req.on("error", (error) => {
      finish({ ok: false, description: error.message });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Telegram request timed out after ${timeoutMs}ms`));
    });

    req.write(payload);
    req.end();
  });
}

export function appendLog(entry, logPath = LOG_PATH) {
  let logs = readLogs(logPath);
  if (!Array.isArray(logs)) logs = [];

  logs.push(entry);

  if (logs.length > MAX_LOG_ENTRIES) {
    logs = logs.slice(-MAX_LOG_ENTRIES);
  }

  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2) + "\n");
}

function runLogCommand(args) {
  const follow = args.includes("-f");
  const logs = readLogs();

  for (const entry of logs) {
    console.log(formatEntry(entry));
  }

  if (!follow) return Promise.resolve();

  let previous = JSON.stringify(logs);
  return new Promise(() => {
    fs.watchFile(LOG_PATH, { interval: 500 }, () => {
      const current = readLogs();
      const serialized = JSON.stringify(current);
      if (serialized === previous) return;

      const previousEntries = JSON.parse(previous);
      const previousLast = previousEntries.at(-1)?.timestamp;
      const start = Math.max(
        0,
        current.findIndex((entry) => entry.timestamp === previousLast) + 1
      );

      for (let index = start; index < current.length; index++) {
        console.log(formatEntry(current[index]));
      }

      previous = serialized;
    });
  });
}

function installUsage() {
  return `Usage:
  claude-tg-hook install --codex [--project]
  claude-tg-hook install --claude [--project]
  claude-tg-hook install --codex --claude [--project]

Options:
  --codex   Install Codex PermissionRequest and Stop hooks
  --claude  Install Claude Notification and Stop hooks
  --project Write config below the current working directory
  --help    Show this help
`;
}

function runInstallCommand(args, stdout, stderr, options = {}) {
  const flags = new Set(args.slice(1));
  const supported = new Set(["--codex", "--claude", "--project", "--help"]);
  const unknown = [...flags].filter((flag) => !supported.has(flag));

  if (flags.has("--help")) {
    stdout.write(installUsage());
    return 0;
  }

  if (unknown.length > 0) {
    stderr.write(`claude-tg-hook: unknown option ${unknown[0]}\n`);
    stderr.write(installUsage());
    return 1;
  }

  try {
    const results = installHooks({
      codex: flags.has("--codex"),
      claude: flags.has("--claude"),
      project: flags.has("--project"),
      cwd: options.cwd,
      home: options.home,
    });

    for (const result of results) {
      const status = result.changed ? "Installed" : "Already installed";
      stdout.write(`${status} ${result.platform} hooks: ${result.filePath}\n`);
    }

    stdout.write(
      "Restart the agent or open a new session, then review hooks with /hooks.\n"
    );
    return 0;
  } catch (error) {
    stderr.write(`claude-tg-hook: ${error.message}\n`);
    return 1;
  }
}

export async function runCli({
  args = process.argv.slice(2),
  input = process.stdin,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  telegramRequest = https.request,
  logPath = LOG_PATH,
  cwd = process.cwd(),
  home,
} = {}) {
  if (args[0] === "install") {
    return runInstallCommand(args, stdout, stderr, { cwd, home });
  }

  if (args[0] === "log" || args[0] === "logs") {
    await runLogCommand(args);
    return 0;
  }

  const data = await readPayload(args, input);
  if (!data) {
    stderr.write("claude-tg-hook: invalid JSON input\n");
    return 0;
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    stderr.write(
      "claude-tg-hook: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set\n"
    );
    return 0;
  }

  const normalized = normalizePayload(data);
  const text = buildMessage(normalized);
  const result = await sendTelegram(
    token,
    chatId,
    text,
    telegramRequest,
    TELEGRAM_TIMEOUT_MS
  );

  appendLog(
    {
      timestamp: new Date().toISOString(),
      source: normalized.source,
      event: normalized.event,
      normalized_event: normalized.normalizedEvent,
      text,
      telegram_ok: result.ok ?? false,
      telegram_error: result.ok ? null : result.description || "Unknown error",
      session_id: normalized.sessionId,
      raw: data,
    },
    logPath
  );

  if (normalized.source === "codex" && normalized.event === "Stop") {
    stdout.write('{"continue":true}\n');
  }

  return 0;
}

function resolveExecutablePath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

const isDirectRun =
  process.argv[1] &&
  resolveExecutablePath(process.argv[1]) ===
    resolveExecutablePath(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error("claude-tg-hook:", error.message);
      process.exitCode = 1;
    });
}
