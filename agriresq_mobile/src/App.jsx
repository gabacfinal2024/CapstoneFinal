import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationsProvider } from './context/NotificationsContext';
import NotificationToast from './components/NotificationToast';
import AIVision from './pages/AIVision';
import Splash from './pages/Splash';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import BatchDetail from './pages/BatchDetail';
import NewBatch from './pages/NewBatch';
import Marketplace from './pages/Marketplace';
import ProduceDetail from './pages/ProduceDetail';
import Messages from './pages/Messages';
import Chat from './pages/Chat';
import Notifications from './pages/Notifications';
import Profile from './pages/Profile';
import AccountSettings from './pages/AccountSettings';
import Devices from './pages/Devices';
import AddDevice from './pages/AddDevice';
import DeviceDetail from './pages/DeviceDetail';
import Gallery from './pages/Gallery';
import Basis from './pages/Basis';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-shell page"><p>Loading...</p></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/home" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NotificationsProvider>
        <NotificationToast />
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<PublicRoute><Splash /></PublicRoute>} />
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/reset-password" element={<PublicRoute><ResetPassword /></PublicRoute>} />
          
          
          {/* Private Routes */}
          <Route path="/account-settings" element={<PrivateRoute><AccountSettings /></PrivateRoute>} />
          <Route path="/home" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/batch/new" element={<PrivateRoute><NewBatch /></PrivateRoute>} />
          <Route path="/batch/:id" element={<PrivateRoute><BatchDetail /></PrivateRoute>} />
          <Route path="/marketplace" element={<PrivateRoute><Marketplace /></PrivateRoute>} />
          <Route path="/produce/:id" element={<PrivateRoute><ProduceDetail /></PrivateRoute>} />
          <Route path="/messages" element={<PrivateRoute><Messages /></PrivateRoute>} />
          <Route path="/chat/:id" element={<PrivateRoute><Chat /></PrivateRoute>} />
          <Route path="/notifications" element={<PrivateRoute><Notifications /></PrivateRoute>} />
          <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
          <Route path="/basis" element={<PrivateRoute><Basis /></PrivateRoute>} />

          {/* ESP32-CAM devices (smart-home style setup) */}
          <Route path="/devices" element={<PrivateRoute><Devices /></PrivateRoute>} />
          <Route path="/devices/add" element={<PrivateRoute><AddDevice /></PrivateRoute>} />
          <Route path="/devices/:id" element={<PrivateRoute><DeviceDetail /></PrivateRoute>} />
          <Route path="/gallery" element={<PrivateRoute><Gallery /></PrivateRoute>} />
          <Route path="/ai-test" element={<PrivateRoute><AIVision /></PrivateRoute>} />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </NotificationsProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}``