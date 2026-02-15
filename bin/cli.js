#!/usr/bin/env node

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
const LOG_PATH = "/tmp/claude-tg-hook.log.json";
const MAX_LOG_ENTRIES = 20;

function formatEntry(entry) {
  const time = entry.timestamp?.replace("T", " ").replace(/\.\d+Z$/, "");
  const ok = entry.telegram_ok ? "+" : "x";
  return `[${ok}] ${time}  ${entry.event}  ${entry.text}`;
}

function readLogs() {
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
  } catch {
    return [];
  }
}

// Subcommand: claude-tg-hook log [-f]
if (process.argv[2] === "log" || process.argv[2] === "logs") {
  const follow = process.argv.includes("-f");
  const logs = readLogs();

  for (const entry of logs) {
    console.log(formatEntry(entry));
  }

  if (!follow) process.exit(0);

  let seen = logs.length;
  fs.watchFile(LOG_PATH, { interval: 500 }, () => {
    const current = readLogs();
    for (let i = seen; i < current.length; i++) {
      console.log(formatEntry(current[i]));
    }
    seen = current.length;
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function buildMessage(data) {
  const event = data.hook_event_name;
  const dir = data.cwd
    ? data.cwd.split(path.sep).slice(-2).join("/")
    : "unknown";

  if (event === "Notification") {
    const msg = data.message || "Needs your attention";
    return `${msg} [${dir}]`;
  }

  if (event === "Stop") {
    return `Done: ${dir}`;
  }

  return `[${event}] ${data.message || JSON.stringify(data)}`;
}

function sendTelegram(token, chatId, text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ chat_id: chatId, text });

    const req = https.request(
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
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve({ ok: false, description: "Invalid JSON response" });
          }
        });
      }
    );

    req.on("error", (err) => {
      resolve({ ok: false, description: err.message });
    });

    req.write(payload);
    req.end();
  });
}

function appendLog(entry) {
  let logs = [];
  try {
    const raw = fs.readFileSync(LOG_PATH, "utf-8");
    logs = JSON.parse(raw);
    if (!Array.isArray(logs)) logs = [];
  } catch {
    logs = [];
  }

  logs.push(entry);

  if (logs.length > MAX_LOG_ENTRIES) {
    logs = logs.slice(-MAX_LOG_ENTRIES);
  }

  fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2) + "\n");
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("claude-tg-hook: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set");
    process.exit(0);
  }

  const raw = await readStdin();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("claude-tg-hook: invalid JSON on stdin");
    process.exit(0);
  }

  const text = buildMessage(data);
  const result = await sendTelegram(token, chatId, text);

  appendLog({
    timestamp: new Date().toISOString(),
    event: data.hook_event_name || "unknown",
    text,
    telegram_ok: result.ok ?? false,
    session_id: data.session_id || null,
    raw: data,
  });
}

main().catch((err) => {
  console.error("claude-tg-hook:", err.message);
  process.exit(0);
});
