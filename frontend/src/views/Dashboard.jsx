import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiRequest, getUser, clearToken } from '../utils/api';
import { 
  Server, 
  Activity, 
  Users, 
  Cpu, 
  HardDrive, 
  Search, 
  LayoutGrid, 
  List as ListIcon, 
  Play, 
  Square, 
  RotateCcw, 
  Plus, 
  LogOut, 
  Check, 
  X,
  Gauge
} from 'lucide-react';

export default function Dashboard() {
  const [servers, setServers] = useState([]);
  const [systemStats, setSystemStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  
  // Custom Controls hooks
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewLayout, setViewLayout] = useState('grid');
  
  // Create Server Modal State
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [port, setPort] = useState('25565');
  const [autostart, setAutostart] = useState(false);
  const [serverType, setServerType] = useState('Survival');
  const [serverVersion, setServerVersion] = useState('Use Global Default');
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
      fetchSystemStats();

      // Poll server status and metrics every 10 seconds in the background
      const intervalId = setInterval(() => {
        fetchServers();
        fetchSystemStats();
      }, 10000);

      return () => clearInterval(intervalId);
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

  const fetchSystemStats = async () => {
    try {
      const stats = await apiRequest('/system/stats');
      setSystemStats(stats);
    } catch (err) {
      console.error('Failed to fetch system stats:', err);
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
        autostart: !!autostart,
        server_type: serverType,
        server_version: serverVersion
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
      setServerType('Survival');
      setServerVersion('Use Global Default');
      setShowModal(false);
      
      // Refresh listing
      fetchServers();
      fetchSystemStats();
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
      // Poll/refresh listing instantly
      fetchServers();
      fetchSystemStats();
    } catch (err) {
      alert(`Action "${action}" failed: ${err.message}`);
    }
  };

  // Helper formatting logic
  const formatRAM = (bytes) => {
    if (!bytes || isNaN(bytes) || bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1000) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${Math.round(mb)} MB`;
  };

  const formatUptime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0m';
    const d = Math.floor(seconds / (24 * 3600));
    const h = Math.floor((seconds % (24 * 3600)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(' ');
  };

  // Filtering criteria
  const filteredServers = servers.filter((srv) => {
    const matchesSearch = 
      srv.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (srv.description && srv.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (srv.port && String(srv.port).includes(searchTerm));
    
    if (statusFilter === 'all') return matchesSearch;
    return srv.status === statusFilter && matchesSearch;
  });

  const totalPlayersCount = servers.reduce((acc, srv) => acc + (srv.onlinePlayers?.length || 0), 0);
  const activeServersCount = servers.filter((srv) => srv.isRunning).length;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-dark)' }}>
      {/* Header */}
      <header className="fancy-header">
        <div className="fancy-nav-container">
          <nav className="fancy-nav">
            <Link to="/" className="fancy-nav-item active">Dashboard</Link>
            <Link to="/metrics" className="fancy-nav-item">System Metrics</Link>
            <Link to="/settings" className="fancy-nav-item">Settings</Link>
          </nav>
        </div>

        <div className="fancy-title-container">
          <h1 className="fancy-title">
            <span className="fancy-title-brackets">[</span>
            Hytale Clusters
            <span className="fancy-title-brackets">]</span>
          </h1>
        </div>

        <div className="fancy-right-container">
          <div className="fancy-user-badge">
            <span style={{ color: 'var(--text-muted)' }}>Logged in as</span>
            <strong style={{ color: 'var(--text-main)' }}>{user?.username}</strong>
            <span className="badge badge-warning" style={{ fontSize: '9px', padding: '2px 6px' }}>{user?.role}</span>
          </div>
          <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>
            <LogOut size={14} style={{ marginRight: '6px' }} />
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main style={{ flex: 1, padding: '32px', maxWidth: '1200px', width: '100%', margin: '0 auto' }}>
        
        {/* Dynamic Cluster Stat summary cards at top */}
        <section className="cluster-metrics-summary">
          <div className="mini-stat-card">
            <div className="mini-stat-icon-wrapper">
              <Server size={20} />
            </div>
            <div className="mini-stat-data">
              <div className="mini-stat-label">Total Clusters</div>
              <div className="mini-stat-value">{servers.length} profiles</div>
            </div>
          </div>

          <div className="mini-stat-card">
            <div className="mini-stat-icon-wrapper" style={{ color: activeServersCount > 0 ? 'var(--success)' : 'inherit', background: activeServersCount > 0 ? 'var(--success-glow)' : 'inherit' }}>
              <Activity size={20} className={activeServersCount > 0 ? 'status-dot active' : ''} />
            </div>
            <div className="mini-stat-data">
              <div className="mini-stat-label">Online Nodes</div>
              <div className="mini-stat-value">{activeServersCount} active</div>
            </div>
          </div>

          <div className="mini-stat-card">
            <div className="mini-stat-icon-wrapper" style={{ color: totalPlayersCount > 0 ? 'var(--secondary)' : 'inherit', background: totalPlayersCount > 0 ? 'var(--secondary-glow)' : 'inherit' }}>
              <Users size={20} />
            </div>
            <div className="mini-stat-data">
              <div className="mini-stat-label">Active Players</div>
              <div className="mini-stat-value">{totalPlayersCount} online</div>
            </div>
          </div>

          <div className="mini-stat-card">
            <div className="mini-stat-icon-wrapper">
              <Cpu size={20} />
            </div>
            <div className="mini-stat-data">
              <div className="mini-stat-label">Host CPU / RAM</div>
              <div className="mini-stat-value">
                {systemStats ? `${systemStats.memory?.percentage || 0}% RAM` : 'Connecting...'}
              </div>
            </div>
            {systemStats && (
              <div style={{ position: 'absolute', right: '12px', top: '12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {formatUptime(systemStats.uptime)}
              </div>
            )}
          </div>
        </section>

        {/* Header Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '24px', fontWeight: 'bold' }}>Server Instances</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Manage and configure active Hytale worlds</p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn btn-primary">
            <Plus size={16} />
            New Server Profile
          </button>
        </div>

        {/* Dashboard filter & control bar */}
        <div className="dashboard-controls-bar">
          <div className="search-input-wrapper">
            <Search className="search-input-icon" size={16} />
            <input
              type="text"
              placeholder="Search by name, description or port..."
              className="form-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="filter-pills-container">
            <button 
              className={`filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All
            </button>
            <button 
              className={`filter-pill ${statusFilter === 'running' ? 'active' : ''}`}
              onClick={() => setStatusFilter('running')}
            >
              <span className="status-dot active" style={{ position: 'static', marginRight: '4px' }}></span>
              Running
            </button>
            <button 
              className={`filter-pill ${statusFilter === 'stopped' ? 'active' : ''}`}
              onClick={() => setStatusFilter('stopped')}
            >
              <span className="status-dot stopped" style={{ position: 'static', marginRight: '4px' }}></span>
              Stopped
            </button>
            <button 
              className={`filter-pill ${statusFilter === 'uninstalled' ? 'active' : ''}`}
              onClick={() => setStatusFilter('uninstalled')}
            >
              <span className="status-dot warning" style={{ position: 'static', marginRight: '4px' }}></span>
              Uninstalled
            </button>
          </div>

          <div className="layout-toggle-container">
            <button 
              className={`layout-toggle-btn ${viewLayout === 'grid' ? 'active' : ''}`}
              title="Grid View"
              onClick={() => setViewLayout('grid')}
            >
              <LayoutGrid size={16} />
            </button>
            <button 
              className={`layout-toggle-btn ${viewLayout === 'list' ? 'active' : ''}`}
              title="Dense List View"
              onClick={() => setViewLayout('list')}
            >
              <ListIcon size={16} />
            </button>
          </div>
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
            <Activity size={24} style={{ animation: 'spinSlow 2s linear infinite', marginBottom: '12px' }} />
            <div>Loading server instances...</div>
          </div>
        ) : filteredServers.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '64px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '16px', marginBottom: '16px' }}>No servers match your filters.</p>
            <button onClick={() => { setSearchTerm(''); setStatusFilter('all'); setShowModal(true); }} className="btn btn-accent">
              Create a Server Profile
            </button>
          </div>
        ) : viewLayout === 'grid' ? (
          /* Grid View Layout */
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '24px'
          }}>
            {filteredServers.map((srv) => {
              const themeClass = 
                srv.status === 'running' ? 'card-theme-running' :
                srv.status === 'stopped' ? 'card-theme-stopped' :
                srv.status === 'uninstalled' ? 'card-theme-uninstalled' : 'card-theme-error';

              return (
                <div 
                  key={srv.id} 
                  onClick={() => navigate(`/servers/${srv.id}`)}
                  className={`pretty-card animate-fade-in ${themeClass}`}
                >
                  <div>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '17px', fontWeight: '600', color: 'var(--text-main)' }}>
                        {srv.name}
                      </h3>
                      <span className={`badge ${srv.status === 'running' ? 'badge-success' : srv.status === 'stopped' ? 'badge-secondary' : srv.status === 'uninstalled' ? 'badge-warning' : 'badge-error'}`}>
                        <span className={`status-dot ${srv.status === 'running' ? 'active' : srv.status === 'stopped' ? 'stopped' : srv.status === 'uninstalled' ? 'warning' : 'stopped'}`}></span>
                        {srv.status}
                      </span>
                    </div>

                    {/* Server Type */}
                    <div style={{ marginBottom: '6px' }}>
                      <span className="badge badge-warning" style={{ fontSize: '9px', padding: '2px 8px', textTransform: 'uppercase' }}>
                        {srv.server_type || 'Survival'}
                      </span>
                    </div>

                    {/* Port & Slug */}
                    <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: '8px' }}>
                      <span>port: <strong style={{ color: 'var(--text-main)' }}>{srv.port || 'Auto'}</strong></span>
                      <span>slug: <strong style={{ color: 'var(--text-main)' }}>{srv.slug}</strong></span>
                    </div>

                    {/* Description */}
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '36px', marginBottom: '8px' }}>
                      {srv.description || 'No description provided.'}
                    </p>
                  </div>

                  {/* Resource metrics and players preview */}
                  <div>
                    {srv.status === 'running' && srv.metrics && (
                      <div className="metrics-bars-grid">
                        <div className="metric-bar-group">
                          <div className="metric-bar-label">
                            <span>CPU</span>
                            <span className="metric-bar-value">{srv.metrics.cpu_percentage || 0}%</span>
                          </div>
                          <div className="metric-bar-track">
                            <div 
                              className="metric-bar-fill cpu" 
                              style={{ width: `${Math.min(100, srv.metrics.cpu_percentage || 0)}%` }}
                            ></div>
                          </div>
                        </div>

                        <div className="metric-bar-group">
                          <div className="metric-bar-label">
                            <span>RAM</span>
                            <span className="metric-bar-value">{formatRAM(srv.metrics.ram_bytes)}</span>
                          </div>
                          <div className="metric-bar-track">
                            <div 
                              className="metric-bar-fill ram" 
                              style={{ width: srv.metrics.ram_bytes ? '65%' : '0%' }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Active Players pills row */}
                    {srv.status === 'running' && srv.onlinePlayers && srv.onlinePlayers.length > 0 && (
                      <div className="card-players-preview">
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', marginRight: '4px' }}>
                          <Users size={10} style={{ marginRight: '3px' }} />
                        </span>
                        {srv.onlinePlayers.map((player, idx) => (
                          <span key={idx} className="mini-player-pill">{player}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Card bottom actions row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '12px' }}>
                    <div className={`autostart-toggle-indicator ${srv.autostart ? 'active' : ''}`}>
                      {srv.autostart ? <Check size={11} /> : <X size={11} />}
                      Autostart
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {srv.status === 'uninstalled' ? (
                        <span style={{ fontSize: '12px', color: 'var(--primary)', fontStyle: 'italic', padding: '4px 0', fontWeight: '500' }}>
                          Requires Install
                        </span>
                      ) : srv.status === 'stopped' ? (
                        <button 
                          onClick={(e) => triggerAction(e, srv.id, 'start')} 
                          className="btn btn-accent" 
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                        >
                          <Play size={10} />
                          Start
                        </button>
                      ) : (
                        <>
                          <button 
                            onClick={(e) => triggerAction(e, srv.id, 'stop')} 
                            className="btn btn-secondary" 
                            style={{ padding: '4px 10px', fontSize: '11px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                          >
                            <Square size={10} />
                            Stop
                          </button>
                          <button 
                            onClick={(e) => triggerAction(e, srv.id, 'restart')} 
                            className="btn btn-secondary" 
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                          >
                            <RotateCcw size={10} />
                            Restart
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Dense List View Layout */
          <div className="dense-list-container animate-fade-in">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>Server Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Port</th>
                  <th>CPU Load</th>
                  <th>RAM Allocation</th>
                  <th>Players</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredServers.map((srv) => (
                  <tr key={srv.id} onClick={() => navigate(`/servers/${srv.id}`)}>
                    <td style={{ fontWeight: '600' }}>
                      <div>{srv.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '400', marginTop: '2px' }}>
                        {srv.description || 'No description provided.'}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-warning" style={{ fontSize: '9px', padding: '2px 8px', textTransform: 'uppercase' }}>
                        {srv.server_type || 'Survival'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${srv.status === 'running' ? 'badge-success' : srv.status === 'stopped' ? 'badge-secondary' : srv.status === 'uninstalled' ? 'badge-warning' : 'badge-error'}`}>
                        <span className={`status-dot ${srv.status === 'running' ? 'active' : srv.status === 'stopped' ? 'stopped' : srv.status === 'uninstalled' ? 'warning' : 'stopped'}`}></span>
                        {srv.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{srv.port || '25565'}</td>
                    <td>
                      {srv.status === 'running' && srv.metrics ? (
                        <div className="dense-progress-mini">
                          <span style={{ fontSize: '11px', fontWeight: 'bold', width: '32px' }}>{srv.metrics.cpu_percentage || 0}%</span>
                          <div className="dense-progress-bar">
                            <div className="dense-progress-fill" style={{ width: `${Math.min(100, srv.metrics.cpu_percentage || 0)}%`, background: 'var(--secondary)' }}></div>
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-dark)' }}>--</span>
                      )}
                    </td>
                    <td>
                      {srv.status === 'running' && srv.metrics ? (
                        <div className="dense-progress-mini">
                          <span style={{ fontSize: '11px', fontWeight: 'bold', width: '48px' }}>{formatRAM(srv.metrics.ram_bytes)}</span>
                          <div className="dense-progress-bar">
                            <div className="dense-progress-fill" style={{ width: srv.metrics.ram_bytes ? '65%' : '0%', background: '#8b5cf6' }}></div>
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-dark)' }}>--</span>
                      )}
                    </td>
                    <td>
                      {srv.status === 'running' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '600' }}>
                          <Users size={12} />
                          {srv.onlinePlayers?.length || 0} online
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dark)' }}>Offline</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                        {srv.status === 'uninstalled' ? (
                          <span style={{ fontSize: '12px', color: 'var(--primary)', fontStyle: 'italic', fontWeight: '500' }}>
                            Requires Install
                          </span>
                        ) : srv.status === 'stopped' ? (
                          <button 
                            onClick={(e) => triggerAction(e, srv.id, 'start')} 
                            className="btn btn-accent" 
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                          >
                            <Play size={10} />
                            Start
                          </button>
                        ) : (
                          <>
                            <button 
                              onClick={(e) => triggerAction(e, srv.id, 'stop')} 
                              className="btn btn-secondary" 
                              style={{ padding: '4px 10px', fontSize: '11px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                            >
                              <Square size={10} />
                              Stop
                            </button>
                            <button 
                              onClick={(e) => triggerAction(e, srv.id, 'restart')} 
                              className="btn btn-secondary" 
                              style={{ padding: '4px 10px', fontSize: '11px' }}
                            >
                              <RotateCcw size={10} />
                              Restart
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

              <div className="form-group">
                <label className="form-label">Server Type</label>
                <select
                  value={serverType}
                  onChange={(e) => setServerType(e.target.value)}
                  disabled={creating}
                  style={{
                    backgroundColor: 'rgba(9, 10, 15, 0.6)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border)',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    width: '100%',
                    cursor: creating ? 'not-allowed' : 'default'
                  }}
                >
                  <option value="Survival">Survival</option>
                  <option value="Adventure/RPG">Adventure/RPG</option>
                  <option value="Creative">Creative</option>
                  <option value="PvP">PvP</option>
                  <option value="Minigames">Minigames</option>
                  <option value="Roleplay">Roleplay</option>
                  <option value="Social">Social</option>
                  <option value="Sandbox">Sandbox</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Server Version</label>
                <select
                  value={serverVersion}
                  onChange={(e) => setServerVersion(e.target.value)}
                  disabled={creating}
                  style={{
                    backgroundColor: 'rgba(9, 10, 15, 0.6)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border)',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    width: '100%',
                    cursor: creating ? 'not-allowed' : 'default'
                  }}
                >
                  <option value="Use Global Default">Use Global Default</option>
                  <option value="latest">latest</option>
                  <option value="0.2.0">0.2.0</option>
                  <option value="0.1.0">0.1.0</option>
                </select>
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
