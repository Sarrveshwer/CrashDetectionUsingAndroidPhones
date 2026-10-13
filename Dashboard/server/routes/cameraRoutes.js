const express = require('express');
const router = express.Router();
const {
    getCameras,
    getCameraById,
    createCamera,
    updateCamera,
    deleteCamera
} = require('../controllers/cameraController');

router.route('/')
    .get(getCameras)
    .post(createCamera);

router.route('/:id')
    .get(getCameraById)
    .put(updateCamera)
    .delete(deleteCamera);

module.exports = router;
