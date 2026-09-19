const EdgeDevice = require('../models/EdgeDevice');
const Camera = require('../models/Camera');
const { getEffectiveStatus } = require('../utils/deviceStatus');

// @desc    Register a new edge device
// @route   POST /api/devices/register
// @access  Public
const registerDevice = async (req, res) => {
    const { deviceId, deviceName, deviceModel, androidVersion, appVersion, ipAddress, cameraId } = req.body;

    if (!deviceId || !deviceName) {
        return res.status(400).json({ message: 'Please provide deviceId and deviceName' });
    }

    try {
        let device = await EdgeDevice.findOne({ deviceId });

        if (device) {
            device.deviceName = deviceName;
            device.deviceModel = deviceModel || device.deviceModel;
            device.androidVersion = androidVersion || device.androidVersion;
            device.appVersion = appVersion || device.appVersion;
            device.ipAddress = ipAddress || device.ipAddress;
            device.cameraId = cameraId || device.cameraId;
            device.status = 'ONLINE';
            device.lastHeartbeat = Date.now();
            await device.save();
        } else {
            device = await EdgeDevice.create({
                deviceId,
                deviceName,
                deviceModel,
                androidVersion,
                appVersion,
                ipAddress,
                cameraId,
                status: 'ONLINE',
                lastHeartbeat: Date.now()
            });
        }

        const io = req.app.get('socketio');
        io.to('admin-room').emit('device:registered', device);
        io.to('admin-room').emit('dashboard:update');

        res.status(200).json(device);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Receive heartbeat from device
// @route   POST /api/devices/:deviceId/heartbeat
// @access  Public
const sendHeartbeat = async (req, res) => {
    const { deviceId } = req.params;
    const { status, latitude, longitude } = req.body;

    try {
        const device = await EdgeDevice.findOne({ deviceId });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const oldStatus = getEffectiveStatus(device.lastHeartbeat, device.status);
        device.lastHeartbeat = Date.now();
        device.status = status || 'ONLINE';
        if (latitude) device.latitude = latitude;
        if (longitude) device.longitude = longitude;
        await device.save();

        // Update associated camera if it exists
        if (device.cameraId) {
            const camera = await Camera.findOne({ cameraId: device.cameraId });
            if (camera) {
                camera.lastHeartbeat = Date.now();
                camera.status = 'ONLINE';
                await camera.save();
            }
        }

        const newStatus = getEffectiveStatus(device.lastHeartbeat, device.status);
        const io = req.app.get('socketio');

        if (oldStatus !== newStatus) {
            const event = newStatus === 'ONLINE' ? 'device:online' : 'device:offline';
            io.to('admin-room').emit(event, { deviceId, status: newStatus });
            io.to('admin-room').emit('dashboard:update');
        }

        io.to('admin-room').emit('device:update', device);

        res.status(200).json({ message: 'Heartbeat received' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all edge devices
// @route   GET /api/devices
// @access  Private
const getDevices = async (req, res) => {
    try {
        const devices = await EdgeDevice.find({}).sort({ createdAt: -1 });
        const mappedDevices = devices.map(dev => ({
            ...dev._doc,
            status: getEffectiveStatus(dev.lastHeartbeat, dev.status)
        }));
        res.json(mappedDevices);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get device by ID
// @route   GET /api/devices/:deviceId
// @access  Private
const getDeviceById = async (req, res) => {
    try {
        const device = await EdgeDevice.findOne({ deviceId: req.params.deviceId });
        if (device) {
            const result = {
                ...device._doc,
                status: getEffectiveStatus(device.lastHeartbeat, device.status)
            };
            res.json(result);
        } else {
            res.status(404).json({ message: 'Device not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    registerDevice,
    sendHeartbeat,
    getDevices,
    getDeviceById
};
