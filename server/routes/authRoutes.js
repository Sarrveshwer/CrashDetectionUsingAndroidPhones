const express = require('express');
const router = express.Router();
const { loginUser, logoutUser, getMe } = require('../controllers/authController');

router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.get('/me', getMe);

module.exports = router;
