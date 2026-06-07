/**
 * Discord channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 */
import { createDiscordAdapter } from '@chat-adapter/discord';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import { setVerboseModeForPlatform, type VerboseLevel } from '../verbose-mode.js';
import { createChatSdkBridge, type ReplyContext } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReplyContext(raw: Record<string, any>): ReplyContext | null {
  if (!raw.referenced_message) return null;
  const reply = raw.referenced_message;
  return {
    text: reply.content || '',
    sender: reply.author?.global_name || reply.author?.username || 'Unknown',
  };
}

async function registerDiscordCommands(botToken: string, applicationId?: string): Promise<void> {
  if (!applicationId) {
    log.warn('Discord application ID missing; skipping /verbose command registration');
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

  const rest = new REST({ version: '10' }).setToken(botToken);
  const existing = (await rest.get(Routes.applicationCommands(applicationId))) as Array<{ id: string; name: string }>;
  const current = existing.find((cmd) => cmd.name === 'verbose');
  if (current) {
    await rest.patch(Routes.applicationCommand(applicationId, current.id), { body: verbose.toJSON() });
  } else {
    await rest.post(Routes.applicationCommands(applicationId), { body: verbose.toJSON() });
  }
  log.info('Discord application commands registered', { commands: ['verbose'] });
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
      onApplicationCommand: async ({ name, options, platformId }) => {
        if (name !== 'verbose') return null;
        const rawMode = options.mode || 'all';
        const mode = rawMode === 'off' ? 'off' : (rawMode as VerboseLevel);
        const result = setVerboseModeForPlatform('discord', platformId, mode);
        return { text: result.message, ephemeral: true };
      },
    });
  },
});
