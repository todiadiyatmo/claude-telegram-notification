import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  installClaude,
  installCodex,
  installHooks,
  installerMarkers,
  resolveConfigPath,
} from "../lib/install.js";

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claude-tg-hook-install-"));
}

test("resolves global and project config paths", () => {
  assert.equal(
    resolveConfigPath({
      platform: "codex",
      home: "/home/test",
    }),
    "/home/test/.codex/config.toml"
  );
  assert.equal(
    resolveConfigPath({
      platform: "claude",
      project: true,
      cwd: "/workspace/project",
    }),
    "/workspace/project/.claude/settings.json"
  );
});

test("creates Claude config and remains idempotent", () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, ".claude", "settings.json");

  const first = installClaude({ filePath });
  const second = installClaude({ filePath });
  const config = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(config.hooks.Notification.length, 1);
  assert.equal(config.hooks.Stop.length, 1);
  assert.equal(
    config.hooks.Stop[0].hooks[0].command,
    "claude-tg-hook"
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

test("preserves existing Claude settings and recognizes npx hooks", () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "settings.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        permissions: { allow: ["Bash(npm *)"] },
        hooks: {
          Notification: [
            {
              matcher: ".*",
              hooks: [
                {
                  type: "command",
                  command: "npx --yes claude-tg-hook",
                },
              ],
            },
          ],
        },
      },
      null,
      2
    )
  );

  const result = installClaude({ filePath });
  const config = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  assert.equal(result.changed, true);
  assert.deepEqual(config.permissions.allow, ["Bash(npm *)"]);
  assert.equal(config.hooks.Notification.length, 1);
  assert.equal(config.hooks.Stop.length, 1);
  assert.equal(fs.existsSync(`${filePath}.bak`), true);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("refuses invalid Claude JSON", () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "settings.json");
  fs.writeFileSync(filePath, "{invalid");

  assert.throws(
    () => installClaude({ filePath }),
    /Invalid Claude JSON config/
  );
  assert.equal(fs.readFileSync(filePath, "utf-8"), "{invalid");
  fs.rmSync(directory, { recursive: true, force: true });
});

test("appends and updates a managed Codex block", () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "config.toml");
  fs.writeFileSync(filePath, 'model = "gpt-5"\n');

  const first = installCodex({ filePath });
  const second = installCodex({ filePath });
  const content = fs.readFileSync(filePath, "utf-8");

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.match(content, /model = "gpt-5"/);
  assert.equal(content.match(/BEGIN claude-tg-hook/g).length, 1);
  assert.match(content, /\[\[hooks\.PermissionRequest\]\]/);
  assert.match(content, /\[\[hooks\.Stop\]\]/);
  assert.equal(fs.existsSync(`${filePath}.bak`), true);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("adds only the missing Codex event beside an unmanaged hook", () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "config.toml");
  const original = `[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "npx --yes claude-tg-hook"
`;
  fs.writeFileSync(filePath, original);

  const result = installCodex({ filePath });
  const content = fs.readFileSync(filePath, "utf-8");

  assert.equal(result.changed, true);
  assert.equal(content.match(/\[\[hooks\.Stop\]\]/g).length, 1);
  assert.equal(content.match(/\[\[hooks\.PermissionRequest\]\]/g).length, 1);
  assert.match(content, /BEGIN claude-tg-hook/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("refuses malformed managed Codex markers", () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "config.toml");
  fs.writeFileSync(filePath, `${installerMarkers.start}\n`);

  assert.throws(
    () => installCodex({ filePath }),
    /Malformed claude-tg-hook block/
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

test("installs both platforms into project scope", () => {
  const directory = temporaryDirectory();
  const results = installHooks({
    codex: true,
    claude: true,
    project: true,
    cwd: directory,
  });

  assert.deepEqual(
    results.map((result) => result.platform),
    ["Codex", "Claude"]
  );
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
