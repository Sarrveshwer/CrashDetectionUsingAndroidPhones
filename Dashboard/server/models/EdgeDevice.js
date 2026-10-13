const mongoose = require('mongoose');

const edgeDeviceSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true },
    deviceName: { type: String, required: true },
    cameraId: { type: String },
    deviceModel: { type: String },
    androidVersion: { type: String },
    appVersion: { type: String },
    status: {
        type: String,
        enum: ['ONLINE', 'OFFLINE'],
        default: 'OFFLINE'
    },
    latitude: { type: Number },
    longitude: { type: Number },
    lastHeartbeat: { type: Date, default: Date.now },
    ipAddress: { type: String }
}, {
    timestamps: true
});

module.exports = mongoose.model('EdgeDevice', edgeDeviceSchema);
