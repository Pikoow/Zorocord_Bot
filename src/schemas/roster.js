const { Schema, model } = require('mongoose');

const rosterSchema = new Schema({
    _id: Schema.Types.ObjectId,
    guildId: { type: String, required: true },
    managerName: { type: String, required: true },
    rosterName: { type: String, required: true },
    rosterPlayers: [
        {
            playerName: { type: String, required: true },
            purchasePrice: { type: Number, required: true, min: 0 },
        }
    ],
    rosterBudget: { type: Number, default: 120000, min: 0 },
});

rosterSchema.index({ guildId: 1, rosterName: 1 }, { unique: true });

module.exports = model("Roster", rosterSchema, "rosters");