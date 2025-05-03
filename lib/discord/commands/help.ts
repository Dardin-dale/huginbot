const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show Valheim server commands help'),

    async execute(interaction, lambda) {
        await createHelpPagination(interaction);
    }
};

/**
 * Create a paginated help guide with multiple pages
 */
async function createHelpPagination(interaction) {
    // Create the help pages
    const pages = [
        // Overview page
        new EmbedBuilder()
            .setTitle("📚 HuginBot Help - Overview")
            .setDescription("HuginBot helps you manage your Valheim server directly from Discord. Navigate through the help pages using the buttons below.")
            .setColor(0x5865F2) // Discord blurple
            .setThumbnail('https://i.imgur.com/UQYgxBG.png') // Valheim logo
            .addFields(
                {
                    name: "Available Commands",
                    value: "`/start` - Start the Valheim server\n`/stop` - Stop the Valheim server\n`/status` - Check server status\n`/worlds` - Manage Valheim worlds\n`/controls` - Show control panel\n`/help` - Show this help menu\n`/backup` - Manage world backups"
                },
                {
                    name: "Navigation",
                    value: "Use the ⬅️ and ➡️ buttons below to navigate between help pages."
                }
            )
            .setFooter({ 
                text: "HuginBot • Help Page 1/5",
                iconURL: "https://i.imgur.com/xASc1QX.png" 
            })
            .setTimestamp(),

        // Server Management page
        new EmbedBuilder()
            .setTitle("🎮 Server Management")
            .setDescription("Learn how to start, stop, and check the status of your Valheim server.")
            .setColor(0x00ff00) // Green
            .addFields(
                {
                    name: "Starting the Server",
                    value: "Use `/start [world]` to start the server. If no world is specified, the default world will be used."
                },
                {
                    name: "Stopping the Server",
                    value: "Use `/stop` to stop the server. Make sure all players save their game before stopping!"
                },
                {
                    name: "Checking Status",
                    value: "Use `/status check` to check if the server is running\nUse `/status dashboard` to create a live status panel with controls."
                },
                {
                    name: "Control Panel",
                    value: "Use `/controls` to create an interactive control panel with buttons for all server operations."
                }
            )
            .setFooter({ 
                text: "HuginBot • Help Page 2/5",
                iconURL: "https://i.imgur.com/xASc1QX.png" 
            })
            .setTimestamp(),

        // World Management page
        new EmbedBuilder()
            .setTitle("🌍 World Management")
            .setDescription("Manage different worlds for your Valheim server.")
            .setColor(0x00aaff) // Blue
            .addFields(
                {
                    name: "Listing Worlds",
                    value: "Use `/worlds list` to see all available worlds for this Discord server."
                },
                {
                    name: "Switching Worlds",
                    value: "Use `/worlds switch` to switch to a different world. This requires a server restart."
                },
                {
                    name: "World Details",
                    value: "Each world has:\n• A display name (for Discord)\n• A Valheim world name (save file name)\n• A server password"
                },
                {
                    name: "Creating/Deleting Worlds",
                    value: "New worlds must be created using the CLI for security reasons:\n`npm run cli -- world create`"
                }
            )
            .setFooter({ 
                text: "HuginBot • Help Page 3/5",
                iconURL: "https://i.imgur.com/xASc1QX.png" 
            })
            .setTimestamp(),

        // Backup Management page
        new EmbedBuilder()
            .setTitle("💾 Backup Management")
            .setDescription("Learn how backups work and how to manage them.")
            .setColor(0xaa00ff) // Purple
            .addFields(
                {
                    name: "Automatic Backups",
                    value: "Backups are automatically created when:\n• The server starts\n• The server stops\n• Worlds are switched"
                },
                {
                    name: "Manual Backups",
                    value: "Use `/backup create` to manually trigger a backup at any time while the server is running."
                },
                {
                    name: "Backup Storage",
                    value: "Backups are stored securely in AWS S3 and are organized by world name and timestamp."
                },
                {
                    name: "Backup Rotation",
                    value: "Old backups are automatically cleaned up to save storage space. By default, the system keeps:\n• All backups from the last 24 hours\n• Daily backups for the past week\n• Weekly backups for the past month"
                }
            )
            .setFooter({ 
                text: "HuginBot • Help Page 4/5",
                iconURL: "https://i.imgur.com/xASc1QX.png" 
            })
            .setTimestamp(),

        // Additional Info page
        new EmbedBuilder()
            .setTitle("ℹ️ Additional Information")
            .setDescription("Additional information about the Valheim server.")
            .setColor(0xff9900) // Orange
            .addFields(
                {
                    name: "Server Auto-Shutdown",
                    value: "The server will automatically shut down after 10 minutes of inactivity to save resources."
                },
                {
                    name: "Join Codes",
                    value: "When the server starts, a join code will be posted in Discord. Use this code to connect to the server from Valheim's 'Join Game' menu."
                },
                {
                    name: "Common Issues",
                    value: "• **Can't connect**: Make sure the server is fully started (may take 5-10 minutes)\n• **No join code**: The server might still be initializing\n• **Disconnects**: Check if the server has auto-shutdown due to inactivity"
                },
                {
                    name: "Getting Help",
                    value: "If you need further assistance, contact your server administrator."
                }
            )
            .setFooter({ 
                text: "HuginBot • Help Page 5/5",
                iconURL: "https://i.imgur.com/xASc1QX.png" 
            })
            .setTimestamp()
    ];

    // Set up initial state
    let currentPage = 0;
    
    // Create navigation buttons
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('help_prev')
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⬅️')
                .setDisabled(true), // Initially disabled on first page
            new ButtonBuilder()
                .setCustomId('help_next')
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('➡️')
                .setDisabled(false)
        );
    
    // Send the initial message with the first page
    const message = await interaction.reply({
        embeds: [pages[currentPage]],
        components: [row],
        fetchReply: true
    });
    
    // Create a collector to handle button interactions
    const collector = message.createMessageComponentCollector({ time: 300000 }); // 5 minutes
    
    collector.on('collect', async i => {
        // Verify that the person clicking is the same as the one who ran the command
        if (i.user.id !== interaction.user.id) {
            return i.reply({ 
                content: "This help menu is for the person who created it. Use `/help` to create your own.", 
                ephemeral: true 
            });
        }
        
        // Update page based on button clicked
        if (i.customId === 'help_prev') {
            currentPage--;
        } else if (i.customId === 'help_next') {
            currentPage++;
        }
        
        // Update button states
        const updatedRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('help_prev')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
                    .setDisabled(currentPage === 0),
                new ButtonBuilder()
                    .setCustomId('help_next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➡️')
                    .setDisabled(currentPage === pages.length - 1)
            );
        
        // Update the message
        await i.update({
            embeds: [pages[currentPage]],
            components: [updatedRow]
        });
    });
    
    collector.on('end', async () => {
        // Disable buttons when collector expires
        const disabledRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('help_prev')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('help_next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➡️')
                    .setDisabled(true)
            );
        
        try {
            await message.edit({
                content: "This help menu has expired. Use `/help` to create a new one.",
                components: [disabledRow]
            });
        } catch (error) {
            console.error('Error updating expired help menu:', error);
        }
    });
}