# Repository Guidelines

## Project Structure & Module Organization

This repository provides a Node.js CLI that forwards Claude Code and Codex hook events to Telegram.

- `bin/cli.js`: executable entry point; handles stdin JSON, Telegram API requests, and log output.
- `lib/install.js`: idempotent Claude and Codex configuration installer.
- `package.json`: package metadata, Node.js version requirement, and the `claude-tg-hook` binary mapping.
- `README.md`: installation and usage documentation.
- `.claude/`: local Claude Code settings; avoid committing machine-specific changes.
- `test/`: Node.js built-in tests for payload handling, delivery failures, and config installation.

Keep command dispatch in `bin/` and reusable behavior in `lib/`. Tests live in `test/` with paths mirroring runtime modules.

## Build, Test, and Development Commands

There is no compilation step or dependency install required.

- `npm test`: run the Node.js built-in test suite.
- `node --check bin/cli.js`: verify JavaScript syntax.
- `npm link`: install a global symlink so edits are immediately available as `claude-tg-hook`.
- `claude-tg-hook log`: print the retained local event log.
- `claude-tg-hook log -f`: follow newly written log entries.
- `npm pack --dry-run`: inspect the files that would be published to npm.

For end-to-end checks, provide hook JSON on stdin with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` set. Use a test bot/chat.

## Coding Style & Naming Conventions

Use modern ECMAScript modules compatible with Node.js 18+. Follow the existing style: two-space indentation, semicolons, double-quoted strings, trailing commas in multiline objects, and one purpose per function. Use `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants, and clear command-oriented filenames. Keep error handling non-throwing where hook execution must not disrupt Claude Code.

## Testing Guidelines

Tests use Node’s built-in test runner; no coverage threshold is configured. Name files `test/*.test.js`. Before submitting changes, run `npm test` plus the syntax and package checks above, then manually exercise Telegram delivery with a test bot when network behavior changes.

## Commit & Pull Request Guidelines

The short history uses brief subjects such as `initial` and `update readme`; prefer clearer imperative messages, for example `Add retry handling for Telegram requests`. Keep commits focused. Pull requests should explain behavior changes, list validation commands, link relevant issues, and include representative terminal output when CLI output changes. Update `README.md` whenever setup, environment variables, commands, or user-visible messages change.

## Security & Configuration

Never commit bot tokens, chat IDs, raw hook payloads, or generated logs. Logs are written to `/tmp/claude-tg-hook.log.json`; inspect them before sharing because they may contain session data.
