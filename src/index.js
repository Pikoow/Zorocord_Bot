require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, ActivityType, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, PermissionsBitField } = require('discord.js');
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
    
        const prediction = await Prediction.findOne({ guildId, predictionName });

        if (!prediction) {
            return interaction.reply({ content: 'Prediction not found.', ephemeral: true });
        }
    
        const duels = prediction.duels;
    
        const embed = new EmbedBuilder()
            .setTitle(`Set the winners of the prediction : ${prediction.predictionName}`)
            .setDescription(`**${prediction.roster1.rosterName}** vs **${prediction.roster2.rosterName}**`);

        await interaction.reply({ embeds: [embed] });

        duels.forEach(async (duel, index) => {
            const duelEmbed = new EmbedBuilder()
                .setDescription(`**${duel.slot1}** vs **${duel.slot2}**\n` +
                                `**${duel.votes.slot1}** votes vs **${duel.votes.slot2}** votes`)
                .setFooter({ text: 'Vote by clicking the buttons below' });
    
            const firstButton = new ButtonBuilder()
                .setCustomId(`duel_${index}_slot1`)
                .setLabel(duel.slot1)
                .setStyle(ButtonStyle.Primary);
    
            const secondButton = new ButtonBuilder()
                .setCustomId(`duel_${index}_slot2`)  // Use index to identify the duel
                .setLabel(duel.slot2)
                .setStyle(ButtonStyle.Primary);
    
            const buttonRow = new ActionRowBuilder().addComponents(firstButton, secondButton);
    
            await interaction.channel.send({ embeds: [duelEmbed], components: [buttonRow] });
        });

        const collector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 86400000, // 24 hours
        });
    
        collector.on('collect', async (buttonInteraction) => {
            if (buttonInteraction.customId.startsWith('duel_')) {
                const [_, duelIndex, slot] = buttonInteraction.customId.split('_');
                const voteSlot = slot === 'slot1' ? 'slot1' : 'slot2';
    
                const duelToUpdate = prediction.duels[parseInt(duelIndex)];

                for (const vote of duelToUpdate.votedUsers) {
                    if (vote.slotVoted === (voteSlot === 'slot1' ? 1 : 2)) {
                        const guild = await client.guilds.fetch(guildId);
                        const member = await guild.members.fetch(vote.voterId);
                        const username = member.user.username;

                        const user = await Leaderboard.findOne({ guildId, playerName: username });

                        if (user) {
                            user.playerPoints += 1;
                            await user.save();
                        }
                    }
                }

                await buttonInteraction.reply({ 
                    content: `The people who voted for **${duelToUpdate[voteSlot]}** received their points.`,
                });

                await buttonInteraction.message.edit({
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
    
        const rosters = await Roster.find({ guildId, rosterName: { $in: [roster1Name, roster2Name] } });
    
        if (rosters.length !== 2) {
            return interaction.reply({ content: 'One or both rosters not found.', ephemeral: true });
        }
    
        const [roster1, roster2] = rosters;
    
        const prediction = new Prediction({
            _id: new mongoose.Types.ObjectId(),
            predictionName: predictionName,
            guildId,
            roster1: roster1._id,
            roster2: roster2._id,
            votes: { roster1: 0, roster2: 0 },
            duels: [],
        });
    
        const embed = new EmbedBuilder()
            .setTitle('Prediction Created')
            .setDescription(`Prediction (**${predictionName}**) created between **${roster1Name}** and **${roster2Name}**.`)
            .setColor(0x00FF00);
    
        await interaction.reply({ embeds: [embed] });
    
        const duelEmbed = new EmbedBuilder()
            .setTitle('New Duel')
            .setDescription(`Please provide the duels in the format: \`player1 ; player2\`.`)
            .setColor(0x00FF00);
    
        await interaction.followUp({ embeds: [duelEmbed] });
    
        const filter = response => response.author.id === interaction.user.id;
        const collector = interaction.channel.createMessageCollector({ filter, max: numberDuels, time: 60000 });
    
        let duelCount = 0;
    
        collector.on('collect', message => {
            const duelInfo = message.content.split(';').map(str => str.trim());
    
            if (duelInfo.length === 2) {
                prediction.duels.push({
                    slot1: duelInfo[0],
                    slot2: duelInfo[1],
                    votes: { 
                        slot1: 0, 
                        slot2: 0 
                    },
                    votedUsers: []
                });
    
                duelCount++;
                interaction.followUp(`Duel ${duelCount} added: **${duelInfo[0]}** vs **${duelInfo[1]}**`);
    
                if (duelCount === numberDuels) {
                    collector.stop();
                }
            } else {
                interaction.followUp('Invalid format. Please use: `player1 ; player2`.');
            }
        });
    
        collector.on('end', async collected => {
            if (duelCount < numberDuels) {
                interaction.followUp({ content: `Only ${duelCount} out of ${numberDuels} duels were added.`, ephemeral: true });
            } else {
                interaction.followUp({ content: `All ${numberDuels} duels have been successfully registered.` });
            }
    
            // Save the prediction with the collected duels
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
            return interaction.reply({ content: 'Prediction not found.', ephemeral: true });
        }
    
        const duels = prediction.duels;
    
        const embed = new EmbedBuilder()
            .setTitle(`Prediction : ${prediction.predictionName}`)
            .setDescription(`**${prediction.roster1.rosterName}** vs **${prediction.roster2.rosterName}**`);
    
        await interaction.reply({ embeds: [embed] });
    
        const endButton = new ButtonBuilder()
            .setCustomId('end_voting')
            .setLabel('End Voting')
            .setStyle(ButtonStyle.Danger);
    
        const endButtonRow = new ActionRowBuilder().addComponents(endButton);
    
        duels.forEach(async (duel, index) => {
            const duelEmbed = new EmbedBuilder()
                .setDescription(`**${duel.slot1}** vs **${duel.slot2}**\n` +
                                `**${duel.votes.slot1}** votes vs **${duel.votes.slot2}** votes`)
                .setFooter({ text: 'Vote by clicking the buttons below' });
    
            const firstButton = new ButtonBuilder()
                .setCustomId(`duel_${index}_slot1`)  // Use index to identify the duel
                .setLabel(duel.slot1)
                .setStyle(ButtonStyle.Primary);
    
            const secondButton = new ButtonBuilder()
                .setCustomId(`duel_${index}_slot2`)  // Use index to identify the duel
                .setLabel(duel.slot2)
                .setStyle(ButtonStyle.Primary);
    
            const buttonRow = new ActionRowBuilder().addComponents(firstButton, secondButton);
    
            await interaction.channel.send({ embeds: [duelEmbed], components: [buttonRow] });
        });
    
        await interaction.channel.send({ content: 'Click "End Voting" to stop voting.', components: [endButtonRow] });
    
        const collector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 86400000, // 24 hours
        });
    
        collector.on('collect', async (buttonInteraction) => {
            if (buttonInteraction.customId.startsWith('duel_')) {
                const [_, duelIndex, slot] = buttonInteraction.customId.split('_');
                const voteSlot = slot === 'slot1' ? 'slot1' : 'slot2';
    
                const duelToUpdate = prediction.duels[parseInt(duelIndex)];

                const userName = buttonInteraction.user.username;
                const leaderboardEntry = await Leaderboard.findOne({ guildId, playerName: userName });

                if (!leaderboardEntry) {
                    const newLeaderboardEntry = new Leaderboard({
                        _id: new mongoose.Types.ObjectId(),
                        guildId,
                        playerName: userName,
                        playerPoints: 0,
                    });

                    await newLeaderboardEntry.save();
                }

                if (!duelToUpdate) {
                    return buttonInteraction.reply({ content: 'Duel not found.', ephemeral: true });
                }

                const userHasVoted = duelToUpdate.votedUsers.some(vote => vote.voterId === buttonInteraction.user.id);

                if (userHasVoted) {
                    return buttonInteraction.reply({ content: 'You have already voted in this duel.', ephemeral: true });
                }
    
                duelToUpdate.votes[slot]++;

                if (slot === 'slot1') {
                    slotNumber = 1;
                } else {
                    slotNumber = 2;
                }

                duelToUpdate.votedUsers.push({
                    voterId: buttonInteraction.user.id,
                    slotVoted: slotNumber,
                });
                await prediction.save();

                await buttonInteraction.reply({ 
                    content: `Vote recorded for **${duelToUpdate[voteSlot]}** in the duel between **${duelToUpdate.slot1}** and **${duelToUpdate.slot2}**.`,
                    ephemeral: true
                });
    
                const duelEmbed = new EmbedBuilder()
                    .setDescription(`**${duelToUpdate.slot1}** vs **${duelToUpdate.slot2}**\n` +
                                    `**${duelToUpdate.votes.slot1}** votes vs **${duelToUpdate.votes.slot2}** votes`)
                    .setFooter({ text: 'Vote by clicking the buttons below' });

                const message = await buttonInteraction.message.fetch();
                await message.edit({ embeds: [duelEmbed] });
            } else if (buttonInteraction.customId === 'end_voting') {
                if (!buttonInteraction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return buttonInteraction.reply({ content: 'You do not have permission to end voting.', ephemeral: true });
                }
    
                collector.stop('End button clicked by a moderator.');
    
                await interaction.channel.send('Voting has ended.');
            }
        });
    
        collector.on('end', (collected, reason) => {
            if (reason === 'End button clicked by a moderator.') {
                interaction.channel.send(`Voting ended by a moderator. ${collected.size} votes collected.`);
            } else {
                interaction.channel.send(`Voting ended automatically. ${collected.size} votes collected.`);
            }
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