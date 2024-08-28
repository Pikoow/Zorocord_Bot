require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, ActivityType } = require('discord.js');
const { connect, default: mongoose } = require('mongoose');
const Roster = require('../src/schemas/roster');
const { registerCommands } = require('./register-commands');

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
        await registerCommands(rosterChoices, guildId);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

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
        await registerCommands(rosterChoices, guildId);
    }

    if (interaction.commandName === "show_rosters") {
        const guildId = interaction.guild.id;
        const rosters = await Roster.find({ guildId }); // Filtrer par guildId
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
            guildId: guildId, // Association du guildId
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
        await registerCommands(rosterChoices, guildId);
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
    
        const guildId = interaction.guild.id; // Use guildId to identify the server
        const guild = interaction.guild;
    
        let currentPrice = startingPrice;
        let lastBidder = null;
        let countdown = time;
        let countdownInterval = null;
        let countdownMessage = null;
        let collector = null;
        let auctionActive = false;
    
        const auctionEmbed = new EmbedBuilder()
            .setTitle('Auction Started!')
            .setDescription(`Player being auctioned: **${player}**\nStarting price: **${startingPrice}**.`)
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
    
                    const endAuctionEmbed = new EmbedBuilder()
                        .setTitle('Auction Ended!')
                        .setColor(0xFF0000);
    
                    if (lastBidder) {
                        let lastBidderName = null;
    
                        try {
                            const member = await guild.members.fetch(lastBidder);
                            lastBidderName = member.user.username;
                        } catch (error) {
                            console.error('Error fetching member:', error);
                            endAuctionEmbed.setDescription('Auction ended, but an error occurred fetching the last bidder.');
                            await interaction.channel.send({ embeds: [endAuctionEmbed] });
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
                                `Auction ended! Final price: **${currentPrice}** by **${lastBidderName}**.\n` +
                                `**${lastBidderName}** now has a remaining budget of **${winnerProfile.rosterBudget}**.`
                            );
                        } else {
                            endAuctionEmbed.setDescription('Auction ended, but an error occurred with the winner\'s profile.');
                        }
                    } else {
                        endAuctionEmbed.setDescription('Auction ended with no bids.');
                    }
    
                    await interaction.channel.send({ embeds: [endAuctionEmbed] });
                }
            }, 1000);
        };
    
        const startCollector = () => {
            if (collector) collector.stop();
    
            const filter = (message) => !isNaN(message.content) && message.content.trim().length > 0;
            collector = interaction.channel.createMessageCollector({ filter, time: time * 1000 });
    
            collector.on('collect', async (message) => {
                if (!auctionActive) return; // Ignore messages if auction is not active
    
                const newPrice = parseInt(message.content.trim(), 10);
    
                if (newPrice <= currentPrice) return;
    
                if (message.author.id === lastBidder) return; // Ignore bids from the same bidder
    
                auctionActive = false; // Lock auction until current bid is processed
    
                let potentialBidderName = null;
                let potentialBidder = message.author.id;
    
                try {
                    const member = await guild.members.fetch(potentialBidder);
                    potentialBidderName = member.user.username;
                } catch (error) {
                    console.error('Error fetching member:', error);
                    auctionActive = true; // Unlock auction if error occurs
                    return;
                }
    
                const potentialBidderProfile = await Roster.findOne({ managerName: potentialBidder, guildId });
    
                if (!potentialBidderProfile || potentialBidderProfile.rosterBudget < newPrice) {
                    const insufficientFundsEmbed = new EmbedBuilder()
                        .setTitle('Bid Rejected')
                        .setDescription(`**${potentialBidderName}**, your bid of **${newPrice}** exceeds your current budget of **${potentialBidderProfile ? potentialBidderProfile.rosterBudget : 0}**.`)
                        .setColor(0xFF0000);
    
                    await interaction.channel.send({ embeds: [insufficientFundsEmbed] });
                    auctionActive = true; // Unlock auction if bid is rejected
                    return;
                }
    
                currentPrice = newPrice;
                lastBidder = potentialBidder;
    
                const bidEmbed = new EmbedBuilder()
                    .setTitle('New Bid!')
                    .setDescription(`**${potentialBidderName}** has bid **${currentPrice}** on **${player}**!`)
                    .setColor(0x00FF00);
    
                await interaction.channel.send({ embeds: [bidEmbed] });
    
                auctionActive = true; // Unlock auction to allow new bids
            });
        };
    
        auctionActive = true; // Start auction
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
});

async function getRosterChoices(guildId) {
    const rosters = await Roster.find({ guildId }, 'rosterName').exec();
    return rosters.map(roster => ({
        name: roster.rosterName,
        value: roster.rosterName,
    }));
}

module.exports = { getRosterChoices };