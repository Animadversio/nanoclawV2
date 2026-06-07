import { describe, it, expect } from 'bun:test';

import {
  type AppServer,
  STALE_THREAD_RE,
  initializeCodexAppServer,
  interruptCodexTurn,
  startCodexTurn,
  steerCodexTurn,
  tomlBasicString,
} from './codex-app-server.js';

function fakeServer(
  result: unknown,
  messages: Array<{ id?: number; method: string; params: Record<string, unknown> }>,
): AppServer {
  const pending = new Map<
    number,
    { resolve: (response: { id: number; result?: unknown }) => void; reject: (err: Error) => void }
  >();
  const stdin = {
    write(line: string): boolean {
      const message = JSON.parse(line) as { id?: number; method: string; params: Record<string, unknown> };
      messages.push(message);
      if (message.id !== undefined) {
        queueMicrotask(() => pending.get(message.id!)?.resolve({ id: message.id!, result }));
      }
      return true;
    },
  };

  return {
    process: { stdin } as unknown as AppServer['process'],
    readline: { close() {} } as unknown as AppServer['readline'],
    pending,
    notificationHandlers: [],
    serverRequestHandlers: [],
  };
}

describe('initialize handshake', () => {
  it('sends initialized after the initialize response', async () => {
    const messages: Array<{ id?: number; method: string; params: Record<string, unknown> }> = [];
    const server = fakeServer({ userAgent: 'codex-test' }, messages);

    await initializeCodexAppServer(server);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      method: 'initialize',
      params: {
        clientInfo: { name: 'nanoclaw', version: '1.0.0' },
        capabilities: { experimentalApi: false },
      },
    });
    expect(messages[1]).toEqual({ method: 'initialized', params: {} });
  });
});

describe('tomlBasicString', () => {
  it('leaves safe strings unchanged inside quotes', () => {
    expect(tomlBasicString('hello')).toBe('"hello"');
    expect(tomlBasicString('bun')).toBe('"bun"');
    expect(tomlBasicString('/usr/local/bin/node')).toBe('"/usr/local/bin/node"');
  });

  it('escapes double-quotes', () => {
    expect(tomlBasicString('a"b')).toBe('"a\\"b"');
    expect(tomlBasicString('"quoted"')).toBe('"\\"quoted\\""');
  });

  it('escapes backslashes', () => {
    expect(tomlBasicString('a\\b')).toBe('"a\\\\b"');
    expect(tomlBasicString('C:\\path\\to\\bin')).toBe('"C:\\\\path\\\\to\\\\bin"');
  });

  it('escapes backslash before quote (order matters)', () => {
    expect(tomlBasicString('\\"')).toBe('"\\\\\\""');
  });

  it('rejects strings containing newlines', () => {
    expect(() => tomlBasicString('line1\nline2')).toThrow(/newline/);
    expect(() => tomlBasicString('trailing\n')).toThrow(/newline/);
    expect(() => tomlBasicString('crlf\r\nhere')).toThrow(/newline/);
  });
});

describe('STALE_THREAD_RE', () => {
  it('matches stale-thread error messages', () => {
    expect(STALE_THREAD_RE.test('thread not found')).toBe(true);
    expect(STALE_THREAD_RE.test('unknown thread xyz')).toBe(true);
    expect(STALE_THREAD_RE.test('No such thread: abc')).toBe(true);
    expect(STALE_THREAD_RE.test('invalid thread_id')).toBe(true);
  });

  it('does not match transient or unrelated errors', () => {
    expect(STALE_THREAD_RE.test('rate limit exceeded')).toBe(false);
    expect(STALE_THREAD_RE.test('authentication failed')).toBe(false);
    expect(STALE_THREAD_RE.test('connection reset by peer')).toBe(false);
    expect(STALE_THREAD_RE.test('internal server error')).toBe(false);
  });
});

describe('turn requests', () => {
  it('returns the turn id from turn/start', async () => {
    const requests: Array<{ id?: number; method: string; params: Record<string, unknown> }> = [];
    const server = fakeServer({ turn: { id: 'turn-1' } }, requests);

    await expect(
      startCodexTurn(server, {
        threadId: 'thread-1',
        inputText: 'hello',
        model: 'gpt-5.4-mini',
        cwd: '/workspace/agent',
      }),
    ).resolves.toBe('turn-1');

    expect(requests[0]).toMatchObject({
      method: 'turn/start',
      params: {
        threadId: 'thread-1',
        input: [{ type: 'text', text: 'hello' }],
        model: 'gpt-5.4-mini',
        cwd: '/workspace/agent',
      },
    });
  });

  it('passes local image parts to turn/start', async () => {
    const requests: Array<{ id?: number; method: string; params: Record<string, unknown> }> = [];
    const server = fakeServer({ turn: { id: 'turn-1' } }, requests);

    await startCodexTurn(server, {
      threadId: 'thread-1',
      inputText: 'look at this',
      input: [
        { type: 'text', text: 'look at this' },
        { type: 'localImage', path: '/tmp/image.png' },
      ],
      model: 'gpt-5.4-mini',
      cwd: '/workspace/agent',
    });

    expect(requests[0]).toMatchObject({
      method: 'turn/start',
      params: {
        input: [
          { type: 'text', text: 'look at this' },
          { type: 'localImage', path: '/tmp/image.png' },
        ],
      },
    });
  });

  it('steers the expected active turn', async () => {
    const requests: Array<{ id?: number; method: string; params: Record<string, unknown> }> = [];
    const server = fakeServer({ turnId: 'turn-1' }, requests);

    await steerCodexTurn(server, 'thread-1', 'turn-1', 'follow up');

    expect(requests[0]).toMatchObject({
      method: 'turn/steer',
      params: {
        threadId: 'thread-1',
        expectedTurnId: 'turn-1',
        input: [{ type: 'text', text: 'follow up' }],
      },
    });
  });

  it('interrupts a specific active turn', async () => {
    const requests: Array<{ id?: number; method: string; params: Record<string, unknown> }> = [];
    const server = fakeServer({}, requests);

    await interruptCodexTurn(server, 'thread-1', 'turn-1');

    expect(requests[0]).toMatchObject({
      method: 'turn/interrupt',
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    });
  });
});
