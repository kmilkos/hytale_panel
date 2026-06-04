import React, { Suspense, lazy } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { getUser } from './utils/api';

const Login = lazy(() => import('./views/Login'));
const Dashboard = lazy(() => import('./views/Dashboard'));
const ServerDetail = lazy(() => import('./views/ServerDetail'));
const SystemSettings = lazy(() => import('./views/SystemSettings'));
const SystemMetrics = lazy(() => import('./views/SystemMetrics'));

// Sleek glassmorphic page loader fallback matching dark theme
function LoadingFallback() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--bg-dark, #0b0c10)',
      color: 'var(--text-main, #ffffff)',
      fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)'
    }}>
      <div className="glass-panel" style={{
        padding: '32px 48px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
        borderRadius: '12px',
        border: '1px solid var(--border, rgba(255, 255, 255, 0.05))',
        backgroundColor: 'rgba(17, 19, 28, 0.45)',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          border: '3px solid rgba(245, 158, 11, 0.1)',
          borderTopColor: 'var(--primary, #f59e0b)',
          animation: 'spin 1s linear infinite'
        }}></div>
        <div style={{ fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', color: 'var(--text-muted, #94a3b8)' }}>
          LOADING COMPONENT
        </div>
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Route protection component
function PrivateRoute({ children }) {
  const user = getUser();
  return user ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <Router>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route 
            path="/" 
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            } 
          />
          
          <Route 
            path="/servers/:id" 
            element={
              <PrivateRoute>
                <ServerDetail />
              </PrivateRoute>
            } 
          />
          
          <Route 
            path="/settings" 
            element={
              <PrivateRoute>
                <SystemSettings />
              </PrivateRoute>
            } 
          />

          <Route 
            path="/metrics" 
            element={
              <PrivateRoute>
                <SystemMetrics />
              </PrivateRoute>
            } 
          />

          {/* Fallback to main dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
