const EdgeDevice = require('../models/EdgeDevice');
const Camera = require('../models/Camera');
const { getEffectiveStatus } = require('../utils/deviceStatus');

// Register an edge device and ensure it has a camera record.
// EdgeDevice.cameraId stores the camera's external string ID; Incident.cameraId
// stores the Camera document's MongoDB ObjectId.
const registerDevice = async (req, res) => {
    const { deviceId, deviceName, deviceModel, androidVersion, appVersion, ipAddress } = req.body;

    if (!deviceId || !deviceName) {
        return res.status(400).json({ message: 'Please provide deviceId and deviceName' });
    }

    try {
        let device = await EdgeDevice.findOne({ deviceId });
        const externalCameraId = (req.body.cameraId || device?.cameraId || `android-${deviceId}`).toString();

        // Reuse the camera on repeat registrations instead of creating duplicates.
        let camera = await Camera.findOne({ cameraId: externalCameraId });
        if (!camera) {
            camera = await Camera.create({
                cameraName: `${deviceName} Camera`,
                cameraId: externalCameraId,
                location: 'Location pending',
                latitude: 0,
                longitude: 0,
                deviceId,
                status: 'ONLINE',
                lastHeartbeat: Date.now()
            });
        } else {
            camera.cameraName = camera.cameraName || `${deviceName} Camera`;
            camera.deviceId = deviceId;
            camera.status = 'ONLINE';
            camera.lastHeartbeat = Date.now();
            await camera.save();
        }

        if (device) {
            device.deviceName = deviceName;
            device.deviceModel = deviceModel || device.deviceModel;
            device.androidVersion = androidVersion || device.androidVersion;
            device.appVersion = appVersion || device.appVersion;
            device.ipAddress = ipAddress || device.ipAddress;
            device.cameraId = externalCameraId;
            device.status = 'ONLINE';
            device.lastHeartbeat = Date.now();
            await device.save();
        } else {
            device = await EdgeDevice.create({
                deviceId, deviceName, deviceModel, androidVersion, appVersion, ipAddress,
                cameraId: externalCameraId,
                status: 'ONLINE',
                lastHeartbeat: Date.now()
            });
        }

        const io = req.app.get('socketio');
        if (io) {
            io.to('admin-room').emit('device:registered', device);
            io.to('admin-room').emit('dashboard:update');
        }

        res.status(200).json({
            ...device._doc,
            camera: {
                _id: camera._id,
                cameraId: camera.cameraId,
                cameraName: camera.cameraName,
                location: camera.location,
                latitude: camera.latitude,
                longitude: camera.longitude,
                status: camera.status
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const sendHeartbeat = async (req, res) => {
    const { deviceId } = req.params;
    const { status, latitude, longitude } = req.body;

    try {
        const device = await EdgeDevice.findOne({ deviceId });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const oldStatus = getEffectiveStatus(device.lastHeartbeat, device.status);
        device.lastHeartbeat = Date.now();
        device.status = status || 'ONLINE';
        if (latitude !== undefined && latitude !== null) device.latitude = latitude;
        if (longitude !== undefined && longitude !== null) device.longitude = longitude;
        await device.save();

        if (device.cameraId) {
            const camera = await Camera.findOne({ cameraId: device.cameraId });
            if (camera) {
                camera.lastHeartbeat = Date.now();
                camera.status = 'ONLINE';
                if (latitude !== undefined && latitude !== null) camera.latitude = latitude;
                if (longitude !== undefined && longitude !== null) camera.longitude = longitude;
                if ((latitude !== undefined && latitude !== null) || (longitude !== undefined && longitude !== null)) {
                    camera.location = `Device location (${camera.latitude}, ${camera.longitude})`;
                }
                await camera.save();
            }
        }

        const newStatus = getEffectiveStatus(device.lastHeartbeat, device.status);
        const io = req.app.get('socketio');
        if (io) {
            if (oldStatus !== newStatus) {
                const event = newStatus === 'ONLINE' ? 'device:online' : 'device:offline';
                io.to('admin-room').emit(event, { deviceId, status: newStatus });
                io.to('admin-room').emit('dashboard:update');
            }
            io.to('admin-room').emit('device:update', device);
        }
        res.status(200).json({ message: 'Heartbeat received' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDevices = async (req, res) => {
    try {
        const devices = await EdgeDevice.find({}).sort({ createdAt: -1 });
        res.json(devices.map(dev => ({ ...dev._doc, status: getEffectiveStatus(dev.lastHeartbeat, dev.status) })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDeviceById = async (req, res) => {
    try {
        const device = await EdgeDevice.findOne({ deviceId: req.params.deviceId });
        if (device) {
            res.json({ ...device._doc, status: getEffectiveStatus(device.lastHeartbeat, device.status) });
        } else {
            res.status(404).json({ message: 'Device not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { registerDevice, sendHeartbeat, getDevices, getDeviceById };
