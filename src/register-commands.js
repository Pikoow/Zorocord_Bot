require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const registerCommands = async (rosterChoices, guildId) => {
    const commands = [
        {
            name: 'start',
            description: 'Starts an auction.',
            options: [
                {
                    name: 'player',
                    description: 'The player getting drafted.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: 'time',
                    description: 'The time the auction gets to end (in seconds).',
                    type: ApplicationCommandOptionType.Number,
                    required: true,
                },
                {
                    name: 'starting_price',
                    description: 'The starting price of the player getting drafted.',
                    type: ApplicationCommandOptionType.Number,
                    required: true,
                },
            ],
        },
        {
            name: 'roster',
            description: 'Shows the roster of a manager.',
            options: [
                {
                    name: 'name',
                    description: 'The name of the roster.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rosterChoices,
                },
            ],
        },
        {
            name: 'create_roster',
            description: 'Create a roster.',
            options: [
                {
                    name: 'manager',
                    description: 'The manager who has the roster.',
                    type: ApplicationCommandOptionType.Mentionable,
                    required: true,
                },
                {
                    name: 'roster_name',
                    description: 'The name of the roster.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        },
        {
            name: 'reset_roster',
            description: 'Reset a roster.',
            options: [
                {
                    name: 'roster_name',
                    description: 'The name of the roster.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rosterChoices,
                },
            ],
        },
        {
            name: 'show_rosters',
            description: 'Shows all rosters.',
        },
        {
            name: 'delete_roster',
            description: 'Deletes a roster.',
            options: [
                {
                    name: 'roster_name',
                    description: 'The name of the roster to delete.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rosterChoices,
                },
            ],
        },
        {
            name: 'add_member',
            description: 'Add a player to a roster.',
            options: [
                {
                    name: 'roster_name',
                    description: 'The name of the roster to which the player will be added.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rosterChoices,
                },
                {
                    name: 'player_name',
                    description: 'The name of the player to be added.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: 'player_price',
                    description: 'The price of the player.',
                    type: ApplicationCommandOptionType.Number,
                    required: true,
                },
            ],
        },
        {
            name: 'help',
            description: 'Displays all the available commands and their descriptions.',
        },
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        console.log(`Registering slash commands for guild ${guildId}...`);

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
            { body: commands }
        );

        console.log(`Slash commands registered successfully for guild ${guildId}.`);
    } catch (error) {
        console.error(`Error registering commands for guild ${guildId}: ${error}`);
    }
};

module.exports = { registerCommands };