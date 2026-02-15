# claude-tg-hook

Telegram notification hook for Claude Code. Sends you a message when Claude needs attention or finishes a task.

## Setup

### 1. Set environment variables

Add these to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token-here"
export TELEGRAM_CHAT_ID="your-chat-id-here"
```

Source your shell profile (`~/.zshrc`, `~/.bashrc`, etc.)

```bash
source ~/.zshrc
```

**How to get these:**

- **Bot token**: Message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`, and copy the token
- **Chat ID**: Message your bot, then open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser — your chat ID is in `result[0].message.chat.id`

Reload your shell after adding:

```bash
source ~/.zshrc
```

### 2. Install

```bash
npm install -g claude-tg-hook
```

### Building from source

```bash
git clone <repo-url>
cd claude-tg-hook
npm link
```

`npm link` symlinks the CLI into your global `node_modules`, so any edits to the source take effect immediately — no rebuild needed.

### 3. Configure Claude Code hooks

Add to `~/.claude/settings.json`:

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

## What it does

| Event | Telegram message |
|-------|-----------------|
| **Notification** | The notification text + project folder name, e.g. `Claude needs your permission [my-project]` |
| **Stop** | `Done: <project-folder-name>` |

## Logs

Last 20 messages are logged to `/tmp/claude-tg-hook.log.json`.

View logs:

```bash
claude-tg-hook log
```

Follow new entries in real time (like `tail -f`):

```bash
claude-tg-hook log -f
```

Output:

```
[+] 2026-02-15 00:21:23  Notification  Claude needs your approval for the plan [pdf_qr/frontend]
[+] 2026-02-15 00:22:10  Stop  Done: pdf_qr/frontend
```

Each log entry also stores the full raw JSON from Claude Code for debugging.

## License

MIT
