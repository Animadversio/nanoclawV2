import { describe, expect, it } from 'vitest';

import './index.js';
import { listProviderContainerConfigNames } from './provider-container-registry.js';

describe('codex provider host registration', () => {
  it('registers codex through the host provider barrel', () => {
    expect(listProviderContainerConfigNames()).toContain('codex');
  });
});
