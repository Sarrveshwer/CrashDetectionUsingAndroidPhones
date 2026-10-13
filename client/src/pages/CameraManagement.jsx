import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Camera, Edit2, Trash2, Plus, X, Activity } from 'lucide-react';

const CameraManagement = () => {
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCamera, setEditingCamera] = useState(null);
    const [formData, setFormData] = useState({
        cameraName: '',
        cameraId: '',
        deviceId: '',
        location: '',
        latitude: '',
        longitude: '',
        rtspUrl: ''
    });

    const fetchCameras = async () => {
        try {
            const { data } = await axios.get('/api/cameras');
            setCameras(data);
        } catch (error) {
            console.error('Error fetching cameras', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCameras();
    }, []);

    const handleOpenModal = (camera = null) => {
        if (camera) {
            setEditingCamera(camera);
            setFormData({
                cameraName: camera.cameraName,
                cameraId: camera.cameraId,
                deviceId: camera.deviceId || '',
                location: camera.location,
                latitude: camera.latitude,
                longitude: camera.longitude,
                rtspUrl: camera.rtspUrl || ''
            });
        } else {
            setEditingCamera(null);
            setFormData({
                cameraName: '',
                cameraId: '',
                deviceId: '',
                location: '',
                latitude: '',
                longitude: '',
                rtspUrl: ''
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingCamera(null);
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingCamera) {
                await axios.put(`/api/cameras/${editingCamera._id}`, formData);
            } else {
                await axios.post('/api/cameras', formData);
            }
            fetchCameras();
            handleCloseModal();
        } catch (error) {
            alert(error.response?.data?.message || 'Error saving camera');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Are you sure you want to delete this camera?')) {
            try {
                await axios.delete(`/api/cameras/${id}`);
                fetchCameras();
            } catch (error) {
                console.error('Error deleting camera', error);
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                <div>
                    <h1 className="text-xl font-bold text-gray-800">Camera Network</h1>
                    <p className="text-gray-500 text-xs uppercase tracking-widest font-mono">Infrastructure Management</p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-xs font-bold flex items-center shadow-md transition-all uppercase tracking-wider"
                >
                    <Plus size={16} className="mr-2" /> Add Camera
                </button>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                            <tr>
                                <th className="px-6 py-4">Camera Name</th>
                                <th className="px-6 py-4">Camera ID</th>
                                <th className="px-6 py-4">Device</th>
                                <th className="px-6 py-4">Location</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Last Heartbeat</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr><td colSpan="7" className="px-6 py-12 text-center text-gray-400">Loading camera network...</td></tr>
                            ) : cameras.length > 0 ? (
                                cameras.map((camera) => (
                                    <tr key={camera._id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 font-bold text-gray-800 text-sm">{camera.cameraName}</td>
                                        <td className="px-6 py-4 text-xs font-mono text-gray-600">{camera.cameraId}</td>
                                        <td className="px-6 py-4">
                                            <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">
                                                {camera.deviceId || 'UNASSIGNED'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-xs text-gray-700">{camera.location}</span>
                                                <span className="text-[10px] text-gray-400 font-mono">{camera.latitude}, {camera.longitude}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                                                camera.status === 'ONLINE' ? 'bg-green-100 text-green-700' :
                                                camera.status === 'MAINTENANCE' ? 'bg-orange-100 text-orange-700' :
                                                'bg-red-100 text-red-700'
                                            }`}>
                                                {camera.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-[10px] text-gray-500 font-mono">
                                            {camera.lastHeartbeat ? new Date(camera.lastHeartbeat).toLocaleString() : 'NEVER'}
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            <button onClick={() => handleOpenModal(camera)} className="text-blue-600 hover:text-blue-800"><Edit2 size={16} /></button>
                                            <button onClick={() => handleDelete(camera._id)} className="text-red-600 hover:text-red-800"><Trash2 size={16} /></button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr><td colSpan="7" className="px-6 py-12 text-center text-gray-400 italic">No cameras registered.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h2 className="text-lg font-bold text-gray-800">{editingCamera ? 'Edit Camera' : 'Add New Camera'}</h2>
                            <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Camera Name</label>
                                    <input type="text" name="cameraName" value={formData.cameraName} onChange={handleChange} className="w-full px-3 py-2 border rounded text-sm" required />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Camera ID</label>
                                    <input type="text" name="cameraId" value={formData.cameraId} onChange={handleChange} className="w-full px-3 py-2 border rounded text-sm" required />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Device ID</label>
                                    <input type="text" name="deviceId" value={formData.deviceId} onChange={handleChange} className="w-full px-3 py-2 border rounded text-sm" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Location</label>
                                    <input type="text" name="location" value={formData.location} onChange={handleChange} className="w-full px-3 py-2 border rounded text-sm" required />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Latitude</label>
                                    <input type="number" step="any" name="latitude" value={formData.latitude} onChange={handleChange} className="w-full px-3 py-2 border rounded text-sm" required />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Longitude</label>
                                    <input type="number" step="any" name="longitude" value={formData.longitude} onChange={handleChange} className="w-full px-3 py-2 border rounded text-sm" required />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">RTSP URL (Optional)</label>
                                    <input type="text" name="rtspUrl" value={formData.rtspUrl} onChange={handleChange} className="w-full px-3 py-2 border rounded text-sm" />
                                </div>
                            </div>
                            <div className="pt-4 flex space-x-3">
                                <button type="button" onClick={handleCloseModal} className="flex-1 py-2 border rounded text-xs font-bold uppercase tracking-wider">Cancel</button>
                                <button type="submit" className="flex-1 py-2 bg-blue-600 text-white rounded text-xs font-bold uppercase tracking-wider">Save Camera</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CameraManagement;
