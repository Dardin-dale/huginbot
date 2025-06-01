const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Load command data
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    commands.push(command.data.toJSON());
}

// Setup REST API client
const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_BOT_SECRET_TOKEN);

// Register commands
(async () => {
    try {
        console.log('Registering slash commands...');

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APP_ID),
            { body: commands }
        );

        console.log('Commands registered successfully!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();
