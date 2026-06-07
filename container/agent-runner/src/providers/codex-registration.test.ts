import { describe, expect, it } from 'bun:test';

import './index.js';
import { listProviderNames } from './provider-registry.js';

describe('codex provider registration', () => {
  it('registers codex through the container provider barrel', () => {
    expect(listProviderNames()).toContain('codex');
  });
});
