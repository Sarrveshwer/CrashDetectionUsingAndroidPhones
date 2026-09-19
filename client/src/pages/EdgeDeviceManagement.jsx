import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Smartphone, Activity, MapPin, Clock, Info } from 'lucide-react';
import useSocket from '../hooks/useSocket';

const EdgeDeviceManagement = () => {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchDevices = async () => {
        try {
            const { data } = await axios.get('/api/devices');
            setDevices(data);
        } catch (error) {
            console.error('Error fetching devices', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDevices();
    }, []);

    useSocket('device:registered', fetchDevices);
    useSocket('device:online', fetchDevices);
    useSocket('device:offline', fetchDevices);
    useSocket('device:update', (updatedDevice) => {
        setDevices(prev => prev.map(d => d.deviceId === updatedDevice.deviceId ? { ...d, ...updatedDevice } : d));
    });

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                <div>
                    <h1 className="text-xl font-bold text-gray-800">Edge Device Management</h1>
                    <p className="text-gray-500 text-xs uppercase tracking-widest font-mono">Repurposed Android Smartphone Network</p>
                </div>
                <div className="flex items-center space-x-2 bg-blue-50 px-3 py-1 rounded-full">
                    <Smartphone size={14} className="text-blue-600" />
                    <span className="text-blue-700 text-xs font-bold">{devices.length} Registered</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <div className="col-span-full py-12 text-center text-gray-400">Loading edge device network...</div>
                ) : devices.length > 0 ? (
                    devices.map((device) => (
                        <div key={device._id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                            <div className={`h-1 ${device.status === 'ONLINE' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            <div className="p-5">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center">
                                        <div className={`p-2 rounded-lg ${device.status === 'ONLINE' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'} mr-3`}>
                                            <Smartphone size={20} />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-gray-800">{device.deviceName}</h3>
                                            <p className="text-[10px] text-gray-400 font-mono">{device.deviceId}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                                        device.status === 'ONLINE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                        {device.status}
                                    </span>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center text-xs text-gray-600">
                                        <Activity size={14} className="mr-2 text-gray-400" />
                                        <span className="font-medium mr-2">Camera:</span>
                                        <span className="text-blue-600 font-mono">{device.cameraId || 'UNASSIGNED'}</span>
                                    </div>
                                    <div className="flex items-center text-xs text-gray-600">
                                        <MapPin size={14} className="mr-2 text-gray-400" />
                                        <span className="font-medium mr-2">Location:</span>
                                        <span className="font-mono">
                                            {device.latitude && device.longitude
                                                ? `${device.latitude.toFixed(4)}, ${device.longitude.toFixed(4)}`
                                                : 'NO_GPS_DATA'}
                                        </span>
                                    </div>
                                    <div className="flex items-center text-xs text-gray-600">
                                        <Clock size={14} className="mr-2 text-gray-400" />
                                        <span className="font-medium mr-2">Heartbeat:</span>
                                        <span className="font-mono">{new Date(device.lastHeartbeat).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="flex items-center text-xs text-gray-600">
                                        <Info size={14} className="mr-2 text-gray-400" />
                                        <span className="font-medium mr-2">System:</span>
                                        <span>Android {device.androidVersion} | v{device.appVersion || '1.0'}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-end">
                                <button className="text-blue-600 hover:text-blue-800 text-[10px] font-bold uppercase tracking-widest">
                                    Configure Node
                                </button>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="col-span-full bg-white rounded-lg border-2 border-dashed border-gray-200 p-12 text-center text-gray-400 italic">
                        No Android edge devices have registered yet.
                    </div>
                )}
            </div>
        </div>
    );
};

export default EdgeDeviceManagement;
