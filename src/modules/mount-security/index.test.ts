import fs from 'fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const paths = vi.hoisted(() => {
  const testDir = '/tmp/nanoclaw-test-mount-security';
  return { testDir, allowlistPath: `${testDir}/mount-allowlist.json` };
});

vi.mock('../../config.js', async () => {
  const actual = await vi.importActual('../../config.js');
  return { ...actual, MOUNT_ALLOWLIST_PATH: paths.allowlistPath };
});

import { validateAdditionalMounts, validateMount } from './index.js';

describe('mount security', () => {
  beforeEach(() => {
    fs.rmSync(paths.testDir, { recursive: true, force: true });
    fs.mkdirSync(paths.testDir, { recursive: true });
    fs.writeFileSync(
      paths.allowlistPath,
      JSON.stringify({
        allowedRoots: [{ path: paths.testDir, allowReadWrite: true, description: 'test root' }],
        blockedPatterns: [],
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(paths.testDir, { recursive: true, force: true });
  });

  it('keeps relative mounts under /workspace/extra', () => {
    const hostPath = `${paths.testDir}/project`;
    fs.mkdirSync(hostPath);

    const mounts = validateAdditionalMounts([{ hostPath, containerPath: 'project', readonly: false }], 'test-group');

    expect(mounts).toEqual([
      { hostPath: fs.realpathSync(hostPath), containerPath: '/workspace/extra/project', readonly: false },
    ]);
  });

  it('allows absolute container paths only when they mirror the host path', () => {
    const hostPath = `${paths.testDir}/home`;
    fs.mkdirSync(hostPath);
    const realHostPath = fs.realpathSync(hostPath);

    expect(validateMount({ hostPath, containerPath: realHostPath, readonly: false })).toMatchObject({
      allowed: true,
      resolvedContainerPath: realHostPath,
      effectiveReadonly: false,
    });

    expect(validateMount({ hostPath, containerPath: '/etc/nanoclaw-home', readonly: false })).toMatchObject({
      allowed: false,
    });
  });
});
