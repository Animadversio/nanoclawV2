import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { loadGlobalMcpServers, mergeMcpServers } from './container-config.js';

describe('global MCP config', () => {
  it('loads mcpServers from a root-style .mcp.json file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-mcp-'));
    const configPath = path.join(dir, '.mcp.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          kernel: {
            command: '/bin/kernel-mcp',
            args: ['--stdio'],
            instructions: 'Use this for notebook-backed Python work.',
          },
        },
      }),
    );

    expect(loadGlobalMcpServers(configPath)).toEqual({
      kernel: {
        command: '/bin/kernel-mcp',
        args: ['--stdio'],
        instructions: 'Use this for notebook-backed Python work.',
      },
    });
  });

  it('lets group MCP config override global servers by name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-mcp-'));
    const configPath = path.join(dir, '.mcp.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          kernel: { command: '/global/kernel-mcp' },
        },
      }),
    );
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(mergeMcpServers({ kernel: { command: '/group/kernel-mcp' } })).toEqual({
        kernel: { command: '/group/kernel-mcp' },
      });
    } finally {
      process.chdir(previousCwd);
    }
  });
});
