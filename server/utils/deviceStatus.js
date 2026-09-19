const HEARTBEAT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Determines if a device/camera is online based on last heartbeat
 * @param {Date} lastHeartbeat
 * @param {string} currentStatus
 * @returns {string}
 */
const getEffectiveStatus = (lastHeartbeat, currentStatus) => {
    if (currentStatus === 'MAINTENANCE') return 'MAINTENANCE';

    if (!lastHeartbeat) return 'OFFLINE';

    const now = new Date();
    const diff = now - new Date(lastHeartbeat);

    return diff < HEARTBEAT_TIMEOUT ? 'ONLINE' : 'OFFLINE';
};

module.exports = {
    getEffectiveStatus,
    HEARTBEAT_TIMEOUT
};
