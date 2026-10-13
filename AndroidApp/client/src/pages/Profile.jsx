import React from 'react';
import { useAuth } from '../context/AuthContext';

const Profile = () => {
    const { user } = useAuth();

    return (
        <div className="space-y-6 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-800">Operator Profile</h1>
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-slate-900 h-24"></div>
                <div className="px-8 pb-8">
                    <div className="relative -mt-12 mb-6">
                        <div className="w-24 h-24 rounded-full bg-blue-100 border-4 border-white flex items-center justify-center text-blue-600 text-3xl font-bold shadow-md">
                            {user?.name?.charAt(0)}
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Full Name</label>
                            <p className="text-lg font-semibold text-gray-800">{user?.name}</p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Email Address</label>
                            <p className="text-gray-700">{user?.email}</p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Role / Rank</label>
                            <p className="text-gray-700 capitalize">{user?.role}</p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Department</label>
                            <p className="text-gray-700">Road Safety & Emergency Monitoring</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;
