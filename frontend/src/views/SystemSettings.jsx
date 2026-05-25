import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiRequest, getUser, clearToken, API_BASE_URL, getToken } from '../utils/api';
import { showConfirm } from '../utils/confirm';

export default function SystemSettings() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  
  // Settings Form State
  const [cfKey, setCfKey] = useState('');
  const [nxKey, setNxKey] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  // Audit Logs State
  const [logs, setLogs] = useState([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [logAction, setLogAction] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Central Installer State
  const [installerStatus, setInstallerStatus] = useState({ isCached: false, downloadState: { status: 'idle', progress: 0 }, configuredUrl: '' });
  const [installerUrl, setInstallerUrl] = useState('');
  const [downloadingInstaller, setDownloadingInstaller] = useState(false);
  const [installerError, setInstallerError] = useState('');

  // User Management State
  const [users, setUsers] = useState([]);
  const [servers, setServers] = useState([]);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [roleInput, setRoleInput] = useState('operator');
  const [assignedServerIds, setAssignedServerIds] = useState([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    const curUser = getUser();
    if (!curUser) {
      navigate('/login');
    } else {
      setUser(curUser);
      fetchStats();
      fetchSettings();
      fetchAuditLogs(1);
      fetchInstallerStatus();
      
      if (curUser.role === 'admin') {
        fetchUsers();
        fetchServersList();
      }

      // Poll stats every 5 seconds
      const statsInterval = setInterval(fetchStats, 5000);
      return () => clearInterval(statsInterval);
    }
  }, [navigate]);

  useEffect(() => {
    let pollInterval;
    if (downloadingInstaller) {
      pollInterval = setInterval(fetchInstallerStatus, 2000);
    }
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [downloadingInstaller]);

  const fetchStats = async () => {
    try {
      const data = await apiRequest('/system/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch system stats', err);
    }
  };

  const fetchSettings = async () => {
    try {
      const settings = await apiRequest('/system/settings');
      setCfKey(settings.curseforge_api_key || '');
      setNxKey(settings.nexus_api_key || '');
    } catch (err) {
      console.error('Failed to fetch system settings', err);
    }
  };

  const fetchAuditLogs = async (page, action = logAction) => {
    setLoadingLogs(true);
    try {
      const res = await apiRequest(`/system/audit-logs?page=${page}&limit=15&action=${action}`);
      setLogs(res.items || []);
      setLogPage(res.pagination.page);
      setLogTotalPages(res.pagination.pages);
    } catch (err) {
      console.error('Failed to fetch audit logs', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchInstallerStatus = async () => {
    try {
      const data = await apiRequest('/system/installer-status');
      setInstallerStatus(data);
      setInstallerUrl(data.configuredUrl || '');
      const activeStates = ['downloading', 'downloading_game', 'awaiting_auth', 'extracting'];
      if (activeStates.includes(data.downloadState.status)) {
        setDownloadingInstaller(true);
      } else {
        setDownloadingInstaller(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchUsers = async () => {
    try {
      const data = await apiRequest('/system/users');
      setUsers(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchServersList = async () => {
    try {
      const data = await apiRequest('/servers');
      setServers(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateOrUpdateUser = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const body = {
          role: roleInput,
          serverIds: assignedServerIds
        };
        if (passwordInput.trim()) {
          body.password = passwordInput.trim();
        }
        await apiRequest(`/system/users/${editingUser.id}`, {
          method: 'PATCH',
          body
        });
        alert('User updated successfully.');
      } else {
        await apiRequest('/system/users', {
          method: 'POST',
          body: {
            username: usernameInput.trim(),
            password: passwordInput.trim(),
            role: roleInput,
            serverIds: assignedServerIds
          }
        });
        alert('User created successfully.');
      }
      setShowUserModal(false);
      setEditingUser(null);
      setUsernameInput('');
      setPasswordInput('');
      setRoleInput('operator');
      setAssignedServerIds([]);
      fetchUsers();
    } catch (err) {
      alert(err.message || 'Action failed.');
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (!await showConfirm(`Are you sure you want to permanently delete user account "${username}"?`, { title: 'Delete User Account', isDanger: true })) return;
    try {
      await apiRequest(`/system/users/${userId}`, {
        method: 'DELETE'
      });
      alert('User account deleted.');
      fetchUsers();
    } catch (err) {
      alert(err.message || 'Deletion failed.');
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateInfo(null);
    try {
      const data = await apiRequest('/system/update-check');
      setUpdateInfo(data);
    } catch (err) {
      alert('Update check failed.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleDownloadInstaller = async (e) => {
    e.preventDefault();
    setInstallerError('');
    setDownloadingInstaller(true);
    try {
      await apiRequest('/system/download-installer', {
        method: 'POST',
        body: { downloadUrl: installerUrl }
      });
      fetchInstallerStatus();
    } catch (err) {
      setInstallerError(err.message || 'Failed to start installer download.');
      setDownloadingInstaller(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaveSuccess('');
    setSaveError('');
    setSaving(true);

    try {
      await apiRequest('/system/settings', {
        method: 'PUT',
        body: {
          curseforge_api_key: cfKey,
          nexus_api_key: nxKey
        }
      });
      setSaveSuccess('API keys and system settings saved successfully.');
      fetchSettings();
    } catch (err) {
      setSaveError(err.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleActionFilterChange = (e) => {
    const act = e.target.value;
    setLogAction(act);
    setLogPage(1);
    fetchAuditLogs(1, act);
  };

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  // Convert bytes helper
  const formatGB = (bytes) => {
    if (!bytes) return '0 GB';
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
            <Link to="/" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Dashboard</Link>
            <Link to="/metrics" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>System Metrics</Link>
            <Link to="/settings" style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Settings</Link>
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

      {/* Main Content */}
      <main style={{ flex: 1, padding: '32px', maxWidth: '1200px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '24px', fontWeight: 'bold' }}>Global Panel Settings</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Monitor resource statistics, manage settings and inspect access logs.</p>
        </div>

        {/* Resources Metrics & Settings */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '32px' }}>
          {/* Machine Performance */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
              System Monitor
            </h3>
            {stats ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Platform</label>
                    <div style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text-main)' }}>{stats.platform} ({stats.arch})</div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Node Runtime</label>
                    <div style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text-main)' }}>{stats.nodeVersion}</div>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>CPU Hardware</label>
                  <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-main)' }}>{stats.cpuModel}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{stats.cpuCores} physical/logical cores</div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Memory Consumption</label>
                    <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--primary)' }}>{stats.memory.percentage}%</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${stats.memory.percentage}%`, height: '100%', backgroundColor: 'var(--primary)', boxShadow: '0 0 10px var(--primary)' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>Used: {formatGB(stats.memory.used)}</span>
                    <span>Total: {formatGB(stats.memory.total)}</span>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Panel Uptime</label>
                  <div style={{ fontSize: '14px', color: 'var(--text-main)' }}>
                    {Math.floor(stats.uptime / 86400)}d {Math.floor((stats.uptime % 86400) / 3600)}h {Math.floor((stats.uptime % 3600) / 60)}m {stats.uptime % 60}s
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Querying system resources...</div>
            )}
          </div>

          {/* Config Settings Form */}
          <div className="glass-panel">
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '20px' }}>
              Integrations Keys
            </h3>

            {saveSuccess && (
              <div style={{ backgroundColor: 'var(--success-glow)', color: 'var(--success)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', padding: '12px', fontSize: '13px', marginBottom: '16px' }}>
                {saveSuccess}
              </div>
            )}
            {saveError && (
              <div style={{ backgroundColor: 'var(--error-glow)', color: 'var(--error)', border: '1px solid rgba(244, 63, 94, 0.3)', borderRadius: '8px', padding: '12px', fontSize: '13px', marginBottom: '16px' }}>
                {saveError}
              </div>
            )}

            <form onSubmit={handleSaveSettings}>
              <div className="form-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>CurseForge API Key</label>
                  <a
                    href="https://console.curseforge.com/#/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '11px',
                      fontWeight: '600',
                      color: 'var(--primary)',
                      textDecoration: 'none',
                      border: '1px solid rgba(99, 102, 241, 0.4)',
                      borderRadius: '5px',
                      padding: '3px 8px',
                      transition: 'all 0.2s',
                      backgroundColor: 'rgba(99, 102, 241, 0.08)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.18)'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.08)'; e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)'; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    Get API Key
                  </a>
                </div>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter CurseForge console API key"
                  value={cfKey}
                  onChange={(e) => setCfKey(e.target.value)}
                  disabled={saving}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>Required to scan and auto-install CurseForge Hytale mods.</span>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Nexus Mods Personal API Key</label>
                  <a
                    href="https://next.nexusmods.com/settings/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '11px',
                      fontWeight: '600',
                      color: '#d97706',
                      textDecoration: 'none',
                      border: '1px solid rgba(217, 119, 6, 0.4)',
                      borderRadius: '5px',
                      padding: '3px 8px',
                      transition: 'all 0.2s',
                      backgroundColor: 'rgba(217, 119, 6, 0.08)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(217, 119, 6, 0.18)'; e.currentTarget.style.borderColor = '#d97706'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(217, 119, 6, 0.08)'; e.currentTarget.style.borderColor = 'rgba(217, 119, 6, 0.4)'; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    Get API Key
                  </a>
                </div>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter Nexus Mods API key"
                  value={nxKey}
                  onChange={(e) => setNxKey(e.target.value)}
                  disabled={saving}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>Used for querying remote listings discovery (manual install only).</span>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }} disabled={saving}>
                {saving ? 'Saving...' : 'Save Config'}
              </button>
            </form>
          </div>

          {/* Hytale Central Server Cache */}
          <div className="glass-panel" style={{ gridColumn: 'span 2' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '20px' }}>
              Hytale Server Installer (Shared Cache)
            </h3>
            
            {installerError && (
              <div style={{ backgroundColor: 'var(--error-glow)', color: 'var(--error)', border: '1px solid rgba(244, 63, 94, 0.3)', borderRadius: '8px', padding: '12px', fontSize: '13px', marginBottom: '16px' }}>
                {installerError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', alignItems: 'start' }}>
              <div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cache Status</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                    <span className={`status-dot ${installerStatus.isCached ? 'active' : 'stopped'}`}></span>
                    <strong style={{ fontSize: '15px' }}>
                      {installerStatus.isCached ? 'Cached & Ready (shared/)' : 'Missing / Not Cached'}
                    </strong>
                  </div>
                </div>

                <form onSubmit={handleDownloadInstaller}>
                  <div className="form-group">
                    <label className="form-label">Installer ZIP Download URL</label>
                    <input
                      type="url"
                      className="form-input"
                      placeholder="https://downloader.hytale.com/hytale-downloader.zip"
                      value={installerUrl}
                      onChange={(e) => setInstallerUrl(e.target.value)}
                      disabled={downloadingInstaller}
                      required
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>
                      Enter the direct URL to the Hytale Downloader utility ZIP archive. This utility will automatically run, prompt for verification, and compile the server cache.
                    </span>
                  </div>

                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    disabled={downloadingInstaller}
                    style={{ width: '100%', marginTop: '8px' }}
                  >
                    {downloadingInstaller ? 'Downloading...' : 'Download & Cache Installer'}
                  </button>
                </form>
              </div>

              {/* Status Box (Always Visible) */}
              <div style={{ backgroundColor: 'var(--bg-panel-hover)', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '14px', color: 'var(--primary)', fontWeight: 'bold', margin: 0 }}>
                  Cache Installer Status
                </h4>
                
                {/* Status Indicator Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Execution State:</span>
                  <span className={`badge ${
                    installerStatus.downloadState.status === 'completed' ? 'badge-success' :
                    installerStatus.downloadState.status === 'failed' ? 'badge-error' :
                    installerStatus.downloadState.status === 'idle' ? 'badge-secondary' :
                    'badge-warning'
                  }`} style={{ textTransform: 'capitalize', fontWeight: 'bold' }}>
                    {installerStatus.downloadState.status}
                  </span>
                </div>

                {/* Progress Bar Container */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-main)', marginBottom: '8px' }}>
                    <span>Progress:</span>
                    <span>{installerStatus.downloadState.progress || 0}%</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ 
                      width: `${installerStatus.downloadState.progress || 0}%`, 
                      height: '100%', 
                      backgroundColor: installerStatus.downloadState.status === 'failed' ? 'var(--error)' : 'var(--primary)',
                      boxShadow: installerStatus.downloadState.status === 'failed' ? 'none' : '0 0 10px var(--primary)',
                      transition: 'width 0.3s ease-in-out'
                    }}></div>
                  </div>
                </div>

                {/* Completed State Info */}
                {installerStatus.downloadState.status === 'completed' && (
                  <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid var(--success)', borderRadius: '8px', padding: '12px', fontSize: '12px', color: 'var(--text-main)', lineHeight: '1.5' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)', fontWeight: 'bold', marginBottom: '4px' }}>
                      <span>✓</span> Hytale Cache Complete
                    </div>
                    The central server installation cache files (including <code>Server/HytaleServer.jar</code> and <code>Assets.zip</code>) are successfully compiled, verified, and ready for deployment to instances.
                  </div>
                )}

                {/* Failed State Info */}
                {installerStatus.downloadState.status === 'failed' && (
                  <div style={{ backgroundColor: 'rgba(244, 63, 94, 0.08)', border: '1px solid var(--error)', borderRadius: '8px', padding: '12px', fontSize: '12px', color: 'var(--text-main)', lineHeight: '1.5' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--error)', fontWeight: 'bold', marginBottom: '4px' }}>
                      <span>⚠️</span> Installer Execution Failed
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px', wordBreak: 'break-all' }}>
                      {installerStatus.downloadState.error || 'Unknown cache installation error occurred.'}
                    </div>
                  </div>
                )}

                {/* Idle State Info */}
                {installerStatus.downloadState.status === 'idle' && (
                  <div style={{ border: '1px dashed var(--border)', borderRadius: '8px', padding: '12px', fontSize: '12px', color: 'var(--text-dark)', textAlign: 'center', fontStyle: 'italic' }}>
                    {installerStatus.isCached ? (
                      <span style={{ color: 'var(--success)' }}>✓ Cache is populated and ready. You can trigger a re-download if you need to update or reset the installer cache.</span>
                    ) : (
                      <span>No active task. Provide a direct Hytale Downloader ZIP URL on the left and click "Download & Cache Installer" to initialize.</span>
                    )}
                  </div>
                )}

                {/* Active Downloading State Stats */}
                {installerStatus.downloadState.status === 'downloading' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <div>
                      Downloaded: {(installerStatus.downloadState.downloadedBytes / (1024 * 1024)).toFixed(2)} MB of {(installerStatus.downloadState.totalBytes / (1024 * 1024)).toFixed(2)} MB
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '6px', marginTop: '2px' }}>
                      <span>Speed: <strong style={{ color: 'var(--primary)' }}>{installerStatus.downloadState.speedFormatted || '0 B/s'}</strong></span>
                      <span>ETA: <strong style={{ color: 'var(--accent)' }}>{installerStatus.downloadState.etaFormatted || 'Estimating...'}</strong></span>
                    </div>
                  </div>
                )}

                {/* Active Downloader Spawning / Downloading Game Payload */}
                {installerStatus.downloadState.status === 'downloading_game' && (
                  <div style={{ fontSize: '11.5px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                    <span className="status-dot active" style={{ width: '8px', height: '8px' }}></span>
                    <span>Downloading game release payload ({installerStatus.downloadState.progress || 0}%)...</span>
                  </div>
                )}

                {/* Active OAuth2 Device Verification Prompt */}
                {installerStatus.downloadState.status === 'awaiting_auth' && (
                  <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)', border: '1px solid var(--warning)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '20px' }}>🔐</span>
                      <strong style={{ fontSize: '13px', color: 'var(--warning)' }}>Account Verification Required</strong>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5', margin: 0 }}>
                      The Hytale Downloader requires account verification. Click the link and enter the code:
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>1. Click to open:</span>
                        <div style={{ marginTop: '2px' }}>
                          <a 
                            href={installerStatus.downloadState.authUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            style={{ color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'underline', fontSize: '13px' }}
                          >
                            {installerStatus.downloadState.authUrl}
                          </a>
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>2. Enter Code:</span>
                        <div style={{
                          backgroundColor: '#050608',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '16px',
                          fontWeight: 'bold',
                          color: 'var(--accent)',
                          textAlign: 'center',
                          letterSpacing: '2px',
                          marginTop: '2px'
                        }}>
                          {installerStatus.downloadState.authCode}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-dark)', marginTop: '4px' }}>
                      <span className="status-dot warning" style={{ width: '8px', height: '8px' }}></span>
                      <span>Waiting for authentication confirmation...</span>
                    </div>
                  </div>
                )}

                {/* Active Game / Binary Extraction Phase */}
                {installerStatus.downloadState.status === 'extracting' && (
                  <div style={{ fontSize: '11px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                    <span className="status-dot active animate-pulse" style={{ width: '8px', height: '8px' }}></span>
                    <span>Extracting cache files... Please keep this page open.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* OS Auto-Start Services & Panel Updates */}
          <div className="glass-panel" style={{ gridColumn: 'span 2' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '20px' }}>
              OS Service Daemon Installer & Panel Updates
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
              <div>
                <h4 style={{ fontSize: '14px', color: 'var(--text-main)', fontWeight: 'bold', marginBottom: '8px' }}>
                  Auto-Start Startup Services
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '16px' }}>
                  Configure your system to automatically bootstrap the Hytale Control Panel server daemon whenever the host OS restarts.
                </p>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <a 
                    href={`${API_BASE_URL}/system/service-templates/windows?token=${getToken()}`}
                    download
                    className="btn btn-accent"
                    style={{ flex: 1, textDecoration: 'none' }}
                  >
                    Windows (PowerShell)
                  </a>
                  <a 
                    href={`${API_BASE_URL}/system/service-templates/linux?token=${getToken()}`}
                    download
                    className="btn btn-accent"
                    style={{ flex: 1, textDecoration: 'none' }}
                  >
                    Linux (systemd)
                  </a>
                </div>
              </div>

              <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '24px' }}>
                <h4 style={{ fontSize: '14px', color: 'var(--text-main)', fontWeight: 'bold', marginBottom: '8px' }}>
                  Panel Software Auto-Updates
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '16px' }}>
                  Verify if your control panel software requires patching or updating from the remote master branch repositories.
                </p>
                
                {updateInfo ? (
                  <div style={{ padding: '12px', backgroundColor: 'var(--bg-panel-hover)', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span>Current: <strong>v{updateInfo.currentVersion}</strong></span>
                      <span>Latest: <strong>v{updateInfo.latestVersion}</strong></span>
                    </div>
                    <div style={{ color: updateInfo.needsUpdate ? 'var(--warning)' : 'var(--success)', fontWeight: '500' }}>
                      {updateInfo.changelog}
                    </div>
                  </div>
                ) : null}

                <button 
                  onClick={handleCheckUpdates} 
                  className="btn btn-secondary" 
                  style={{ width: '100%' }}
                  disabled={checkingUpdates}
                >
                  {checkingUpdates ? 'Checking Repository...' : 'Check For Panel Updates'}
                </button>
              </div>
            </div>
          </div>

          {/* User Directory Management (Admin Only) */}
          {user?.role === 'admin' && (
            <div className="glass-panel" style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '20px' }}>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
                  User Accounts Directory
                </h3>
                <button 
                  onClick={() => {
                    setEditingUser(null);
                    setUsernameInput('');
                    setPasswordInput('');
                    setRoleInput('operator');
                    setAssignedServerIds([]);
                    setShowUserModal(true);
                  }}
                  className="btn btn-primary"
                  style={{ padding: '6px 16px', fontSize: '13px' }}
                >
                  + Add User
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 8px' }}>Username</th>
                      <th style={{ padding: '12px 8px' }}>Role</th>
                      <th style={{ padding: '12px 8px' }}>Assigned Server Scopes</th>
                      <th style={{ padding: '12px 8px' }}>Created At</th>
                      <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid rgba(34, 37, 51, 0.5)' }}>
                        <td style={{ padding: '12px 8px', fontWeight: '600' }}>{u.username}</td>
                        <td style={{ padding: '12px 8px' }}>
                          <span className={`badge ${u.role === 'admin' ? 'badge-error' : u.role === 'operator' ? 'badge-warning' : 'badge-success'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td style={{ padding: '12px 8px' }}>
                          {u.role === 'admin' ? (
                            <span style={{ color: 'var(--text-dark)' }}>Global Permissions</span>
                          ) : u.servers && u.servers.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {u.servers.map(s => (
                                <span key={s.id} className="badge badge-warning" style={{ fontSize: '9px', padding: '1px 6px', textTransform: 'none' }}>
                                  {s.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--error)', fontStyle: 'italic' }}>No Access Scopes</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{u.created_at}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                          <button
                            onClick={() => {
                              setEditingUser(u);
                              setUsernameInput(u.username);
                              setPasswordInput('');
                              setRoleInput(u.role);
                              setAssignedServerIds(u.servers ? u.servers.map(s => s.id) : []);
                              setShowUserModal(true);
                            }}
                            className="btn btn-secondary"
                            style={{ padding: '2px 8px', fontSize: '11px', marginRight: '8px' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            className="btn btn-secondary"
                            style={{ padding: '2px 8px', fontSize: '11px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                            disabled={user?.id === u.id}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Global Security Audit Log */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
              Security Audit Trail
            </h3>
            
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Action:</label>
              <select 
                value={logAction} 
                onChange={handleActionFilterChange}
                style={{
                  backgroundColor: 'var(--bg-dark)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '13px'
                }}
              >
                <option value="">All Actions</option>
                <option value="login">login</option>
                <option value="create-server">create-server</option>
                <option value="delete-server">delete-server</option>
                <option value="start-server">start-server</option>
                <option value="stop-server">stop-server</option>
                <option value="write-file">write-file</option>
                <option value="delete-file">delete-file</option>
                <option value="upload-file">upload-file</option>
                <option value="toggle-mod">toggle-mod</option>
                <option value="install-mod">install-mod</option>
                <option value="delete-mod">delete-mod</option>
                <option value="update-settings">update-settings</option>
                <option value="create-backup">create-backup</option>
                <option value="restore-backup">restore-backup</option>
                <option value="delete-backup">delete-backup</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px' }}>Timestamp</th>
                  <th style={{ padding: '12px 8px' }}>User</th>
                  <th style={{ padding: '12px 8px' }}>Action</th>
                  <th style={{ padding: '12px 8px' }}>Target</th>
                  <th style={{ padding: '12px 8px' }}>IP</th>
                  <th style={{ padding: '12px 8px' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {loadingLogs ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      Fetching audit trails...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dark)' }}>
                      No audit events logged.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid rgba(34, 37, 51, 0.5)', color: 'var(--text-main)' }}>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{log.created_at}</td>
                      <td style={{ padding: '12px 8px', fontWeight: '500' }}>{log.username || 'System'}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span className="badge badge-warning" style={{ fontSize: '10px', padding: '2px 8px' }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{log.target || '-'}</td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{log.ip || '-'}</td>
                      <td style={{ padding: '12px 8px' }}>{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {logTotalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '12px' }}>
              <button
                disabled={logPage <= 1 || loadingLogs}
                onClick={() => fetchAuditLogs(logPage - 1)}
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Previous
              </button>
              <span style={{ display: 'flex', alignItems: 'center', fontSize: '13px', color: 'var(--text-muted)', padding: '0 8px' }}>
                Page {logPage} of {logTotalPages}
              </span>
              <button
                disabled={logPage >= logTotalPages || loadingLogs}
                onClick={() => fetchAuditLogs(logPage + 1)}
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Create or Edit User Modal */}
      {showUserModal && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' }}>
              {editingUser ? `Edit User: ${editingUser.username}` : 'Create New User Account'}
            </h3>
            
            <form onSubmit={handleCreateOrUpdateUser}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  className="form-input"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  disabled={!!editingUser}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder={editingUser ? 'Leave blank to keep current' : 'Enter account password'}
                  required={!editingUser}
                />
              </div>

              <div className="form-group">
                <label className="form-label">User Role</label>
                <select
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value)}
                  style={{
                    backgroundColor: 'var(--bg-dark)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '13px'
                  }}
                >
                  <option value="admin">Administrator (Full Access)</option>
                  <option value="operator">Operator (Manage Scoped Servers)</option>
                  <option value="viewer">Viewer (Read-Only Scoped Servers)</option>
                </select>
              </div>

              {roleInput !== 'admin' && (
                <div className="form-group">
                  <label className="form-label">Assigned Servers (Access Scope)</label>
                  <span style={{ fontSize: '11px', color: 'var(--text-dark)', marginBottom: '8px' }}>
                    Select server instances this user is allowed to manage/view.
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', padding: '8px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-dark)' }}>
                    {servers.map(srv => (
                      <div key={srv.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          id={`scope-${srv.id}`}
                          checked={assignedServerIds.includes(srv.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAssignedServerIds(prev => [...prev, srv.id]);
                            } else {
                              setAssignedServerIds(prev => prev.filter(id => id !== srv.id));
                            }
                          }}
                          style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                        />
                        <label htmlFor={`scope-${srv.id}`} style={{ fontSize: '13px', color: 'var(--text-main)', cursor: 'pointer' }}>
                          {srv.name} (Port: {srv.port})
                        </label>
                      </div>
                    ))}
                    {servers.length === 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--text-dark)', textAlign: 'center', padding: '12px' }}>
                        No server instances registered.
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button type="button" onClick={() => { setShowUserModal(false); setEditingUser(null); }} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-primary">
                  {editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
