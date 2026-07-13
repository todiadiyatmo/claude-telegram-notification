# claude-tg-hook

Telegram notification hook for Claude Code and Codex. It sends a message when an
agent needs approval or finishes a turn.

## Setup

### 1. Set up a Telegram bot

- **Bot token**: message [@BotFather](https://t.me/BotFather), run `/newbot`,
  and copy the token.
- **Chat ID**: message your bot, then open
  `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`. The ID is available at
  `result[0].message.chat.id`.

### 2. Set environment variables

Add these variables to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token-here"
export TELEGRAM_CHAT_ID="your-chat-id-here"
```

Reload the profile, for example:

```bash
source ~/.zshrc
```

### 3. Install

```bash
npm install -g claude-tg-hook
```

To develop from source:

```bash
git clone <repo-url>
cd claude-tg-hook
npm link
```

`npm link` creates a global development symlink, so edits take effect without a
build step.

## Automatic hook installation

Install hooks into the current user's global configuration:

```bash
claude-tg-hook install --codex
claude-tg-hook install --claude
claude-tg-hook install --codex --claude
```

Add `--project` to write below the current working directory instead:

```bash
claude-tg-hook install --codex --project
claude-tg-hook install --claude --project
```

| Target | Global path | Project path |
|---|---|---|
| Codex | `~/.codex/config.toml` | `.codex/config.toml` |
| Claude Code | `~/.claude/settings.json` | `.claude/settings.json` |

The installer creates missing directories, preserves unrelated settings, and
does not duplicate existing `claude-tg-hook` commands. Before changing an
existing file, it writes a sibling `.bak` backup. Claude JSON is merged
structurally. Codex hooks are maintained inside a
`# BEGIN claude-tg-hook` / `# END claude-tg-hook` block.

After installation, restart the agent or open a new session. Use `/hooks` to
review detected hooks; project-level Codex hooks require a trusted repository.

## Claude Code configuration

The installer above is recommended. For manual setup, add the hooks to
`~/.claude/settings.json`:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx --yes claude-tg-hook"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx --yes claude-tg-hook"
          }
        ]
      }
    ]
  }
}
```

For direct approval events, `PermissionRequest` can be configured in the same
way as `Notification`.

## Codex configuration

The installer above is recommended. For manual setup, add lifecycle hooks to
`~/.codex/config.toml`, or to `.codex/config.toml` for a trusted project:

```toml
[[hooks.PermissionRequest]]
[[hooks.PermissionRequest.hooks]]
type = "command"
command = "npx --yes claude-tg-hook"
timeout = 10
statusMessage = "Sending Telegram approval notification"

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "npx --yes claude-tg-hook"
timeout = 10
statusMessage = "Sending Telegram completion notification"
```

Restart Codex or open a new session, then use `/hooks` to review the discovered
hooks. Project hooks only run for trusted repositories.

Codex also provides a simpler completion-only `notify` option:

```toml
notify = ["npx", "--yes", "claude-tg-hook"]
```

`notify` sends an `agent-turn-complete` JSON payload as the command's first
argument. Do not configure both `notify` and `hooks.Stop` for this package,
because both fire at turn completion and would send duplicate messages.

See the official [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
and [Codex hooks reference](https://developers.openai.com/codex/hooks).

## Claude Code vs Codex hooks

### Hook mechanism

| Aspect | Claude Code | Codex |
|---|---|---|
| Global configuration | `~/.claude/settings.json` | `~/.codex/config.toml` |
| Project configuration | `.claude/settings.json` | `.codex/config.toml` |
| Lifecycle hook input | JSON on stdin | JSON on stdin |
| External notification API | `Notification` lifecycle hook | `notify` command |
| Approval notification | `PermissionRequest` or `Notification` | `PermissionRequest` |
| Turn completion | `Stop` | `Stop` or `notify: agent-turn-complete` |
| Hook review | `/hooks` | `/hooks`; project must be trusted |

### Event mapping

| Purpose | Claude Code event | Codex event | Mapping |
|---|---|---|---|
| Session starts | `SessionStart` | `SessionStart` | Direct |
| Prompt submitted | `UserPromptSubmit` | `UserPromptSubmit` | Direct |
| Subagent starts | `SubagentStart` | `SubagentStart` | Direct |
| Before a tool runs | `PreToolUse` | `PreToolUse` | Direct |
| Approval required | `PermissionRequest` / `Notification` | `PermissionRequest` | `approval_required` |
| Tool succeeds | `PostToolUse` | `PostToolUse` | Direct |
| Tool fails | `PostToolUseFailure` | No dedicated event | Partial: Codex `PostToolUse` may include a failed tool result |
| Before compaction | `PreCompact` | `PreCompact` | Direct |
| After compaction | `PostCompact` | `PostCompact` | Direct |
| Subagent finishes | `SubagentStop` | `SubagentStop` | Direct |
| Turn finishes | `Stop` | `Stop` / `agent-turn-complete` | `turn_complete` |
| Session ends | `SessionEnd` | No direct event | Claude-only |

Claude Code also exposes lifecycle events without direct Codex equivalents,
including `Setup`, general-purpose `Notification`, `StopFailure`,
`TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, and
`WorktreeRemove`. Codex `notify` is a separate external notification mechanism,
not a lifecycle hook.

This package currently sends Telegram messages only for approval and turn
completion events; the other rows document how the two hook systems relate.

## Devcontainer installation

When testing an unpublished local build inside a running devcontainer, create a
tarball on the host and install it inside the container:

```bash
# Run in this repository on the host.
npm pack --pack-destination /tmp

docker cp /tmp/claude-tg-hook-1.0.0.tgz <container>:/tmp/
docker exec -u node <container> \
  npm install -g /tmp/claude-tg-hook-1.0.0.tgz
```

Then install project hooks from the mounted workspace:

```bash
docker exec -u node -w /workspace <container> \
  claude-tg-hook install --codex --project

docker exec -u node -w /workspace <container> \
  claude-tg-hook install --claude --project
```

The Telegram environment variables must be available to the Claude or Codex
process inside the container. Verify installation without sending a message:

```bash
docker exec -u node <container> command -v claude-tg-hook
docker exec -u node -w /workspace <container> \
  claude-tg-hook install --codex --project
```

The second install should report `Already installed`. Restart the agent and run
`/hooks` before manually triggering approval and completion events.

## Messages

| Source event | Telegram message |
|---|---|
| Claude `Notification` | Notification text plus project path |
| Claude `PermissionRequest` | `Claude needs approval: <description> [project]` |
| Claude `Stop` | `Done: <project>` |
| Codex `PermissionRequest` | `Codex needs approval: <description> [project]` |
| Codex `Stop` / `agent-turn-complete` | `Done: <project> [Codex]` |

## Logs

The last 20 messages are stored in `/tmp/claude-tg-hook.log.json`.

```bash
claude-tg-hook log
claude-tg-hook log -f
```

Example:

```text
[+] 2026-02-15 00:21:23  PermissionRequest  Codex needs approval: Run tests [my-project]
[+] 2026-02-15 00:22:10  Stop  Done: my-project [Codex]
```

Each entry stores the source, original event, normalized event, delivery result,
and raw hook payload. Raw payloads may contain sensitive session information.

## Development

```bash
npm test
node --check bin/cli.js
npm pack --dry-run
```

## License

MIT
