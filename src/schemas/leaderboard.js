const { Schema, model } = require('mongoose');

const leaderboardSchema = new Schema({
    _id: Schema.Types.ObjectId,
    guildId: { type: String, required: true },
    playerName: { type: String, required: true },
    playerPoints: { type: Number, required : true },
});

leaderboardSchema.index({ guildId: 1, playerName: 1 }, { unique: true });

module.exports = model("Leaderboard", leaderboardSchema, "leaderboards");