const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
    const { email, password } = req.body;

    // Hardcoded demo user if no users exist (for project foundation)
    let user = await User.findOne({ email });

    if (!user && email === 'admin@emergency.gov' && password === 'admin123') {
        user = await User.create({
            name: 'System Admin',
            email: 'admin@emergency.gov',
            password: 'admin123',
            role: 'admin'
        });
    }

    if (user && (await user.matchPassword(password))) {
        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            token: generateToken(user._id),
        });
    } else {
        res.status(401).json({ message: 'Invalid email or password' });
    }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = (req, res) => {
    res.json({ message: 'Logged out successfully' });
};

// @desc    Get user profile
// @route   GET /api/auth/me
// @access  Public (unprotected)
const getMe = async (req, res) => {
    if (req.user) {
        const user = await User.findById(req.user._id);
        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        });
    } else {
        res.json({ message: 'No authenticated user', user: null });
    }
};

module.exports = { loginUser, logoutUser, getMe };
