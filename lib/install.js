import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MANAGED_BLOCK_START = "# BEGIN claude-tg-hook";
const MANAGED_BLOCK_END = "# END claude-tg-hook";

function containsHookCommand(value) {
  return (
    typeof value === "string" &&
    /(^|[\s/"'])claude-tg-hook(?=$|[\s"'])/.test(value)
  );
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeAtomic(filePath, content) {
  ensureDirectory(filePath);

  const exists = fs.existsSync(filePath);
  const mode = exists ? fs.statSync(filePath).mode & 0o777 : 0o600;
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  if (exists) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }

  try {
    fs.writeFileSync(temporaryPath, content, { mode });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

function claudeHook(command) {
  return {
    matcher: ".*",
    hooks: [
      {
        type: "command",
        command,
      },
    ],
  };
}

function eventContainsCommand(entries) {
  if (!Array.isArray(entries)) return false;

  return entries.some(
    (entry) =>
      Array.isArray(entry?.hooks) &&
      entry.hooks.some((hook) => containsHookCommand(hook?.command))
  );
}

export function installClaude({
  filePath,
  command = "claude-tg-hook",
} = {}) {
  let config = {};
  const exists = fs.existsSync(filePath);

  if (exists) {
    try {
      config = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      throw new Error(`Invalid Claude JSON config: ${filePath}`);
    }
  }

  if (!config || Array.isArray(config) || typeof config !== "object") {
    throw new Error(`Claude config must contain a JSON object: ${filePath}`);
  }

  if (config.hooks === undefined) config.hooks = {};
  if (
    !config.hooks ||
    Array.isArray(config.hooks) ||
    typeof config.hooks !== "object"
  ) {
    throw new Error(`Claude "hooks" must be a JSON object: ${filePath}`);
  }

  let changed = false;
  for (const event of ["Notification", "Stop"]) {
    if (config.hooks[event] === undefined) config.hooks[event] = [];
    if (!Array.isArray(config.hooks[event])) {
      throw new Error(`Claude hooks.${event} must be an array: ${filePath}`);
    }

    if (!eventContainsCommand(config.hooks[event])) {
      config.hooks[event].push(claudeHook(command));
      changed = true;
    }
  }

  if (changed || !exists) {
    writeAtomic(filePath, JSON.stringify(config, null, 2) + "\n");
  }

  return {
    platform: "Claude",
    filePath,
    changed: changed || !exists,
  };
}

function codexEventBlock(event, command) {
  const status =
    event === "PermissionRequest"
      ? "Sending Telegram approval notification"
      : "Sending Telegram completion notification";

  return `[[hooks.${event}]]
[[hooks.${event}.hooks]]
type = "command"
command = "${command}"
timeout = 10
statusMessage = "${status}"`;
}

function codexManagedBlock(command, events) {
  return `${MANAGED_BLOCK_START}
${events.map((event) => codexEventBlock(event, command)).join("\n\n")}
${MANAGED_BLOCK_END}`;
}

function codexEventContainsCommand(content, event) {
  const lines = content.split(/\r?\n/);
  let currentEvent = null;

  for (const line of lines) {
    const match = line.match(/^\s*\[\[hooks\.([A-Za-z]+)\]\]\s*$/);
    if (match) {
      currentEvent = match[1];
      continue;
    }

    if (currentEvent === event && containsHookCommand(line)) {
      return true;
    }
  }

  return false;
}

export function installCodex({
  filePath,
  command = "claude-tg-hook",
} = {}) {
  const exists = fs.existsSync(filePath);
  const original = exists ? fs.readFileSync(filePath, "utf-8") : "";
  const start = original.indexOf(MANAGED_BLOCK_START);
  const end = original.indexOf(MANAGED_BLOCK_END);

  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error(`Malformed claude-tg-hook block in Codex config: ${filePath}`);
  }

  const endOffset = end === -1 ? -1 : end + MANAGED_BLOCK_END.length;
  const unmanaged =
    start === -1
      ? original
      : original.slice(0, start) + original.slice(endOffset);
  const missingEvents = ["PermissionRequest", "Stop"].filter(
    (event) => !codexEventContainsCommand(unmanaged, event)
  );
  const block =
    missingEvents.length > 0 ? codexManagedBlock(command, missingEvents) : "";
  let next;

  if (start !== -1) {
    next = original.slice(0, start) + block + original.slice(endOffset);
  } else if (!block) {
    return {
      platform: "Codex",
      filePath,
      changed: false,
    };
  } else {
    const prefix = original.trimEnd();
    next = prefix ? `${prefix}\n\n${block}\n` : `${block}\n`;
  }

  if (next !== original) {
    writeAtomic(filePath, next);
  }

  return {
    platform: "Codex",
    filePath,
    changed: next !== original,
  };
}

export function resolveConfigPath({
  platform,
  project = false,
  cwd = process.cwd(),
  home = os.homedir(),
}) {
  if (platform === "codex") {
    return project
      ? path.join(cwd, ".codex", "config.toml")
      : path.join(home, ".codex", "config.toml");
  }

  if (platform === "claude") {
    return project
      ? path.join(cwd, ".claude", "settings.json")
      : path.join(home, ".claude", "settings.json");
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

export function installHooks({
  codex = false,
  claude = false,
  project = false,
  cwd = process.cwd(),
  home = os.homedir(),
  command = "claude-tg-hook",
} = {}) {
  if (!codex && !claude) {
    throw new Error("Choose at least one platform: --codex or --claude");
  }

  const results = [];

  if (codex) {
    results.push(
      installCodex({
        filePath: resolveConfigPath({
          platform: "codex",
          project,
          cwd,
          home,
        }),
        command,
      })
    );
  }

  if (claude) {
    results.push(
      installClaude({
        filePath: resolveConfigPath({
          platform: "claude",
          project,
          cwd,
          home,
        }),
        command,
      })
    );
  }

  return results;
}

export const installerMarkers = {
  start: MANAGED_BLOCK_START,
  end: MANAGED_BLOCK_END,
};
