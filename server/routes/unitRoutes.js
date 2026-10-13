const express = require('express');
const router = express.Router();
const {
    getUnits,
    createUnit,
    updateUnit,
    deleteUnit
} = require('../controllers/unitController');

router.route('/')
    .get(getUnits)
    .post(createUnit);

router.route('/:id')
    .put(updateUnit)
    .delete(deleteUnit);

module.exports = router;
