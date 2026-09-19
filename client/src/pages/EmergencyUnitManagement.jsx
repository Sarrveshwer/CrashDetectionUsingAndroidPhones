import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Truck, Plus, X, Edit2, Trash2, Smartphone } from 'lucide-react';

const EmergencyUnitManagement = () => {
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUnit, setEditingUnit] = useState(null);
    const [formData, setFormData] = useState({
        unitId: '',
        unitName: '',
        unitType: 'AMBULANCE',
        status: 'AVAILABLE'
    });

    const fetchUnits = async () => {
        try {
            const { data } = await axios.get('/api/units');
            setUnits(data);
        } catch (error) {
            console.error('Error fetching units', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUnits();
    }, []);

    const handleOpenModal = (unit = null) => {
        if (unit) {
            setEditingUnit(unit);
            setFormData({
                unitId: unit.unitId,
                unitName: unit.unitName,
                unitType: unit.unitType,
                status: unit.status
            });
        } else {
            setEditingUnit(null);
            setFormData({
                unitId: '',
                unitName: '',
                unitType: 'AMBULANCE',
                status: 'AVAILABLE'
            });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingUnit) {
                await axios.put(`/api/units/${editingUnit._id}`, formData);
            } else {
                await axios.post('/api/units', formData);
            }
            fetchUnits();
            setIsModalOpen(false);
        } catch (error) {
            alert(error.response?.data?.message || 'Operation failed');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this emergency unit?')) {
            try {
                await axios.delete(`/api/units/${id}`);
                fetchUnits();
            } catch (error) {
                alert('Delete failed');
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                <div>
                    <h1 className="text-xl font-bold text-[#0B192C]">Responder Network</h1>
                    <p className="text-slate-500 text-[10px] font-mono uppercase tracking-[0.2em] mt-1">Resource Management & Deployment</p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="bg-[#0B192C] text-white px-4 py-2 rounded text-xs font-bold flex items-center hover:bg-slate-800 transition-all shadow-md uppercase tracking-wider"
                >
                    <Plus size={16} className="mr-2" /> Add Unit
                </button>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                            <tr>
                                <th className="px-6 py-4">Unit Details</th>
                                <th className="px-6 py-4">ID</th>
                                <th className="px-6 py-4">Type</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400 font-mono text-xs">Synchronizing responder data...</td></tr>
                            ) : units.length > 0 ? (
                                units.map((unit) => (
                                    <tr key={unit._id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 font-bold text-slate-800 text-sm">{unit.unitName}</td>
                                        <td className="px-6 py-4 text-xs font-mono text-slate-500">{unit.unitId}</td>
                                        <td className="px-6 py-4">
                                            <span className="text-[10px] font-bold uppercase text-slate-600 bg-slate-100 px-2 py-1 rounded">
                                                {unit.unitType}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                                                unit.status === 'AVAILABLE' ? 'bg-green-100 text-green-700' :
                                                unit.status === 'UNAVAILABLE' ? 'bg-slate-100 text-slate-500' :
                                                'bg-amber-100 text-amber-700'
                                            }`}>
                                                {unit.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            <button onClick={() => handleOpenModal(unit)} className="text-blue-600 hover:text-blue-800"><Edit2 size={16} /></button>
                                            <button onClick={() => handleDelete(unit._id)} className="text-red-600 hover:text-red-800"><Trash2 size={16} /></button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400 italic text-sm">No emergency units registered in system.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 bg-[#0B192C] flex justify-between items-center">
                            <h2 className="text-sm font-bold text-white uppercase tracking-widest">{editingUnit ? 'Edit Unit' : 'Register New Unit'}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Unit ID (Identifier)</label>
                                <input
                                    type="text"
                                    value={formData.unitId}
                                    onChange={(e) => setFormData({...formData, unitId: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-200 rounded text-sm font-mono"
                                    placeholder="e.g. AMB-001"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Display Name</label>
                                <input
                                    type="text"
                                    value={formData.unitName}
                                    onChange={(e) => setFormData({...formData, unitName: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-200 rounded text-sm"
                                    placeholder="e.g. North Sector Ambulance 1"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Unit Type</label>
                                    <select
                                        value={formData.unitType}
                                        onChange={(e) => setFormData({...formData, unitType: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-200 rounded text-sm"
                                    >
                                        <option value="AMBULANCE">AMBULANCE</option>
                                        <option value="POLICE">POLICE</option>
                                        <option value="FIRE">FIRE</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Availability</label>
                                    <select
                                        value={formData.status}
                                        onChange={(e) => setFormData({...formData, status: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-200 rounded text-sm"
                                    >
                                        <option value="AVAILABLE">AVAILABLE</option>
                                        <option value="UNAVAILABLE">UNAVAILABLE</option>
                                    </select>
                                </div>
                            </div>
                            <div className="pt-4 flex space-x-3">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-wider text-slate-500">Cancel</button>
                                <button type="submit" className="flex-1 py-2 bg-[#E68310] text-white rounded text-[10px] font-bold uppercase tracking-wider shadow-md hover:bg-[#c9750d]">Save Unit</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmergencyUnitManagement;
