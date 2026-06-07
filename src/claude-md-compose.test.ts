import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPaths = vi.hoisted(() => ({
  groupsDir: `/tmp/nanoclaw-claude-md-compose-test-${process.pid}`,
}));

vi.mock('./config.js', () => ({
  GROUPS_DIR: mockPaths.groupsDir,
}));

vi.mock('./db/container-configs.js', () => ({
  getContainerConfig: vi.fn(),
}));

vi.mock('./log.js', () => ({
  log: {
    info: vi.fn(),
  },
}));

import { migrateGroupsToClaudeLocal } from './claude-md-compose.js';

describe('migrateGroupsToClaudeLocal', () => {
  beforeEach(() => {
    fs.rmSync(mockPaths.groupsDir, { recursive: true, force: true });
    fs.mkdirSync(mockPaths.groupsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(mockPaths.groupsDir, { recursive: true, force: true });
  });

  it('preserves groups/global while migrating legacy group prompts', () => {
    const globalDir = path.join(mockPaths.groupsDir, 'global');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'CLAUDE.md'), 'global prompt\n');

    const groupDir = path.join(mockPaths.groupsDir, 'main');
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), 'legacy local prompt\n');
    fs.symlinkSync('../global/CLAUDE.md', path.join(groupDir, '.claude-global.md'));

    migrateGroupsToClaudeLocal();

    expect(fs.readFileSync(path.join(globalDir, 'CLAUDE.md'), 'utf8')).toBe('global prompt\n');
    expect(fs.existsSync(path.join(groupDir, 'CLAUDE.md'))).toBe(false);
    expect(fs.readFileSync(path.join(groupDir, 'CLAUDE.local.md'), 'utf8')).toBe('legacy local prompt\n');
    expect(fs.existsSync(path.join(groupDir, '.claude-global.md'))).toBe(false);
  });
});
