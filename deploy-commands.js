require('dotenv').config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const token = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('❌ Missing BOT_TOKEN or CLIENT_ID in environment variables.');
  process.exit(1);
}

const youtubeCommand = new SlashCommandBuilder()
  .setName('youtube')
  .setDescription('Manage YouTube notifications')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub.setName('add').setDescription('Add a new YouTube channel')
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List saved YouTube channels')
  )
  .addSubcommand((sub) =>
    sub.setName('remove').setDescription('Remove a saved YouTube channel')
  );

const bloggerCommand = new SlashCommandBuilder()
  .setName('blogger')
  .setDescription('Manage Blogger notifications')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub.setName('add').setDescription('Add a new Blogger blog')
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List saved Blogger blogs')
  )
  .addSubcommand((sub) =>
    sub.setName('remove').setDescription('Remove a saved Blogger blog')
  );

const commands = [youtubeCommand.toJSON(), bloggerCommand.toJSON()];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`🚀 Registering ${commands.length} global slash commands...`);
    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    console.log(`✅ Successfully registered ${data.length} global slash commands.`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
    process.exit(1);
  }
})();
