import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'bun:test';

const DOCKERFILE = path.join(import.meta.dir, '..', '..', '..', 'Dockerfile');

describe('container/Dockerfile codex CLI install', () => {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8');

  it('declares the CODEX_VERSION argument', () => {
    expect(dockerfile).toMatch(/ARG\s+CODEX_VERSION=/);
  });

  it('installs the Codex CLI at the pinned version', () => {
    expect(dockerfile).toMatch(/pnpm install -g\s+"@openai\/codex@\$\{CODEX_VERSION\}"/);
  });
});
