const express = require('express');
const router = express.Router();
const {
    registerDevice,
    sendHeartbeat,
    getDevices,
    getDeviceById
} = require('../controllers/deviceController');

router.post('/register', registerDevice);
router.post('/:deviceId/heartbeat', sendHeartbeat);
router.get('/', getDevices);
router.get('/:deviceId', getDeviceById);

module.exports = router;
