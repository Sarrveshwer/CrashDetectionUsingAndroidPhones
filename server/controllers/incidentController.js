const Incident = require('../models/Incident');
const EmergencyUnit = require('../models/EmergencyUnit');

// @desc    Get all incidents
// @route   GET /api/incidents
// @access  Private
const getIncidents = async (req, res) => {
    try {
        const incidents = await Incident.find({}).sort({ createdAt: -1 });
        res.json(incidents);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Report new incident (Alert from Android Application)
// @route   POST /api/incidents/report
// @access  Public (Placeholder for Android API integration)
const reportIncident = async (req, res) => {
    try {
        const {
            cameraId,
            edgeDeviceId,
            cameraName,
            timestamp,
            latitude,
            longitude,
            confidence,
            snapshotImage,
            vehicleCount,
            incidentType
        } = req.body;

        const incident = await Incident.create({
            cameraId,
            edgeDeviceId,
            cameraName,
            timestamp: timestamp || Date.now(),
            location: {
                latitude,
                longitude
            },
            snapshotImage,
            confidence,
            vehicleCount,
            incidentType,
            status: 'PENDING_VERIFICATION'
        });

        // Emit socket event for real-time dashboard update
        const io = req.app.get('socketio');
        io.emit('incident:new', incident);
        io.emit('dashboard:update'); // Trigger stats refresh

        res.status(201).json(incident);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Verify incident
// @route   PATCH /api/incidents/:id/verify
// @access  Private
const verifyIncident = async (req, res) => {
    try {
        const incident = await Incident.findById(req.params.id);
        if (incident) {
            incident.status = 'VERIFIED';
            incident.verifiedBy = req.user._id;
            incident.verificationTime = Date.now();
            const updatedIncident = await incident.save();

            const io = req.app.get('socketio');
            io.emit('incident:update', updatedIncident);
            io.emit('dashboard:update');

            res.json(updatedIncident);
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
            incident.verifiedBy = req.user._id;
            incident.verificationTime = Date.now();
            const updatedIncident = await incident.save();

            const io = req.app.get('socketio');
            io.emit('incident:update', updatedIncident);
            io.emit('dashboard:update');

            res.json(updatedIncident);
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

module.exports = {
    getIncidents,
    reportIncident,
    verifyIncident,
    rejectIncident,
    dispatchIncident,
    respondIncident,
    resolveIncident
};
