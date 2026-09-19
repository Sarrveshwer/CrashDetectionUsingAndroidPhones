import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    AlertCircle,
    History,
    Camera,
    Smartphone,
    Truck,
    BarChart3,
    Settings,
    User,
    LogOut
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Sidebar = ({ isOpen }) => {
    const { logout } = useAuth();

    const menuItems = [
        { path: '/dashboard', name: 'Dashboard', icon: LayoutDashboard },
        { path: '/live-incidents', name: 'Live Incidents', icon: AlertCircle },
        { path: '/incident-history', name: 'Incident History', icon: History },
        { path: '/cameras', name: 'Cameras', icon: Camera },
        { path: '/devices', name: 'Edge Devices', icon: Smartphone },
        { path: '/units', name: 'Emergency Units', icon: Truck },
        { path: '/dispatch', name: 'Dispatch Control', icon: Truck },
        { path: '/reports', name: 'Reports', icon: BarChart3 },
        { path: '/settings', name: 'Settings', icon: Settings },
        { path: '/profile', name: 'Profile', icon: User },
    ];

    return (
        <div className={`${isOpen ? 'w-64' : 'w-20'} bg-slate-900 text-white transition-all duration-300 flex flex-col`}>
            <div className="p-6 flex items-center justify-center border-b border-slate-800">
                <h1 className={`${!isOpen && 'hidden'} font-bold text-xl tracking-tight`}>CRASH<span className="text-blue-500">DETECT</span></h1>
                {!isOpen && <span className="font-bold text-xl text-blue-500">CD</span>}
            </div>

            <nav className="flex-1 mt-6 px-4">
                <ul className="space-y-2">
                    {menuItems.map((item) => (
                        <li key={item.path}>
                            <NavLink
                                to={item.path}
                                className={({ isActive }) =>
                                    `flex items-center p-3 rounded-lg transition-colors ${
                                        isActive
                                        ? 'bg-blue-600 text-white'
                                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                    }`
                                }
                            >
                                <item.icon size={20} />
                                <span className={`${!isOpen && 'hidden'} ml-3 font-medium`}>{item.name}</span>
                            </NavLink>
                        </li>
                    ))}
                </ul>
            </nav>

            <div className="p-4 border-t border-slate-800">
                <button
                    onClick={logout}
                    className="flex items-center w-full p-3 text-slate-400 hover:bg-red-900/20 hover:text-red-500 rounded-lg transition-colors"
                >
                    <LogOut size={20} />
                    <span className={`${!isOpen && 'hidden'} ml-3 font-medium`}>Logout</span>
                </button>
            </div>
        </div>
    );
};

export default Sidebar;
