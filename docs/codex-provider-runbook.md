# Codex Provider Operator Runbook

This runbook starts NanoClaw v2 with a Codex-backed test agent, verifies the
message path, and provides rollback commands. Keep the existing v1 service
running until the manual v2 smoke test succeeds.

## Prerequisites

- Node 20 or newer and pnpm 10.33.0
- Bun for the agent-runner tests
- Docker Desktop or another supported container runtime
- Codex authentication through either:
  - `codex login` on the host, which creates `~/.codex/auth.json`
  - `OPENAI_API_KEY` in the v2 environment

Do not place credentials in group instructions, container config JSON, or
chat messages.

## 1. Verify the Source Tree

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm test
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
(cd container/agent-runner && bun install --frozen-lockfile && bun test)
```

Expected result: all host and agent-runner tests pass.

## 2. Build and Probe the Agent Image

Start the container runtime, then run:

```bash
./container/build.sh
docker run --rm --entrypoint codex nanoclaw-agent:latest --version
```

The image build and version probe are required because the structural tests
only verify that the pinned Codex install is present in the Dockerfile.

## 3. Initialize a CLI Test Agent

For a fresh v2 checkout:

```bash
pnpm exec tsx scripts/init-cli-agent.ts \
  --display-name "$USER" \
  --agent-name "NanoClaw Codex Test" \
  --folder "codex-test"
```

The command prints the new agent group ID. Store it for the remaining
commands:

```bash
export CODEX_GROUP_ID="<agent-group-id>"
```

## 4. Start v2 Manually

Do not modify launchd yet. Start the v2 host in a dedicated terminal:

```bash
pnpm run dev
```

The host owns the `ncl` Unix socket, so leave it running for the remaining
commands.

## 5. Select Codex for the Test Group

From another terminal, update the central container config:

```bash
pnpm run ncl -- groups config update \
  --id "$CODEX_GROUP_ID" \
  --provider codex \
  --model gpt-5.4-mini

pnpm run ncl -- groups config get --id "$CODEX_GROUP_ID"
```

The displayed config must contain `"provider": "codex"`. The host
materializes this DB-backed config into `groups/codex-test/container.json`
when it spawns the container.

Send the first message:

```bash
pnpm run chat "Reply with exactly: CODEX_OK"
```

Expected reply:

```text
CODEX_OK
```

## 6. Smoke-Test Continuation and Tools

Run these in order:

```bash
pnpm run chat "Remember the token cobalt-731 and reply SAVED."
pnpm run chat "What token did I ask you to remember?"
pnpm run chat "Use an available NanoClaw tool to list my current sessions, then summarize the result."
pnpm run ncl -- groups restart --id "$CODEX_GROUP_ID"
pnpm run chat "What token did I ask you to remember before the restart?"
pnpm run chat "/clear"
pnpm run chat "What was the previous token?"
```

Pass criteria:

1. The second message returns `cobalt-731`.
2. The tool call completes without an approval deadlock.
3. The token survives a container restart.
4. After `/clear`, the old Codex continuation is no longer used.

For steering, send a long-running request and immediately send a correction
from a second terminal. The correction should be incorporated into the
active turn; if Codex rejects steering during turn completion, NanoClaw
queues it as the next turn instead of dropping it.

## 7. Monitor the Message Path

Follow the host logs:

```bash
tail -F logs/nanoclaw.error.log logs/nanoclaw.log
```

List the active session:

```bash
pnpm run ncl -- sessions list
```

For a selected session, inspect the two DBs:

```bash
export CODEX_SESSION_ID="<session-id>"
export SESSION_DIR="data/v2-sessions/$CODEX_GROUP_ID/$CODEX_SESSION_ID"

pnpm exec tsx scripts/q.ts "$SESSION_DIR/inbound.db" \
  "SELECT id, kind, status, timestamp FROM messages_in ORDER BY seq DESC LIMIT 10"

pnpm exec tsx scripts/q.ts "$SESSION_DIR/outbound.db" \
  "SELECT id, kind, timestamp FROM messages_out ORDER BY seq DESC LIMIT 10"

pnpm exec tsx scripts/q.ts "$SESSION_DIR/outbound.db" \
  "SELECT message_id, status, status_changed FROM processing_ack ORDER BY status_changed DESC LIMIT 10"

pnpm exec tsx scripts/q.ts "$SESSION_DIR/outbound.db" \
  "SELECT key, value FROM session_state ORDER BY key"

stat "$SESSION_DIR/.heartbeat"
```

Interpretation:

- Missing inbound row: routing or wiring problem.
- Inbound row stuck in processing: container/provider problem.
- Outbound row present but not delivered: channel delivery problem.
- No Codex continuation in `session_state`: thread initialization failed.
- Stale heartbeat: container is stopped or wedged.

Codex-specific logs use the prefixes `[codex-provider]` and
`[codex-app-server]`. They include thread/turn lifecycle and normalized
errors, but should not contain credentials.

## 8. Roll Back the Test Group

Keep Claude installed during rollout. To switch the test group back:

```bash
pnpm run ncl -- groups config update \
  --id "$CODEX_GROUP_ID" \
  --provider claude

pnpm run ncl -- groups restart --id "$CODEX_GROUP_ID"
```

Continuations are stored per provider, so the Claude provider does not reuse
the Codex thread ID.

## 9. Cut Over the Service

Only after the manual smoke test passes:

1. Stop the v1 launchd service.
2. Point the launchd plist at this checkout and `dist/index.js`.
3. Start the v2 service.
4. Repeat the `CODEX_OK`, continuation, tool, and restart checks.
5. Keep the v1 checkout and data unchanged until v2 has run reliably.

If v2 fails, stop it and restore the previous launchd plist. Do not merge v2
into the v1 checkout.
