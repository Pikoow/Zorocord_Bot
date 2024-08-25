const { Schema, model } = require('mongoose');

const rosterSchema = new Schema({
    _id: Schema.Types.ObjectId,
    managerName : String,
    rosterName : String,
    rosterPlayers: [
        {
            playerName: String,
            purchasePrice: Number
        }
    ],
    rosterBudget: { type: Number, default: 120000 },
});

module.exports = model("Roster", rosterSchema, "rosters");