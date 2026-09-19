const Incident = require('../models/Incident');
const Camera = require('../models/Camera');
const EdgeDevice = require('../models/EdgeDevice');
const { HEARTBEAT_TIMEOUT } = require('../utils/deviceStatus');

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private
const getDashboardStats = async (req, res) => {
    try {
        const timeoutDate = new Date(Date.now() - HEARTBEAT_TIMEOUT);

        const totalCameras = await Camera.countDocuments();
        const onlineCameras = await Camera.countDocuments({
            status: 'ONLINE',
            lastHeartbeat: { $gt: timeoutDate }
        });
        const offlineCameras = totalCameras - onlineCameras;

        const totalDevices = await EdgeDevice.countDocuments();
        const onlineDevices = await EdgeDevice.countDocuments({
            status: 'ONLINE',
            lastHeartbeat: { $gt: timeoutDate }
        });

        // Incident lifecycle counts
        const pendingAlerts = await Incident.countDocuments({ status: 'PENDING_VERIFICATION' });
        const verifiedIncidents = await Incident.countDocuments({ status: 'VERIFIED' });
        const falsePositives = await Incident.countDocuments({ status: 'FALSE_POSITIVE' });
        const emergencyDispatches = await Incident.countDocuments({ status: 'DISPATCHED' });
        const respondingIncidents = await Incident.countDocuments({ status: 'RESPONDING' });
        const resolvedIncidents = await Incident.countDocuments({ status: 'RESOLVED' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIncidents = await Incident.countDocuments({
            createdAt: { $gte: today },
            status: { $in: ['VERIFIED', 'DISPATCHED', 'RESPONDING', 'RESOLVED'] }
        });

        const recentAlerts = await Incident.find({})
            .sort({ createdAt: -1 })
            .limit(10);

        res.json({
            totalCameras,
            onlineCameras,
            offlineCameras,
            totalDevices,
            onlineDevices,
            pendingAlerts,
            verifiedIncidents,
            falsePositives,
            todayIncidents,
            emergencyDispatches,
            respondingIncidents,
            resolvedIncidents,
            recentAlerts,
            systemStatus: onlineCameras > 0 ? 'Optimal' : 'Caution - Cameras Offline'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getDashboardStats };
