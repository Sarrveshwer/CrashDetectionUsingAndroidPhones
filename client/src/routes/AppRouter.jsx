import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from '../layout/MainLayout';
import ProtectedRoute from '../components/ProtectedRoute';

// Pages
import Dashboard from '../pages/Dashboard';
import LiveIncidents from '../pages/LiveIncidents';
import IncidentHistory from '../pages/IncidentHistory';
import CameraManagement from '../pages/CameraManagement';
import EdgeDeviceManagement from '../pages/EdgeDeviceManagement';
import EmergencyDispatch from '../pages/EmergencyDispatch';
import EmergencyUnitManagement from '../pages/EmergencyUnitManagement';
import Reports from '../pages/Reports';
import Settings from '../pages/Settings';
import Profile from '../pages/Profile';
import Login from '../pages/Login';
import NotFound from '../pages/NotFound';

const AppRouter = () => {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/live-incidents" element={<LiveIncidents />} />
                <Route path="/incident-history" element={<IncidentHistory />} />
                <Route path="/cameras" element={<CameraManagement />} />
                <Route path="/devices" element={<EdgeDeviceManagement />} />
                <Route path="/units" element={<EmergencyUnitManagement />} />
                <Route path="/dispatch" element={<EmergencyDispatch />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/profile" element={<Profile />} />
            </Route>

            <Route path="*" element={<NotFound />} />
        </Routes>
    );
};

export default AppRouter;
