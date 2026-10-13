const express = require('express');
const router = express.Router();
const {
    getIncidents,
    reportIncident,
    reportIncidentWithVideo,
    verifyIncident,
    rejectIncident,
    dispatchIncident,
    respondIncident,
    resolveIncident
} = require('../controllers/incidentController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const uploadDir = path.join(__dirname, '..', 'uploads', 'incidents');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.mp4';
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
    }
});

const upload = multer({ storage });

router.route('/')
    .get(getIncidents);

router.post('/report', reportIncident); // Endpoint for Android App (regular report)

router.post('/report-video', upload.single('video'), reportIncidentWithVideo); // Endpoint for Android App (debug video with multipart/form-data)

router.patch('/:id/verify', verifyIncident);
router.patch('/:id/reject', rejectIncident);
router.post('/:id/dispatch', dispatchIncident);
router.post('/:id/respond', respondIncident);
router.post('/:id/resolve', resolveIncident);

module.exports = router;