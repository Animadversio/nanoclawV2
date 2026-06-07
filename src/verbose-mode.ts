import fs from 'fs';
import path from 'path';

import { getAgentGroup } from './db/agent-groups.js';
import { getMessagingGroupAgents, getMessagingGroupByPlatform } from './db/messaging-groups.js';

export type VerboseLevel = 'all' | 'edit' | 'bash';

const VERBOSE_LEVELS = new Set<VerboseLevel>(['all', 'edit', 'bash']);

export interface VerboseCommandResponse {
  ok: boolean;
  message: string;
}

export function setVerboseModeForPlatform(
  channelType: string,
  platformId: string,
  level: VerboseLevel | 'off',
): VerboseCommandResponse {
  const mg = getMessagingGroupByPlatform(channelType, platformId);
  if (!mg) {
    return { ok: false, message: 'This Discord channel is not registered with NanoClaw yet.' };
  }

  const wiring = getMessagingGroupAgents(mg.id)[0];
  if (!wiring) {
    return { ok: false, message: 'This Discord channel is not wired to an agent group yet.' };
  }

  const group = getAgentGroup(wiring.agent_group_id);
  if (!group) {
    return { ok: false, message: 'The wired agent group no longer exists.' };
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
