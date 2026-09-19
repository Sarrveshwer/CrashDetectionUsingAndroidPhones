const Camera = require('../models/Camera');
const { getEffectiveStatus } = require('../utils/deviceStatus');

// @desc    Get all cameras
// @route   GET /api/cameras
// @access  Private
const getCameras = async (req, res) => {
    try {
        const cameras = await Camera.find({}).sort({ createdAt: -1 });
        const mappedCameras = cameras.map(cam => ({
            ...cam._doc,
            status: getEffectiveStatus(cam.lastHeartbeat, cam.status)
        }));
        res.json(mappedCameras);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get camera by ID
// @route   GET /api/cameras/:id
// @access  Private
const getCameraById = async (req, res) => {
    try {
        const camera = await Camera.findById(req.params.id);
        if (camera) {
            const result = {
                ...camera._doc,
                status: getEffectiveStatus(camera.lastHeartbeat, camera.status)
            };
            res.json(result);
        } else {
            res.status(404).json({ message: 'Camera not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a camera
// @route   POST /api/cameras
// @access  Private/Admin
const createCamera = async (req, res) => {
    const { cameraName, cameraId, location, latitude, longitude, rtspUrl, deviceId } = req.body;

    if (!cameraName || !cameraId || !location || !latitude || !longitude) {
        return res.status(400).json({ message: 'Please provide all required fields' });
    }

    try {
        const camera = await Camera.create({
            cameraName,
            cameraId,
            location,
            latitude,
            longitude,
            rtspUrl,
            deviceId,
            status: 'OFFLINE'
        });

        const io = req.app.get('socketio');
        io.to('admin-room').emit('dashboard:update');

        res.status(201).json(camera);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update a camera
// @route   PUT /api/cameras/:id
// @access  Private/Admin
const updateCamera = async (req, res) => {
    try {
        const camera = await Camera.findById(req.params.id);
        if (camera) {
            const { cameraName, cameraId, location, latitude, longitude, rtspUrl, deviceId, status } = req.body;

            camera.cameraName = cameraName || camera.cameraName;
            camera.cameraId = cameraId || camera.cameraId;
            camera.location = location || camera.location;
            camera.latitude = latitude || camera.latitude;
            camera.longitude = longitude || camera.longitude;
            camera.rtspUrl = rtspUrl || camera.rtspUrl;
            camera.deviceId = deviceId !== undefined ? deviceId : camera.deviceId;
            camera.status = status || camera.status;

            const updatedCamera = await camera.save();

            const io = req.app.get('socketio');
            io.to('admin-room').emit('dashboard:update');

            res.json(updatedCamera);
        } else {
            res.status(404).json({ message: 'Camera not found' });
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Delete a camera
// @route   DELETE /api/cameras/:id
// @access  Private/Admin
const deleteCamera = async (req, res) => {
    try {
        const camera = await Camera.findById(req.params.id);
        if (camera) {
            await camera.deleteOne();

            const io = req.app.get('socketio');
            io.to('admin-room').emit('dashboard:update');

            res.json({ message: 'Camera removed' });
        } else {
            res.status(404).json({ message: 'Camera not found' });
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getCameras,
    getCameraById,
    createCamera,
    updateCamera,
    deleteCamera
};
