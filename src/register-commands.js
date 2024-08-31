require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const registerCommands = async (rosterChoices, predictionChoices, guildId) => {
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
        {
            name: 'transfer_player',
            description: 'Transfers a player from one roster to another.',
            options: [
                {
                    name: 'player_name',
                    description: 'The name of the player to transfer.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: 'from_roster',
                    description: 'The name of the roster from which the player is being transferred.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rosterChoices,
                },
                {
                    name: 'to_roster',
                    description: 'The name of the roster to which the player is being transferred.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rosterChoices,
                },
                {
                    name: 'transfer_price',
                    description: 'The price of the player transfer.',
                    type: ApplicationCommandOptionType.Number,
                    required: true,
                },
            ],
        },
        {
            name: 'create_prediction',
            description: 'Creates a new prediction.',
            options: [
                {
                    name: 'prediction_name',
                    description: 'The name of the prediction.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: 'roster1',
                    description: 'The first roster for the prediction.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rosterChoices,
                },
                {
                    name: 'roster2',
                    description: 'The second roster for the prediction.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rosterChoices,
                },
                {
                    name: 'number_of_duels',
                    description: 'The number of duels that will be happening between the two rosters.',
                    type: ApplicationCommandOptionType.Number,
                    required: true,
                }
            ],
        },
        {
            name: 'delete_prediction',
            description: 'Deletes a prediction.',
            options: [
                {
                    name: 'prediction_name',
                    description: 'The name of the prediction to delete.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: predictionChoices,
                },
            ],
        },
        {
            name: 'start_prediction',
            description: 'Shows ongoing predictions.',
            options: [
                {
                    name: 'prediction_name',
                    description: 'The name of the prediction to end.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: predictionChoices,
                },
            ],
        },
        {
            name: 'reset_prediction',
            description: 'Resets a predictions.',
            options: [
                {
                    name: 'prediction_name',
                    description: 'The name of the prediction to reset.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: predictionChoices,
                },
            ],
        },
        {
            name: 'distribute_points',
            description: 'Distributes points depending on who wons the duels.',
            options: [
                {
                    name: 'prediction_name',
                    description: 'The name of the prediction to end.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: predictionChoices,
                },
            ],
        },
        {
            name: 'leaderboard',
            description: 'Displays the current leaderboard standings.',
        },
        {
            name: 'profile',
            description: 'Displays your profile or the profile of a mentioned user.',
            options: [
                {
                    name: 'user',
                    description: 'The user whose profile you want to view',
                    type: ApplicationCommandOptionType.Mentionable,
                    required: false
                }
            ]
        }
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