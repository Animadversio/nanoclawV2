/**
 * Discord channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 */
import { createDiscordAdapter } from '@chat-adapter/discord';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

import { restartAgentGroupContainers } from '../container-restart.js';
import { getAgentGroup } from '../db/agent-groups.js';
import { getDb, hasTable } from '../db/connection.js';
import { getContainerConfig, updateContainerConfigScalars } from '../db/container-configs.js';
import { getMessagingGroupAgents, getMessagingGroupByPlatform } from '../db/messaging-groups.js';
import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import { setVerboseModeForPlatform, type VerboseLevel } from '../verbose-mode.js';
import { createChatSdkBridge, type ReplyContext } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

const CODEX_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReplyContext(raw: Record<string, any>): ReplyContext | null {
  if (!raw.referenced_message) return null;
  const reply = raw.referenced_message;
  return {
    text: reply.content || '',
    sender: reply.author?.global_name || reply.author?.username || 'Unknown',
  };
}

async function upsertDiscordCommand(
  rest: REST,
  applicationId: string,
  existing: Array<{ id: string; name: string }>,
  command: { toJSON(): { name: string } },
): Promise<void> {
  const body = command.toJSON();
  const current = existing.find((cmd) => cmd.name === body.name);
  if (current) {
    await rest.patch(Routes.applicationCommand(applicationId, current.id), { body });
  } else {
    await rest.post(Routes.applicationCommands(applicationId), { body });
  }
}

async function registerDiscordCommands(botToken: string, applicationId?: string): Promise<void> {
  if (!applicationId) {
    log.warn('Discord application ID missing; skipping Discord application-command registration');
    return;
  }

  const verbose = new SlashCommandBuilder()
    .setName('verbose')
    .setDescription('Control NanoClaw progress narration for this channel')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('How much progress narration to show')
        .setRequired(false)
        .addChoices(
          { name: 'All tool calls', value: 'all' },
          { name: 'Commands and edits', value: 'edit' },
          { name: 'Bash only', value: 'bash' },
          { name: 'Off', value: 'off' },
        ),
    );

  const codex = new SlashCommandBuilder()
    .setName('codex')
    .setDescription('Show or update Codex model settings for this channel agent')
    .addStringOption((option) =>
      option.setName('model').setDescription('Codex model ID to use, for example gpt-5.4-mini').setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('effort')
        .setDescription('Reasoning effort for Codex')
        .setRequired(false)
        .addChoices(
          { name: 'None', value: 'none' },
          { name: 'Minimal', value: 'minimal' },
          { name: 'Low', value: 'low' },
          { name: 'Medium', value: 'medium' },
          { name: 'High', value: 'high' },
          { name: 'Extra high', value: 'xhigh' },
        ),
    );

  const rest = new REST({ version: '10' }).setToken(botToken);
  const existing = (await rest.get(Routes.applicationCommands(applicationId))) as Array<{ id: string; name: string }>;
  await upsertDiscordCommand(rest, applicationId, existing, verbose);
  await upsertDiscordCommand(rest, applicationId, existing, codex);
  log.info('Discord application commands registered', { commands: ['verbose', 'codex'] });
}

function isDiscordAdmin(userId: string, agentGroupId: string): boolean {
  if (!userId) return false;
  const db = getDb();
  if (!hasTable(db, 'user_roles')) return true;
  const namespacedUserId = `discord:${userId}`;
  const row = db
    .prepare(
      `SELECT 1
         FROM user_roles
        WHERE user_id = ?
          AND role IN ('owner', 'admin')
          AND (agent_group_id IS NULL OR agent_group_id = ?)
        LIMIT 1`,
    )
    .get(namespacedUserId, agentGroupId) as { '1': number } | undefined;
  return row !== undefined;
}

async function handleCodexCommand(ctx: {
  options: Record<string, string>;
  platformId: string;
  userId: string;
}): Promise<{ text: string; ephemeral: true }> {
  const mg = getMessagingGroupByPlatform('discord', ctx.platformId);
  if (!mg) {
    return { text: 'This Discord channel or thread is not registered with NanoClaw yet.', ephemeral: true };
  }

  const wiring = getMessagingGroupAgents(mg.id)[0];
  if (!wiring) {
    return { text: 'This Discord channel is registered but has no NanoClaw agent wired to it.', ephemeral: true };
  }

  if (!isDiscordAdmin(ctx.userId, wiring.agent_group_id)) {
    return { text: 'Only NanoClaw owners and admins can change Codex settings for this agent.', ephemeral: true };
  }

  const group = getAgentGroup(wiring.agent_group_id);
  const config = getContainerConfig(wiring.agent_group_id);
  if (!config) {
    return { text: `No container config found for agent group ${wiring.agent_group_id}.`, ephemeral: true };
  }

  const provider = config.provider ?? group?.agent_provider ?? 'codex';
  if (provider !== 'codex') {
    return {
      text: `This agent is currently using provider "${provider}". /codex only controls Codex-backed agents.`,
      ephemeral: true,
    };
  }

  const model = ctx.options.model?.trim();
  const effort = ctx.options.effort?.trim().toLowerCase();
  const updates: { model?: string; effort?: string } = {};

  if (model) updates.model = model;
  if (effort) {
    if (!CODEX_EFFORTS.has(effort)) {
      return {
        text: `Unknown Codex reasoning effort "${effort}". Use one of: ${Array.from(CODEX_EFFORTS).join(', ')}.`,
        ephemeral: true,
      };
    }
    updates.effort = effort;
  }

  const label = group ? `${group.name} (${group.id})` : wiring.agent_group_id;
  if (Object.keys(updates).length === 0) {
    return {
      text: `Codex settings for ${label}: model=${config.model ?? '(default)'}, effort=${config.effort ?? '(default)'}.`,
      ephemeral: true,
    };
  }

  updateContainerConfigScalars(wiring.agent_group_id, updates);
  const restarted = restartAgentGroupContainers(
    wiring.agent_group_id,
    'Discord /codex settings update',
    'Codex settings were updated by a Discord admin. Continue with the new model and reasoning effort.',
  );

  const nextModel = updates.model ?? config.model ?? '(default)';
  const nextEffort = updates.effort ?? config.effort ?? '(default)';
  const restartText =
    restarted > 0
      ? `Restarted ${restarted} active session${restarted === 1 ? '' : 's'} so the change takes effect now.`
      : 'Saved. No active session was running; the next wake will use the change.';
  return {
    text: `Updated Codex settings for ${label}: model=${nextModel}, effort=${nextEffort}. ${restartText}`,
    ephemeral: true,
  };
}

registerChannelAdapter('discord', {
  factory: () => {
    const env = readEnvFile(['DISCORD_BOT_TOKEN', 'DISCORD_PUBLIC_KEY', 'DISCORD_APPLICATION_ID']);
    if (!env.DISCORD_BOT_TOKEN) return null;
    const discordAdapter = createDiscordAdapter({
      botToken: env.DISCORD_BOT_TOKEN,
      publicKey: env.DISCORD_PUBLIC_KEY,
      applicationId: env.DISCORD_APPLICATION_ID,
    });
    registerDiscordCommands(env.DISCORD_BOT_TOKEN, env.DISCORD_APPLICATION_ID).catch((err) => {
      log.warn('Failed to register Discord application commands', { err });
    });
    return createChatSdkBridge({
      adapter: discordAdapter,
      concurrency: 'concurrent',
      botToken: env.DISCORD_BOT_TOKEN,
      extractReplyContext,
      supportsThreads: true,
      onApplicationCommand: async ({ name, options, platformId, userId }) => {
        switch (name) {
          case 'verbose': {
            const rawMode = options.mode || 'all';
            const mode = rawMode === 'off' ? 'off' : (rawMode as VerboseLevel);
            const result = setVerboseModeForPlatform('discord', platformId, mode);
            return { text: result.message, ephemeral: true };
          }
          case 'codex':
            return handleCodexCommand({ options, platformId, userId });
          default:
            return null;
        }
      },
    });
  },
});
