import fs from 'fs';
import path from 'path';

import type { MessageInRow } from './db/messages-in.js';
import { categorizeMessage, formatMessages } from './formatter.js';
import { SESSION_DIR } from './paths.js';
import type { ProviderInputItem } from './providers/types.js';

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.webp']);
const IMAGE_TYPES = new Set(['image', 'photo', 'sticker']);

/**
 * Format messages for provider input. Text-only providers use `prompt`.
 * Multimodal providers can use `input`, which appends image parts for
 * attachments already saved into the session inbox by the host.
 */
export function buildProviderInput(
  messages: MessageInRow[],
  nativeSlashCommands: boolean,
): { prompt: string; input: ProviderInputItem[] } {
  const prompt = formatMessagesWithCommands(messages, nativeSlashCommands);
  return {
    prompt,
    input: [{ type: 'text', text: prompt }, ...extractImageInputs(messages)],
  };
}

/**
 * Format messages, handling passthrough commands differently.
 * When the provider handles slash commands natively (Claude Code),
 * passthrough commands are sent raw (no XML wrapping) so the SDK can
 * dispatch them. Otherwise they fall through to standard XML formatting.
 */
export function formatMessagesWithCommands(messages: MessageInRow[], nativeSlashCommands: boolean): string {
  const parts: string[] = [];
  const normalBatch: MessageInRow[] = [];

  for (const msg of messages) {
    if (nativeSlashCommands && (msg.kind === 'chat' || msg.kind === 'chat-sdk')) {
      const cmdInfo = categorizeMessage(msg);
      if (cmdInfo.category === 'passthrough' || cmdInfo.category === 'admin') {
        if (normalBatch.length > 0) {
          parts.push(formatMessages(normalBatch));
          normalBatch.length = 0;
        }
        parts.push(cmdInfo.text);
        continue;
      }
    }
    normalBatch.push(msg);
  }

  if (normalBatch.length > 0) {
    parts.push(formatMessages(normalBatch));
  }

  return parts.join('\n\n');
}

export function extractImageInputs(messages: MessageInRow[]): ProviderInputItem[] {
  const images: ProviderInputItem[] = [];
  for (const msg of messages) {
    const content = parseContent(msg.content);
    const attachments = content.attachments;
    if (!Array.isArray(attachments)) continue;
    for (const attachment of attachments) {
      if (!isImageAttachment(attachment)) continue;
      const localPath = typeof attachment.localPath === 'string' ? path.join(SESSION_DIR, attachment.localPath) : '';
      if (localPath && fs.existsSync(localPath)) {
        images.push({ type: 'localImage', path: localPath });
        continue;
      }
      if (typeof attachment.url === 'string' && attachment.url) {
        images.push({ type: 'image', url: attachment.url });
      }
    }
  }
  return images;
}

function isImageAttachment(attachment: unknown): attachment is Record<string, unknown> {
  if (!attachment || typeof attachment !== 'object') return false;
  const a = attachment as Record<string, unknown>;
  const mimeType = typeof a.mimeType === 'string' ? a.mimeType.toLowerCase() : '';
  if (mimeType.startsWith('image/')) return true;
  const type = typeof a.type === 'string' ? a.type.toLowerCase() : '';
  if (IMAGE_TYPES.has(type)) return true;
  const name = typeof a.name === 'string' ? a.name : typeof a.filename === 'string' ? a.filename : '';
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function parseContent(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
