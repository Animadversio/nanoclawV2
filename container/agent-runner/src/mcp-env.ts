const MCP_ENV_KEYS = [
  'NANOCLAW_SESSION_DIR',
  'NANOCLAW_AGENT_DIR',
  'NANOCLAW_GLOBAL_DIR',
  'NANOCLAW_SKILLS_DIR',
  'NANOCLAW_CONFIG_PATH',
  'NANOCLAW_INBOUND_DB',
  'NANOCLAW_OUTBOUND_DB',
  'NANOCLAW_HEARTBEAT_PATH',
  'NANOCLAW_OUTBOX_DIR',
  'NANOCLAW_ADDITIONAL_DIRECTORIES',
  'TZ',
] as const;

export function builtinMcpEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MCP_ENV_KEYS) {
    const value = source[key];
    if (value) env[key] = value;
  }
  return env;
}
