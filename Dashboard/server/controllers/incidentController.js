const mongoose = require('mongoose');
const Incident = require('../models/Incident');
const Camera = require('../models/Camera');
const EdgeDevice = require('../models/EdgeDevice');
const EmergencyUnit = require('../models/EmergencyUnit');


function publicVideoUrl(value) {
    if (!value || typeof value !== 'string') return value || null;

    // Keep already-public URLs and URL paths unchanged.
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/uploads/')) return value;

    // Older records stored Multer's absolute filesystem path in MongoDB.
    // Convert only the public URL; never expose a local filesystem path to the browser.
    const normalized = value.replace(/\\\\/g, '/');
    const filename = normalized.split('/').filter(Boolean).pop();
    if (!filename) return null;
    return `/uploads/incidents/${encodeURIComponent(filename)}`;
}

const getIncidents = async (req, res) => {
    try {
        const incidents = await Incident.find({}).sort({ createdAt: -1 }).lean();
        res.json(incidents.map((incident) => ({
            ...incident,
            videoUrl: publicVideoUrl(incident.videoUrl)
        })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Android clients may send JSON directly or JSON encoded in multipart field "report".
function getReportBody(req) {
    let body = req.body || {};
    if (typeof body.report === 'string') {
        try { body = { ...body, ...JSON.parse(body.report) }; }
        catch (_) { throw new Error('Multipart field "report" must contain valid JSON'); }
    }
    return body;
}

async function resolveCamera(body) {
    let camera = null;
    const cameraId = body.cameraId;
    if (cameraId && mongoose.Types.ObjectId.isValid(String(cameraId))) {
        camera = await Camera.findById(cameraId);
    }
    if (!camera && cameraId) camera = await Camera.findOne({ cameraId: String(cameraId) });

    const deviceId = body.edgeDeviceId || body.deviceId || body.device_id || body.deviceId;
    let device = null;
    if (!camera && deviceId) {
        device = await EdgeDevice.findOne({ deviceId: String(deviceId) });
        if (device && device.cameraId) camera = await Camera.findOne({ cameraId: device.cameraId });
    }

    if (!camera && deviceId) {
        // Fallback for devices registered before automatic camera provisioning was added.
        const externalCameraId = device?.cameraId || `android-${deviceId}`;
        camera = await Camera.findOne({ cameraId: externalCameraId });
        if (!camera) {
            const lat = Number(body.latitude ?? device?.latitude ?? 0);
            const lng = Number(body.longitude ?? device?.longitude ?? 0);
            camera = await Camera.create({
                cameraName: body.cameraName || `${device?.deviceName || deviceId} Camera`,
                cameraId: externalCameraId,
                location: (lat || lng) ? `Device location (${lat}, ${lng})` : 'Location pending',
                latitude: Number.isFinite(lat) ? lat : 0,
                longitude: Number.isFinite(lng) ? lng : 0,
                deviceId: String(deviceId),
                status: 'ONLINE',
                lastHeartbeat: Date.now()
            });
            if (device && !device.cameraId) {
                device.cameraId = externalCameraId;
                await device.save();
            }
        }
    }
    return { camera, device };
}

async function createIncident(req, res, includeVideo) {
    try {
        const body = getReportBody(req);
        const { camera, device } = await resolveCamera(body);
        if (!camera) {
            return res.status(400).json({ message: 'Camera could not be resolved. Register the edge device first or provide a valid cameraId/deviceId.' });
        }

        const lat = body.latitude ?? body.location?.latitude ?? body.location?.lat ?? camera.latitude;
        const lng = body.longitude ?? body.location?.longitude ?? body.location?.lng ?? camera.longitude;
        const snapshotImage = body.snapshotImage || body.snapshot_image || '';
        const videoUrl = includeVideo && req.file ? `/uploads/incidents/${encodeURIComponent(req.file.filename)}` : publicVideoUrl(body.videoUrl || body.video_url || null);
        const incident = await Incident.create({
            cameraId: camera._id,
            edgeDeviceId: body.edgeDeviceId || body.deviceId || body.device_id || device?.deviceId || camera.deviceId || 'unknown',
            cameraName: body.cameraName || camera.cameraName,
            timestamp: body.timestamp || Date.now(),
            location: {
                latitude: Number.isFinite(Number(lat)) ? Number(lat) : camera.latitude,
                longitude: Number.isFinite(Number(lng)) ? Number(lng) : camera.longitude
            },
            snapshotImage,
            confidence: body.confidence,
            vehicleCount: body.vehicleCount,
            incidentType: body.incidentType || body.type || body.severity || 'UNKNOWN',
            status: 'PENDING_VERIFICATION',
            ...(includeVideo ? { videoUrl } : {})
        });

        const io = req.app.get('socketio');
        if (io) {
            io.emit('incident:new', incident);
            io.emit('dashboard:update');
        }
        return res.status(201).json(incident);
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
}

const reportIncident = (req, res) => createIncident(req, res, false);
const reportIncidentWithVideo = (req, res) => createIncident(req, res, true);

// @desc    Verify incident
// @route   PATCH /api/incidents/:id/verify
// @access  Private
const verifyIncident = async (req, res) => {
    try {
        const incident = await Incident.findById(req.params.id);
        if (incident) {
            incident.status = 'VERIFIED';
            if (req.user?._id) incident.verifiedBy = req.user._id;
            incident.verificationTime = Date.now();
            const updatedIncident = await incident.save();

            const io = req.app.get('socketio');
            if (io) {
                io.emit('incident:update', updatedIncident);
                io.emit('dashboard:update');
            }

            return res.json(updatedIncident);
        } else {
            res.status(404).json({ message: 'Incident not found' });
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Reject incident (False Positive)
// @route   PATCH /api/incidents/:id/reject
// @access  Private
const rejectIncident = async (req, res) => {
    try {
        const incident = await Incident.findById(req.params.id);
        if (incident) {
            incident.status = 'FALSE_POSITIVE';
            if (req.user?._id) incident.verifiedBy = req.user._id;
            incident.verificationTime = Date.now();
            const updatedIncident = await incident.save();

            const io = req.app.get('socketio');
            if (io) {
                io.emit('incident:update', updatedIncident);
                io.emit('dashboard:update');
            }

            return res.json(updatedIncident);
        } else {
            res.status(404).json({ message: 'Incident not found' });
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Dispatch unit to incident
// @route   POST /api/incidents/:id/dispatch
// @access  Private
const dispatchIncident = async (req, res) => {
    try {
        const { unitId, operatorNotes } = req.body;
        const incident = await Incident.findById(req.params.id);
        const unit = await EmergencyUnit.findOne({ unitId });

        if (!incident) return res.status(404).json({ message: 'Incident not found' });
        if (!unit) return res.status(404).json({ message: 'Unit not found' });

        if (incident.status !== 'VERIFIED') {
            return res.status(400).json({ message: 'Only verified incidents can be dispatched' });
        }
        if (unit.status !== 'AVAILABLE') {
            return res.status(400).json({ message: 'Unit is not available' });
        }

        incident.status = 'DISPATCHED';
        incident.dispatchedAt = Date.now();
        incident.assignedUnit = `${unit.unitName} (${unit.unitId})`;
        incident.operatorNotes = operatorNotes;
        const updatedIncident = await incident.save();

        unit.status = 'DISPATCHED';
        await unit.save();

        const io = req.app.get('socketio');
        io.emit('incident:dispatched', updatedIncident);
        io.emit('dashboard:update');

        res.json(updatedIncident);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Mark incident as responding
// @route   POST /api/incidents/:id/respond
// @access  Private
const respondIncident = async (req, res) => {
    try {
        const incident = await Incident.findById(req.params.id);
        if (!incident) return res.status(404).json({ message: 'Incident not found' });

        if (incident.status !== 'DISPATCHED') {
            return res.status(400).json({ message: 'Incident must be dispatched before responding' });
        }

        incident.status = 'RESPONDING';
        incident.respondingAt = Date.now();
        const updatedIncident = await incident.save();

        // Extract unitId from assignedUnit string "Name (ID)"
        const unitIdMatch = incident.assignedUnit.match(/\((.*)\)/);
        if (unitIdMatch) {
            const unit = await EmergencyUnit.findOne({ unitId: unitIdMatch[1] });
            if (unit) {
                unit.status = 'RESPONDING';
                await unit.save();
            }
        }

        const io = req.app.get('socketio');
        io.emit('incident:responding', updatedIncident);
        io.emit('dashboard:update');

        res.json(updatedIncident);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Mark incident as resolved
// @route   POST /api/incidents/:id/resolve
// @access  Private
const resolveIncident = async (req, res) => {
    try {
        const { operatorNotes } = req.body;
        const incident = await Incident.findById(req.params.id);
        if (!incident) return res.status(404).json({ message: 'Incident not found' });

        if (incident.status !== 'RESPONDING') {
            return res.status(400).json({ message: 'Incident must be in responding state to resolve' });
        }

        incident.status = 'RESOLVED';
        incident.resolvedAt = Date.now();
        if (operatorNotes) incident.operatorNotes = operatorNotes;
        const updatedIncident = await incident.save();

        // Extract unitId from assignedUnit string "Name (ID)"
        const unitIdMatch = incident.assignedUnit.match(/\((.*)\)/);
        if (unitIdMatch) {
            const unit = await EmergencyUnit.findOne({ unitId: unitIdMatch[1] });
            if (unit) {
                unit.status = 'AVAILABLE';
                await unit.save();
            }
        }

        const io = req.app.get('socketio');
        io.emit('incident:resolved', updatedIncident);
        io.emit('dashboard:update');

        res.json(updatedIncident);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};


module.exports = { getIncidents, reportIncident, reportIncidentWithVideo, verifyIncident, rejectIncident, dispatchIncident, respondIncident, resolveIncident };
