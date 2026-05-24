import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiRequest, getUser, clearToken } from '../utils/api';

export default function Dashboard() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  
  // Create Server Modal State
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [port, setPort] = useState('25565');
  const [autostart, setAutostart] = useState(false);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const curUser = getUser();
    if (!curUser) {
      navigate('/login');
    } else {
      setUser(curUser);
      fetchServers();
    }
  }, [navigate]);

  const fetchServers = async () => {
    try {
      setError('');
      const data = await apiRequest('/servers');
      setServers(data);
    } catch (err) {
      setError(err.message || 'Failed to fetch servers list.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  const handleCreateServer = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    try {
      const payload = {
        name,
        description,
        port: parseInt(port, 10),
        autostart: autostart ? 1 : 0
      };

      await apiRequest('/servers', {
        method: 'POST',
        body: payload
      });

      // Clear values and close
      setName('');
      setDescription('');
      setPort('25565');
      setAutostart(false);
      setShowModal(false);
      
      // Refresh list
      fetchServers();
    } catch (err) {
      setCreateError(err.message || 'Failed to create server.');
    } finally {
      setCreating(false);
    }
  };

  const triggerAction = async (e, serverId, action) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await apiRequest(`/servers/${serverId}/action`, {
        method: 'POST',
        body: { action }
      });
      // Poll/refresh servers listing
      fetchServers();
    } catch (err) {
      alert(`Action "${action}" failed: ${err.message}`);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-dark)' }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 32px',
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <h1 className="text-glow-primary" style={{ fontFamily: 'var(--font-heading)', fontSize: '22px', fontWeight: 'bold', margin: 0 }}>
            Hytale Clusters
          </h1>
          <nav style={{ display: 'flex', gap: '16px' }}>
            <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Dashboard</Link>
            <Link to="/settings" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Settings</Link>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
            Logged in as <strong style={{ color: 'var(--text-main)' }}>{user?.username}</strong> ({user?.role})
          </span>
          <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main style={{ flex: 1, padding: '32px', maxWidth: '1200px', width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '24px', fontWeight: 'bold' }}>Server Instances</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Manage and configure active Hytale worlds</p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn btn-primary">
            + New Server
          </button>
        </div>

        {error && (
          <div style={{
            backgroundColor: 'var(--error-glow)',
            color: 'var(--error)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '24px'
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '64px', color: 'var(--text-muted)' }}>
            Loading server instances...
          </div>
        ) : servers.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '64px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '16px', marginBottom: '16px' }}>No servers configured yet.</p>
            <button onClick={() => setShowModal(true)} className="btn btn-accent">
              Create Your First Server
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '24px'
          }}>
            {servers.map((srv) => (
              <div 
                key={srv.id} 
                onClick={() => navigate(`/servers/${srv.id}`)}
                className="glass-card animate-fade-in"
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '200px' }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--text-main)' }}>
                      {srv.name}
                    </h3>
                    <span className={`badge ${srv.status === 'running' ? 'badge-success' : srv.status === 'stopped' ? 'badge-secondary' : srv.status === 'uninstalled' ? 'badge-secondary' : 'badge-warning'}`}>
                      <span className={`status-dot ${srv.status === 'running' ? 'active' : srv.status === 'stopped' ? 'stopped' : srv.status === 'uninstalled' ? 'stopped' : 'warning'}`}></span>
                      {srv.status}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '36px', marginBottom: '12px' }}>
                    {srv.description || 'No description provided.'}
                  </p>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Port: <strong style={{ color: 'var(--text-main)' }}>{srv.port || 'Auto'}</strong>
                  </span>
                  
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {srv.status === 'uninstalled' ? (
                      <span style={{ fontSize: '12px', color: 'var(--text-dark)', fontStyle: 'italic', padding: '4px 0' }}>
                        Requires Install
                      </span>
                    ) : srv.status === 'stopped' ? (
                      <button 
                        onClick={(e) => triggerAction(e, srv.id, 'start')} 
                        className="btn btn-accent" 
                        style={{ padding: '4px 12px', fontSize: '12px' }}
                      >
                        Start
                      </button>
                    ) : (
                      <>
                        <button 
                          onClick={(e) => triggerAction(e, srv.id, 'stop')} 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 12px', fontSize: '12px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                        >
                          Stop
                        </button>
                        <button 
                          onClick={(e) => triggerAction(e, srv.id, 'restart')} 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 12px', fontSize: '12px' }}
                        >
                          Restart
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Server Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' }}>
              Create New Server Profile
            </h3>

            {createError && (
              <div style={{
                backgroundColor: 'var(--error-glow)',
                color: 'var(--error)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '13px',
                marginBottom: '16px'
              }}>
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateServer}>
              <div className="form-group">
                <label className="form-label">Server Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Orbis Survival"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={creating}
                />
                {name.trim() && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Generated Slug: <span style={{ color: 'var(--primary)', fontWeight: '600' }}>{name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}</span>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-input"
                  placeholder="Add details about your community or rules"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ minHeight: '80px', resize: 'vertical' }}
                  disabled={creating}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Port</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="25565"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  required
                  disabled={creating}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
                <input
                  type="checkbox"
                  id="autostart"
                  checked={autostart}
                  onChange={(e) => setAutostart(e.target.checked)}
                  disabled={creating}
                  style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                />
                <label htmlFor="autostart" style={{ fontSize: '14px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                  Enable automatic startup on panel boot
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)} 
                  className="btn btn-secondary"
                  disabled={creating}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={creating}
                >
                  {creating ? 'Creating...' : 'Create Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
