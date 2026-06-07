import fs from 'fs';
import path from 'path';

import type { MessageInRow } from './db/messages-in.js';
import { AGENT_DIR } from './paths.js';

export type VerboseLevel = 'all' | 'edit' | 'bash';

const VERBOSE_LEVELS = new Set<VerboseLevel>(['all', 'edit', 'bash']);

const SKIP_VERBOSE_TOOLS = new Set([
  'mcp__nanoclaw__send_message',
  'mcp__nanoclaw__send_file',
  'mcp__nanoclaw__edit_message',
  'mcp__nanoclaw__add_reaction',
  'mcp__nanoclaw__list_tasks',
  'TodoWrite',
  'NotebookEdit',
]);

const EDIT_VERBOSE_TOOLS = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'Task', 'Agent']);

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***'],
  [/\bghp_[A-Za-z0-9]{10,}/g, 'ghp_***'],
  [/\bgho_[A-Za-z0-9]{10,}/g, 'gho_***'],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/g, 'github_pat_***'],
  // Discord bot tokens: base64url(userId).base64url(ts).base64url(hmac)
  [/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g, '***'],
  [/(Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/=]{8,}/g, '$1 ***'],
  [/(--(?:api[_-]?key|token|password|secret|credential|auth)[\s=])(?:"[^"]*"|'[^']*'|[^\s'";&|]+)/gi, '$1***'],
  [/\b([A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|OAUTH|PRIVATE_KEY)[A-Z_]*=)(?:"[^"]*"|'[^']*'|[^\s'";&|]+)/g, '$1***'],
  [/([?&](?:api[_-]?key|token|secret|password|credential|auth)=)[^&\s'"]+/gi, '$1***'],
];

export interface ToolCallInfo {
  name: string;
  input?: Record<string, unknown>;
}

export interface VerboseCommandResult {
  matched: boolean;
  response?: string;
}

function verboseFlagPath(): string {
  return path.join(AGENT_DIR, '.verbose');
}

export function readVerboseLevel(): VerboseLevel | null {
  try {
    const raw = fs.readFileSync(verboseFlagPath(), 'utf-8').trim().toLowerCase();
    return VERBOSE_LEVELS.has(raw as VerboseLevel) ? (raw as VerboseLevel) : raw ? 'all' : null;
  } catch {
    return null;
  }
}

export function verboseInstructions(level: VerboseLevel | null): string | undefined {
  if (!level) return undefined;
  if (level === 'bash') {
    return [
      '## Verbose Mode',
      'Verbose mode is set to bash. For long-running work, narrate meaningful bash milestones using `send_message` before the final answer. Keep updates short and do not expose secrets.',
    ].join('\n');
  }
  if (level === 'edit') {
    return [
      '## Verbose Mode',
      'Verbose mode is set to edit. For long-running work, narrate meaningful command, edit, write, and sub-agent milestones using `send_message` before the final answer. Keep updates short and do not expose secrets.',
    ].join('\n');
  }
  return [
    '## Verbose Mode',
    'Verbose mode is on. For long-running work, narrate meaningful progress using `send_message` before the final answer. Prefer useful milestones over micro-step narration, and do not expose secrets.',
  ].join('\n');
}

export function parseVerboseCommandText(text: string): VerboseLevel | 'off' | null {
  const normalized = text.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return null;
  const match = normalized.match(/^([!/])(?:verbose|quiet)(?:\s+(all|edit|bash|off))?$/);
  if (!match) return null;
  const command = normalized.split(' ')[0];
  if (command === '!quiet' || command === '/quiet') return 'off';
  const level = match[2];
  return level === 'off' ? 'off' : ((level || 'all') as VerboseLevel);
}

export function handleVerboseCommandMessage(msg: MessageInRow): VerboseCommandResult {
  if (msg.kind !== 'chat' && msg.kind !== 'chat-sdk') return { matched: false };

  let text = '';
  try {
    const parsed = JSON.parse(msg.content) as { text?: unknown };
    text = typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    text = msg.content;
  }

  const command = parseVerboseCommandText(text);
  if (!command) return { matched: false };

  const flagPath = verboseFlagPath();
  if (command === 'off') {
    try {
      fs.unlinkSync(flagPath);
    } catch {
      // Already off.
    }
    return {
      matched: true,
      response: "Verbose mode off. I'll only send final results and normal mid-turn updates.",
    };
  }

  fs.writeFileSync(flagPath, command);
  const response =
    command === 'bash'
      ? "Verbose bash mode on. I'll narrate bash/tool-command activity during longer tasks."
      : command === 'edit'
        ? "Verbose edit mode on. I'll narrate commands, edits, writes, and sub-agent work during longer tasks."
        : "Verbose mode on. I'll narrate tool calls and meaningful progress during longer tasks.";
  return { matched: true, response };
}

export function shouldNotifyTool(level: VerboseLevel, toolName: string): boolean {
  if (SKIP_VERBOSE_TOOLS.has(toolName) || toolName.startsWith('mcp__nanoclaw__')) return false;
  if (level === 'bash') return toolName === 'Bash' || toolName.toLowerCase().includes('bash');
  if (level === 'edit') return EDIT_VERBOSE_TOOLS.has(toolName);
  return true;
}

export function formatToolNotification(level: VerboseLevel | null, tool: ToolCallInfo): string | null {
  if (!level || !shouldNotifyTool(level, tool.name)) return null;
  const input = tool.input ?? {};
  const value = (key: string): string => sanitize(String(input[key] ?? ''));

  switch (tool.name) {
    case 'Bash':
      return `Running command: \`${truncate(value('command'), 150)}\``;
    case 'Read':
      return `Reading \`${truncate(value('file_path'), 150)}\``;
    case 'Write':
      return `Writing \`${truncate(value('file_path'), 150)}\``;
    case 'Edit':
    case 'MultiEdit':
      return `Editing \`${truncate(value('file_path'), 150)}\``;
    case 'Glob':
      return `Globbing \`${truncate(value('pattern'), 150)}\``;
    case 'Grep':
      return `Searching \`${truncate(value('pattern'), 150)}\``;
    case 'WebSearch':
      return `Searching web: ${truncate(value('query'), 150)}`;
    case 'WebFetch':
      return `Fetching ${truncate(value('url'), 150)}`;
    case 'Task':
    case 'Agent':
      return `Starting sub-agent: ${truncate(value('description') || value('prompt') || tool.name, 150)}`;
    default:
      return `Using tool: ${sanitize(tool.name)}`;
  }
}

function sanitize(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
