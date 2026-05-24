import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiRequest, WS_BASE_URL, getToken, getUser } from '../utils/api';

export default function ServerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [installingFiles, setInstallingFiles] = useState(false);

  // Advanced features states
  const [currentUser, setCurrentUser] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [serverConfig, setServerConfig] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [schedName, setSchedName] = useState('');
  const [schedCron, setSchedCron] = useState('* * * * *');
  const [schedAction, setSchedAction] = useState('restart');
  const [schedPayload, setSchedPayload] = useState('');
  
  // Tab Navigation State: 'console' | 'files' | 'mods' | 'backups' | 'schedules' | 'players' | 'config'
  const [activeTab, setActiveTab] = useState('console');

  // 1. Console Tab State
  const [logs, setLogs] = useState([]);
  const [command, setCommand] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const COMMAND_SUGGESTIONS = [
    '/auth status',
    '/auth login',
    '/auth select',
    '/auth logout',
    '/auth cancel',
    '/auth persistence',
    '/ban',
    '/gamemode adventure',
    '/gamemode creative',
    '/gamemode survival',
    '/gamemode spectator',
    '/heal',
    '/help',
    '/hide',
    '/inventory',
    '/kick',
    '/kill',
    '/maxplayers',
    '/op self',
    '/op add',
    '/op remove',
    '/refer',
    '/spawning',
    '/stop',
    '/tp',
    '/unban'
  ];

  const [detectedIssues, setDetectedIssues] = useState([]);
  const consoleBottomRef = useRef(null);
  const consoleContainerRef = useRef(null);
  const isAutoScrollRef = useRef(true);
  const [metricsRange, setMetricsRange] = useState('30m');
  const metricsRangeRef = useRef('30m');
  const wsRef = useRef(null);

  // 2. Files Tab State
  const [currentRelPath, setCurrentRelPath] = useState('');
  const [filesList, setFilesList] = useState([]);
  const [editingFile, setEditingFile] = useState(null); // { relPath, content }
  const [editingContent, setEditingContent] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const fileInputRef = useRef(null);

  // 3. Mods Tab State
  const [installedMods, setInstalledMods] = useState([]);
  const [modsSearchQuery, setModsSearchQuery] = useState('');
  const [modsSource, setModsSource] = useState('curseforge'); // 'curseforge' | 'nexus'
  const [remoteMods, setRemoteMods] = useState([]);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [selectedMod, setSelectedMod] = useState(null);
  const [selectedModFiles, setSelectedModFiles] = useState([]);
  const [conflictsList, setConflictsList] = useState([]);
  const [activeDownloads, setActiveDownloads] = useState([]);

  // 4. Backups Tab State
  const [backups, setBackups] = useState([]);
  const [creatingBackup, setCreatingBackup] = useState(false);

  // 5. Configuration Tab State
  const [jvmArgs, setJvmArgs] = useState('');
  const [port, setPort] = useState(25565);
  const [autostart, setAutostart] = useState(false);
  const [restartPolicy, setRestartPolicy] = useState('never');
  const [restartSchedule, setRestartSchedule] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState('');

  // 6. Players Tab State
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [whitelistContent, setWhitelistContent] = useState('');
  const [bansContent, setBansContent] = useState('');
  const [savingPlayers, setSavingPlayers] = useState(false);

  useEffect(() => {
    setCurrentUser(getUser());
    fetchServerDetails();
    fetchBackups();
    fetchInstalledMods();
    fetchActiveDownloads();
    
    fetchMetrics();
    fetchSchedules();

    const dlInterval = setInterval(fetchActiveDownloads, 2000);
    const metricsInterval = setInterval(fetchMetrics, 15000);

    return () => {
      clearInterval(dlInterval);
      clearInterval(metricsInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [id]);

  useEffect(() => {
    if (activeTab === 'console') {
      fetchLogs();
      connectWebSocket();
      fetchMetrics();
    } else {
      if (wsRef.current) wsRef.current.close();
    }

    if (activeTab === 'files') {
      fetchFiles(currentRelPath);
    }

    if (activeTab === 'players') {
      fetchOnlinePlayers();
    }

    if (activeTab === 'schedules') {
      fetchSchedules();
    }

    if (activeTab === 'config') {
      fetchServerConfig();
    }
  }, [activeTab, currentRelPath]);

  const fetchLogs = async () => {
    try {
      const data = await apiRequest(`/servers/${id}/logs?limit=200`);
      setLogs(data.map(log => log.line));
      scrollToConsoleBottom(true);
    } catch (err) {
      console.error('Failed to fetch historical logs:', err);
    }
  };

  // WS Connection for real-time console logs
  const connectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `${WS_BASE_URL}?token=${getToken()}&serverId=${id}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Console WebSocket connected.');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.serverId === parseInt(id, 10)) {
          if (msg.type === 'log') {
            const line = msg.line;
            setLogs(prev => [...prev.slice(-399), line]); // Keep last 400 lines
            classifyLogLine(line);
            scrollToConsoleBottom();
          } else if (msg.type === 'status') {
            setServer(prev => prev ? { ...prev, status: msg.status } : null);
          } else if (msg.type === 'players') {
            setOnlinePlayers(msg.players || []);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    ws.onclose = () => {
      console.log('Console WebSocket closed.');
    };
  };

  const classifyLogLine = (line) => {
    let issue = null;
    if (line.includes('ClassNotFoundException') || line.includes('NoClassDefFoundError')) {
      issue = {
        id: Math.random().toString(),
        severity: 'critical',
        type: 'Missing Library Class',
        line,
        hint: 'A mod file is missing its dependecies or was compiled for a different Hytale build. Scan for conflicts or install dependency packages.'
      };
    } else if (line.includes('UnsupportedClassVersionError')) {
      issue = {
        id: Math.random().toString(),
        severity: 'critical',
        type: 'Java Version Mismatch',
        line,
        hint: 'The server JAR or mods require a newer Java virtual machine. Go to configuration page and verify your JAVA_HOME path.'
      };
    } else if (line.includes('missing dependency') || line.includes('DependencyResolutionException')) {
      issue = {
        id: Math.random().toString(),
        severity: 'critical',
        type: 'Unresolved Dependency',
        line,
        hint: 'Hytale failed to load a mod because a required dependency is missing or disabled. Check mod directory.'
      };
    } else if (line.includes('WARN') || line.includes('warning') || line.includes('Warning')) {
      // Avoid spamming warning classification
      if (Math.random() < 0.1) {
        issue = {
          id: Math.random().toString(),
          severity: 'warning',
          type: 'Server Performance Warning',
          line,
          hint: 'The server flagged a warning log. This is typical, but check custom settings if lag is present.'
        };
      }
    }

    if (issue) {
      setDetectedIssues(prev => [issue, ...prev.slice(0, 9)]);
    }
  };

  const scrollToConsoleBottom = (force = false) => {
    if (force || isAutoScrollRef.current) {
      setTimeout(() => {
        const el = consoleContainerRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }, 50);
    }
  };

  const handleConsoleScroll = () => {
    const el = consoleContainerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    isAutoScrollRef.current = isAtBottom;
  };

  const renderLineWithLinks = (line) => {
    if (!line) return '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = line.split(urlRegex);
    return parts.map((part, idx) => {
      if (part.match(/^https?:\/\//)) {
        const cleanUrl = part.replace(/[.,;:()'"\s]$/, '');
        return (
          <a
            key={idx}
            href={cleanUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--primary)',
              textDecoration: 'underline',
              cursor: 'pointer',
              wordBreak: 'break-all'
            }}
          >
            {part}
          </a>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const handleCommandChange = (e) => {
    const val = e.target.value;
    setCommand(val);

    if (val.trim() === '') {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const filtered = COMMAND_SUGGESTIONS.filter(cmd => 
      cmd.toLowerCase().startsWith(val.toLowerCase()) && cmd.toLowerCase() !== val.toLowerCase()
    );
    setSuggestions(filtered);
    setActiveSuggestionIdx(0);
    setShowSuggestions(filtered.length > 0);
  };

  const handleCommandKeyDown = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'Tab') {
        e.preventDefault();
        setCommand(suggestions[activeSuggestionIdx]);
        setSuggestions([]);
        setShowSuggestions(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIdx(prev => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIdx(prev => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    } else {
      if (e.key === 'Tab') {
        const val = command;
        const match = COMMAND_SUGGESTIONS.find(cmd => 
          cmd.toLowerCase().startsWith(val.toLowerCase())
        );
        if (match) {
          e.preventDefault();
          setCommand(match);
        }
      }
    }
  };

  const fetchServerDetails = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await apiRequest(`/servers/${id}`);
      setServer(data);
      setPort(data.port);
      setAutostart(data.autostart === 1);
      
      const configData = data.config_json ? JSON.parse(data.config_json) : {};
      setJvmArgs(configData.jvmArgs || '');
      setRestartPolicy(data.restart_policy || 'never');
      setRestartSchedule(data.restart_schedule || '');
      setWebhookUrl(data.webhook_url || '');

      // Load whitelist/bans configs
      setWhitelistContent(configData.whitelist || '');
      setBansContent(configData.bans || '');
    } catch (err) {
      setError(err.message || 'Failed to retrieve server details.');
    } finally {
      setLoading(false);
    }
  };

  // Install server core files
  const handleInstallServerFiles = async () => {
    try {
      setInstallingFiles(true);
      setError('');
      await apiRequest(`/servers/${id}/install-files`, {
        method: 'POST'
      });
      alert('Hytale server core files successfully installed!');
      await fetchServerDetails();
    } catch (err) {
      alert(`Installation failed: ${err.message}`);
    } finally {
      setInstallingFiles(false);
    }
  };

  // Status Action triggers
  const handleServerAction = async (action) => {
    try {
      await apiRequest(`/servers/${id}/action`, {
        method: 'POST',
        body: { action }
      });
      // Fetch details to update status
      const updated = await apiRequest(`/servers/${id}`);
      setServer(updated);
    } catch (err) {
      alert(`Server action ${action} failed: ${err.message}`);
    }
  };

  // Console send command
  const handleSendCommand = (e) => {
    e.preventDefault();
    if (!command.trim()) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'command',
        serverId: id,
        command: command.trim()
      }));
    } else {
      // Fallback HTTP command API
      apiRequest(`/servers/${id}/command`, {
        method: 'POST',
        body: { command: command.trim() }
      }).catch(err => alert(`Failed to send: ${err.message}`));
    }
    
    setLogs(prev => [...prev, `> ${command}`]);
    setCommand('');
    scrollToConsoleBottom();
  };

  // FILES TAB API
  const fetchFiles = async (relPath) => {
    try {
      const files = await apiRequest(`/files?serverId=${id}&relPath=${encodeURIComponent(relPath)}`);
      setFilesList(files);
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileClick = async (file) => {
    if (file.isDir) {
      setCurrentRelPath(currentRelPath ? `${currentRelPath}/${file.name}` : file.name);
    } else {
      // Check if text file to open editor
      const ext = file.name.split('.').pop().toLowerCase();
      const textExtensions = ['json', 'txt', 'cfg', 'properties', 'yml', 'yaml', 'sh', 'bat', 'log', 'xml'];
      if (textExtensions.includes(ext) || file.size < 50000) {
        try {
          const filePath = currentRelPath ? `${currentRelPath}/${file.name}` : file.name;
          const data = await apiRequest(`/files/read?serverId=${id}&relPath=${encodeURIComponent(filePath)}`);
          setEditingFile({ relPath: filePath, name: file.name });
          setEditingContent(data.content);
        } catch (err) {
          alert(`Failed to load file contents: ${err.message}`);
        }
      } else {
        alert('File is a binary format or too large to view in browser editor.');
      }
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    try {
      await apiRequest('/files/write', {
        method: 'POST',
        body: {
          serverId: id,
          relPath: editingFile.relPath,
          content: editingContent
        }
      });
      alert('File saved successfully.');
      setEditingFile(null);
      fetchFiles(currentRelPath);
    } catch (err) {
      alert(`Failed to save file: ${err.message}`);
    }
  };

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const folderPath = currentRelPath ? `${currentRelPath}/${newFolderName.trim()}` : newFolderName.trim();
    try {
      await apiRequest('/files/mkdir', {
        method: 'POST',
        body: { serverId: id, relPath: folderPath }
      });
      setNewFolderName('');
      fetchFiles(currentRelPath);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeletePath = async (filename) => {
    if (!confirm(`Are you sure you want to permanently delete "${filename}"?`)) return;
    const filePath = currentRelPath ? `${currentRelPath}/${filename}` : filename;
    try {
      await apiRequest('/files', {
        method: 'DELETE',
        body: { serverId: id, relPath: filePath }
      });
      fetchFiles(currentRelPath);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUploadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileRelPath = currentRelPath ? `${currentRelPath}/${file.name}` : file.name;
    const headers = {
      'serverid': id,
      'relpath': fileRelPath,
    };

    try {
      // Use raw streaming upload endpoint
      const response = await fetch(`${API_BASE_URL}/files/upload`, {
        method: 'POST',
        headers: {
          ...headers,
          'Authorization': `Bearer ${getToken()}`
        },
        body: file // Send file binary stream directly
      });

      if (!response.ok) throw new Error('Upload stream failed.');
      
      alert(`Successfully uploaded file: ${file.name}`);
      fetchFiles(currentRelPath);
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    }
  };

  const fetchOnlinePlayers = async () => {
    try {
      const data = await apiRequest(`/servers/${id}/players`);
      setOnlinePlayers(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const getMetricsLimit = (range) => {
    switch (range) {
      case '1m': return 2;
      case '30m': return 60;
      case '1h': return 120;
      default: return 60;
    }
  };

  const fetchMetrics = async (rangeVal) => {
    try {
      const activeRange = rangeVal || metricsRangeRef.current;
      const limit = getMetricsLimit(activeRange);
      const data = await apiRequest(`/servers/${id}/metrics?limit=${limit}`);
      setMetrics(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRangeChange = (newRange) => {
    metricsRangeRef.current = newRange;
    setMetricsRange(newRange);
    fetchMetrics(newRange);
  };

  const fetchServerConfig = async () => {
    try {
      const data = await apiRequest(`/servers/${id}/config-files/server.json`);
      setServerConfig(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveServerConfig = async (e) => {
    e.preventDefault();
    try {
      await apiRequest(`/servers/${id}/config-files/server.json`, {
        method: 'PUT',
        body: serverConfig
      });
      alert('Hytale server.json config saved successfully.');
    } catch (err) {
      alert(err.message);
    }
  };

  const fetchSchedules = async () => {
    try {
      const data = await apiRequest(`/servers/${id}/schedules`);
      setSchedules(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateOrUpdateSchedule = async (e) => {
    e.preventDefault();
    try {
      const body = {
        name: schedName.trim(),
        cron_expression: schedCron.trim(),
        action: schedAction,
        action_payload: schedPayload.trim()
      };
      
      if (editingSchedule) {
        await apiRequest(`/servers/${id}/schedules/${editingSchedule.id}`, {
          method: 'PATCH',
          body
        });
        alert('Schedule task updated successfully.');
      } else {
        await apiRequest(`/servers/${id}/schedules`, {
          method: 'POST',
          body
        });
        alert('Schedule task created successfully.');
      }
      
      setShowScheduleModal(false);
      setEditingSchedule(null);
      setSchedName('');
      setSchedCron('* * * * *');
      setSchedAction('restart');
      setSchedPayload('');
      fetchSchedules();
    } catch (err) {
      alert(err.message || 'Action failed.');
    }
  };

  const handleToggleSchedule = async (scheduleId, active) => {
    try {
      await apiRequest(`/servers/${id}/schedules/${scheduleId}`, {
        method: 'PATCH',
        body: { is_active: !active }
      });
      fetchSchedules();
    } catch (err) {
      alert(err.message || 'Toggle failed.');
    }
  };

  const handleDeleteSchedule = async (scheduleId) => {
    if (!confirm('Are you sure you want to delete this scheduled task?')) return;
    try {
      await apiRequest(`/servers/${id}/schedules/${scheduleId}`, {
        method: 'DELETE'
      });
      alert('Scheduled task deleted.');
      fetchSchedules();
    } catch (err) {
      alert(err.message || 'Deletion failed.');
    }
  };

  const renderSVGChart = (type) => {
    if (metrics.length === 0) {
      return <div style={{ color: 'var(--text-dark)', textAlign: 'center', padding: '32px' }}>No performance logs recorded yet.</div>;
    }

    const width = 500;
    const height = 150;
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
      color = '#10b981';
      fill = 'rgba(16, 185, 129, 0.1)';
      points = metrics.map((m, idx) => `${getX(idx)},${getY(m.cpu_percentage, maxVal)}`).join(' ');
    } else {
      const maxBytes = Math.max(...metrics.map(m => m.ram_bytes), 1024 * 1024 * 1024);
      maxVal = maxBytes;
      color = '#3b82f6';
      fill = 'rgba(59, 130, 246, 0.1)';
      points = metrics.map((m, idx) => `${getX(idx)},${getY(m.ram_bytes, maxVal)}`).join(' ');
    }

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%', display: 'block' }}>
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="rgba(255,255,255,0.05)" />
        <line x1={padding} y1={height/2} x2={width - padding} y2={height/2} stroke="rgba(255,255,255,0.05)" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.1)" />

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
          />
        )}

        <text x={padding} y={padding - 5} fill="var(--text-dark)" fontSize="9">
          {type === 'cpu' ? '100% CPU' : `${(maxVal / (1024*1024*1024)).toFixed(1)} GB RAM`}
        </text>
        <text x={padding} y={height - 2} fill="var(--text-dark)" fontSize="9">0</text>
      </svg>
    );
  };

  // MODS TAB API
  const fetchInstalledMods = async () => {
    try {
      const data = await apiRequest(`/mods/server/${id}`);
      setInstalledMods(data.mods || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchActiveDownloads = async () => {
    try {
      const data = await apiRequest(`/mods/server/${id}/downloads`);
      setActiveDownloads(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearchMods = async (e) => {
    e?.preventDefault();
    setSearchingRemote(true);
    try {
      const data = await apiRequest(`/mods/search?source=${modsSource}&q=${encodeURIComponent(modsSearchQuery)}`);
      setRemoteMods(data || []);
      setSelectedMod(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setSearchingRemote(false);
    }
  };

  const handleViewModDetails = async (mod) => {
    setSelectedMod(mod);
    setSelectedModFiles([]);
    try {
      const files = await apiRequest(`/mods/details/${mod.source}/${mod.id}/files`);
      setSelectedModFiles(files || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleInstallModFile = async (modFile) => {
    try {
      await apiRequest(`/mods/server/${id}/install`, {
        method: 'POST',
        body: {
          source: selectedMod.source,
          modId: selectedMod.id,
          fileId: modFile.id,
          downloadUrl: modFile.downloadUrl,
          fileName: modFile.fileName,
          sha1: modFile.hashes?.find(h => h.algo === 1)?.value || null
        }
      });
      alert(`Mod download for "${modFile.fileName}" started in the background.`);
      fetchActiveDownloads();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleMod = async (fileName) => {
    try {
      await apiRequest(`/mods/server/${id}/toggle`, {
        method: 'POST',
        body: { fileName }
      });
      fetchInstalledMods();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteMod = async (fileName) => {
    if (!confirm(`Are you sure you want to delete mod file "${fileName}"?`)) return;
    try {
      await apiRequest(`/mods/server/${id}`, {
        method: 'DELETE',
        body: { fileName }
      });
      fetchInstalledMods();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleScanConflicts = async () => {
    try {
      const data = await apiRequest(`/mods/server/${id}/scan`, { method: 'POST' });
      setConflictsList(data.conflicts || []);
      alert(`Mod Conflict Scan complete. Detected conflicts: ${data.conflictsCount}`);
      fetchInstalledMods(); // Refresh warning tags
    } catch (err) {
      alert(err.message);
    }
  };

  // BACKUPS TAB API
  const fetchBackups = async () => {
    try {
      const data = await apiRequest(`/servers/${id}/backups`);
      setBackups(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      await apiRequest(`/servers/${id}/backups`, { method: 'POST' });
      alert('Server profile backup archived successfully.');
      fetchBackups();
    } catch (err) {
      alert(`Backup failed: ${err.message}`);
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (fileName) => {
    if (!confirm('WARNING: Restoring a backup will overwrite current server files. Are you sure you want to proceed?')) return;
    try {
      await apiRequest(`/servers/${id}/backups/restore`, {
        method: 'POST',
        body: { backup_file: fileName }
      });
      alert('Server files restored from backup successfully.');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteBackup = async (fileName) => {
    if (!confirm(`Permanently delete backup file "${fileName}"?`)) return;
    try {
      await apiRequest(`/servers/${id}/backups`, {
        method: 'DELETE',
        body: { backup_file: fileName }
      });
      fetchBackups();
    } catch (err) {
      alert(err.message);
    }
  };

  // CONFIGURATION TAB API
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaveSettingsSuccess('');
    try {
      await apiRequest(`/servers/${id}`, {
        method: 'PATCH',
        body: {
          port: parseInt(port, 10),
          autostart: autostart ? 1 : 0,
          restart_policy: restartPolicy,
          restart_schedule: restartSchedule,
          webhook_url: webhookUrl,
          config_json: JSON.stringify({
            jvmArgs,
            whitelist: whitelistContent,
            bans: bansContent
          })
        }
      });
      setSaveSettingsSuccess('Configurations saved successfully.');
      fetchServerDetails();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteServer = async () => {
    if (server.status === 'running') {
      alert('Cannot delete a running server. Please stop the server first.');
      return;
    }

    const confirmMsg = `Are you sure you want to permanently delete the server profile "${server.name}"? This action removes database records and assigned user scopes. Disk files will remain safe in "${server.install_path}".`;
    if (!confirm(confirmMsg)) return;

    try {
      await apiRequest(`/servers/${id}`, {
        method: 'DELETE'
      });
      alert('Server profile deleted successfully.');
      navigate('/');
    } catch (err) {
      alert(`Deletion failed: ${err.message}`);
    }
  };

  // PLAYERS TAB SAVE
  const handleSavePlayers = async (e) => {
    e.preventDefault();
    setSavingPlayers(true);
    try {
      const configData = server.config_json ? JSON.parse(server.config_json) : {};
      await apiRequest(`/servers/${id}`, {
        method: 'PATCH',
        body: {
          port: server.port,
          autostart: server.autostart,
          restart_policy: server.restart_policy,
          restart_schedule: server.restart_schedule,
          webhook_url: server.webhook_url,
          config_json: JSON.stringify({
            ...configData,
            whitelist: whitelistContent,
            bans: bansContent
          })
        }
      });
      alert('Whitelist and Bans permissions files synchronized successfully.');
      fetchServerDetails();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingPlayers(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-dark)' }}>
        <p style={{ color: 'var(--text-muted)' }}>Retrieving server administration data...</p>
      </div>
    );
  }

  if (error || !server) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--bg-dark)' }}>
        <div className="badge badge-error" style={{ marginBottom: '16px' }}>Error Loading Server</div>
        <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>{error || 'Server profile not found.'}</p>
        <Link to="/" className="btn btn-secondary">Return to Dashboard</Link>
      </div>
    );
  }

  const isViewer = currentUser?.role === 'viewer';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-dark)' }}>
      {/* Header controls */}
      <header style={{
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        padding: '20px 32px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
              <Link to="/" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '13px' }}>&larr; Dashboard</Link>
              <span className={`badge ${server.status === 'running' ? 'badge-success' : server.status === 'stopped' ? 'badge-secondary' : 'badge-warning'}`}>
                <span className={`status-dot ${server.status === 'running' ? 'active' : server.status === 'stopped' ? 'stopped' : 'warning'}`}></span>
                {server.status}
              </span>
            </div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '26px', fontWeight: 'bold' }}>{server.name}</h2>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            {server.status === 'uninstalled' ? (
              <button 
                onClick={handleInstallServerFiles} 
                className="btn btn-success" 
                disabled={installingFiles}
                style={{ 
                  boxShadow: '0 0 12px var(--success-glow)'
                }}
              >
                {installingFiles ? 'Deploying Core Files...' : 'Install Hytale Server'}
              </button>
            ) : server.status === 'stopped' ? (
              <button onClick={() => handleServerAction('start')} className="btn btn-primary">Start Server</button>
            ) : (
              <>
                <button onClick={() => handleServerAction('stop')} className="btn btn-danger">Stop</button>
                <button onClick={() => handleServerAction('restart')} className="btn btn-secondary">Restart</button>
              </>
            )}
          </div>
        </div>

        {/* Tab Selection */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
          {['console', 'files', 'mods', 'backups', 'schedules', 'players', 'config'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="btn"
              style={{
                backgroundColor: activeTab === tab ? 'var(--primary-glow)' : 'transparent',
                borderColor: activeTab === tab ? 'var(--primary)' : 'transparent',
                color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)',
                padding: '6px 16px',
                fontSize: '13px',
                textTransform: 'capitalize'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {/* Tab Panels */}
      <main style={{ flex: 1, padding: '32px', maxWidth: '1200px', width: '100%', margin: '0 auto' }}>
        {server.status === 'uninstalled' && activeTab !== 'config' ? (
          <div className="glass-panel animate-fade-in" style={{
            padding: '48px 32px',
            textAlign: 'center',
            borderTop: '3px solid var(--primary)',
            boxShadow: 'var(--shadow-glow)',
            maxWidth: '600px',
            margin: '40px auto'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛠️</div>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '20px', fontWeight: '600', marginBottom: '8px' }}>
              Hytale Server files are not yet deployed
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px', lineHeight: '1.6' }}>
              This server is currently registered but has no game core files. Click the <strong>Install Hytale Server</strong> button in the top header to copy the server core files from the central cache.
            </p>
            <button 
              onClick={handleInstallServerFiles} 
              className="btn btn-success" 
              disabled={installingFiles}
              style={{
                boxShadow: '0 0 12px var(--success-glow)'
              }}
            >
              {installingFiles ? 'Deploying Core Files...' : 'Install Hytale Server'}
            </button>
          </div>
        ) : (
          <>
            {/* 1. CONSOLE TAB */}
            {activeTab === 'console' && (
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '24px', height: '600px' }}>
            {/* Log display */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px' }}>
              <div 
                ref={consoleContainerRef}
                onScroll={handleConsoleScroll}
                style={{
                  flex: 1,
                  backgroundColor: '#050608',
                  borderRadius: '8px',
                  padding: '16px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  overflowY: 'auto',
                  marginBottom: '16px',
                  border: '1px solid var(--border)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}
              >
                {logs.length === 0 ? (
                  <div style={{ color: 'var(--text-dark)' }}>Terminal listening for server stdout logs...</div>
                ) : (
                  logs.map((line, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        color: line.startsWith('>') 
                          ? 'var(--primary)' 
                          : line.includes('ERROR') || line.includes('Exception') 
                          ? 'var(--error)' 
                          : line.includes('WARN') 
                          ? 'var(--warning)' 
                          : 'var(--text-main)',
                        marginBottom: '4px'
                      }}
                    >
                      {renderLineWithLinks(line)}
                    </div>
                  ))
                )}
                <div ref={consoleBottomRef}></div>
              </div>

              <form onSubmit={handleSendCommand} style={{ display: 'flex', gap: '12px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={isViewer ? "Terminal is read-only (Viewer role)" : "Enter rcon/console command... (e.g. /help, /auth)"}
                    value={command}
                    onChange={handleCommandChange}
                    onKeyDown={handleCommandKeyDown}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    style={{ flex: 1, width: '100%' }}
                    disabled={server.status !== 'running' || isViewer}
                  />
                  
                  {showSuggestions && suggestions.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 8px)',
                      left: 0,
                      width: '100%',
                      backgroundColor: '#0b0c10',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      boxShadow: 'var(--shadow-glow)',
                      zIndex: 100,
                      maxHeight: '200px',
                      overflowY: 'auto',
                      padding: '4px'
                    }}>
                      {suggestions.map((sug, idx) => (
                        <div
                          key={sug}
                          onClick={() => {
                            setCommand(sug);
                            setSuggestions([]);
                            setShowSuggestions(false);
                          }}
                          style={{
                            padding: '8px 12px',
                            fontSize: '12px',
                            fontFamily: 'var(--font-mono)',
                            borderRadius: '6px',
                            backgroundColor: activeSuggestionIdx === idx ? 'var(--primary-glow)' : 'transparent',
                            color: activeSuggestionIdx === idx ? 'var(--primary)' : 'var(--text-main)',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span>{sug}</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-dark)' }}>
                            {activeSuggestionIdx === idx ? 'Press Tab' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button type="submit" className="btn btn-primary" disabled={server.status !== 'running' || isViewer}>
                  Send
                </button>
              </form>
            </div>

            {/* Classification sidebar */}
            <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              {/* Process Performance Charts */}
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '12px', fontWeight: 'bold', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                    Metrics ({metricsRange})
                  </h3>
                  <div style={{ display: 'flex', gap: '2px', backgroundColor: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    {['1m', '30m', '1h'].map((r) => (
                      <button
                        key={r}
                        onClick={() => handleRangeChange(r)}
                        style={{
                          padding: '2px 6px',
                          fontSize: '10px',
                          fontWeight: '600',
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: metricsRange === r ? 'var(--primary)' : 'transparent',
                          color: metricsRange === r ? '#000' : 'var(--text-dark)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ height: '75px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                    {renderSVGChart('cpu')}
                  </div>
                  <div style={{ height: '75px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                    {renderSVGChart('ram')}
                  </div>
                </div>
              </div>

              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '15px', fontWeight: 'bold', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '12px' }}>
                Crashed Logs & Issue Classifier
              </h3>

              {detectedIssues.length === 0 ? (
                <div style={{ color: 'var(--text-dark)', fontSize: '12px', textAlign: 'center', marginTop: '32px' }}>
                  No active exceptions caught. Server is booting healthy.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {detectedIssues.map((issue) => (
                    <div 
                      key={issue.id} 
                      style={{ 
                        border: '1px solid rgba(244, 63, 94, 0.2)', 
                        backgroundColor: 'rgba(244, 63, 94, 0.05)', 
                        borderRadius: '8px', 
                        padding: '12px', 
                        fontSize: '12px' 
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <strong style={{ color: 'var(--error)', textTransform: 'uppercase' }}>{issue.type}</strong>
                        <span className="badge badge-error" style={{ fontSize: '9px', padding: '1px 6px' }}>{issue.severity}</span>
                      </div>
                      <p style={{ color: 'var(--text-main)', marginBottom: '8px', fontFamily: 'var(--font-mono)', fontSize: '11px', overflowX: 'auto' }}>
                        {issue.line}
                      </p>
                      <div style={{ borderTop: '1px dashed rgba(244, 63, 94, 0.2)', paddingTop: '6px', color: 'var(--text-muted)' }}>
                        <strong>Solution:</strong> {issue.hint}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. FILES TAB */}
        {activeTab === 'files' && (
          <div className="glass-panel animate-fade-in" style={{ minHeight: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Location:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--primary)' }}>
                  / {currentRelPath || ''}
                </span>
                {currentRelPath && (
                  <button 
                    onClick={() => {
                      const parts = currentRelPath.split('/');
                      parts.pop();
                      setCurrentRelPath(parts.join('/'));
                    }} 
                    className="btn btn-secondary" 
                    style={{ padding: '2px 8px', fontSize: '11px', marginLeft: '12px' }}
                  >
                    Up &uarr;
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <form onSubmit={handleCreateFolder} style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={isViewer ? "Read-only" : "New Folder..."}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    style={{ padding: '6px 12px', fontSize: '13px' }}
                    disabled={isViewer}
                  />
                  <button type="submit" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px' }} disabled={isViewer}>Create</button>
                </form>

                <button onClick={() => fileInputRef.current?.click()} className="btn btn-accent" style={{ padding: '6px 12px', fontSize: '13px' }} disabled={isViewer}>
                  Upload File
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleUploadFile} 
                  style={{ display: 'none' }} 
                  disabled={isViewer}
                />
              </div>
            </div>

            {/* List directory files */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr', padding: '8px', color: 'var(--text-muted)', fontSize: '12px', borderBottom: '1px solid var(--border)', fontWeight: '600' }}>
                <div>Name</div>
                <div>Type</div>
                <div>Size</div>
                <div style={{ textAlign: 'right' }}>Actions</div>
              </div>

              {filesList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dark)', fontSize: '14px' }}>
                  Directory is empty.
                </div>
              ) : (
                filesList.map((file) => (
                  <div 
                    key={file.name} 
                    onClick={() => handleFileClick(file)}
                    style={{ 
                      display: 'grid', 
                      gridTemplateColumns: '3fr 1fr 1fr 1fr', 
                      padding: '12px 8px', 
                      borderRadius: '6px', 
                      cursor: 'pointer',
                      fontSize: '13px',
                      alignItems: 'center',
                      transition: 'background-color 0.2s'
                    }}
                    className="glass-card"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: file.isDir ? '600' : '400' }}>
                      <span>{file.isDir ? '📁' : '📄'}</span>
                      {file.name}
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>{file.isDir ? 'Folder' : 'File'}</div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      {file.isDir ? '-' : `${(file.size / 1024).toFixed(1)} KB`}
                    </div>
                    <div style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      {!file.isDir && (
                        <a 
                          href={`${API_BASE_URL}/files/download?serverId=${id}&relPath=${encodeURIComponent(currentRelPath ? `${currentRelPath}/${file.name}` : file.name)}&token=${getToken()}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '11px', marginRight: '6px', display: 'inline-block', textDecoration: 'none' }}
                        >
                          Download
                        </a>
                      )}
                      <button 
                        onClick={() => handleDeletePath(file.name)} 
                        className="btn btn-secondary" 
                        style={{ padding: '2px 8px', fontSize: '11px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                        disabled={isViewer}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* In-Browser Code File Editor Overlay */}
            {editingFile && (
              <div className="modal-overlay">
                <div className="modal-content" style={{ maxWidth: '800px', width: '90%' }}>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>
                    Edit File: {editingFile.name}
                  </h3>
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    style={{
                      width: '100%',
                      height: '400px',
                      backgroundColor: '#050608',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '16px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      resize: 'vertical',
                      outline: 'none',
                      marginBottom: '16px'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button onClick={() => setEditingFile(null)} className="btn btn-secondary">Cancel</button>
                    <button onClick={handleSaveFile} className="btn btn-primary" disabled={isViewer}>Save Changes</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. MODS TAB */}
        {activeTab === 'mods' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {/* Installed Server Mods */}
            <div className="glass-panel animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)' }}>Installed Mods</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Local mods in the server/mods folder.</p>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={handleScanConflicts} className="btn btn-accent" style={{ padding: '6px 12px', fontSize: '13px' }} disabled={isViewer}>
                    Scan for Conflicts
                  </button>
                </div>
              </div>

              {/* Active Downloads HUD */}
              {activeDownloads.length > 0 && (
                <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.05)', border: '1px solid var(--primary-border)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
                  <h4 style={{ fontSize: '13px', color: 'var(--primary)', fontWeight: 'bold', marginBottom: '12px' }}>Background Downloads progress</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {activeDownloads.map((dl) => (
                      <div key={dl.downloadId} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr 1fr', alignItems: 'center', gap: '16px', fontSize: '12px' }}>
                        <div>{dl.fileName}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ flex: 1, height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${dl.progress}%`, height: '100%', backgroundColor: 'var(--primary)' }}></div>
                          </div>
                          <span>{dl.progress}%</span>
                        </div>
                        <div style={{ color: dl.status === 'failed' ? 'var(--error)' : 'var(--text-muted)' }}>
                          {dl.status}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Installed List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', padding: '8px', color: 'var(--text-muted)', fontSize: '12px', borderBottom: '1px solid var(--border)', fontWeight: '600' }}>
                  <div>Mod Name</div>
                  <div>Enabled</div>
                  <div>Provider</div>
                  <div style={{ textAlign: 'right' }}>Actions</div>
                </div>

                {installedMods.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dark)', fontSize: '14px' }}>
                    No mods installed yet.
                  </div>
                ) : (
                  installedMods.map((mod) => (
                    <div 
                      key={mod.fileName} 
                      style={{ 
                        display: 'grid', 
                        gridTemplateColumns: '2fr 1fr 1fr 2fr', 
                        padding: '12px 8px', 
                        borderRadius: '6px',
                        fontSize: '13px',
                        alignItems: 'center',
                        borderLeft: mod.conflicts.length > 0 ? '3px solid var(--error)' : 'none'
                      }}
                      className="glass-card"
                    >
                      <div>
                        <div style={{ fontWeight: '600' }}>{mod.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-dark)', fontFamily: 'var(--font-mono)' }}>{mod.fileName}</div>
                        {mod.conflicts.map((conf, cIdx) => (
                          <div key={cIdx} style={{ color: 'var(--error)', fontSize: '11px', marginTop: '4px' }}>
                            ⚠ {conf.details}
                          </div>
                        ))}
                      </div>
                      <div>
                        <input 
                          type="checkbox"
                          checked={mod.isActive}
                          onChange={() => handleToggleMod(mod.fileName)}
                          disabled={isViewer}
                          style={{ cursor: isViewer ? 'not-allowed' : 'pointer', scale: '1.2', accentColor: 'var(--primary)' }}
                        />
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        <span className="badge badge-warning" style={{ fontSize: '10px', padding: '2px 8px' }}>
                          {mod.modId !== 'manual' ? 'curseforge' : 'manual'}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <button 
                          onClick={() => handleDeleteMod(mod.fileName)} 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 12px', fontSize: '12px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                          disabled={isViewer}
                        >
                          Uninstall
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Install New Mods Browser */}
            <div className="glass-panel animate-fade-in">
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '20px' }}>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', marginBottom: '12px' }}>Mod Marketplace Discovery</h3>
                
                <form onSubmit={handleSearchMods} style={{ display: 'flex', gap: '12px' }}>
                  <select
                    value={modsSource}
                    onChange={(e) => setModsSource(e.target.value)}
                    style={{
                      backgroundColor: 'var(--bg-dark)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border)',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '13px'
                    }}
                  >
                    <option value="curseforge">CurseForge (Auto Install)</option>
                    <option value="nexus">Nexus Mods (Manual Install Info)</option>
                  </select>

                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search mods feed... (e.g. essentials, pack)"
                    value={modsSearchQuery}
                    onChange={(e) => setModsSearchQuery(e.target.value)}
                    style={{ flex: 1 }}
                  />

                  <button type="submit" className="btn btn-primary" disabled={searchingRemote}>
                    {searchingRemote ? 'Searching...' : 'Search'}
                  </button>
                </form>
              </div>

              {/* Discovery results */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* Mod Cards List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '500px', overflowY: 'auto', paddingRight: '8px' }}>
                  {remoteMods.length === 0 ? (
                    <div style={{ color: 'var(--text-dark)', fontSize: '14px', padding: '16px', textAlign: 'center' }}>
                      Enter queries or select database repositories to search mods.
                    </div>
                  ) : (
                    remoteMods.map((mod) => (
                      <div 
                        key={mod.id} 
                        onClick={() => handleViewModDetails(mod)}
                        style={{ 
                          padding: '16px', 
                          display: 'flex', 
                          gap: '16px', 
                          cursor: 'pointer',
                          backgroundColor: selectedMod?.id === mod.id ? 'var(--bg-panel-active)' : 'var(--bg-panel)',
                          borderColor: selectedMod?.id === mod.id ? 'var(--primary)' : 'var(--border)'
                        }}
                        className="glass-card"
                      >
                        {mod.logoUrl && (
                          <img src={mod.logoUrl} alt={mod.name} style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <strong style={{ fontSize: '14px' }}>{mod.name}</strong>
                          </div>
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {mod.summary}
                          </p>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dark)', marginTop: '8px' }}>
                            <span>By: {mod.author}</span>
                            <span>Downloads: {mod.downloads.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Mod Files Inspector Panel */}
                <div className="glass-panel" style={{ backgroundColor: 'rgba(9, 10, 15, 0.4)', minHeight: '300px' }}>
                  {selectedMod ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                        <h4 style={{ fontSize: '16px', color: 'var(--primary)' }}>{selectedMod.name}</h4>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Source: <strong style={{ textTransform: 'capitalize' }}>{selectedMod.source}</strong> | Category: {selectedMod.category}
                        </div>
                      </div>

                      <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{selectedMod.description || selectedMod.summary}</p>

                      <div>
                        <h5 style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: '8px' }}>Available Files / Versions</h5>
                        {selectedMod.source === 'nexus' && (
                          <div className="badge badge-warning" style={{ width: '100%', marginBottom: '12px', justifyContent: 'center' }}>
                            ⚠ Nexus Mods installs are blocked. Manual install instructions only.
                          </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                          {selectedModFiles.length === 0 ? (
                            <div style={{ color: 'var(--text-dark)', fontSize: '11px' }}>Loading files feed...</div>
                          ) : (
                            selectedModFiles.map((file) => (
                              <div key={file.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--bg-panel)', fontSize: '12px' }}>
                                <div>
                                  <div style={{ fontWeight: '600' }}>{file.displayName}</div>
                                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{file.fileName} ({(file.fileLength / (1024 * 1024)).toFixed(2)} MB)</div>
                                </div>
                                
                                {selectedMod.source === 'nexus' ? (
                                  <a href={file.downloadUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', textDecoration: 'none' }}>
                                    External Page
                                  </a>
                                ) : (
                                  <button onClick={() => handleInstallModFile(file)} className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '11px' }} disabled={isViewer}>
                                    Install
                                  </button>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-dark)', fontSize: '13px', textAlign: 'center', marginTop: '128px' }}>
                      Select a mod card from the left search list to install or view files.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. BACKUPS TAB */}
        {activeTab === 'backups' && (
          <div className="glass-panel animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)' }}>System Profile Backups</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Create and restore complete ZIP snapshots of the active server folder.</p>
              </div>
              <button 
              onClick={handleCreateBackup} 
              className="btn btn-primary"
              disabled={creatingBackup || isViewer}
            >
              {creatingBackup ? 'Creating Backup...' : 'Create Backup'}
            </button>
            </div>

            {/* Backups List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '8px', color: 'var(--text-muted)', fontSize: '12px', borderBottom: '1px solid var(--border)', fontWeight: '600' }}>
                <div>Archive File Name</div>
                <div>Created At</div>
                <div>Size</div>
                <div style={{ textAlign: 'right' }}>Actions</div>
              </div>

              {backups.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dark)', fontSize: '14px' }}>
                  No backup archives found.
                </div>
              ) : (
                backups.map((bak) => (
                  <div 
                    key={bak.fileName} 
                    style={{ 
                      display: 'grid', 
                      gridTemplateColumns: '2fr 1fr 1fr 1fr', 
                      padding: '12px 8px', 
                      borderRadius: '6px',
                      fontSize: '13px',
                      alignItems: 'center'
                    }}
                    className="glass-card"
                  >
                    <div style={{ fontWeight: '500', fontFamily: 'var(--font-mono)' }}>{bak.fileName}</div>
                    <div style={{ color: 'var(--text-muted)' }}>{bak.createdAt}</div>
                    <div style={{ color: 'var(--text-muted)' }}>{(bak.sizeBytes / (1024 * 1024)).toFixed(2)} MB</div>
                    <div style={{ textAlign: 'right' }}>
                      <button 
                        onClick={() => handleRestoreBackup(bak.fileName)} 
                        className="btn btn-accent" 
                        style={{ padding: '4px 12px', fontSize: '12px', marginRight: '8px' }}
                        disabled={isViewer}
                      >
                        Restore
                      </button>
                      <button 
                        onClick={() => handleDeleteBackup(bak.fileName)} 
                        className="btn btn-secondary" 
                        style={{ padding: '4px 12px', fontSize: '12px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                        disabled={isViewer}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
   
          {/* 4.5 SCHEDULES TAB */}
          {activeTab === 'schedules' && (
            <div className="glass-panel animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)' }}>Automation Task Scheduler</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Configure standard 5-field cron intervals to automate restarts, backups, or console command scripts.</p>
                </div>
                <button 
                  onClick={() => {
                    setEditingSchedule(null);
                    setSchedName('');
                    setSchedCron('* * * * *');
                    setSchedAction('restart');
                    setSchedPayload('');
                    setShowScheduleModal(true);
                  }} 
                  className="btn btn-primary"
                  disabled={isViewer}
                >
                  Create Scheduled Task
                </button>
              </div>
  
              {/* Schedules Grid */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 1fr', padding: '8px', color: 'var(--text-muted)', fontSize: '12px', borderBottom: '1px solid var(--border)', fontWeight: '600' }}>
                  <div>Task Name</div>
                  <div>Action</div>
                  <div>Cron Expression</div>
                  <div>Status</div>
                  <div style={{ textAlign: 'right' }}>Actions</div>
                </div>
  
                {schedules.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dark)', fontSize: '14px' }}>
                    No active scheduled tasks configured.
                  </div>
                ) : (
                  schedules.map((sched) => (
                    <div 
                      key={sched.id} 
                      style={{ 
                        display: 'grid', 
                        gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 1fr', 
                        padding: '12px 8px', 
                        borderRadius: '6px',
                        fontSize: '13px',
                        alignItems: 'center',
                        opacity: sched.is_active ? 1 : 0.6
                      }}
                      className="glass-card"
                    >
                      <div>
                        <strong style={{ color: 'var(--text-main)' }}>{sched.name}</strong>
                      </div>
                      <div>
                        <span className="badge badge-accent" style={{ textTransform: 'capitalize' }}>
                          {sched.action} {sched.action_payload ? `(${sched.action_payload})` : ''}
                        </span>
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>{sched.cron_expression}</div>
                      <div>
                        <input 
                          type="checkbox"
                          checked={sched.is_active}
                          disabled={isViewer}
                          onChange={() => handleToggleSchedule(sched.id, sched.is_active)}
                          style={{ cursor: isViewer ? 'not-allowed' : 'pointer', scale: '1.2', accentColor: 'var(--primary)' }}
                        />
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <button 
                          onClick={() => {
                            setEditingSchedule(sched);
                            setSchedName(sched.name);
                            setSchedCron(sched.cron_expression);
                            setSchedAction(sched.action);
                            setSchedPayload(sched.action_payload || '');
                            setShowScheduleModal(true);
                          }} 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 10px', fontSize: '12px', marginRight: '6px' }}
                          disabled={isViewer}
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteSchedule(sched.id)} 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 10px', fontSize: '12px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                          disabled={isViewer}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        {/* 5. PLAYERS TAB */}
        {activeTab === 'players' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {/* Active Players HUD */}
            <div className="glass-panel animate-fade-in" style={{ marginBottom: '-16px' }}>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '20px' }}>
                Active Online Players
              </h3>
              {onlinePlayers.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                  No players currently online. The panel polls the active Hytale console session every 90 seconds.
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {onlinePlayers.map((player) => (
                    <div 
                      key={player} 
                      style={{ 
                        backgroundColor: 'var(--bg-panel-hover)', 
                        border: '1px solid var(--border)', 
                        borderRadius: '8px', 
                        padding: '10px 16px', 
                        fontSize: '14px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '10px' 
                      }}
                    >
                      <span className="status-dot active"></span>
                      <strong style={{ color: 'var(--text-main)' }}>{player}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Whitelist and Bans Editors */}
            <div className="glass-panel animate-fade-in">
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '24px' }}>
                Player Access Permissions
              </h3>

              <form onSubmit={handleSavePlayers}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginBottom: '24px' }}>
                  <div className="form-group">
                    <label className="form-label">Whitelist Configuration</label>
                    <span style={{ fontSize: '12px', color: 'var(--text-dark)', marginBottom: '4px' }}>Enter whitelisted player names (one per line)</span>
                    <textarea
                      value={whitelistContent}
                      onChange={(e) => setWhitelistContent(e.target.value)}
                      disabled={isViewer}
                      style={{
                        height: '250px',
                        backgroundColor: '#050608',
                        color: 'var(--text-main)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        resize: 'none',
                        outline: 'none',
                        cursor: isViewer ? 'not-allowed' : 'default'
                      }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Banned Players list</label>
                    <span style={{ fontSize: '12px', color: 'var(--text-dark)', marginBottom: '4px' }}>Enter banned player names (one per line)</span>
                    <textarea
                      value={bansContent}
                      onChange={(e) => setBansContent(e.target.value)}
                      disabled={isViewer}
                      style={{
                        height: '250px',
                        backgroundColor: '#050608',
                        color: 'var(--text-main)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        resize: 'none',
                        outline: 'none',
                        cursor: isViewer ? 'not-allowed' : 'default'
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" disabled={savingPlayers || isViewer}>
                    {savingPlayers ? 'Syncing...' : 'Save Permissions'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 6. CONFIG TAB */}
        {activeTab === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '1200px', width: '100%' }}>
            <div className="glass-panel animate-fade-in" style={{ display: 'flex', gap: '32px' }}>
            
            {/* Left Column: Instance Parameters */}
            <div style={{ flex: 1 }}>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '24px' }}>
                Instance Configuration
              </h3>

              {saveSettingsSuccess && (
                <div style={{ backgroundColor: 'var(--success-glow)', color: 'var(--success)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', padding: '12px', fontSize: '13px', marginBottom: '20px' }}>
                  {saveSettingsSuccess}
                </div>
              )}

              <form onSubmit={handleSaveSettings}>
                <div className="form-group">
                  <label className="form-label">Server Port</label>
                  <input
                    type="number"
                    className="form-input"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    disabled={isViewer}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">JVM Execution Arguments</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. -Xms2G -Xmx2G"
                    value={jvmArgs}
                    onChange={(e) => setJvmArgs(e.target.value)}
                    disabled={isViewer}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>Injects memory allocations and garbage collectors. Default is 2G.</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Restart Policy</label>
                  <select
                    value={restartPolicy}
                    onChange={(e) => setRestartPolicy(e.target.value)}
                    disabled={isViewer}
                    style={{
                      backgroundColor: 'var(--bg-dark)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border)',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      width: '100%',
                      cursor: isViewer ? 'not-allowed' : 'default'
                    }}
                  >
                    <option value="never">Never (Manual stop/start only)</option>
                    <option value="always">Always restart (On unexpected crashes or panel boots)</option>
                    <option value="on-failure">On Failure only</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Scheduled Restart (Cron Format)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 0 4 * * * (daily 4 AM restart)"
                    value={restartSchedule}
                    onChange={(e) => setRestartSchedule(e.target.value)}
                    disabled={isViewer}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>Enter standard 5-field cron statement or leave empty.</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Status Webhook Integration URL</label>
                  <input
                    type="url"
                    className="form-input"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    disabled={isViewer}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>Posts server offline, crash alerts and startups to external discord logs.</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
                  <input
                    type="checkbox"
                    id="autostart"
                    checked={autostart}
                    onChange={(e) => setAutostart(e.target.checked)}
                    disabled={isViewer}
                    style={{ cursor: isViewer ? 'not-allowed' : 'pointer', accentColor: 'var(--primary)' }}
                  />
                  <label htmlFor="autostart" style={{ fontSize: '14px', color: 'var(--text-muted)', cursor: isViewer ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
                    Enable automatic startup on panel boot
                  </label>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={isViewer}>
                  Save Configurations
                </button>
              </form>
            </div>

            {/* Right Column: Visual Configuration Manager Form (Hytale JSON Editor) */}
            <div style={{ flex: 1, borderLeft: '1px solid var(--border)', paddingLeft: '32px' }}>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '24px' }}>
                Hytale Configuration (server.json)
              </h3>

              {serverConfig ? (
                <form onSubmit={handleSaveServerConfig}>
                  <div className="form-group">
                    <label className="form-label">Server Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={serverConfig.serverName || ''}
                      onChange={(e) => setServerConfig({ ...serverConfig, serverName: e.target.value })}
                      disabled={isViewer}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input
                      type="text"
                      className="form-input"
                      value={serverConfig.description || ''}
                      onChange={(e) => setServerConfig({ ...serverConfig, description: e.target.value })}
                      disabled={isViewer}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Max Players</label>
                    <input
                      type="number"
                      className="form-input"
                      value={serverConfig.maxPlayers || 20}
                      onChange={(e) => setServerConfig({ ...serverConfig, maxPlayers: parseInt(e.target.value, 10) || 0 })}
                      disabled={isViewer}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Bind Address</label>
                    <input
                      type="text"
                      className="form-input"
                      value={serverConfig.bindAddress || '0.0.0.0'}
                      onChange={(e) => setServerConfig({ ...serverConfig, bindAddress: e.target.value })}
                      disabled={isViewer}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <input
                      type="checkbox"
                      id="whitelistEnabled"
                      checked={serverConfig.whitelistEnabled || false}
                      onChange={(e) => setServerConfig({ ...serverConfig, whitelistEnabled: e.target.checked })}
                      disabled={isViewer}
                      style={{ cursor: isViewer ? 'not-allowed' : 'pointer', accentColor: 'var(--primary)' }}
                    />
                    <label htmlFor="whitelistEnabled" style={{ fontSize: '14px', color: 'var(--text-muted)', cursor: isViewer ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
                      Enable Whitelist Control
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
                    <input
                      type="checkbox"
                      id="announceToMasterServer"
                      checked={serverConfig.announceToMasterServer || false}
                      onChange={(e) => setServerConfig({ ...serverConfig, announceToMasterServer: e.target.checked })}
                      disabled={isViewer}
                      style={{ cursor: isViewer ? 'not-allowed' : 'pointer', accentColor: 'var(--primary)' }}
                    />
                    <label htmlFor="announceToMasterServer" style={{ fontSize: '14px', color: 'var(--text-muted)', cursor: isViewer ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
                      Announce to Hytale Master Directory
                    </label>
                  </div>

                  <button type="submit" className="btn btn-accent" style={{ width: '100%' }} disabled={isViewer}>
                    Save server.json Configuration
                  </button>
                </form>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dark)' }}>
                  Loading Hytale configuration...
                </div>
              )}
            </div>

          </div>

          {/* Danger Zone Panel (Admin Only) */}
          {currentUser?.role === 'admin' && (
            <div className="glass-panel animate-fade-in" style={{ borderColor: 'rgba(244, 63, 94, 0.3)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--error)', borderBottom: '1px solid rgba(244, 63, 94, 0.15)', paddingBottom: '12px', margin: 0 }}>
                Danger Zone
              </h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ color: 'var(--text-main)', fontSize: '14px' }}>Delete Server Profile</strong>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0 0' }}>
                    Permanently delete this server profile from the database. The server directory and files on disk will be preserved for security.
                  </p>
                </div>
                <button 
                  onClick={handleDeleteServer}
                  className="btn btn-secondary" 
                  style={{ padding: '8px 20px', borderColor: 'rgba(244, 63, 94, 0.5)', color: 'var(--error)', fontWeight: '600' }}
                >
                  Delete Server
                </button>
              </div>
            </div>
          )}
        </div>
      )}
          </>
        )}

      </main>

      {/* Create / Edit Schedule Modal Overlay */}
      {showScheduleModal && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-content" style={{ maxWidth: '500px', width: '90%' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: 'bold', marginBottom: '16px', color: 'var(--primary)' }}>
              {editingSchedule ? 'Edit Scheduled Task' : 'Create Scheduled Task'}
            </h3>

            <form onSubmit={handleCreateOrUpdateSchedule}>
              <div className="form-group">
                <label className="form-label">Task Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Daily Nightly Restart"
                  value={schedName}
                  onChange={(e) => setSchedName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Cron Expression (5-field)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 0 4 * * * (daily 4 AM)"
                  value={schedCron}
                  onChange={(e) => setSchedCron(e.target.value)}
                  required
                />
                <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>Format: minute hour day-of-month month day-of-week</span>
              </div>

              <div className="form-group">
                <label className="form-label">Action Target</label>
                <select
                  value={schedAction}
                  onChange={(e) => setSchedAction(e.target.value)}
                  style={{
                    backgroundColor: 'var(--bg-dark)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    width: '100%'
                  }}
                >
                  <option value="restart">Restart Server Gracefully</option>
                  <option value="backup">Create System Backup Profile</option>
                  <option value="command">Execute Console Command script</option>
                </select>
              </div>

              {schedAction === 'command' && (
                <div className="form-group animate-fade-in">
                  <label className="form-label">Console Command payload</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. say Server restarting in 5 minutes!"
                    value={schedPayload}
                    onChange={(e) => setSchedPayload(e.target.value)}
                    required
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>The raw command to inject into stdout terminal console.</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button 
                  type="button" 
                  onClick={() => setShowScheduleModal(false)} 
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                >
                  {editingSchedule ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
