import React from 'react';

const IncidentHistory = () => {
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">Incident History Archival</h1>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex space-x-4 mb-6">
                    <input type="date" className="border rounded px-3 py-2 text-sm" />
                    <select className="border rounded px-3 py-2 text-sm">
                        <option>All Statuses</option>
                        <option>Verified</option>
                        <option>Rejected</option>
                    </select>
                    <button className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold">Filter Records</button>
                </div>
                <div className="text-center py-10 text-gray-400 italic">
                    Historical incident logs will be listed here.
                </div>
            </div>
        </div>
    );
};

export default IncidentHistory;
