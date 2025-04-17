const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { AWS } = require('aws-sdk');

// Create Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Configure AWS SDK
const lambda = new AWS.Lambda({
    region: process.env.AWS_REGION || 'us-west-2'
});

// Load command handlers
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
}

// Discord events
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, lambda);
    } catch (error) {
        console.error(error);
        await interaction.reply({
            content: 'There was an error executing this command!',
            ephemeral: true
        });
    }
});

// Login to Discord
client.login(process.env.DISCORD_BOT_SECRET_TOKEN);
