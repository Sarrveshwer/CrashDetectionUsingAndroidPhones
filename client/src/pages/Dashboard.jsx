import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Camera, AlertCircle, CheckCircle, XCircle, Clock, Truck, Activity, Bell, Smartphone, ShieldCheck, CheckCircle2 } from 'lucide-react';
import useSocket from '../hooks/useSocket';

const StatCard = ({ title, value, icon: Icon, colorClass, subtext }) => (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 transition-all hover:shadow-md">
        <div className="flex items-center justify-between mb-4">
            <div className={`p-2 rounded-lg ${colorClass} shadow-inner`}>
                <Icon size={24} className="text-white" />
            </div>
            <span className="text-gray-400 text-[10px] font-bold uppercase tracking-widest">{subtext}</span>
        </div>
        <h3 className="text-gray-500 text-sm font-medium">{title}</h3>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
    </div>
);

const Dashboard = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [newAlertBadge, setNewAlertBadge] = useState(false);
    const socket = useSocket();

    const fetchStats = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/dashboard/stats');
            setStats(data);
        } catch (error) {
            console.error('Error fetching dashboard stats', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();
        if (socket) {
            socket.emit('join:admin');
        }
    }, [fetchStats, socket]);

    // Socket listeners for real-time updates
    useSocket('dashboard:update', fetchStats);
    useSocket('device:registered', fetchStats);
    useSocket('device:online', fetchStats);
    useSocket('device:offline', fetchStats);
    useSocket('incident:dispatched', fetchStats);
    useSocket('incident:responding', fetchStats);
    useSocket('incident:resolved', fetchStats);

    useSocket('incident:new', (incident) => {
        setNewAlertBadge(true);
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play().catch(e => console.log('Audio play blocked'));
        fetchStats();
    });

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-[60vh]">
            <Activity className="text-[#0B192C] animate-spin mb-4" size={48} />
            <p className="text-gray-500 font-medium font-mono uppercase tracking-widest">Initialising Operational Data...</p>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 tracking-tight flex items-center">
                        <Activity className="mr-3 text-[#0B192C]" size={28} />
                        Operational Dashboard
                    </h1>
                    <p className="text-gray-500 text-sm">Real-time road incident monitoring system status</p>
                </div>

                <div className="flex items-center space-x-3">
                    {newAlertBadge && (
                        <div className="flex items-center bg-red-600 text-white px-3 py-1.5 rounded-md text-xs font-bold animate-bounce shadow-lg">
                            <Bell size={14} className="mr-2" />
                            NEW INCIDENT DETECTED
                        </div>
                    )}
                    <div className="flex items-center space-x-2 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${stats?.onlineCameras > 0 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-slate-700 text-[10px] font-bold uppercase tracking-widest">
                            {stats?.onlineCameras > 0 ? 'System Optimal' : 'Network Caution'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Stats Grid 1: Infrastructure */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Total Cameras"
                    value={stats?.totalCameras || 0}
                    icon={Camera}
                    colorClass="bg-[#0B192C]"
                    subtext="Network"
                />
                <StatCard
                    title="Camera Health"
                    value={`${stats?.onlineCameras || 0} / ${stats?.totalCameras || 0}`}
                    icon={Activity}
                    colorClass={stats?.onlineCameras > 0 ? 'bg-green-600' : 'bg-red-600'}
                    subtext="Online"
                />
                <StatCard
                    title="Edge Devices"
                    value={stats?.totalDevices || 0}
                    icon={Smartphone}
                    colorClass="bg-indigo-600"
                    subtext="Connected"
                />
                <StatCard
                    title="Pending Verification"
                    value={stats?.pendingAlerts || 0}
                    icon={AlertCircle}
                    colorClass="bg-red-600"
                    subtext="Action Required"
                />
            </div>

            {/* Stats Grid 2: Dispatch Lifecycle */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Verified / Ready"
                    value={stats?.verifiedIncidents || 0}
                    icon={ShieldCheck}
                    colorClass="bg-blue-600"
                    subtext="Ready for Dispatch"
                />
                <StatCard
                    title="Units Dispatched"
                    value={stats?.emergencyDispatches || 0}
                    icon={Truck}
                    colorClass="bg-amber-600"
                    subtext="In Route"
                />
                <StatCard
                    title="Active Response"
                    value={stats?.respondingIncidents || 0}
                    icon={Clock}
                    colorClass="bg-indigo-700"
                    subtext="On Scene"
                />
                <StatCard
                    title="Resolved Today"
                    value={stats?.resolvedIncidents || 0}
                    icon={CheckCircle2}
                    colorClass="bg-green-600"
                    subtext="Operational Success"
                />
            </div>

            {/* Recent Activity Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
                    <h2 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Recent Mission Logs</h2>
                    <button
                        onClick={() => setNewAlertBadge(false)}
                        className="text-blue-600 text-xs font-bold hover:underline uppercase tracking-tighter"
                    >
                        Mark All as Read
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                            <tr>
                                <th className="px-6 py-4">Camera Source</th>
                                <th className="px-6 py-4">Incident Time</th>
                                <th className="px-6 py-4">Location</th>
                                <th className="px-6 py-4">Confidence</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {stats?.recentAlerts?.length > 0 ? (
                                stats.recentAlerts.map((alert) => (
                                    <tr key={alert._id} className={`hover:bg-gray-50 transition-colors ${alert.status === 'PENDING_VERIFICATION' ? 'bg-red-50/30' : ''}`}>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center">
                                                <div className={`w-2 h-2 rounded-full mr-3 ${alert.status === 'PENDING_VERIFICATION' ? 'bg-red-600' : 'bg-gray-300'}`}></div>
                                                <span className="font-bold text-gray-800 text-sm uppercase tracking-tight">{alert.cameraName}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-gray-600">{new Date(alert.createdAt).toLocaleString()}</td>
                                        <td className="px-6 py-4 text-xs text-gray-600 uppercase tracking-tighter">{alert.location?.address || 'GPS COORDINATES'}</td>
                                        <td className="px-6 py-4">
                                            <div className="w-full bg-gray-200 rounded-full h-1.5 max-w-[80px]">
                                                <div
                                                    className={`h-1.5 rounded-full ${alert.confidence > 80 ? 'bg-red-600' : 'bg-orange-500'}`}
                                                    style={{ width: `${alert.confidence}%` }}
                                                ></div>
                                            </div>
                                            <span className="text-[10px] font-bold text-gray-500 mt-1 block">{alert.confidence}%</span>
                                        </td>
                                        <td className="px-6 py-4 text-xs">
                                            <span className={`px-2 py-1 rounded font-bold uppercase tracking-tighter ${
                                                alert.status === 'PENDING_VERIFICATION' ? 'bg-red-100 text-red-700' :
                                                alert.status === 'VERIFIED' ? 'bg-blue-100 text-blue-700' :
                                                alert.status === 'RESOLVED' ? 'bg-green-100 text-green-700' :
                                                'bg-gray-100 text-gray-700'
                                            }`}>
                                                {alert.status.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button className="text-blue-600 hover:text-blue-800 text-xs font-bold uppercase tracking-widest">
                                                Analyze
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="6" className="px-6 py-12 text-center text-gray-400 italic">No operational incidents recorded in the current session.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* System Information Footer */}
            <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono uppercase tracking-tighter bg-gray-50 p-3 rounded border border-gray-100">
                <div className="flex space-x-6">
                    <span>Protocol: RESP_V4_SECURE</span>
                    <span>DB: MONGO_PERSISTENT</span>
                    <span>Node: EDGE_REPURPOSED</span>
                </div>
                <div>
                    Connected ID: {stats?._id?.slice(-8).toUpperCase() || 'SESSION_INIT'}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
