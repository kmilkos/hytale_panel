import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiRequest, getUser, clearToken, API_BASE_URL, getToken } from '../utils/api';

export default function SystemMetrics() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [metricsRange, setMetricsRange] = useState('30m');
  const metricsRangeRef = useRef('30m');

  // Real-time logical core loads
  const [prevCpus, setPrevCpus] = useState(null);
  const [coreUsages, setCoreUsages] = useState([]);

  const navigate = useNavigate();

  useEffect(() => {
    const curUser = getUser();
    if (!curUser) {
      navigate('/login');
    } else {
      setUser(curUser);
      fetchStats();
      fetchMetrics();

      // Poll stats every 5 seconds, metrics every 15 seconds
      const statsInterval = setInterval(fetchStats, 5000);
      const metricsInterval = setInterval(() => fetchMetrics(), 15000);

      return () => {
        clearInterval(statsInterval);
        clearInterval(metricsInterval);
      };
    }
  }, [navigate]);

  // Compute live CPU logical core loads between polls
  useEffect(() => {
    if (stats && stats.cpus) {
      if (prevCpus) {
        const newUsages = stats.cpus.map((core, i) => {
          const prev = prevCpus[i];
          if (!prev) return 0;

          const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
          const curTotal = Object.values(core.times).reduce((a, b) => a + b, 0);
          const prevIdle = prev.times.idle;
          const curIdle = core.times.idle;

          const totalDiff = curTotal - prevTotal;
          const idleDiff = curIdle - prevIdle;

          if (totalDiff === 0) return 0;
          return Math.min(100, Math.max(0, Math.round((1 - idleDiff / totalDiff) * 100)));
        });
        setCoreUsages(newUsages);
      } else {
        setCoreUsages(stats.cpus.map(() => 0));
      }
      setPrevCpus(stats.cpus);
    }
  }, [stats]);

  const fetchStats = async () => {
    try {
      const data = await apiRequest('/system/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch system stats', err);
    }
  };

  const getMetricsLimit = (range) => {
    switch (range) {
      case '1m': return 2;     // Last 2 ticks
      case '30m': return 60;   // Last 60 ticks (30 mins at 30s/tick)
      case '1h': return 120;   // Last 120 ticks (1 hr at 30s/tick)
      default: return 60;
    }
  };

  const fetchMetrics = async (rangeVal) => {
    try {
      const activeRange = rangeVal || metricsRangeRef.current;
      const limit = getMetricsLimit(activeRange);
      const data = await apiRequest(`/system/metrics?limit=${limit}`);
      setMetrics(data || []);
    } catch (err) {
      console.error('Failed to fetch historical system metrics', err);
    }
  };

  const handleRangeChange = (newRange) => {
    metricsRangeRef.current = newRange;
    setMetricsRange(newRange);
    fetchMetrics(newRange);
  };

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  const formatGB = (bytes) => {
    if (!bytes) return '0.00 GB';
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const renderSVGChart = (type) => {
    if (metrics.length === 0) {
      return (
        <div style={{ color: 'var(--text-dark)', textAlign: 'center', padding: '40px', fontSize: '13px' }}>
          Awaiting background resource logs collection...
        </div>
      );
    }

    const width = 800;
    const height = 200;
    const padding = 20;

    const getX = (index) => {
      if (metrics.length <= 1) return width / 2;
      return padding + (index / (metrics.length - 1)) * (width - 2 * padding);
    };

    const getY = (val, max) => height - padding - (val / max) * (height - 2 * padding);

    let points = '';
    let maxVal = 100;
    let color = 'var(--primary)';
    let fill = 'var(--primary-glow)';

    if (type === 'cpu') {
      maxVal = 100;
      color = '#10b981'; // Green
      fill = 'rgba(16, 185, 129, 0.08)';
      points = metrics.map((m, idx) => `${getX(idx)},${getY(m.cpu_percentage, maxVal)}`).join(' ');
    } else if (type === 'ram') {
      const maxBytes = Math.max(...metrics.map(m => m.ram_bytes), 1024 * 1024 * 1024);
      maxVal = maxBytes;
      color = '#3b82f6'; // Blue
      fill = 'rgba(59, 130, 246, 0.08)';
      points = metrics.map((m, idx) => `${getX(idx)},${getY(m.ram_bytes, maxVal)}`).join(' ');
    } else {
      // active processes/servers
      const maxServers = Math.max(...metrics.map(m => m.active_servers), 4);
      maxVal = maxServers;
      color = '#ec4899'; // Pink
      fill = 'rgba(236, 72, 153, 0.08)';
      points = metrics.map((m, idx) => `${getX(idx)},${getY(m.active_servers, maxVal)}`).join(' ');
    }

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%', display: 'block' }}>
        {/* Horizontal gridlines */}
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="rgba(255,255,255,0.03)" />
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="rgba(255,255,255,0.03)" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.08)" />

        {points && (
          <polygon
            points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`}
            fill={fill}
          />
        )}

        {points && (
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            points={points}
            style={{ filter: `drop-shadow(0 2px 4px ${color}40)` }}
          />
        )}

        {/* Data points markers */}
        {points && metrics.length < 30 && metrics.map((m, idx) => {
          const val = type === 'cpu' ? m.cpu_percentage : type === 'ram' ? m.ram_bytes : m.active_servers;
          return (
            <circle
              key={idx}
              cx={getX(idx)}
              cy={getY(val, maxVal)}
              r="4"
              fill="#fff"
              stroke={color}
              strokeWidth="2"
            />
          );
        })}
      </svg>
    );
  };

  const getOverallCpuPercentage = () => {
    if (!stats) return 0;
    if (coreUsages.length > 0) {
      return Math.round(coreUsages.reduce((a, b) => a + b, 0) / coreUsages.length);
    }
    return stats.memory.percentage || 0; // fallback approximation if initial ticks are missing
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-dark)' }}>
      {/* Header */}
      <header className="fancy-header">
        <div className="fancy-nav-container">
          <nav className="fancy-nav">
            <Link to="/" className="fancy-nav-item">Dashboard</Link>
            <Link to="/metrics" className="fancy-nav-item active">System Metrics</Link>
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
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '32px', maxWidth: '1200px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '24px', fontWeight: 'bold' }}>Host Performance Metrics</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Monitor cluster machine resources, disk capacity, and running process footprints.</p>
        </div>

        {/* Resources Metrics Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px' }}>
          {/* Card 1: Overall CPU */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>Host CPU Utilization</span>
              <span style={{ fontSize: '20px' }}>💻</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#10b981', textShadow: '0 0 10px rgba(16, 185, 129, 0.2)' }}>
              {stats ? `${getOverallCpuPercentage()}%` : '0%'}
            </div>
            <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: stats ? `${getOverallCpuPercentage()}%` : '0%', height: '100%', backgroundColor: '#10b981', boxShadow: '0 0 8px #10b981', transition: 'width 0.5s ease' }}></div>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {stats ? `${stats.cpuCores} Cores - ${stats.cpuModel}` : 'Awaiting stats...'}
            </span>
          </div>

          {/* Card 2: Memory */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>Memory Consumption</span>
              <span style={{ fontSize: '20px' }}>🧠</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#3b82f6', textShadow: '0 0 10px rgba(59, 130, 246, 0.2)' }}>
              {stats ? `${stats.memory.percentage}%` : '0%'}
            </div>
            <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: stats ? `${stats.memory.percentage}%` : '0%', height: '100%', backgroundColor: '#3b82f6', boxShadow: '0 0 8px #3b82f6', transition: 'width 0.5s ease' }}></div>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              {stats ? (
                <>
                  <span>Used: {formatGB(stats.memory.used)}</span>
                  <span>Total: {formatGB(stats.memory.total)}</span>
                </>
              ) : (
                <span>Awaiting stats...</span>
              )}
            </span>
          </div>

          {/* Card 3: Storage */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>Workspace Disk</span>
              <span style={{ fontSize: '20px' }}>💽</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#eab308', textShadow: '0 0 10px rgba(234, 179, 8, 0.2)' }}>
              {stats && stats.disk && stats.disk.total > 0
                ? `${Math.round((stats.disk.used / stats.disk.total) * 100)}%`
                : '0%'}
            </div>
            <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{
                width: stats && stats.disk && stats.disk.total > 0
                  ? `${Math.round((stats.disk.used / stats.disk.total) * 100)}%`
                  : '0%',
                height: '100%',
                backgroundColor: '#eab308',
                boxShadow: '0 0 8px #eab308',
                transition: 'width 0.5s ease'
              }}></div>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              {stats && stats.disk && stats.disk.total > 0 ? (
                <>
                  <span>Used: {formatGB(stats.disk.used)}</span>
                  <span>Total: {formatGB(stats.disk.total)}</span>
                </>
              ) : (
                <span>Awaiting stats...</span>
              )}
            </span>
          </div>

          {/* Card 4: Active Instances */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>Running Servers</span>
              <span style={{ fontSize: '20px' }}>⚡</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#ec4899', textShadow: '0 0 10px rgba(236, 72, 153, 0.2)' }}>
              {stats && stats.activeInstances ? stats.activeInstances.length : 0}
            </div>
            <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{
                width: stats && stats.activeInstances ? `${Math.min(100, stats.activeInstances.length * 20)}%` : '0%',
                height: '100%',
                backgroundColor: '#ec4899',
                boxShadow: '0 0 8px #ec4899',
                transition: 'width 0.5s ease'
              }}></div>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {stats && stats.activeInstances
                ? `${stats.activeInstances.length} active process templates`
                : 'Awaiting stats...'}
            </span>
          </div>
        </div>

        {/* Middle Section: CPU Cores Load & Hytale Processes Footprint */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '32px' }}>
          {/* Logical Core Threads Monitor */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', margin: 0 }}>
              Logical CPU Core Utilizations
            </h3>

            {stats && stats.cpus ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                {stats.cpus.map((core, i) => {
                  const usage = coreUsages[i] || 0;
                  return (
                    <div key={i} style={{ backgroundColor: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                        <span>Thread #{i + 1}</span>
                        <span style={{ fontWeight: 'bold', color: '#10b981' }}>{usage}%</span>
                      </div>
                      <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${usage}%`, height: '100%', backgroundColor: '#10b981', transition: 'width 0.3s ease' }}></div>
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-dark)', marginTop: '4px', textAlign: 'right' }}>
                        {core.speed} MHz
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Reading physical CPU layout...</div>
            )}
          </div>

          {/* Hytale Servers Resource Footprints */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', margin: 0 }}>
              Active Server Resource Allocation
            </h3>

            {stats && stats.activeInstances && stats.activeInstances.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {stats.activeInstances.map((srv) => (
                  <div key={srv.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-panel-hover)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Link to={`/servers/${srv.id}`} style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-main)', textDecoration: 'none' }}>
                        🟢 {srv.name} <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal' }}>(port: {srv.port})</span>
                      </Link>
                      <span className="badge badge-success" style={{ fontSize: '10px' }}>Online</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '4px' }}>
                      {/* CPU usage bar */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                          <span>CPU Allocation</span>
                          <strong style={{ color: '#10b981' }}>{srv.cpu}%</strong>
                        </div>
                        <div style={{ width: '100%', height: '5px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '2.5px', overflow: 'hidden' }}>
                          <div style={{ width: `${srv.cpu}%`, height: '100%', backgroundColor: '#10b981' }}></div>
                        </div>
                      </div>

                      {/* Memory usage bar */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                          <span>RAM Allocation</span>
                          <strong style={{ color: '#3b82f6' }}>{formatGB(srv.ram)}</strong>
                        </div>
                        <div style={{ width: '100%', height: '5px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '2.5px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (srv.ram / (1024 * 1024 * 1024)) * 25)}%`, height: '100%', backgroundColor: '#3b82f6' }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ border: '1px dashed var(--border)', borderRadius: '8px', padding: '32px', textAlign: 'center', color: 'var(--text-dark)', fontStyle: 'italic', fontSize: '13px' }}>
                No active Hytale servers are currently consuming metrics. Go to the Dashboard to bootstrap a server.
              </div>
            )}
          </div>
        </div>

        {/* Performance Charts Panel */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
              Historical Analytics
            </h3>
            <div style={{ display: 'flex', gap: '2px', backgroundColor: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border)' }}>
              {['1m', '30m', '1h'].map((r) => (
                <button
                  key={r}
                  onClick={() => handleRangeChange(r)}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: '600',
                    borderRadius: '4px',
                    border: 'none',
                    backgroundColor: metricsRange === r ? 'var(--primary)' : 'transparent',
                    color: metricsRange === r ? '#000' : 'var(--text-dark)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {r === '1m' ? 'Live (1m)' : r === '30m' ? 'Last 30m' : 'Last 1h'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '32px' }}>
            {/* Chart 1: Host CPU Usage */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: '500' }}>
                <span>Host CPU Load History</span>
                <span style={{ color: '#10b981', fontWeight: 'bold' }}>
                  {metrics.length > 0 ? `${metrics[metrics.length - 1].cpu_percentage}%` : '0%'}
                </span>
              </div>
              <div style={{ height: '220px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                {renderSVGChart('cpu')}
              </div>
            </div>

            {/* Chart 2: Host RAM Usage */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: '500' }}>
                <span>Host RAM History</span>
                <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>
                  {metrics.length > 0 ? formatGB(metrics[metrics.length - 1].ram_bytes) : '0.00 GB'}
                </span>
              </div>
              <div style={{ height: '220px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                {renderSVGChart('ram')}
              </div>
            </div>

            {/* Chart 3: Active Server Instances */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: '500' }}>
                <span>Active Hytale Server Processes Ticker</span>
                <span style={{ color: '#ec4899', fontWeight: 'bold' }}>
                  {metrics.length > 0 ? `${metrics[metrics.length - 1].active_servers} Running` : '0 Running'}
                </span>
              </div>
              <div style={{ height: '220px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                {renderSVGChart('servers')}
              </div>
            </div>
          </div>
        </div>

        {/* Runtime Environment Info */}
        {stats && (
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', margin: 0 }}>
              Physical Node Environment
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px', fontSize: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Operating System</label>
                <div style={{ fontWeight: '500', color: 'var(--text-main)' }}>{stats.platform} ({stats.arch})</div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Node Version</label>
                <div style={{ fontWeight: '500', color: 'var(--text-main)' }}>{stats.nodeVersion}</div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>System Uptime</label>
                <div style={{ fontWeight: '500', color: 'var(--text-main)' }}>
                  {Math.floor(stats.uptime / 86400)}d {Math.floor((stats.uptime % 86400) / 3600)}h {Math.floor((stats.uptime % 3600) / 60)}m {stats.uptime % 60}s
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Load Average (Unix Only)</label>
                <div style={{ fontWeight: '500', color: 'var(--text-main)' }}>
                  {stats.loadAverage && stats.loadAverage.length > 0 ? stats.loadAverage.map(n => n.toFixed(2)).join(', ') : 'Not applicable (Windows)'}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
