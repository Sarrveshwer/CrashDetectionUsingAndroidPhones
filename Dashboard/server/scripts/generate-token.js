const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'crash_detection_secret_key';

const generateToken = (id) => {
    return jwt.sign({ id }, JWT_SECRET, {
        expiresIn: '30d',
    });
};

const token = generateToken('admin_demo_id');

console.log('JWL Token (JWT):', token);
console.log('\nToken payload decoded:', jwt.decode(token));
console.log('\nVerification:');
try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Valid token for user ID:', decoded.id);
} catch (err) {
    console.log('Invalid token:', err.message);
}