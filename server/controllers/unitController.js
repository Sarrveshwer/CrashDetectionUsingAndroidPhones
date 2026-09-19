const EmergencyUnit = require('../models/EmergencyUnit');

// @desc    Get all units
// @route   GET /api/units
// @access  Private
const getUnits = async (req, res) => {
    try {
        const units = await EmergencyUnit.find({});
        res.json(units);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a unit
// @route   POST /api/units
// @access  Private/Admin
const createUnit = async (req, res) => {
    try {
        const { unitId, unitName, unitType } = req.body;
        const unit = await EmergencyUnit.create({
            unitId,
            unitName,
            unitType,
            status: 'AVAILABLE'
        });
        res.status(201).json(unit);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update a unit
// @route   PUT /api/units/:id
// @access  Private/Admin
const updateUnit = async (req, res) => {
    try {
        const unit = await EmergencyUnit.findById(req.params.id);
        if (unit) {
            Object.assign(unit, req.body);
            const updatedUnit = await unit.save();
            res.json(updatedUnit);
        } else {
            res.status(404).json({ message: 'Unit not found' });
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Delete a unit
// @route   DELETE /api/units/:id
// @access  Private/Admin
const deleteUnit = async (req, res) => {
    try {
        const unit = await EmergencyUnit.findById(req.params.id);
        if (unit) {
            await unit.deleteOne();
            res.json({ message: 'Unit removed' });
        } else {
            res.status(404).json({ message: 'Unit not found' });
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getUnits,
    createUnit,
    updateUnit,
    deleteUnit
};
