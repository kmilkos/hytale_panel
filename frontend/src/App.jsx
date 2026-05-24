import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './views/Login';
import Dashboard from './views/Dashboard';
import ServerDetail from './views/ServerDetail';
import SystemSettings from './views/SystemSettings';
import { getUser } from './utils/api';

// Route protection component
function PrivateRoute({ children }) {
  const user = getUser();
  return user ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <Router>
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

        {/* Fallback to main dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
