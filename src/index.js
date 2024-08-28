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

    const rosterChoices = await getRosterChoices();
    await registerCommands(rosterChoices);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "delete_roster") {
        const rosterName = interaction.options.get('roster_name').value;

        const rosterProfile = await Roster.findOne({ rosterName });

        await Roster.deleteOne({ rosterName }).catch(console.error);

        const embed = new EmbedBuilder()
            .setTitle('Roster Deleted')
            .setDescription(`The roster **${rosterName}** has been deleted successfully.`)
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [embed] });

        const rosterChoices = await getRosterChoices();
        await registerCommands(rosterChoices);
    }

    if (interaction.commandName === "show_rosters") {
        const rosters = await Roster.find();

        if (!rosters.length) {
            const noRostersEmbed = new EmbedBuilder()
                .setTitle('No Rosters Found')
                .setDescription('There are no rosters available.')
                .setColor(0xFF0000);
            await interaction.reply({ embeds: [noRostersEmbed] });
            return;
        }

        const allRostersEmbed = new EmbedBuilder()
            .setTitle('All Rosters')
            .setColor(0x3498DB);

        rosters.forEach(roster => {
            const rosterDetails = roster.rosterPlayers
                .map(player => `**${player.playerName}** - ${player.purchasePrice}`)
                .join('\n') || 'No players in this roster yet.';

            allRostersEmbed.addFields([
                { name: `${roster.rosterName}`, value: `Manager : **${roster.managerName}**\n` + `Budget : **${roster.rosterBudget}**` + '\n' + rosterDetails }
            ]);
        });

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

        const rosterProfile = new Roster({
            _id: new mongoose.Types.ObjectId(),
            managerName: manager,
            rosterName: rosterName,
            rosterPlayers: [],
            rosterBudget: 120000,
        });

        await rosterProfile.save().catch(console.error);

        const embed = new EmbedBuilder()
            .setTitle('Roster Created')
            .setDescription(`The roster named **${rosterProfile.rosterName}** managed by **${rosterProfile.managerName}** has been created!`)
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [embed] });

        const rosterChoices = await getRosterChoices();
        await registerCommands(rosterChoices);
    }
    
    if (interaction.commandName === "roster") {
        const name = interaction.options.get('name').value;

        let rosterProfile = await Roster.findOne({ rosterName: name });

        if (!rosterProfile) {
            const embed = new EmbedBuilder()
                .setTitle('Roster Not Found')
                .setDescription(`No roster found with the name **${rosterName}**.`)
                .setColor(0xFF0000);

            return interaction.reply({ embeds: [embed]});
        }

        const rosterDetails = rosterProfile.rosterPlayers
            .map(player => `**${player.playerName}** - ${player.purchasePrice} zorocoins`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`${rosterProfile.rosterName} :`)
            .setDescription(rosterProfile.rosterPlayers.length > 0 ? `${rosterDetails}` + `\nBudget : **${rosterProfile.rosterBudget}**` : 'No players in this roster.' + `\nBudget : **${rosterProfile.rosterBudget}**`)
            .setColor(0x3498DB);

        await interaction.reply({ embeds: [embed] });
    }
    
    if (interaction.commandName === "start") {
        const player = interaction.options.get('player').value;
        const time = interaction.options.get('time').value;
        const startingPrice = interaction.options.get('starting_price').value;

        let currentPrice = startingPrice;
        let lastBidder = null;
        let lastBidderId = null;
        let countdown = time;
        let countdownInterval = null;
        let countdownMessage = null;
        let collector = null;

        const auctionEmbed = new EmbedBuilder()
            .setTitle('Auction Started !')
            .setDescription(`Player getting auctionned : **${player}** !\nStarting price: **${startingPrice}** zorocoins.`)
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
                        .setDescription(`${countdown} seconds !`)
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
                                .setDescription(`${countdown} seconds !`)
                                .setColor(0xFFFF00)
                        ]
                    });
                } else {
                    clearInterval(countdownInterval);
                    collector.stop();

                    const endAuctionEmbed = new EmbedBuilder()
                        .setTitle('Auction Ended !')
                        .setColor(0xFF0000);

                    if (lastBidder === '_n_tm_') {
                        lastBidder = 'N';
                    } else if (lastBidder === 'forgo_isles_ceo') {
                        lastBidder = 'Lulu';
                    } else if (lastBidder === 'applejuice127') {
                        lastBidder = 'Felilou';
                    } else if (lastBidder === 'roy_yamaha') {
                        lastBidder = 'Ryellow Yamada';
                    } else if (lastBidder === 'pikoow') {
                        lastBidder = 'Lulu';
                    } else if (lastBidder === 'albret_') {
                        lastBidder = 'Albret';
                    }

                    if (lastBidder) {
                        const winnerProfile = await Roster.findOne({ managerName: lastBidder });

                        if (winnerProfile) {
                            winnerProfile.rosterBudget -= currentPrice;
                            winnerProfile.rosterPlayers.push({
                                playerName: player,
                                purchasePrice: currentPrice
                            });
                            await winnerProfile.save();

                            endAuctionEmbed.setDescription(`Auction ended! Final price: **${currentPrice}** zorocoins by **${lastBidder}**.\n**${lastBidder}** now has a remaining budget of **${winnerProfile.rosterBudget}**.`);
                        } else {
                            endAuctionEmbed.setDescription(`Auction ended, but an error occurred with the winner's profile.`);
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
                const newPrice = parseInt(message.content.trim(), 10);

                if (newPrice <= currentPrice) return;

                let potentialBidder = message.author.username;

                if (potentialBidder === '_n_tm_') {
                    potentialBidder = 'Lulu';
                } else if (potentialBidder === 'forgo_isles_ceo') {
                    potentialBidder = 'Lulu';
                } else if (potentialBidder === 'applejuice127') {
                    potentialBidder = 'Felilou';
                } else if (potentialBidder === 'roy_yamaha') {
                    potentialBidder = 'Ryellow Yamada';
                } else if (potentialBidder === 'pikoow') {
                    potentialBidder = 'Lulu';
                } else if (potentialBidder === 'albret_') {
                    potentialBidder = 'Albret';
                }

                const potentialBidderProfile = await Roster.findOne({ managerName: potentialBidder });

                if (potentialBidderProfile.rosterBudget < newPrice) {
                    const insufficientFundsEmbed = new EmbedBuilder()
                        .setTitle('Bid Rejected')
                        .setDescription(`**${potentialBidder}**, your bid of **${newPrice}** exceeds your current budget of **${potentialBidderProfile.rosterBudget}** zorocoins.`)
                        .setColor(0xFF0000);

                    await interaction.channel.send({ embeds: [insufficientFundsEmbed] });
                    return;
                }

                lastBidder = potentialBidder;
                lastBidderId = message.author.id;
                currentPrice = newPrice;

                const bidEmbed = new EmbedBuilder()
                    .setTitle('New Bid!')
                    .setDescription(`**${lastBidder}** has bid **${currentPrice}** zorocoins on **${player}**!`)
                    .setColor(0x00FF00);

                await interaction.channel.send({ embeds: [bidEmbed] });

                await startCountdown();
                startCollector();
            });
        };

        await startCountdown();
        startCollector();
    }
});

async function getRosterChoices() {
    const rosters = await Roster.find({}, 'rosterName').exec();
    return rosters.map(roster => ({
        name: roster.rosterName,
        value: roster.rosterName,
    }));
}

module.exports = { getRosterChoices };