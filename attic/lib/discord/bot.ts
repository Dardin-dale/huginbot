const { 
    Client, 
    GatewayIntentBits, 
    Collection, 
    EmbedBuilder,
    Events,
    ActivityType
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const statusUpdater = require('./status-updater');

// Configure environment
const DISCORD_BOT_SECRET_TOKEN = process.env.DISCORD_BOT_SECRET_TOKEN;
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const COMMANDS_LAMBDA_NAME = process.env.COMMANDS_LAMBDA_NAME;
const START_STOP_LAMBDA_NAME = process.env.START_STOP_LAMBDA_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT || 'development';

if (!DISCORD_BOT_SECRET_TOKEN) {
    console.error('Missing DISCORD_BOT_SECRET_TOKEN environment variable');
    process.exit(1);
}

// Create Discord client with appropriate intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// Configure AWS SDK
const lambda = new AWS.Lambda({
    region: AWS_REGION
});

// Load command handlers
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Load all commands
console.log('Loading commands:');
for (const file of commandFiles) {
    try {
        const command = require(path.join(commandsPath, file));
        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
            console.log(`✅ Loaded command: ${command.data.name}`);
        } else {
            console.warn(`⚠️ Command file ${file} is missing required properties`);
        }
    } catch (error) {
        console.error(`❌ Error loading command from ${file}:`, error);
    }
}

// Discord events
client.once(Events.ClientReady, () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`🌐 Environment: ${ENVIRONMENT}`);
    
    // Set bot status/activity
    client.user.setPresence({
        activities: [{ 
            name: 'Valheim servers', 
            type: ActivityType.Watching 
        }],
        status: 'online'
    });

    // Initialize status updater for auto-updating status messages
    statusUpdater.initStatusUpdater(client)
        .then(() => console.log('✅ Status updater initialized'))
        .catch(error => console.error('Failed to initialize status updater:', error));
});

// Handle incoming slash commands
client.on(Events.InteractionCreate, async interaction => {
    // Only handle slash commands
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.warn(`Command not found: ${interaction.commandName}`);
        return;
    }

    try {
        // Add AWS Lambda and other required services to the command context
        await command.execute(interaction, lambda);
    } catch (error) {
        console.error(`Error executing command ${interaction.commandName}:`, error);
        
        // Create a rich error embed
        const errorEmbed = new EmbedBuilder()
            .setTitle("❌ Command Error")
            .setDescription("There was an error executing this command!")
            .setColor(0xff0000) // Red
            .addFields({ 
                name: "Error Details", 
                value: error.message || "Unknown error"
            })
            .setFooter({ 
                text: "HuginBot • Error • Type /help for working commands" 
            })
            .setTimestamp();
        
        // Check if the interaction was already replied to
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ 
                embeds: [errorEmbed], 
                components: [] 
            }).catch(console.error);
        } else {
            // Initial reply with error
            await interaction.reply({
                embeds: [errorEmbed],
                ephemeral: true // Only visible to command user
            }).catch(console.error);
        }
    }
});

// Handle button interactions
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    
    try {
        // The button ID is used to route to the correct handler
        const buttonId = interaction.customId;
        
        // Get the command this button belongs to (usually stored in customId, e.g., "status_refresh")
        const commandName = buttonId.split('_')[0];
        const command = client.commands.get(commandName);
        
        if (command && command.handleButton) {
            await command.handleButton(interaction, buttonId, lambda);
        } else {
            console.warn(`No button handler found for ${buttonId}`);
            await interaction.reply({
                content: "This button is no longer supported. Please use the command again.",
                ephemeral: true
            });
        }
    } catch (error) {
        console.error('Error handling button interaction:', error);
        try {
            await interaction.reply({
                content: "There was an error processing this button. Please try the command again.",
                ephemeral: true
            });
        } catch (replyError) {
            // If replying fails (e.g., interaction already replied to)
            console.error('Error replying to button interaction:', replyError);
        }
    }
});

// Handle select menu interactions
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    
    try {
        // The select menu ID is used to route to the correct handler
        const selectId = interaction.customId;
        
        // Get the command this select menu belongs to (usually stored in customId, e.g., "worlds_select")
        const commandName = selectId.split('_')[0];
        const command = client.commands.get(commandName);
        
        if (command && command.handleSelect) {
            await command.handleSelect(interaction, selectId, lambda);
        } else {
            console.warn(`No select menu handler found for ${selectId}`);
            await interaction.reply({
                content: "This selection menu is no longer supported. Please use the command again.",
                ephemeral: true
            });
        }
    } catch (error) {
        console.error('Error handling select menu interaction:', error);
        try {
            await interaction.reply({
                content: "There was an error processing this selection. Please try the command again.",
                ephemeral: true
            });
        } catch (replyError) {
            // If replying fails (e.g., interaction already replied to)
            console.error('Error replying to select menu interaction:', replyError);
        }
    }
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Continue running - don't crash the bot
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Continue running - don't crash the bot
});

// Handle shutdown gracefully
function shutdown() {
    console.log('Shutting down bot...');
    client.destroy();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Login to Discord
console.log('Connecting to Discord...');
client.login(DISCORD_BOT_SECRET_TOKEN)
    .then(() => {
        console.log('Login successful');
    })
    .catch(error => {
        console.error('Login failed:', error);
        process.exit(1);
    });
