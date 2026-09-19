const express = require('express');
const router = express.Router();
const {
    registerDevice,
    sendHeartbeat,
    getDevices,
    getDeviceById
} = require('../controllers/deviceController');
const { protect } = require('../middleware/auth');

router.post('/register', registerDevice);
router.post('/:deviceId/heartbeat', sendHeartbeat);
router.get('/', protect, getDevices);
router.get('/:deviceId', protect, getDeviceById);

module.exports = router;
