const express = require('express');
const router = express.Router();
const {
    getUnits,
    createUnit,
    updateUnit,
    deleteUnit
} = require('../controllers/unitController');
const { protect, adminOnly } = require('../middleware/auth');

router.route('/')
    .get(protect, getUnits)
    .post(protect, adminOnly, createUnit);

router.route('/:id')
    .put(protect, adminOnly, updateUnit)
    .delete(protect, adminOnly, deleteUnit);

module.exports = router;
