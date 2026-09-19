const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema({
    event: { type: String, required: true },
    details: { type: String },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SystemLog', systemLogSchema);
