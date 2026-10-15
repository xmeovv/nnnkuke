import 'dotenv/config';
import {
  REST, Routes, SlashCommandBuilder,
  ApplicationIntegrationType, InteractionContextType,
} from 'discord.js';

/* ------------------------------------------------------------------ config */

const token = process.env.DISCORD_TOKEN;
const appId = process.env.CLIENT_ID;

if (!token || !appId) {
  console.error('[deploy] ERROR: DISCORD_TOKEN and/or CLIENT_ID is missing.');
  process.exit(1);
}

/* ---------------------------------------------------------------- commands */

const integrationTypes = [
  ApplicationIntegrationType.UserInstall,
  ApplicationIntegrationType.GuildInstall,
];

const commands = [
  new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete every channel and rebuild the server')
    .addBooleanOption(o =>
      o.setName('roles')
        .setDescription('Also delete every deletable role (default: false)')
        .setRequired(false))
    .setIntegrationTypes(...integrationTypes)
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all commands')
    .setIntegrationTypes(...integrationTypes)
    .setContexts(InteractionContextType.Guild),
].map(c => c.toJSON());

/* ---------------------------------------------------------------- helpers */

const rest = new REST({ version: '10' }).setToken(token);

function dumpError(label, err) {
  console.error(`[deploy] ${label} failed`);
  if (err?.status) console.error(`[deploy]   status: ${err.status}`);
  if (err?.code)   console.error(`[deploy]   code:   ${err.code}`);
  console.error('[deploy]', err?.rawError ?? err);

  if (err?.status === 401) console.error('[deploy]   -> DISCORD_TOKEN wrong or revoked');
  if (err?.status === 403) console.error('[deploy]   -> CLIENT_ID does not belong to this token');
  if (err?.status === 400 &&
      JSON.stringify(err?.rawError ?? '').includes('integration_types')) {
    console.error('[deploy]   -> enable "User Install" in the Developer Portal, or remove UserInstall');
  }
}

/* --------------------------------------------------------------- register */

try {
  const body = await rest.put(Routes.applicationCommands(appId), { body: commands });
  console.log(`[deploy] OK - ${body.length} GLOBAL commands registered (up to 1h to propagate).`);
  console.log(`[deploy] registered: ${commands.map(c => '/' + c.name).join(', ')}`);
} catch (err) {
  dumpError('registration', err);
  process.exit(1);
}

process.exit(0);
