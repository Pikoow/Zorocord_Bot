require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, ActivityType, isStringSelectMenu, StringSelectMenuOptionBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, PermissionsBitField } = require('discord.js');
const { connect, default: mongoose } = require('mongoose');
const Roster = require('../src/schemas/roster');
const Prediction = require('../src/schemas/prediction');
const Leaderboard = require('../src/schemas/leaderboard');
const { registerCommands } = require('./register-commands');
const leaderboard = require('../src/schemas/leaderboard');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ],
});

(async () => {
    await connect(process.env.MONGODB_ID).catch(console.error);
    client.login(process.env.TOKEN);
})();

client.on('ready', async (c) => {
    client.user.setActivity({
        name: 'Fuck the british',
        type: ActivityType.Playing,
    });

    console.log(`${c.user.tag} is ready.`);

    const guilds = client.guilds.cache.map(guild => guild.id);
    for (const guildId of guilds) {
        const rosterChoices = await getRosterChoices(guildId);
        const predictionChoices = await getPredictionChoices(guildId);
        await registerCommands(rosterChoices, predictionChoices, guildId);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "reset_profile") {
        const guildId = interaction.guildId;
        const user = interaction.options.getUser('user');
        const playerName = user.username;

        const leaderboardEntry = await Leaderboard.findOneAndDelete({ guildId, playerName });

        if (!leaderboardEntry) {
            return interaction.reply({ content: `No profile found for ${playerName}.`, ephemeral: true });
        }

        return interaction.reply({ content: `${playerName}'s profile has been reset.`, ephemeral: true });
    }

    if (interaction.commandName === "profile") {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guildId;
        const targetUsername = targetUser.username;

        let leaderboardEntry = await Leaderboard.findOne({ guildId, playerName: targetUsername });

        if (!leaderboardEntry) {
            return interaction.reply({ content: `${targetUsername} does not have a profile yet.`, ephemeral: true });
        }

        const profileEmbed = new EmbedBuilder()
            .setTitle(`${targetUsername}'s Profile`)
            .setDescription(`**Points:** ${leaderboardEntry.playerPoints}`)
            .setColor(0x00FF00)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

        if (leaderboardEntry.pastVotes.length > 0) {

            let votesDescription = leaderboardEntry.pastVotes.map(vote => 
                `Voted For: **${vote.playerVoted}** | Result: **${vote.isCorrect === 'Won' ? '✅' : vote.isCorrect === 'Lost' ? '❌' : '🔄 Undecided'}**`
            ).join('\n');

            profileEmbed.addFields({ name: 'Voting History', value: votesDescription });
        } else {
            profileEmbed.addFields({ name: 'Voting History', value: 'No votes cast yet.' });
        }

        await interaction.reply({ embeds: [profileEmbed] });
    }

    if (interaction.commandName === "leaderboard") {
        const guildId = interaction.guildId;

        const topMembers = await Leaderboard.find({ guildId })
            .sort({ playerPoints: -1 })
            .limit(10);

        const embed = new EmbedBuilder()
            .setTitle('Leaderboard')
            .setDescription(topMembers.length > 0 ? topMembers.map((member, index) => `**${index + 1}. ${member.playerName}** ${member.playerPoints} points`).join('\n') : 'No leaderboard data available.')
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "distribute_points") {
        const guildId = interaction.guildId;
        const predictionName = interaction.options.getString('prediction_name');
        
        const prediction = await Prediction.findOne({ guildId, predictionName }).populate('roster1 roster2');
        if (!prediction) {
            return interaction.reply({ content: 'Prediction not found.', ephemeral: true });
        }
    
        const duels = prediction.duels;
    
        const embed = new EmbedBuilder()
            .setTitle(`Prediction: ${prediction.predictionName}`)
            .setDescription(`**${prediction.roster1.rosterName}** vs **${prediction.roster2.rosterName}**`);
    
        await interaction.reply({ embeds: [embed] });
        
        for (const [index, duel] of duels.entries()) {
            const duelEmbed = new EmbedBuilder()
                .setDescription(`**${duel.slot1}** vs **${duel.slot2}**\n**${duel.votes.slot1}** votes vs **${duel.votes.slot2}** votes`);
            
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('player-select')
                .setPlaceholder('Select the player who won')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(duel.slot1)
                        .setValue(`duel_${predictionName}_${index}_slot1`),
                    new StringSelectMenuOptionBuilder()
                        .setLabel(duel.slot2)
                        .setValue(`duel_${predictionName}_${index}_slot2`)
                );
            
            const row = new ActionRowBuilder().addComponents(selectMenu);
    
            await interaction.channel.send({ embeds: [duelEmbed], components: [row] });
        }

        const filter = i => i.isStringSelectMenu() && i.customId === 'player-select';

        const collector = interaction.channel.createMessageComponentCollector({
            filter,
        });
    
        collector.on('collect', async i => {
            const selectedCategory = i.values[0];

            if (selectedCategory.startsWith(`duel_${predictionName}_`)) {
                const [_, predictionName, duelIndex, slot] = selectedCategory.split('_');
                const voteSlot = slot === 'slot1' ? 'slot1' : 'slot2';
    
                const duelToUpdate = prediction.duels[parseInt(duelIndex)];
                if (!duelToUpdate) {
                    return i.reply({ content: 'Duel not found!', ephemeral: true });
                }

                for (const vote of duelToUpdate.votedUsers) {
                    const guild = await client.guilds.fetch(guildId);
                    const member = await guild.members.fetch(vote.voterId);
                    const username = member.user.username;
                    
                    const leaderboardEntry = await Leaderboard.findOne({ guildId: prediction.guildId, playerName: username });
                    if (!leaderboardEntry) {
                        continue;
                    }
                    
                    const isVoteCorrect = (vote.slotVoted === (voteSlot === 'slot1' ? 1 : 2)) ? 'Won' : 'Lost';
                    const pointsToAdd = isVoteCorrect === 'Won' ? 0 : 1;
                    
                    leaderboardEntry.playerPoints += pointsToAdd;
                    const existingVote = leaderboardEntry.pastVotes.find(pastVote => pastVote._id.equals(vote._id));
                    existingVote.isCorrect = isVoteCorrect;
                    
                    await leaderboardEntry.save();
                }

                const newDuelEmbed = new EmbedBuilder()
                    .setDescription(`The people who voted for **${duelToUpdate[voteSlot]}** received their points.`);

                await i.message.edit({
                    embeds: [newDuelEmbed],
                    components: []
                });
            }
        });
    }

    if (interaction.commandName === "reset_prediction") {
        const guildId = interaction.guildId;
        const predictionName = interaction.options.getString('prediction_name');

        // Fetch the prediction
        const prediction = await Prediction.findOne({ guildId, predictionName }).populate('roster1 roster2');
        if (!prediction) {
            return interaction.reply({ content: 'Prediction not found.', ephemeral: true });
        }

        // Reset votes and votedUsers for each duel
        for (const duel of prediction.duels) {
            duel.votes.slot1 = 0;
            duel.votes.slot2 = 0;
            duel.votedUsers = []; // Make sure you have this array in your schema
        }

        // Save the changes
        await prediction.save();

        // Send a confirmation message
        const embed = new EmbedBuilder()
            .setTitle('Prediction Reset')
            .setDescription(`The prediction **${prediction.predictionName}** has been reset. All votes have been cleared.`)
            .setColor(0xFF0000);

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "delete_prediction") {
        const guildId = interaction.guildId;
        const predictionName = interaction.options.getString('prediction_name');

        const result = await Prediction.deleteOne({ predictionName, guildId });

        if (result.deletedCount === 0) {
            return interaction.reply({ content: 'Prediction not found.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('Prediction deleted')
            .setDescription(`Prediction **${predictionName}** deleted.`)
            .setColor(0xFF0000);
    
        await interaction.reply({ embeds: [embed] });

        const rosterChoices = await getRosterChoices(guildId);
        const predictionChoices = await getPredictionChoices(guildId);
        await registerCommands(rosterChoices, predictionChoices, guildId);
    }

    if (interaction.commandName === "create_prediction") {
        const guildId = interaction.guildId;
        const predictionName = interaction.options.getString('prediction_name');
        const roster1Name = interaction.options.getString('roster1');
        const roster2Name = interaction.options.getString('roster2');
        const numberDuels = interaction.options.getNumber('number_of_duels');

        let rosterProfile1 = await Roster.findOne({ rosterName: roster1Name, guildId: guildId });
        let rosterProfile2 = await Roster.findOne({ rosterName: roster2Name, guildId: guildId });

        const existingPrediction = await Prediction.findOne({ guildId, predictionName });
        if (existingPrediction) {
            return interaction.reply({ content: 'A prediction with this name already exists.', ephemeral: true });
        }
    
        const rosters = await Roster.find({ guildId, rosterName: { $in: [roster1Name, roster2Name] } });
        if (rosters.length !== 2) {
            return interaction.reply({ content: 'One or both rosters not found.', ephemeral: true });
        }
    
        const [roster1, roster2] = rosters;
    
        const prediction = new Prediction({
            _id: new mongoose.Types.ObjectId(),
            predictionName: predictionName,
            guildId: guildId,
            roster1: roster1._id,
            roster2: roster2._id,
            votes: { roster1: 0, roster2: 0 },
            duels: [],
        });

        const duels = prediction.duels;

        const createPredictionEmbed = new EmbedBuilder()
            .setTitle('Prediction Created')
            .setDescription(`Prediction (**${predictionName}**) created between **${roster1Name}** and **${roster2Name}**.`)
            .setColor(0x00FF00);
    
        await interaction.reply({ embeds: [createPredictionEmbed] });

        const playersRoster1 = rosterProfile1.rosterPlayers;
        const playersRoster2 = rosterProfile2.rosterPlayers;

        for (let index = 0 ; index < numberDuels ; index++) {
            const dropdownOptions1 = playersRoster1.map((player, playerIndex) => ({
                label: player.playerName,
                value: `duel_${predictionName}_${index}_${playerIndex}_roster1`,
            }));

            const dropdownOptions2 = playersRoster2.map((player, playerIndex) => ({
                label: player.playerName,
                value: `duel_${predictionName}_${index}_${playerIndex}_roster2`,
            }));
                
            const createPredictionMenu1 = new StringSelectMenuBuilder()
                .setCustomId('create-prediction-select-1')
                .setPlaceholder(`Select a player from ${roster1.rosterName} to add to the 1v1`)
                .addOptions(...dropdownOptions1.map(option => ({
                    label: option.label,
                    value: option.value,
                })));

            const createPredictionMenu2 = new StringSelectMenuBuilder()
                .setCustomId('create-prediction-select-2')
                .setPlaceholder(`Select a player from ${roster2.rosterName} to add to the 1v1`)
                .addOptions(...dropdownOptions2.map(option => ({
                    label: option.label,
                    value: option.value,
                })));

            const predictionRow1 = new ActionRowBuilder().addComponents(createPredictionMenu1);
            const predictionRow2 = new ActionRowBuilder().addComponents(createPredictionMenu2);

            const duelEmbed = new EmbedBuilder()
                .setTitle(`Create a new duel in ${predictionName}`);
                /*.setDescription(`**${duel.slot1}** vs **${duel.slot2}**\n**${duel.votes.slot1}** votes vs **${duel.votes.slot2}** votes`);
*/    
            await interaction.channel.send({ embeds: [duelEmbed], components: [predictionRow1, predictionRow2] });
        }
    
        const filter = i => i.isStringSelectMenu();
        const collector = interaction.channel.createMessageComponentCollector({ filter });

        let numberDuelsReal = 0;
        
        collector.on('collect', async i => {
            const selectedPlayer = i.values[0];

            if (selectedPlayer.startsWith(`duel_${predictionName}_`)) {
                const [_, predictionName, duelIndex, playerIndex, roster] = selectedPlayer.split('_');
            
                if (!duels[duelIndex]) {
                    duels[duelIndex] = {
                        slot1: null,
                        slot2: null,
                        votes: { 
                            slot1: 0, 
                            slot2: 0,
                        },
                        votedUsers: [],
                    };
                }

                if (roster === 'roster1') {
                    duels[duelIndex].slot1 = playersRoster1[playerIndex].playerName;
                } else if (roster === 'roster2') {
                    duels[duelIndex].slot2 = playersRoster2[playerIndex].playerName;
                }

                console.log("joueur 1 : " + duels[duelIndex].slot1);
                console.log("joueur 2 : " + duels[duelIndex].slot2);

                if (duels[duelIndex].slot1 != null && duels[duelIndex].slot2 != null) {
                    numberDuelsReal++;

                    const newEmbed = new EmbedBuilder()
                        .setTitle(`New duel between ${duels[duelIndex].slot1} and ${duels[duelIndex].slot2} created !`)

                    await i.message.edit({ embeds: [newEmbed], components: [] });

                    console.log(duels);
                }

                if (numberDuelsReal === numberDuels) {
                    await prediction.save();

                    collector.stop();
                }
            }
        });
    
        collector.on('end', async collected => {
            interaction.followUp({ content: `All ${numberDuels} duels have been successfully registered.` });
    
            await prediction.save();
    
            const rosterChoices = await getRosterChoices(guildId);
            const predictionChoices = await getPredictionChoices(guildId);
            await registerCommands(rosterChoices, predictionChoices, guildId);
        });
    }

    if (interaction.commandName === "start_prediction") {
        const guildId = interaction.guildId;
        const predictionName = interaction.options.getString('prediction_name');
        
        const prediction = await Prediction.findOne({ guildId, predictionName }).populate('roster1 roster2');
        if (!prediction) {
            return interaction.reply({ content: 'Prediction not found.' });
        }
    
        const duels = prediction.duels;
    
        const embed = new EmbedBuilder()
            .setTitle(`Prediction: ${prediction.predictionName}`)
            .setDescription(`**${prediction.roster1.rosterName}** vs **${prediction.roster2.rosterName}**`);
    
        await interaction.reply({ embeds: [embed] });

        const optionsEmbed = new EmbedBuilder()
            .setTitle(`${predictionName} options.`);
            
        const optionsMenu = new StringSelectMenuBuilder()
            .setCustomId('options-select')
            .setPlaceholder('Select an option (Admin only)')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('End prediction')
                    .setValue(`end_voting_${predictionName}`),
            );

        const optionsRow = new ActionRowBuilder().addComponents(optionsMenu);
    
        for (const [index, duel] of duels.entries()) {
            const duelEmbed = new EmbedBuilder()
                .setDescription(`**${duel.slot1}** vs **${duel.slot2}**\n**${duel.votes.slot1}** votes vs **${duel.votes.slot2}** votes`);
            
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('player-select')
                .setPlaceholder('Select a player to vote for')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(duel.slot1)
                        .setValue(`duel_${predictionName}_${index}_slot1`),
                    new StringSelectMenuOptionBuilder()
                        .setLabel(duel.slot2)
                        .setValue(`duel_${predictionName}_${index}_slot2`)
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
    
            await interaction.channel.send({ embeds: [duelEmbed], components: [row] });
        }
    
        await interaction.channel.send({ embeds: [optionsEmbed], components: [optionsRow] });
    
        const filter = i => i.isStringSelectMenu() && (i.customId === 'player-select' || i.customId === 'options-select');
        const collector = interaction.channel.createMessageComponentCollector({
            filter,
        });
    
        collector.on('collect', async i => {
            const selectedCategory = i.values[0];
            
            if (selectedCategory.startsWith(`duel_${predictionName}_`)) {
                const [_, predictionName, duelIndex, slot] = selectedCategory.split('_');
                const voteSlot = slot === 'slot1' ? 'slot1' : 'slot2';
    
                const duelToUpdate = prediction.duels[parseInt(duelIndex)];
    
                const userName = i.user.username;
                let leaderboardEntry = await Leaderboard.findOne({ guildId, playerName: userName });
    
                if (!duelToUpdate) {
                    return i.followUp({ content: 'Duel not found.', ephemeral: true });
                }
    
                const userHasVoted = duelToUpdate.votedUsers.some(vote => vote.voterId === i.user.id);

                const voteId = new mongoose.Types.ObjectId();
    
                if (userHasVoted) {
                    return i.reply({ content: 'You have already voted in this duel.', ephemeral: true });
                }

                if (!leaderboardEntry) {
                    leaderboardEntry = new Leaderboard({
                        _id: new mongoose.Types.ObjectId(),
                        guildId,
                        playerName: userName,
                        playerPoints: 0,
                        pastVotes: [],
                    });
                }

                leaderboardEntry.pastVotes.push({
                    _id: voteId,
                    playerVoted: duelToUpdate[voteSlot],
                    isCorrect: "Undecided"
                });

                await leaderboardEntry.save();

                duelToUpdate.votes[slot]++;
    
                duelToUpdate.votedUsers.push({
                    _id: voteId,
                    voterId: i.user.id,
                    slotVoted: slot === 'slot1' ? 1 : 2,
                });
                await prediction.save();

                await i.reply({ 
                    content: `Vote recorded for **${duelToUpdate[voteSlot]}** in the duel between **${duelToUpdate.slot1}** and **${duelToUpdate.slot2}**.`,
                    ephemeral: true
                });
        
                const duelEmbed = new EmbedBuilder()
                    .setDescription(`**${duelToUpdate.slot1}** vs **${duelToUpdate.slot2}**\n**${duelToUpdate.votes.slot1}** votes vs **${duelToUpdate.votes.slot2}** votes`)
                    .setFooter({ text: 'Vote by clicking the buttons below' });
    
                const message = await i.message.fetch();
                await message.edit({ embeds: [duelEmbed] });

            } else if (selectedCategory.startsWith(`end_voting_${predictionName}`)) {
                if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return i.reply({ content: 'You do not have permission to end the prediction.', ephemeral: true });
                }
    
                collector.stop(i);
            }
        });
    
        collector.on('end', async (collected, i) => {
            const newDuelEmbed = new EmbedBuilder()
                .setTitle(`The prediction for **${predictionName}** has ended.`);
                /*.setDescription({ text: `${collected.size - 1} votes collected.` });*/

            await i.message.edit({
                embeds: [newDuelEmbed],
                components: []
            });
        });
    }

    if (interaction.commandName === "delete_roster") {
        const rosterName = interaction.options.get('roster_name').value;
        const guildId = interaction.guild.id;
    
        const rosterProfile = await Roster.findOne({ rosterName, guildId });
    
        if (!rosterProfile) {
            const embed = new EmbedBuilder()
                .setTitle('Roster Not Found')
                .setDescription(`No roster found with the name **${rosterName}** in this server.`)
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [embed] });
        }
    
        await Roster.deleteOne({ rosterName, guildId }).catch(console.error);
    
        const embed = new EmbedBuilder()
            .setTitle('Roster Deleted')
            .setDescription(`The roster **${rosterName}** has been deleted successfully.`)
            .setColor(0x00FF00);
    
        await interaction.reply({ embeds: [embed] });
    
        const rosterChoices = await getRosterChoices(guildId);
        const predictionChoices = await getPredictionChoices(guildId);
        await registerCommands(rosterChoices, predictionChoices, guildId);
    }

    if (interaction.commandName === "show_rosters") {
        const guildId = interaction.guild.id;
        const rosters = await Roster.find({ guildId });
        const guild = interaction.guild;
    
        if (!rosters.length) {
            const noRostersEmbed = new EmbedBuilder()
                .setTitle('No Rosters Found')
                .setDescription('There are no rosters available in this server.')
                .setColor(0xFF0000);
            await interaction.reply({ embeds: [noRostersEmbed] });
            return;
        }
    
        const allRostersEmbed = new EmbedBuilder()
            .setTitle('All Rosters')
            .setColor(0x3498DB);
    
        for (const roster of rosters) {
            let managerName = 'Unknown User'; // Default value
    
            try {
                const manager = await guild.members.fetch(roster.managerName);
                managerName = manager.user.username; // Utiliser `manager.user.username`
            } catch (error) {
                console.error('Error fetching member:', error);
            }
    
            const rosterDetails = roster.rosterPlayers
                .map(player => `**${player.playerName}** - ${player.purchasePrice}`)
                .join('\n') || 'No players in this roster yet.';
    
            allRostersEmbed.addFields([
                {
                    name: `${roster.rosterName}`,
                    value: `Manager : **${managerName}**\nBudget : **${roster.rosterBudget}**\n${rosterDetails}`
                }
            ]);
        }
    
        await interaction.reply({ embeds: [allRostersEmbed] });
    }

    if (interaction.commandName === "reset_roster") {
        const rosterName = interaction.options.get('roster_name').value;

        const rosterProfile = await Roster.findOne({ rosterName });

        rosterProfile.rosterPlayers = [];
        rosterProfile.rosterBudget = 120000;
        await rosterProfile.save().catch(console.error);

        const embed = new EmbedBuilder()
            .setTitle('Roster Reset')
            .setDescription(`The roster **${rosterName}** has been reset. All players have been removed and the budget is back to max.`)
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "create_roster") {
        const manager = interaction.options.get('manager').value;
        const rosterName = interaction.options.get('roster_name').value;
        const guildId = interaction.guild.id;
        const guild = interaction.guild;
        let managerName = null;
    
        try {
            let member = await guild.members.fetch(manager);
            managerName = member.user.username;
        } catch (error) {
            console.error('Error fetching member:', error);
            return;
        }
    
        const rosterProfile = new Roster({
            _id: new mongoose.Types.ObjectId(),
            guildId: guildId,
            managerName: manager,
            rosterName: rosterName,
            rosterPlayers: [],
            rosterBudget: 120000,
        });
    
        await rosterProfile.save().catch(console.error);
    
        const embed = new EmbedBuilder()
            .setTitle('Roster Created')
            .setDescription(`The roster named **${rosterProfile.rosterName}** managed by **${managerName}** has been created in this server!`)
            .setColor(0x00FF00);
    
        await interaction.reply({ embeds: [embed] });
    
        const rosterChoices = await getRosterChoices(guildId);
        const predictionChoices = await getPredictionChoices(guildId);
        await registerCommands(rosterChoices, predictionChoices, guildId);
    }
    
    if (interaction.commandName === "roster") {
        const rosterName = interaction.options.get('name').value;
        const guildId = interaction.guild.id;
    
        let rosterProfile = await Roster.findOne({ rosterName, guildId });
    
        if (!rosterProfile) {
            const embed = new EmbedBuilder()
                .setTitle('Roster Not Found')
                .setDescription(`No roster found with the name **${rosterName}** in this server.`)
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [embed] });
        }
    
        const rosterDetails = rosterProfile.rosterPlayers
            .map(player => `**${player.playerName}** - ${player.purchasePrice}`)
            .join('\n');
    
        const embed = new EmbedBuilder()
            .setTitle(`${rosterProfile.rosterName}:`)
            .setDescription(rosterProfile.rosterPlayers.length > 0 ? `Budget: **${rosterProfile.rosterBudget}**\n${rosterDetails}` : 'No players in this roster.' + `\nBudget: **${rosterProfile.rosterBudget}**`)
            .setColor(0x3498DB);
    
        await interaction.reply({ embeds: [embed] });
    }
    
    if (interaction.commandName === "start") {
        const player = interaction.options.get('player').value;
        const time = interaction.options.get('time').value;
        const startingPrice = interaction.options.get('starting_price').value;
    
        const guildId = interaction.guild.id;
        const guild = interaction.guild;
    
        let currentPrice = startingPrice;
        let lastBidder = null;
        let countdown = time;
        let countdownInterval = null;
        let countdownMessage = null;
        let collector = null;
        let auctionAborted = false; // Flag to indicate if the auction is aborted
    
        const auctionEmbed = new EmbedBuilder()
            .setTitle('Auction Started!')
            .setDescription(`Player being auctioned: **${player}**\nStarting price: **${startingPrice}** zorocoins.`)
            .setColor(0xFFA500);
    
        await interaction.reply({ embeds: [auctionEmbed] });
    
        const startCountdown = async () => {
            if (countdownInterval) clearInterval(countdownInterval);
    
            if (countdownMessage) await countdownMessage.delete();
    
            countdown = time;
            countdownMessage = await interaction.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Time Left')
                        .setDescription(`${countdown} seconds left!`)
                        .setColor(0xFFFF00)
                ]
            });
    
            countdownInterval = setInterval(async () => {
                if (countdown > 0) {
                    countdown--;
                    await countdownMessage.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('Time Left')
                                .setDescription(`${countdown} seconds left!`)
                                .setColor(0xFFFF00)
                        ]
                    });
                } else {
                    clearInterval(countdownInterval);
                    collector.stop();
    
                    if (!auctionAborted) {
                        const endAuctionEmbed = new EmbedBuilder()
                            .setTitle('Auction Ended!')
                            .setColor(0xFF0000);
    
                        if (lastBidder) {
                            let lastBidderName = null;
    
                            try {
                                const member = await guild.members.fetch(lastBidder);
                                lastBidderName = member.user.username;
                            } catch (error) {
                                await interaction.reply('Could not fetch member.');
                                console.error('Error fetching member:', error);
                                return;
                            }
    
                            const winnerProfile = await Roster.findOne({ managerName: lastBidder, guildId });
    
                            if (winnerProfile) {
                                winnerProfile.rosterBudget -= currentPrice;
                                winnerProfile.rosterPlayers.push({
                                    playerName: player,
                                    purchasePrice: currentPrice,
                                });
                                await winnerProfile.save();
    
                                endAuctionEmbed.setDescription(
                                    `Auction ended! Final price: **${currentPrice}** zorocoins by **${lastBidderName}**.\n` +
                                    `**${lastBidderName}** now has a remaining budget of **${winnerProfile.rosterBudget}**.`
                                );
                            } else {
                                endAuctionEmbed.setDescription('Auction ended, but an error occurred with the winner\'s profile.');
                            }
                        } else {
                            endAuctionEmbed.setDescription('Auction ended with no bids.');
                        }
    
                        await interaction.channel.send({ embeds: [endAuctionEmbed] });
                    } else {
                        const abortEmbed = new EmbedBuilder()
                            .setTitle('Auction Aborted')
                            .setDescription('The auction has been aborted due to a request.')
                            .setColor(0xFF0000);
    
                        await interaction.channel.send({ embeds: [abortEmbed] });
                    }
                }
            }, 1000);
        };
    
        const startCollector = () => {
            if (collector) collector.stop();
    
            const filter = (message) => {
                const content = message.content.trim();
                return !isNaN(content) && content.length > 0 || content.toLowerCase() === 'end';
            };
            collector = interaction.channel.createMessageCollector({ filter, time: time * 1000 });
    
            collector.on('collect', async (message) => {
                if (message.content.trim().toLowerCase() === 'end') {
                    const member = await guild.members.fetch(message.author.id);

                    if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                        const noPermissionEmbed = new EmbedBuilder()
                            .setTitle('Permission Denied')
                            .setDescription(`**${member.user.username}**, you don't have the required permissions to abort the auction.`)
                            .setColor(0xFF0000);

                        await message.channel.send({ embeds: [noPermissionEmbed] });
                        return;
                    }

                    if (auctionAborted) return;
    
                    auctionAborted = true;
                    collector.stop();
    
                    clearInterval(countdownInterval);
                    if (countdownMessage) await countdownMessage.delete();
    
                    const abortEmbed = new EmbedBuilder()
                        .setTitle('Auction Aborted')
                        .setDescription('The auction has been aborted due to a request.')
                        .setColor(0xFF0000);
    
                    await interaction.channel.send({ embeds: [abortEmbed] });
    
                    return;
                }
    
                const newPrice = parseInt(message.content.trim(), 10);
    
                if (newPrice <= currentPrice) return;
    
                let potentialBidderName = null;
                let potentialBidder = message.author.id;
    
                try {
                    const member = await guild.members.fetch(potentialBidder);
                    potentialBidderName = member.user.username;
                } catch (error) {
                    await interaction.reply('Could not fetch member.');
                    console.error('Error fetching member:', error);
                    return;
                }
    
                const potentialBidderProfile = await Roster.findOne({ managerName: potentialBidder, guildId });
    
                if (!potentialBidderProfile || potentialBidderProfile.rosterBudget < newPrice) {
                    const insufficientFundsEmbed = new EmbedBuilder()
                        .setTitle('Bid Rejected')
                        .setDescription(`**${potentialBidderName}**, your bid of **${newPrice}** exceeds your current budget of **${potentialBidderProfile ? potentialBidderProfile.rosterBudget : 0}** zorocoins.`)
                        .setColor(0xFF0000);
    
                    await interaction.channel.send({ embeds: [insufficientFundsEmbed] });
                    return;
                }
    
                currentPrice = newPrice;
                lastBidder = potentialBidder;
    
                const bidEmbed = new EmbedBuilder()
                    .setTitle('New Bid!')
                    .setDescription(`**${potentialBidderName}** has bid **${currentPrice}** zorocoins on **${player}**!`)
                    .setColor(0x00FF00);
    
                await interaction.channel.send({ embeds: [bidEmbed] });
    
                await startCountdown();
                startCollector();
            });
        };
    
        await startCountdown();
        startCollector();
    }

    if (interaction.commandName === 'add_member') {
        const rosterName = interaction.options.getString('roster_name');
        const playerName = interaction.options.getString('player_name');
        const playerPrice = interaction.options.getNumber('player_price');

        const rosterProfile = await Roster.findOne({ rosterName, guildId: interaction.guild.id });

        if (!rosterProfile) {
            const embed = new EmbedBuilder()
                .setTitle('Roster Not Found')
                .setDescription(`No roster found with the name **${rosterName}**.`)
                .setColor(0xFF0000);

            return interaction.reply({ embeds: [embed] });
        }

        const playerExists = rosterProfile.rosterPlayers.some(player => player.playerName === playerName);

        if (playerExists) {
            const embed = new EmbedBuilder()
                .setTitle('Player Already Exists')
                .setDescription(`The player **${playerName}** is already in the roster **${rosterName}**.`)
                .setColor(0xFF0000);

            return interaction.reply({ embeds: [embed] });
        }

        if (rosterProfile.rosterBudget < playerPrice) {
            const embed = new EmbedBuilder()
                .setTitle('Insufficient Budget')
                .setDescription(`Cannot add **${playerName}**. The price of **${playerPrice}** exceeds the remaining budget of **${rosterProfile.rosterBudget}**.`)
                .setColor(0xFF0000);

            return interaction.reply({ embeds: [embed] });
        }

        rosterProfile.rosterPlayers.push({
            playerName,
            purchasePrice: playerPrice,
        });

        rosterProfile.rosterBudget -= playerPrice;

        await rosterProfile.save();

        const embed = new EmbedBuilder()
            .setTitle('Player Added')
            .addFields(
                { name: 'Player', value: `${playerName}`, inline: true },
                { name: 'Roster', value: `${rosterName}`, inline: true },
                { name: 'Remaining Budget', value: `${rosterProfile.rosterBudget}`, inline: true }
            )
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'help') {
        try {
            // Fetch all commands registered for the guild
            const commands = await interaction.guild.commands.fetch();

            const helpEmbed = new EmbedBuilder()
                .setTitle('Help - Available Commands')
                .setColor(0x3498DB);

            commands.forEach(command => {
                let optionsList = command.options.map(opt => `\`${opt.name}\``).join(' ');

                // Construct the title with the command name and options
                let fieldTitle = `/${command.name} ${optionsList}`;

                // Generate a detailed description of the options
                let optionsDescription = '';
                if (command.options) {
                    optionsDescription = command.options.map(opt => `**${opt.name}**: ${opt.description}`).join('\n');
                }

                helpEmbed.addFields({
                    name: fieldTitle,
                    value: `${command.description}\n${optionsDescription}`,
                });
            });

            await interaction.reply({ embeds: [helpEmbed] });
        } catch (error) {
            console.error('Error fetching commands:', error);
            await interaction.reply({ content: 'There was an error retrieving the commands.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'transfer_player') {
        const playerName = interaction.options.getString('player_name');
        const fromRosterName = interaction.options.getString('from_roster');
        const toRosterName = interaction.options.getString('to_roster');
        const transferPrice = interaction.options.getNumber('transfer_price');
        const guildId = interaction.guild.id;

        try {
            // Find rosters
            const fromRoster = await Roster.findOne({ rosterName: fromRosterName, guildId });
            const toRoster = await Roster.findOne({ rosterName: toRosterName, guildId });

            if (!fromRoster || !toRoster) {
                const embed = new EmbedBuilder()
                    .setTitle('Roster Not Found')
                    .setDescription('One or both rosters could not be found.')
                    .setColor(0xFF0000);
                return await interaction.reply({ embeds: [embed] });
            }

            // Find player in the 'from' roster
            const playerIndex = fromRoster.rosterPlayers.findIndex(player => player.playerName === playerName);
            if (playerIndex === -1) {
                const embed = new EmbedBuilder()
                    .setTitle('Player Not Found')
                    .setDescription(`Player **${playerName}** not found in roster **${fromRosterName}**.`)
                    .setColor(0xFF0000);
                return await interaction.reply({ embeds: [embed] });
            }

            const player = fromRoster.rosterPlayers[playerIndex];

            // Check if transfer price is valid
            if (transferPrice <= 0) {
                const embed = new EmbedBuilder()
                    .setTitle('Invalid Transfer Price')
                    .setDescription('The transfer price must be greater than 0.')
                    .setColor(0xFF0000);
                return await interaction.reply({ embeds: [embed] });
            }

            // Check if 'from' roster has enough budget
            if (fromRoster.rosterBudget < transferPrice) {
                const embed = new EmbedBuilder()
                    .setTitle('Insufficient Budget')
                    .setDescription(`The budget of **${fromRosterName}** is insufficient to cover the transfer price of **${transferPrice}**.`)
                    .setColor(0xFF0000);
                return await interaction.reply({ embeds: [embed] });
            }

            // Remove player from 'from' roster and add to 'to' roster
            fromRoster.rosterPlayers.splice(playerIndex, 1);
            fromRoster.rosterBudget += transferPrice;

            // Ensure player object is correctly formatted
            const newPlayer = {
                playerName: player.playerName,
                purchasePrice: transferPrice,
            };
            toRoster.rosterPlayers.push(newPlayer);
            toRoster.rosterBudget -= transferPrice;

            await fromRoster.save();
            await toRoster.save();

            const embed = new EmbedBuilder()
                .setTitle('Player Transferred')
                .setDescription(`Player **${playerName}** has been transferred from **${fromRosterName}** to **${toRosterName}** for **${transferPrice}**.`)
                .setColor(0x00FF00);
            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error processing transfer:', error);
            await interaction.reply({ content: 'There was an error processing the transfer.', ephemeral: true });
        }
    }
});

async function getRosterChoices(guildId) {
    const rosters = await Roster.find({ guildId }, 'rosterName').exec();
    return rosters.map(roster => ({
        name: roster.rosterName,
        value: roster.rosterName,
    }));
}

async function getPredictionChoices(guildId) {
    const predictions = await Prediction.find({ guildId }, 'predictionName').exec();
    return predictions.map(prediction => ({
        name: prediction.predictionName,
        value: prediction.predictionName,
    }));
}

module.exports = { getRosterChoices, getPredictionChoices };