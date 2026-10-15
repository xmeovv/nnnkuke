import 'dotenv/config';
import {
  REST, Routes, SlashCommandBuilder,
  ApplicationIntegrationType, InteractionContextType,
} from 'discord.js';

const integrationTypes = [
  ApplicationIntegrationType.UserInstall,
  ApplicationIntegrationType.GuildInstall,
];

const commands = [
  new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete every channel and rebuild the server')
    .addBooleanOption(o =>
      o.setName('spam')
        .setDescription('Post a ping in the rebuilt channel (default: true)')
        .setRequired(false))
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

const appId = process.env.CLIENT_ID;
const token = process.env.DISCORD_TOKEN;

console.log('CLIENT_ID set?', Boolean(appId));

if (!appId || !token) {
  console.error('ERROR: CLIENT_ID and/or DISCORD_TOKEN is missing.');
  process.exit(1); // was 0 — 0 makes Railway report success on failure
}

const rest = new REST({ version: '10' }).setToken(token);

try {
  // user-install commands MUST be registered globally
  console.log(`Registering ${commands.length} GLOBAL commands (up to 1h to propagate)...`);
  const data = await rest.put(Routes.applicationCommands(appId), { body: commands });
  console.log(`OK - registered ${data.length} commands.`);
} catch (err) {
  console.error('Registration failed:', err);
  process.exit(1);
}