const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

router.get('/', protect, (req, res) => {
    res.json({ message: 'Reports data placeholder' });
});

module.exports = router;
