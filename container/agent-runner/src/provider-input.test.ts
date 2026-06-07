import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { MessageInRow } from './db/messages-in.js';

const sessionDir = `/tmp/nanoclaw-provider-input-test-${process.pid}`;
const inboxDir = path.join(sessionDir, 'inbox', 'msg-vision');
const imagePath = path.join(inboxDir, 'photo.png');

function row(content: object): MessageInRow {
  return {
    id: 'msg-vision',
    seq: 1,
    kind: 'chat-sdk',
    timestamp: '2026-06-07T00:00:00.000Z',
    status: 'pending',
    content: JSON.stringify(content),
    platform_id: null,
    channel_type: null,
    thread_id: null,
    process_after: null,
    recurrence: null,
    source_session_id: null,
    trigger: 1,
    on_wake: 0,
  };
}

beforeEach(() => {
  process.env.NANOCLAW_SESSION_DIR = sessionDir;
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(imagePath, 'png-bytes');
});

afterEach(() => {
  fs.rmSync(sessionDir, { recursive: true, force: true });
  delete process.env.NANOCLAW_SESSION_DIR;
});

describe('provider image input', () => {
  it('extracts local image attachments as localImage input parts', async () => {
    const { extractImageInputs } = await import('./provider-input.js');
    const msg = row({
      sender: 'Alice',
      text: 'What is in this image?',
      attachments: [{ type: 'image', name: 'photo.png', mimeType: 'image/png', localPath: 'inbox/msg-vision/photo.png' }],
    });

    expect(extractImageInputs([msg])).toEqual([{ type: 'localImage', path: imagePath }]);
  });

  it('keeps the XML prompt and appends image parts for multimodal providers', async () => {
    const { buildProviderInput } = await import('./provider-input.js');
    const msg = row({
      sender: 'Alice',
      text: 'Describe this.',
      attachments: [{ type: 'image', name: 'photo.png', mimeType: 'image/png', localPath: 'inbox/msg-vision/photo.png' }],
    });

    const input = buildProviderInput([msg], false);

    expect(input.prompt).toContain('Describe this.');
    expect(input.prompt).toContain(`saved to ${imagePath}`);
    expect(input.input[0]).toMatchObject({ type: 'text' });
    expect(input.input[1]).toEqual({ type: 'localImage', path: imagePath });
  });
});
