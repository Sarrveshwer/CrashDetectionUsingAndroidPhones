import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Truck, ShieldAlert, CheckCircle, Clock, MapPin, Info, Send, UserCheck, CheckCircle2 } from 'lucide-react';
import useSocket from '../hooks/useSocket';

const StatusBadge = ({ status }) => {
    const colors = {
        'VERIFIED': 'bg-blue-100 text-blue-700',
        'DISPATCHED': 'bg-amber-100 text-amber-700',
        'RESPONDING': 'bg-indigo-100 text-indigo-700',
        'RESOLVED': 'bg-green-100 text-green-700',
        'FALSE_POSITIVE': 'bg-gray-100 text-gray-700'
    };
    return (
        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
            {status.replace('_', ' ')}
        </span>
    );
};

const EmergencyDispatch = () => {
    const [incidents, setIncidents] = useState([]);
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIncident, setSelectedIncident] = useState(null);
    const [dispatchData, setDispatchData] = useState({ unitId: '', operatorNotes: '' });

    const fetchData = async () => {
        try {
            const [incRes, unitRes] = await Promise.all([
                axios.get('/api/incidents'),
                axios.get('/api/units')
            ]);
            // Only show incidents that need dispatch attention or are recently resolved
            setIncidents(incRes.data.filter(i =>
                ['VERIFIED', 'DISPATCHED', 'RESPONDING'].includes(i.status)
            ));
            setUnits(unitRes.data);
        } catch (error) {
            console.error('Error fetching dispatch data', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    useSocket('incident:update', fetchData);
    useSocket('incident:dispatched', fetchData);
    useSocket('incident:responding', fetchData);
    useSocket('incident:resolved', fetchData);
    useSocket('dashboard:update', fetchData);

    const handleDispatch = async (e) => {
        e.preventDefault();
        if (!dispatchData.unitId) return alert('Please select a unit');
        try {
            await axios.post(`/api/incidents/${selectedIncident._id}/dispatch`, dispatchData);
            setSelectedIncident(null);
            setDispatchData({ unitId: '', operatorNotes: '' });
        } catch (error) {
            alert(error.response?.data?.message || 'Dispatch failed');
        }
    };

    const handleMarkResponding = async (id) => {
        try {
            await axios.post(`/api/incidents/${id}/respond`);
        } catch (error) {
            alert('Operation failed');
        }
    };

    const handleMarkResolved = async (id) => {
        const notes = prompt('Add final resolution notes (optional):');
        try {
            await axios.post(`/api/incidents/${id}/resolve`, { operatorNotes: notes });
        } catch (error) {
            alert('Operation failed');
        }
    };

    if (loading) return <div className="p-6 text-gray-500 font-mono text-xs uppercase">Initialising Dispatch Protocols...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-[#0B192C] p-4 rounded-lg shadow-lg border-l-4 border-[#E68310]">
                <div>
                    <h1 className="text-xl font-bold text-white tracking-tight flex items-center">
                        <Truck className="mr-3 text-[#E68310]" size={24} />
                        EMERGENCY CONTROL ROOM — DISPATCH
                    </h1>
                    <p className="text-slate-400 text-[10px] font-mono uppercase tracking-[0.2em] mt-1">Live Response Management System</p>
                </div>
                <div className="text-right">
                    <p className="text-[#E68310] text-xs font-bold font-mono uppercase">System Time</p>
                    <p className="text-white text-sm font-mono">{new Date().toLocaleTimeString()}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                    <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">Active Incident Queue</h2>
                    {incidents.length > 0 ? (
                        incidents.map(incident => (
                            <div key={incident._id} className={`bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden transition-all ${selectedIncident?._id === incident._id ? 'ring-2 ring-[#E68310]' : ''}`}>
                                <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex items-start">
                                        <div className="p-2 bg-slate-50 rounded text-slate-600 mr-3">
                                            <ShieldAlert size={20} className={incident.status === 'VERIFIED' ? 'text-blue-600' : 'text-[#E68310]'} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-bold text-slate-800 text-sm uppercase">{incident.cameraName}</h3>
                                                <StatusBadge status={incident.status} />
                                            </div>
                                            <p className="text-xs text-slate-500 flex items-center">
                                                <MapPin size={12} className="mr-1" /> {incident.location?.address || 'COORDINATES'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 md:justify-end">
                                        {incident.status === 'VERIFIED' && (
                                            <button
                                                onClick={() => setSelectedIncident(incident)}
                                                className="bg-[#0B192C] text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center hover:bg-slate-800 transition-colors"
                                            >
                                                <Send size={14} className="mr-2" /> Dispatch Unit
                                            </button>
                                        )}
                                        {incident.status === 'DISPATCHED' && (
                                            <button
                                                onClick={() => handleMarkResponding(incident._id)}
                                                className="bg-indigo-600 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center hover:bg-indigo-700 transition-colors"
                                            >
                                                <UserCheck size={14} className="mr-2" /> Mark Responding
                                            </button>
                                        )}
                                        {incident.status === 'RESPONDING' && (
                                            <button
                                                onClick={() => handleMarkResolved(incident._id)}
                                                className="bg-green-600 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center hover:bg-green-700 transition-colors"
                                            >
                                                <CheckCircle2 size={14} className="mr-2" /> Mark Resolved
                                            </button>
                                        )}
                                        <button className="text-slate-400 hover:text-slate-600 p-1.5 rounded bg-slate-50 border border-slate-100">
                                            <Info size={16} />
                                        </button>
                                    </div>
                                </div>
                                {selectedIncident?._id === incident._id && (
                                    <div className="border-t border-slate-100 bg-slate-50/50 p-4 animate-in slide-in-from-top-2 duration-200">
                                        <form onSubmit={handleDispatch} className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Select Available Unit</label>
                                                    <select
                                                        value={dispatchData.unitId}
                                                        onChange={(e) => setDispatchData({ ...dispatchData, unitId: e.target.value })}
                                                        className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#E68310]"
                                                        required
                                                    >
                                                        <option value="">-- Choose Emergency Unit --</option>
                                                        {units.filter(u => u.status === 'AVAILABLE').map(unit => (
                                                            <option key={unit._id} value={unit.unitId}>
                                                                {unit.unitName} ({unit.unitType})
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Operator Dispatch Notes</label>
                                                    <input
                                                        type="text"
                                                        value={dispatchData.operatorNotes}
                                                        onChange={(e) => setDispatchData({ ...dispatchData, operatorNotes: e.target.value })}
                                                        className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#E68310]"
                                                        placeholder="Priority Level, special instructions..."
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex justify-end gap-3 pt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedIncident(null)}
                                                    className="px-4 py-1.5 text-[10px] font-bold uppercase text-slate-500 hover:bg-slate-100 rounded transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="submit"
                                                    className="bg-[#E68310] text-white px-6 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-[#c9750d] transition-all shadow-md"
                                                >
                                                    Confirm Dispatch
                                                </button>
                                            </div>
                                        </form>
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="bg-white rounded-lg border-2 border-dashed border-slate-200 p-12 text-center">
                            <Truck className="mx-auto text-slate-300 mb-4" size={40} />
                            <p className="text-slate-400 font-medium italic text-sm">No active emergency dispatches pending at this time.</p>
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50">
                            <h3 className="font-bold text-[10px] text-slate-400 uppercase tracking-[0.2em]">Emergency Units</h3>
                            <button className="text-blue-600 text-[10px] font-bold hover:underline">Manage</button>
                        </div>
                        <div className="space-y-3">
                            {units.length > 0 ? (
                                units.map(unit => (
                                    <div key={unit._id} className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-100">
                                        <div className="flex items-center">
                                            <div className={`w-2 h-2 rounded-full mr-3 ${
                                                unit.status === 'AVAILABLE' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' :
                                                unit.status === 'UNAVAILABLE' ? 'bg-slate-300' : 'bg-[#E68310]'
                                            }`}></div>
                                            <div>
                                                <p className="text-xs font-bold text-slate-700 leading-none mb-1">{unit.unitName}</p>
                                                <p className="text-[9px] text-slate-400 uppercase font-mono">{unit.unitType}</p>
                                            </div>
                                        </div>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                            unit.status === 'AVAILABLE' ? 'bg-green-50 text-green-700' :
                                            unit.status === 'UNAVAILABLE' ? 'bg-slate-100 text-slate-500' :
                                            'bg-amber-50 text-amber-700'
                                        }`}>
                                            {unit.status}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-[10px] text-slate-400 italic text-center py-4">No units registered in sector.</p>
                            )}
                        </div>
                    </div>

                    <div className="bg-[#0B192C] text-white rounded-lg shadow-lg p-5">
                        <h3 className="font-bold text-[10px] uppercase tracking-[0.2em] mb-4 text-[#E68310]">Operational Protocol</h3>
                        <div className="space-y-3 text-[11px] leading-relaxed text-slate-300">
                            <div className="flex gap-3">
                                <span className="font-bold text-white">01</span>
                                <p>Verify incident authenticity via CCTV frame analysis before initiating dispatch.</p>
                            </div>
                            <div className="flex gap-3">
                                <span className="font-bold text-white">02</span>
                                <p>Assign the nearest available unit. Ensure unit type matches incident requirements (Medical/Fire/Law).</p>
                            </div>
                            <div className="flex gap-3">
                                <span className="font-bold text-white">03</span>
                                <p>Maintain contact with responding unit. Update status to 'Responding' once they are in transit.</p>
                            </div>
                            <div className="flex gap-3">
                                <span className="font-bold text-white">04</span>
                                <p>Close incident only after on-site resolution confirmed by responder.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmergencyDispatch;
