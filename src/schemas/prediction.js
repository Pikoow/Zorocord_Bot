const { Schema, model } = require('mongoose');

const predictionSchema = new Schema({
    _id: Schema.Types.ObjectId,
    predictionName: { type: String, required: true },
    guildId: { type: String, required: true },
    roster1: { type: Schema.Types.ObjectId, ref: 'Roster', required: true },
    roster2: { type: Schema.Types.ObjectId, ref: 'Roster', required: true },
    duels: [{
        slot1: { type: String, required: true },
        slot2: { type: String, required: true },
        votes: { 
            slot1: { type: Number, default: 0 },
            slot2: { type: Number, default: 0 },
        },
        votedUsers: [
            {
                voterId: { type: String, required: true },
                slotVoted: { type: Number, required: true }
            }
        ]
    }],
});

predictionSchema.index({ guildId: 1, predictionName: 1 }, { unique: true });

module.exports = model("Prediction", predictionSchema, "predictions");