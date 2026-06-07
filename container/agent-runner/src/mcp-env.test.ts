import { describe, expect, it } from 'bun:test';

import { builtinMcpEnv } from './mcp-env.js';

describe('builtinMcpEnv', () => {
  it('passes NanoClaw session paths to the built-in MCP server', () => {
    expect(
      builtinMcpEnv({
        NANOCLAW_SESSION_DIR: '/session',
        NANOCLAW_INBOUND_DB: '/session/inbound.db',
        NANOCLAW_OUTBOUND_DB: '/session/outbound.db',
        NANOCLAW_OUTBOX_DIR: '/session/outbox',
        NANOCLAW_AGENT_DIR: '/group',
        TZ: 'America/Denver',
        DISCORD_BOT_TOKEN: 'secret',
      }),
    ).toEqual({
      NANOCLAW_SESSION_DIR: '/session',
      NANOCLAW_INBOUND_DB: '/session/inbound.db',
      NANOCLAW_OUTBOUND_DB: '/session/outbound.db',
      NANOCLAW_OUTBOX_DIR: '/session/outbox',
      NANOCLAW_AGENT_DIR: '/group',
      TZ: 'America/Denver',
    });
  });
});
