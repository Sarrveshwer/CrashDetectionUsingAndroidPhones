const express = require('express');
const router = express.Router();
const {
    getIncidents,
    reportIncident,
    verifyIncident,
    rejectIncident,
    dispatchIncident,
    respondIncident,
    resolveIncident
} = require('../controllers/incidentController');
const { protect } = require('../middleware/auth');

router.route('/')
    .get(protect, getIncidents);

router.post('/report', reportIncident); // Endpoint for Android App

router.patch('/:id/verify', protect, verifyIncident);
router.patch('/:id/reject', protect, rejectIncident);
router.post('/:id/dispatch', protect, dispatchIncident);
router.post('/:id/respond', protect, respondIncident);
router.post('/:id/resolve', protect, resolveIncident);

module.exports = router;
