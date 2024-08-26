require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType, PermissionsBitField } = require('discord.js');

const registerCommands = async (rosterChoices) => {
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
                default_member_permissions: PermissionsBitField.Flags.ManageMessages.toString(),
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
                default_member_permissions: PermissionsBitField.Flags.SendMessages.toString(),
            },
            {
                name: 'create_roster',
                description: 'Create a roster.',
                options: [
                    {
                        name: 'manager',
                        description: 'The manager who has the roster.',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: 'roster_name',
                        description: 'The name of the roster.',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
                default_member_permissions: PermissionsBitField.Flags.ManageMessages.toString(),
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
                default_member_permissions: PermissionsBitField.Flags.ManageMessages.toString(),
            },
            {
                name: 'show_rosters',
                description: 'Shows all rosters.',
                default_member_permissions: PermissionsBitField.Flags.SendMessages.toString(),
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
                default_member_permissions: PermissionsBitField.Flags.ManageMessages.toString(),
            },
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        try {
            console.log('Registering slash commands...');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error(`Error registering commands: ${error}`);
    }
};

module.exports = { registerCommands };