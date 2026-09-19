import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldAlert, CheckCircle, XCircle, Info, MapPin, Clock, Activity, Truck } from 'lucide-react';
import useSocket from '../hooks/useSocket';

const StatusBadge = ({ status }) => {
    const colors = {
        'PENDING_VERIFICATION': 'bg-red-100 text-red-700',
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

const IncidentCard = ({ incident, onVerify, onReject }) => {
    return (
        <div className={`bg-white rounded-lg shadow-md border-l-4 ${
            ['PENDING_VERIFICATION', 'FALSE_POSITIVE'].includes(incident.status) ? 'border-red-600' :
            incident.status === 'VERIFIED' ? 'border-blue-600' :
            incident.status === 'RESOLVED' ? 'border-green-600' : 'border-amber-600'
        } overflow-hidden transition-all hover:shadow-lg`}>
            <div className="p-5">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 flex items-center">
                            <ShieldAlert className="mr-2 text-red-600" size={20} />
                            {incident.cameraName}
                        </h3>
                        <p className="text-xs text-gray-500 font-mono mt-1 uppercase tracking-widest flex items-center">
                            <Clock size={12} className="mr-1" />
                            {new Date(incident.timestamp).toLocaleString()}
                        </p>
                    </div>
                    <div className="text-right">
                        <StatusBadge status={incident.status} />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-slate-50 rounded p-2 text-center border border-slate-100">
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Vehicle Count</p>
                        <p className="text-xl font-bold text-slate-800">{incident.vehicleCount}</p>
                    </div>
                    <div className="bg-slate-50 rounded p-2 text-center border border-slate-100">
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Confidence</p>
                        <p className="text-lg font-bold text-slate-800">{incident.confidence}%</p>
                    </div>
                    {incident.assignedUnit && (
                        <div className="col-span-2 bg-blue-50 rounded p-2 flex items-center justify-center border border-blue-100">
                            <Truck size={14} className="text-blue-600 mr-2" />
                            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">
                                Assigned: {incident.assignedUnit}
                            </span>
                        </div>
                    )}
                </div>

                <div className="mb-4">
                    <div className="h-40 bg-gray-200 rounded overflow-hidden relative">
                        {incident.snapshotImage ? (
                            <img
                                src={incident.snapshotImage}
                                alt="Incident Snapshot"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                                <Activity size={32} className="mb-2" />
                                <span className="text-[10px] italic uppercase tracking-widest">No visual data</span>
                            </div>
                        )}
                        <div className="absolute bottom-2 left-2 bg-black/50 text-white text-[9px] px-2 py-1 rounded flex items-center font-mono">
                            <MapPin size={10} className="mr-1" />
                            {incident.location?.latitude?.toFixed(4)}, {incident.location?.longitude?.toFixed(4)}
                        </div>
                    </div>
                </div>

                {incident.status === 'PENDING_VERIFICATION' && (
                    <div className="flex space-x-2">
                        <button
                            onClick={() => onVerify(incident._id)}
                            className="flex-1 bg-[#0B192C] hover:bg-slate-800 text-white py-2 rounded font-bold text-xs flex items-center justify-center transition-colors shadow-sm uppercase tracking-wider"
                        >
                            <CheckCircle size={14} className="mr-2" /> Verify
                        </button>
                        <button
                            onClick={() => onReject(incident._id)}
                            className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 py-2 rounded font-bold text-xs flex items-center justify-center transition-colors uppercase tracking-wider"
                        >
                            <XCircle size={14} className="mr-2" /> Reject
                        </button>
                    </div>
                )}

                {incident.status !== 'PENDING_VERIFICATION' && (
                    <button className="w-full bg-slate-50 text-slate-500 hover:bg-slate-100 py-2 rounded font-bold text-[10px] flex items-center justify-center uppercase tracking-[0.2em] transition-all">
                        <Info size={14} className="mr-2" /> View Status Timeline
                    </button>
                )}
            </div>
        </div>
    );
};

const LiveIncidents = () => {
    const [incidents, setIncidents] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchIncidents = async () => {
        try {
            const { data } = await axios.get('/api/incidents');
            setIncidents(data);
        } catch (error) {
            console.error('Error fetching incidents', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchIncidents();
    }, []);

    useSocket('incident:new', fetchIncidents);
    useSocket('incident:update', fetchIncidents);
    useSocket('incident:dispatched', fetchIncidents);
    useSocket('incident:responding', fetchIncidents);
    useSocket('incident:resolved', fetchIncidents);
    useSocket('dashboard:update', fetchIncidents);

    const handleVerify = async (id) => {
        try {
            await axios.patch(`/api/incidents/${id}/verify`);
        } catch (error) {
            alert('Verification failed');
        }
    };

    const handleReject = async (id) => {
        try {
            await axios.patch(`/api/incidents/${id}/reject`);
        } catch (error) {
            alert('Rejection failed');
        }
    };

    if (loading) return <div className="p-6 text-slate-500 font-mono text-xs uppercase">Synchronizing Live Intelligence Stream...</div>;

    const criticalIncidents = incidents.filter(i => ['PENDING_VERIFICATION', 'VERIFIED', 'DISPATCHED', 'RESPONDING'].includes(i.status));
    const processedIncidents = incidents.filter(i => ['RESOLVED', 'FALSE_POSITIVE'].includes(i.status)).slice(0, 8);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between bg-white p-4 rounded-lg shadow-sm border border-slate-100">
                <div>
                    <h1 className="text-xl font-bold text-[#0B192C]">Live Incident Monitoring</h1>
                    <p className="text-slate-500 text-[10px] font-mono uppercase tracking-[0.2em] mt-1">Real-time edge intelligence</p>
                </div>
                <div className="flex items-center space-x-6">
                    <div className="text-center">
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Active Alerts</p>
                        <p className="text-xl font-bold text-red-600">{criticalIncidents.length}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                <div className="xl:col-span-3 space-y-8">
                    <section>
                        <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] mb-4 flex items-center">
                            <div className="w-1.5 h-1.5 bg-red-600 rounded-full mr-2 animate-pulse"></div>
                            Priority Alerts in Progress
                        </h2>

                        {criticalIncidents.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {criticalIncidents.map(incident => (
                                    <IncidentCard
                                        key={incident._id}
                                        incident={incident}
                                        onVerify={handleVerify}
                                        onReject={handleReject}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="bg-white rounded-lg border-2 border-dashed border-slate-200 p-12 text-center">
                                <ShieldAlert className="mx-auto text-slate-200 mb-2" size={48} />
                                <p className="text-slate-400 italic text-sm">No critical incidents detected in the current sector.</p>
                            </div>
                        )}
                    </section>

                    <section>
                        <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] mb-4">
                            Recent Incident History
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-80">
                            {processedIncidents.map(incident => (
                                <IncidentCard
                                    key={incident._id}
                                    incident={incident}
                                />
                            ))}
                        </div>
                    </section>
                </div>

                <div className="space-y-6">
                    <div className="bg-[#0B192C] text-white rounded-lg shadow-lg p-5">
                        <h3 className="font-bold text-[10px] uppercase tracking-widest mb-4 text-[#E68310]">Operator Directives</h3>
                        <div className="space-y-4 text-[11px] leading-relaxed">
                            <div className="flex items-start">
                                <div className="mt-1 mr-3 w-4 h-4 bg-red-600 rounded-full flex-shrink-0 border-2 border-white/20"></div>
                                <p><span className="font-bold text-[#E68310]">VERIFY:</span> Confirm detection and escalate to dispatch queue.</p>
                            </div>
                            <div className="flex items-start">
                                <div className="mt-1 mr-3 w-4 h-4 bg-slate-600 rounded-full flex-shrink-0 border-2 border-white/20"></div>
                                <p><span className="font-bold text-slate-400">REJECT:</span> Classify as false positive. Archive data for AI retraining.</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
                        <h3 className="font-bold text-[10px] uppercase tracking-widest mb-4 text-slate-700 border-b pb-2">Status Timeline</h3>
                        <div className="space-y-3 text-[9px] font-mono text-slate-500">
                            {incidents.slice(0, 6).map(inc => (
                                <div key={inc._id + '_log'} className="border-l-2 border-slate-100 pl-3 pb-2 relative">
                                    <div className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-slate-300"></div>
                                    <span className="text-[#0B192C] font-bold">[{new Date(inc.createdAt).toLocaleTimeString()}]</span>
                                    <br/>{inc.status} — {inc.cameraName}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LiveIncidents;
