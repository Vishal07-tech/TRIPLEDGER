import { useEffect } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';

import AuthPage from './pages/AuthPage';
import ExpenseDashboard from './pages/ExpenseDashboard';
import SettlementPage from './pages/SettlementPage';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import ReportsPage from './pages/ReportsPage';
import TripsPage from './pages/TripsPage';
import TripManagementPage from './pages/TripManagementPage';
import { SESSION_EXPIRED_EVENT } from './lib/session';

function App() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleSessionExpired = () => navigate('/', { replace: true });
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [navigate]);

  return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route path="/dashboard" element={<ExpenseDashboard />} />
      <Route path="/trips" element={<TripsPage />} />
      <Route path="/trips/:tripId" element={<TripManagementPage />} />
      <Route path="/settlements" element={<SettlementPage />} />
      <Route path="/analytics" element={<AnalyticsDashboard />} />
      <Route path="/reports" element={<ReportsPage />} />
    </Routes>
  );
}

export default App;
