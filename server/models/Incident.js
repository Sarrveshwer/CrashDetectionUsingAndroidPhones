const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
    cameraId: { type: mongoose.Schema.Types.ObjectId, ref: 'Camera', required: true },
    edgeDeviceId: { type: String }, // Trackable to Edge Device
    cameraName: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    location: {
        latitude: { type: Number },
        longitude: { type: Number },
        address: { type: String }
    },
    snapshotImage: { type: String }, // URL or path to uploaded image
    confidence: { type: Number },
    status: {
        type: String,
        enum: ['PENDING_VERIFICATION', 'VERIFIED', 'FALSE_POSITIVE', 'DISPATCHED', 'RESPONDING', 'RESOLVED'],
        default: 'PENDING_VERIFICATION'
    },
    dispatchedAt: { type: Date },
    respondingAt: { type: Date },
    resolvedAt: { type: Date },
    assignedUnit: { type: String }, // Can store unitName or unitId
    operatorNotes: { type: String },
    incidentType: { type: String, default: 'CRASH' },
    vehicleCount: { type: Number, default: 0 },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verificationTime: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Incident', incidentSchema);
