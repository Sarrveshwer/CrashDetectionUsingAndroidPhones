const mongoose = require('mongoose');

const emergencyUnitSchema = new mongoose.Schema({
    unitId: { type: String, required: true, unique: true },
    unitName: { type: String, required: true },
    unitType: {
        type: String,
        enum: ['AMBULANCE', 'POLICE', 'FIRE'],
        required: true
    },
    status: {
        type: String,
        enum: ['AVAILABLE', 'DISPATCHED', 'RESPONDING', 'UNAVAILABLE'],
        default: 'AVAILABLE'
    },
    currentLocation: {
        latitude: { type: Number },
        longitude: { type: Number },
        address: { type: String }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('EmergencyUnit', emergencyUnitSchema);
