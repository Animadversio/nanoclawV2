import { describe, expect, it } from 'bun:test';

import { formatToolNotification, parseVerboseCommandText, shouldNotifyTool } from './verbose-mode.js';

describe('verbose mode commands', () => {
  it('parses slash and bang command aliases', () => {
    expect(parseVerboseCommandText('/verbose')).toBe('all');
    expect(parseVerboseCommandText('!verbose bash')).toBe('bash');
    expect(parseVerboseCommandText('/verbose edit')).toBe('edit');
    expect(parseVerboseCommandText('!verbose off')).toBe('off');
    expect(parseVerboseCommandText('/quiet')).toBe('off');
    expect(parseVerboseCommandText('hello verbose')).toBeNull();
  });
});

describe('verbose tool filtering', () => {
  it('filters notifications by level', () => {
    expect(shouldNotifyTool('bash', 'Bash')).toBe(true);
    expect(shouldNotifyTool('bash', 'Read')).toBe(false);
    expect(shouldNotifyTool('edit', 'Edit')).toBe(true);
    expect(shouldNotifyTool('edit', 'Read')).toBe(false);
    expect(shouldNotifyTool('all', 'Read')).toBe(true);
    expect(shouldNotifyTool('all', 'mcp__nanoclaw__send_message')).toBe(false);
  });
});

describe('verbose notification formatting', () => {
  it('redacts secrets before formatting command notifications', () => {
    const message = formatToolNotification('bash', {
      name: 'Bash',
      input: {
        command: 'DISCORD_BOT_TOKEN="abcabcabcabcabcabcabcabc.XYZ123.abcdefghijklmnopqrstuvwxyz1" python script.py --token secret-value',
      },
    });

    expect(message).toContain('DISCORD_BOT_TOKEN=***');
    expect(message).toContain('--token ***');
    expect(message).not.toContain('secret-value');
    expect(message).not.toContain('abcdefghijklmnopqrstuvwxyz1');
  });
});
