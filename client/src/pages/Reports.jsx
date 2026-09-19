import React from 'react';

const Reports = () => {
    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">System Reports</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h3 className="font-bold mb-4">Incident Statistics (Last 30 Days)</h3>
                    <div className="h-40 bg-gray-50 rounded flex items-center justify-center text-gray-400 italic text-sm">
                        Bar Chart Placeholder
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h3 className="font-bold mb-4">Camera Performance</h3>
                    <div className="h-40 bg-gray-50 rounded flex items-center justify-center text-gray-400 italic text-sm">
                        Pie Chart Placeholder
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Reports;
