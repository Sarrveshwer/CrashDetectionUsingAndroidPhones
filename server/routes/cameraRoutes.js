const express = require('express');
const router = express.Router();
const {
    getCameras,
    getCameraById,
    createCamera,
    updateCamera,
    deleteCamera
} = require('../controllers/cameraController');
const { protect, adminOnly } = require('../middleware/auth');

router.route('/')
    .get(protect, getCameras)
    .post(protect, adminOnly, createCamera);

router.route('/:id')
    .get(protect, getCameraById)
    .put(protect, adminOnly, updateCamera)
    .delete(protect, adminOnly, deleteCamera);

module.exports = router;
