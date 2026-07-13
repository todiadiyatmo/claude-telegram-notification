import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildMessage,
  normalizePayload,
  parsePayload,
  readPayload,
  runCli,
  sendTelegram,
} from "../bin/cli.js";

test("preserves Claude Notification messages", () => {
  const payload = normalizePayload({
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    message: "Claude needs your permission",
    cwd: "/work/example",
    session_id: "claude-session",
  });

  assert.equal(payload.source, "claude");
  assert.equal(payload.normalizedEvent, "approval_required");
  assert.equal(
    buildMessage(payload),
    "Claude needs your permission [work/example]"
  );
});

test("maps Claude PermissionRequest and Stop events", () => {
  const permission = normalizePayload({
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    cwd: "/work/example",
  });
  const stop = normalizePayload({
    hook_event_name: "Stop",
    cwd: "/work/example",
  });

  assert.equal(
    buildMessage(permission),
    "Claude needs approval: Bash [work/example]"
  );
  assert.equal(buildMessage(stop), "Done: work/example");
});

test("maps Codex PermissionRequest and Stop events", () => {
  const permission = normalizePayload({
    hook_event_name: "PermissionRequest",
    turn_id: "turn-1",
    tool_name: "shell",
    tool_input: { description: "Run the test suite" },
    cwd: "/work/example",
  });
  const stop = normalizePayload({
    hook_event_name: "Stop",
    turn_id: "turn-1",
    cwd: "/work/example",
  });

  assert.equal(permission.source, "codex");
  assert.equal(
    buildMessage(permission),
    "Codex needs approval: Run the test suite [work/example]"
  );
  assert.equal(buildMessage(stop), "Done: work/example [Codex]");
});

test("maps Codex notify agent-turn-complete payloads", async () => {
  const raw = JSON.stringify({
    type: "agent-turn-complete",
    "thread-id": "thread-1",
    "turn-id": "turn-1",
    cwd: "/work/example",
    "last-assistant-message": "Finished",
  });
  const data = await readPayload([raw]);
  const payload = normalizePayload(data);

  assert.equal(payload.source, "codex");
  assert.equal(payload.sessionId, "thread-1");
  assert.equal(payload.normalizedEvent, "turn_complete");
  assert.equal(buildMessage(payload), "Done: work/example [Codex]");
});

test("returns null for invalid JSON", () => {
  assert.equal(parsePayload("{invalid"), null);
});

test("uses an unknown project when cwd is missing", () => {
  const payload = normalizePayload({
    hook_event_name: "PermissionRequest",
    turn_id: "turn-1",
  });

  assert.equal(
    buildMessage(payload),
    "Codex needs approval: Needs your attention [unknown]"
  );
});

test("times out Telegram requests without rejecting", async () => {
  function fakeRequest() {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {};
    request.setTimeout = (_timeout, callback) => callback();
    request.destroy = (error) => request.emit("error", error);
    return request;
  }

  const result = await sendTelegram(
    "token",
    "chat",
    "message",
    fakeRequest,
    10
  );

  assert.deepEqual(result, {
    ok: false,
    description: "Telegram request timed out after 10ms",
  });
});

test("returns valid JSON for Codex Stop hooks", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tg-hook-"));
  const logPath = path.join(directory, "log.json");
  let output = "";

  function fakeSuccessRequest(_options, callback) {
    const request = new EventEmitter();
    request.write = () => {};
    request.setTimeout = () => {};
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const response = new EventEmitter();
      callback(response);
      response.emit("data", Buffer.from('{"ok":true}'));
      response.emit("end");
    };
    return request;
  }

  await runCli({
    args: [
      JSON.stringify({
        hook_event_name: "Stop",
        turn_id: "turn-1",
        cwd: "/work/example",
      }),
    ],
    env: {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
    },
    stdout: { write: (text) => (output += text) },
    stderr: { write: () => {} },
    telegramRequest: fakeSuccessRequest,
    logPath,
  });

  assert.deepEqual(JSON.parse(output), { continue: true });
  assert.equal(JSON.parse(fs.readFileSync(logPath, "utf-8"))[0].source, "codex");
  fs.rmSync(directory, { recursive: true, force: true });
});

test("runs the project-scoped installer from the CLI", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tg-hook-"));
  let output = "";
  let errorOutput = "";

  const exitCode = await runCli({
    args: ["install", "--codex", "--claude", "--project"],
    cwd: directory,
    stdout: { write: (text) => (output += text) },
    stderr: { write: (text) => (errorOutput += text) },
  });

  assert.equal(exitCode, 0);
  assert.equal(errorOutput, "");
  assert.match(output, /Installed Codex hooks/);
  assert.match(output, /Installed Claude hooks/);
  assert.equal(
    fs.existsSync(path.join(directory, ".codex", "config.toml")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(directory, ".claude", "settings.json")),
    true
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

test("rejects installer calls without a platform", async () => {
  let errorOutput = "";

  const exitCode = await runCli({
    args: ["install"],
    stdout: { write: () => {} },
    stderr: { write: (text) => (errorOutput += text) },
  });

  assert.equal(exitCode, 1);
  assert.match(errorOutput, /Choose at least one platform/);
});

test("runs when invoked through an npm-style executable symlink", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tg-hook-"));
  const executable = path.join(directory, "claude-tg-hook");
  const cliPath = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
  fs.symlinkSync(cliPath, executable);

  const result = spawnSync(
    executable,
    ["install", "--codex", "--project"],
    {
      cwd: directory,
      encoding: "utf-8",
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Installed Codex hooks/);
  assert.equal(
    fs.existsSync(path.join(directory, ".codex", "config.toml")),
    true
  );
  fs.rmSync(directory, { recursive: true, force: true });
});
