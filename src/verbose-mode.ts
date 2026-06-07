import fs from 'fs';
import path from 'path';

import { getAgentGroup } from './db/agent-groups.js';
import { getDb } from './db/connection.js';
import { getMessagingGroupAgents, getMessagingGroupByPlatform } from './db/messaging-groups.js';
import type { AgentGroup, Session } from './types.js';

export type VerboseLevel = 'all' | 'edit' | 'bash';

const VERBOSE_LEVELS = new Set<VerboseLevel>(['all', 'edit', 'bash']);

export interface VerboseCommandResponse {
  ok: boolean;
  message: string;
}

function getAgentGroupForPlatform(channelType: string, platformId: string): AgentGroup | undefined {
  const mg = getMessagingGroupByPlatform(channelType, platformId);
  if (mg) {
    const wiring = getMessagingGroupAgents(mg.id)[0];
    return wiring ? getAgentGroup(wiring.agent_group_id) : undefined;
  }

  const direct = getDb()
    .prepare("SELECT * FROM sessions WHERE thread_id = ? AND status = 'active' ORDER BY last_active DESC LIMIT 1")
    .get(platformId) as Session | undefined;
  if (direct) return getAgentGroup(direct.agent_group_id);

  if (channelType !== 'discord') return undefined;
  const threadSnowflake = platformId.split(':').at(-1);
  if (!threadSnowflake) return undefined;
  const suffix = `%:${threadSnowflake}`;
  const byThreadSuffix = getDb()
    .prepare("SELECT * FROM sessions WHERE thread_id LIKE ? AND status = 'active' ORDER BY last_active DESC LIMIT 1")
    .get(suffix) as Session | undefined;
  return byThreadSuffix ? getAgentGroup(byThreadSuffix.agent_group_id) : undefined;
}

export function setVerboseModeForPlatform(
  channelType: string,
  platformId: string,
  level: VerboseLevel | 'off',
): VerboseCommandResponse {
  const group = getAgentGroupForPlatform(channelType, platformId);
  if (!group) {
    return { ok: false, message: 'This Discord channel or thread is not registered with NanoClaw yet.' };
  }

  const flagPath = path.join(process.cwd(), 'groups', group.folder, '.verbose');
  if (level === 'off') {
    try {
      fs.unlinkSync(flagPath);
    } catch {
      // Already off.
    }
    return { ok: true, message: "Verbose mode off. I'll only send final results and normal mid-turn updates." };
  }

  if (!VERBOSE_LEVELS.has(level)) {
    return { ok: false, message: `Unknown verbose level: ${level}` };
  }

  fs.mkdirSync(path.dirname(flagPath), { recursive: true });
  fs.writeFileSync(flagPath, level);

  const message =
    level === 'bash'
      ? "Verbose bash mode on. I'll narrate bash/tool-command activity during longer tasks."
      : level === 'edit'
        ? "Verbose edit mode on. I'll narrate commands, edits, writes, and sub-agent work during longer tasks."
        : "Verbose mode on. I'll narrate tool calls and meaningful progress during longer tasks.";
  return { ok: true, message };
}
