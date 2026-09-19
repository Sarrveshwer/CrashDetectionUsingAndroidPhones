import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

const NotFound = () => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 text-center">
            <div className="max-w-md">
                <div className="flex justify-center mb-6 text-red-500">
                    <AlertTriangle size={64} />
                </div>
                <h1 className="text-4xl font-bold text-gray-800 mb-2">404 - Restricted Area</h1>
                <p className="text-gray-500 mb-8">The requested sector or control module does not exist in the system architecture.</p>
                <Link to="/" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors shadow-md">
                    Return to Operational Base
                </Link>
            </div>
        </div>
    );
};

export default NotFound;
