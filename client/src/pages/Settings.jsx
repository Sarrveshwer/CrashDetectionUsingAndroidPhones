import React from 'react';

const Settings = () => {
    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-800">Control Room Settings</h1>
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg divide-y">
                <div className="p-6">
                    <h3 className="font-bold text-gray-800 mb-2">Notification Preferences</h3>
                    <p className="text-sm text-gray-500 mb-4">Manage how you receive emergency alerts.</p>
                    <div className="space-y-3">
                        <label className="flex items-center">
                            <input type="checkbox" className="rounded text-blue-600" defaultChecked />
                            <span className="ml-2 text-sm">Audio Alerts for High-Confidence Incidents</span>
                        </label>
                        <label className="flex items-center">
                            <input type="checkbox" className="rounded text-blue-600" defaultChecked />
                            <span className="ml-2 text-sm">Automatic Browser Notifications</span>
                        </label>
                    </div>
                </div>
                <div className="p-6">
                    <h3 className="font-bold text-gray-800 mb-2">System Thresholds</h3>
                    <p className="text-sm text-gray-500 mb-4">Configure AI confidence triggers.</p>
                    <div className="flex items-center space-x-4">
                        <span className="text-sm">Alert Confidence Threshold:</span>
                        <input type="range" className="w-full" />
                        <span className="text-sm font-bold">75%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
