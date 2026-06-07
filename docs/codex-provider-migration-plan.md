# Codex Provider Migration Plan

## Goal

Run NanoClaw agent groups through OpenAI Codex instead of the Claude Agent
SDK while preserving the existing host, session DB, container isolation,
message routing, MCP tools, continuation, and recovery behavior.

## Architecture Decision

Use `codex app-server` over its stdio JSON-RPC protocol as the runtime
integration.

App Server exposes the primitives NanoClaw needs:

- threads and resumable turns
- streamed lifecycle and activity events
- `turn/steer` for follow-up messages during active work
- approval requests
- MCP server configuration
- interruption and error reporting

The TypeScript Codex SDK remains suitable for simpler automated runs, but its
higher-level interface does not expose as much lifecycle control as NanoClaw's
`AgentProvider` contract requires.

Official references:

- <https://developers.openai.com/codex/app-server>
- <https://developers.openai.com/codex/sdk>

## Existing Boundaries to Preserve

1. Channel adapters send inbound events to the host router.
2. The host writes each event to the session's `inbound.db`.
3. The container agent-runner polls `inbound.db`.
4. The selected `AgentProvider` runs the model and emits provider events.
5. The runner writes replies and processing state to `outbound.db`.
6. The host delivery loop sends replies through the channel adapter.

Provider-specific behavior must remain behind:

- `src/providers/` for host-side mounts and environment
- `container/agent-runner/src/providers/` for runtime integration
- `container/agent-runner/src/providers/types.ts` for the shared contract

## Implementation Phases

### Phase 1: Migration Checkpoint

- Commit the migrated root `AGENTS.md`.
- Commit the migrated `.agents/` skills.
- Keep this checkpoint separate from provider source changes.

### Phase 2: Codex Provider Baseline

- Add host-side Codex container configuration.
- Add the container-side App Server JSON-RPC transport.
- Add the container-side Codex `AgentProvider`.
- Register Codex in both provider barrels.
- Pin and install `@openai/codex` in `container/Dockerfile`.
- Add registration and Dockerfile structural tests.

Use the upstream `providers` branch as a reference, but copy only Codex-owned
files. Do not merge the full branch because it also carries unrelated provider
code and dependency history.

### Phase 3: Runtime Parity

- Implement `AgentQuery.push()` with `turn/steer` during an active turn.
- Queue follow-ups only when no turn is active.
- Emit `activity` for every App Server notification.
- Translate thread, turn, item, progress, result, and error events.
- Persist the thread ID as soon as the thread is established.
- Interrupt the active turn when `abort()` is called.
- Recover only from recognized stale-thread errors.
- Keep MCP tools available through generated per-session Codex configuration.

### Phase 4: Instruction Compatibility

- Resolve composed `CLAUDE.md` imports for Codex.
- Explicitly include `CLAUDE.local.md`.
- Pass the effective instructions as Codex base instructions.
- Preserve current behavior before renaming Claude-specific files.
- Later rename composer and storage concepts to provider-neutral terms in a
  separate refactor.

### Phase 5: Authentication

Preferred production path:

- Route an OpenAI API credential through OneCLI.
- Do not expose the real credential to the container.

Optional subscription path:

- Copy only host `~/.codex/auth.json` into a private per-session directory.
- Never mount the full host `~/.codex`.
- Document this as a different credential boundary from OneCLI injection.

### Phase 6: Provider Selection and Rollback

- Set a test group's container config provider to `codex`.
- Keep the Claude provider installed during rollout.
- Store continuations under provider-specific keys.
- Confirm switching back to Claude does not reuse a Codex thread ID.
- Remove Anthropic dependencies only after feature parity and sustained live
  testing.

### Phase 7: Operator and Documentation Migration

- Replace setup and recovery handoffs that invoke `claude` with Codex-aware
  equivalents.
- Update setup text, troubleshooting, package metadata, and architecture docs.
- Keep compatibility wording where both providers remain supported.

## Test Matrix

### Unit Tests

- Host and container provider registration
- JSON-RPC initialize handshake
- Thread start and resume
- Stale-thread fallback
- Turn start and completion
- Mid-turn `turn/steer`
- Turn interruption
- Approval request responses
- MCP TOML escaping
- Instruction import resolution
- App Server process exit and timeout handling

### Agent-Runner Integration Tests

- Initial inbound message produces an outbound reply
- Thread continuation persists across runner restart
- Follow-up messages reach an active turn
- `/clear` removes only the Codex continuation
- Provider failure produces an outbound error
- Stale continuation is cleared and retried cleanly

### Container Verification

- `codex --version` succeeds
- `codex app-server` completes initialization
- Auth is available through the selected credential path
- NanoClaw MCP tools are discoverable
- Workspace writes work inside the intended mounts
- Host project and protected mounts retain their expected access

### Live Smoke Test

Use the built-in CLI channel before enabling external channels:

```bash
pnpm run chat "Reply with exactly: CODEX_OK"
```

Then verify:

1. A second message resumes the same Codex thread.
2. A tool call succeeds.
3. A scheduled task can be created and listed.
4. A container restart preserves the conversation.
5. A follow-up sent during a long turn is steered into that turn.
6. `/clear` starts a fresh Codex thread.

## Monitoring

Add structured, credential-safe lifecycle records:

- provider name
- session ID
- Codex thread ID
- turn ID
- turn start and completion timestamps
- last activity timestamp
- duration and terminal status
- normalized error classification

Do not log prompts, raw credentials, complete model responses, or MCP secrets.

Expose an operator health view through `ncl` with:

- session and provider
- container status
- heartbeat age
- pending and processing message counts
- continuation presence
- active tool and declared timeout
- last provider error

Continue using:

- `logs/nanoclaw.error.log`
- `logs/nanoclaw.log`
- `data/v2-sessions/<agent-group>/<session>/inbound.db`
- `data/v2-sessions/<agent-group>/<session>/outbound.db`
- `/workspace/.heartbeat`

## Local Rollout and Service Cutover

The existing launchd service currently points at the v1 checkout. Do not change
it until v2 passes the CLI smoke tests.

1. Install v2 host dependencies.
2. Build and test the host.
3. Build and verify the agent image.
4. Initialize the v2 DB, group, CLI messaging group, and wiring.
5. Start v2 manually and run the live CLI tests.
6. Stop the v1 launchd service.
7. Update the launchd plist to the v2 working directory and `dist/index.js`.
8. Load or restart the service.
9. Repeat the CLI smoke test under launchd.
10. Keep the v1 checkout and data intact until v2 has passed sustained testing.

## Current Local Blockers

At the start of implementation this checkout has:

- no `data/v2.db`
- no `.env`
- no installed host `node_modules`
- no migration handoff file
- no available Docker daemon through the current shell
- a running launchd service still targeting `/Users/binxuwang/nanoclaw`

These do not block source implementation, but they must be resolved before the
container and live smoke-test phases.

## Implementation Status

Completed on branch `codex/migrated-agents`:

- migrated agent assets checkpointed separately
- Codex host and container providers registered
- pinned Codex CLI install added to the container image
- App Server initialize/initialized handshake implemented
- thread start/resume, stale-thread recovery, turn start, steering, interrupt,
  event translation, and MCP config generation implemented
- composed `CLAUDE.md` imports and `CLAUDE.local.md` loaded for Codex
- host build and full host tests passing
- container typecheck and full Bun tests passing

Still blocked on local runtime prerequisites:

- build and probe the Docker image
- initialize the v2 DB and CLI test agent
- run the live Codex smoke test
- cut launchd over from the existing v1 checkout

See [codex-provider-runbook.md](codex-provider-runbook.md) for the exact
operator sequence, monitoring queries, and rollback procedure.
