const mongoose = require('mongoose');

const cameraSchema = new mongoose.Schema({
    cameraName: { type: String, required: true },
    cameraId: { type: String, required: true, unique: true },
    location: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    rtspUrl: { type: String },
    deviceId: { type: String },
    status: {
        type: String,
        enum: ['ONLINE', 'OFFLINE', 'MAINTENANCE'],
        default: 'OFFLINE'
    },
    lastHeartbeat: { type: Date, default: Date.now }
}, {
    timestamps: true
});

module.exports = mongoose.model('Camera', cameraSchema);
