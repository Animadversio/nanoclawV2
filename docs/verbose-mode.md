# Verbose Mode

Verbose mode lets a user ask an agent to narrate tool calls and meaningful progress in the same channel before the final answer.

## Commands

On Discord, use the native `/verbose` application command. It provides a `mode` picker with `all`, `edit`, `bash`, and `off`.

These text aliases also work as normal channel messages, including Discord fallback cases where the bot was invited without the `applications.commands` scope:

| Command | Behavior |
| --- | --- |
| `/verbose` or `!verbose` | Narrate all visible tool calls and meaningful progress. |
| `/verbose edit` or `!verbose edit` | Narrate commands, edits, writes, and sub-agent work. |
| `/verbose bash` or `!verbose bash` | Narrate Bash/tool-command activity only. |
| `/quiet`, `!quiet`, `/verbose off`, or `!verbose off` | Turn verbose mode off. |

The setting is per agent group and persists across restarts in `groups/<folder>/.verbose`.

Discord application-command registration happens on host startup. If `/verbose` does not appear, re-invite the bot with the `applications.commands` OAuth scope, then restart NanoClaw.

## Runtime Behavior

The agent runner reads `.verbose` before each provider turn and again for each tool-call event, so toggles take effect without restarting NanoClaw. Tool-call messages are redacted before delivery to avoid leaking common API keys, auth headers, token flags, env var assignments, URL credentials, GitHub tokens, or Discord bot tokens.

Codex and Claude providers both surface tool-call events into the shared poll loop. The poll loop writes verbose notifications directly to `messages_out`, so delivery uses the normal channel adapter path.
