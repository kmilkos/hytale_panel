import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiRequest, API_BASE_URL, WS_BASE_URL, getToken, getUser } from '../utils/api';
import { showConfirm, showModDeleteConfirm } from '../utils/confirm';
import { showError } from '../utils/errorModal';

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

  // Interactive Schedules Pickers States
  const [schedModalMode, setSchedModalMode] = useState('simple'); // 'simple' | 'advanced'
  const [simpleSchedFreq, setSimpleSchedFreq] = useState('daily'); // 'hourly' | 'everyXHours' | 'daily' | 'weekly' | 'interval'
  const [simpleSchedMinute, setSimpleSchedMinute] = useState(0);
  const [simpleSchedHourStep, setSimpleSchedHourStep] = useState(12);
  const [simpleSchedDailyTime, setSimpleSchedDailyTime] = useState('04:00');
  const [simpleSchedWeeklyDay, setSimpleSchedWeeklyDay] = useState(1); // 1 = Monday
  const [simpleSchedWeeklyTime, setSimpleSchedWeeklyTime] = useState('04:00');
  const [simpleSchedIntervalMin, setSimpleSchedIntervalMin] = useState(15);

  // Live crontab explainer logic
  const explainCron = (cron) => {
    if (!cron) return 'Please specify a cron expression.';
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) return 'Invalid cron expression. Requires exactly 5 fields.';
    
    const [min, hour, dom, month, dow] = fields;
    
    const parseField = (field) => {
      if (field === '*') return { type: 'any' };
      if (field.startsWith('*/')) {
        const step = parseInt(field.split('/')[1], 10);
        return { type: 'step', step };
      }
      if (field.includes(',')) {
        return { type: 'list', values: field.split(',') };
      }
      if (field.includes('-')) {
        const [start, end] = field.split('-');
        return { type: 'range', start: parseInt(start, 10), end: parseInt(end, 10) };
      }
      const val = parseInt(field, 10);
      return { type: 'value', value: val };
    };

    const parsedMin = parseField(min);
    const parsedHour = parseField(hour);
    const parsedDom = parseField(dom);
    const parsedMonth = parseField(month);
    const parsedDow = parseField(dow);

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Case 1: Every minute
    if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return 'Runs every single minute.';
    }

    // Case 2: Every X minutes
    if (parsedMin.type === 'step' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return `Runs every ${parsedMin.step} minutes.`;
    }

    // Case 3: Every hour at minute Y
    if (parsedMin.type === 'value' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      const padMin = String(parsedMin.value).padStart(2, '0');
      return `Runs every hour at minute ${padMin}.`;
    }

    // Case 4: Every X hours at minute Y
    if (parsedMin.type === 'value' && parsedHour.type === 'step' && dom === '*' && month === '*' && dow === '*') {
      const padMin = String(parsedMin.value).padStart(2, '0');
      return `Runs every ${parsedHour.step} hours at minute ${padMin}.`;
    }

    // Case 5: Daily at HH:MM
    if (parsedMin.type === 'value' && parsedHour.type === 'value' && dom === '*' && month === '*' && dow === '*') {
      const hh = String(parsedHour.value).padStart(2, '0');
      const mm = String(parsedMin.value).padStart(2, '0');
      return `Runs daily at ${hh}:${mm}.`;
    }

    // Case 6: Weekly on DayOfWeek at HH:MM
    if (parsedMin.type === 'value' && parsedHour.type === 'value' && dom === '*' && month === '*' && parsedDow.type === 'value') {
      const hh = String(parsedHour.value).padStart(2, '0');
      const mm = String(parsedMin.value).padStart(2, '0');
      const day = daysOfWeek[parsedDow.value] || `Day ${parsedDow.value}`;
      return `Runs weekly on ${day} at ${hh}:${mm}.`;
    }

    // Case 7: Basic generic representation for custom expressions
    let desc = 'Runs at schedule: ';
    if (min === '*') desc += 'every minute';
    else if (parsedMin.type === 'step') desc += `every ${parsedMin.step} minutes`;
    else desc += `at minute ${min}`;

    if (hour === '*') desc += ', every hour';
    else if (parsedHour.type === 'step') desc += `, every ${parsedHour.step} hours`;
    else desc += `, at hour ${hour}`;

    if (dom !== '*') desc += `, on day of month ${dom}`;
    if (month !== '*') desc += `, in month ${month}`;
    if (dow !== '*') {
      const dayNames = dow.split(',').map(d => {
        const dNum = parseInt(d, 10);
        return daysOfWeek[dNum] || `Day ${d}`;
      }).join(', ');
      desc += `, on ${dayNames}`;
    }
    
    return desc + '.';
  };

  // Compile Simple Picker states to a valid 5-field cron string
  useEffect(() => {
    if (schedModalMode !== 'simple') return;

    let expression = '* * * * *';
    if (simpleSchedFreq === 'hourly') {
      expression = `${simpleSchedMinute} * * * *`;
    } else if (simpleSchedFreq === 'everyXHours') {
      expression = `${simpleSchedMinute} */${simpleSchedHourStep} * * *`;
    } else if (simpleSchedFreq === 'daily') {
      const [h, m] = simpleSchedDailyTime.split(':');
      const minVal = parseInt(m, 10) || 0;
      const hourVal = parseInt(h, 10) || 0;
      expression = `${minVal} ${hourVal} * * *`;
    } else if (simpleSchedFreq === 'weekly') {
      const [h, m] = simpleSchedWeeklyTime.split(':');
      const minVal = parseInt(m, 10) || 0;
      const hourVal = parseInt(h, 10) || 0;
      expression = `${minVal} ${hourVal} * * ${simpleSchedWeeklyDay}`;
    } else if (simpleSchedFreq === 'interval') {
      expression = `*/${simpleSchedIntervalMin} * * * *`;
    }

    setSchedCron(expression);
  }, [
    schedModalMode,
    simpleSchedFreq,
    simpleSchedMinute,
    simpleSchedHourStep,
    simpleSchedDailyTime,
    simpleSchedWeeklyDay,
    simpleSchedWeeklyTime,
    simpleSchedIntervalMin
  ]);
  
  // Tab Navigation State: 'console' | 'files' | 'mods' | 'backups' | 'schedules' | 'players' | 'config'
  const [activeTab, setActiveTab] = useState('console');

  // 1. Console Tab State
  const [logs, setLogs] = useState([]);
  const [command, setCommand] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [commandHistory, setCommandHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('hytale_console_history');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);

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

  const COMMAND_METADATA = {
    '/auth status': {
      description: 'Check current OAuth2 authentication status and browser verification links.',
      usage: '/auth status',
      options: []
    },
    '/auth login': {
      description: 'Trigger the OAuth2 authentication login flow.',
      usage: '/auth login',
      options: []
    },
    '/auth select': {
      description: 'Select an active authenticated profile for the server.',
      usage: '/auth select <profile_name>',
      options: [
        { name: '<profile_name>', desc: 'The name of the authentication profile to select.' }
      ]
    },
    '/auth logout': {
      description: 'Log out from the current Hytale authentication account.',
      usage: '/auth logout',
      options: []
    },
    '/auth cancel': {
      description: 'Cancel any ongoing OAuth2 authentication flow.',
      usage: '/auth cancel',
      options: []
    },
    '/auth persistence': {
      description: 'Configure session persistence behavior.',
      usage: '/auth persistence <true|false>',
      options: [
        { name: '<true|false>', desc: 'Set whether to persist credentials across restarts.' }
      ]
    },
    '/ban': {
      description: 'Bans a player from entering the server.',
      usage: '/ban <username> [--duration <time>] [--reason <reason>]',
      options: [
        { name: '<username>', desc: 'The username of the player to ban.' },
        { name: '--duration <time>', desc: 'Optional length of the ban (e.g., 7d, 24h).' },
        { name: '--reason <reason>', desc: 'Optional explanation for the ban.' }
      ]
    },
    '/gamemode adventure': {
      description: 'Set target player\'s game mode to Adventure.',
      usage: '/gamemode adventure [<player>]',
      options: [
        { name: '[<player>]', desc: 'Optional target player name (defaults to self).' }
      ]
    },
    '/gamemode creative': {
      description: 'Set target player\'s game mode to Creative.',
      usage: '/gamemode creative [<player>]',
      options: [
        { name: '[<player>]', desc: 'Optional target player name (defaults to self).' }
      ]
    },
    '/gamemode survival': {
      description: 'Set target player\'s game mode to Survival.',
      usage: '/gamemode survival [<player>]',
      options: [
        { name: '[<player>]', desc: 'Optional target player name (defaults to self).' }
      ]
    },
    '/gamemode spectator': {
      description: 'Set target player\'s game mode to Spectator.',
      usage: '/gamemode spectator [<player>]',
      options: [
        { name: '[<player>]', desc: 'Optional target player name (defaults to self).' }
      ]
    },
    '/heal': {
      description: 'Refills stamina, health, and player vitals to maximum levels.',
      usage: '/heal [<player>]',
      options: [
        { name: '[<player>]', desc: 'Optional target player name to heal.' }
      ]
    },
    '/help': {
      description: 'Displays list of available console commands and options.',
      usage: '/help',
      options: []
    },
    '/hide': {
      description: 'Hides or shows players to others (vanish mode).',
      usage: '/hide [<player>] [on|off]',
      options: [
        { name: '[<player>]', desc: 'Optional target player name.' },
        { name: '[on|off]', desc: 'Turn vanish mode on or off.' }
      ]
    },
    '/inventory': {
      description: 'Manage active players item inventories (clear, view, give).',
      usage: '/inventory <clear|view|give> <player> [<item>] [<amount>]',
      options: [
        { name: '<clear|view|give>', desc: 'The action to perform on the inventory.' },
        { name: '<player>', desc: 'The target player name.' },
        { name: '[<item>]', desc: 'The item ID to give (only for "give").' },
        { name: '[<amount>]', desc: 'The item quantity (only for "give").' }
      ]
    },
    '/kick': {
      description: 'Disconnects an active player with a specified reason.',
      usage: '/kick <username> [<reason>]',
      options: [
        { name: '<username>', desc: 'The username of the player to kick.' },
        { name: '[<reason>]', desc: 'Optional kick explanation.' }
      ]
    },
    '/kill': {
      description: 'Kills the target player and triggers standard respawning.',
      usage: '/kill [<player>]',
      options: [
        { name: '[<player>]', desc: 'Optional target player name to kill.' }
      ]
    },
    '/maxplayers': {
      description: 'Overrides maximum server slot capacities temporarily or persistently.',
      usage: '/maxplayers <slots> [--persist]',
      options: [
        { name: '<slots>', desc: 'The number of player slots allowed.' },
        { name: '--persist', desc: 'Optional flag to persist setting in server.json.' }
      ]
    },
    '/op self': {
      description: 'Grant administrator/operator permissions to yourself.',
      usage: '/op self',
      options: []
    },
    '/op add': {
      description: 'Grant operator status and admin commands permission to a player.',
      usage: '/op add <player>',
      options: [
        { name: '<player>', desc: 'The player username to grant op permissions.' }
      ]
    },
    '/op remove': {
      description: 'Revoke operator status and admin permissions from a player.',
      usage: '/op remove <player>',
      options: [
        { name: '<player>', desc: 'The player username to revoke op permissions.' }
      ]
    },
    '/refer': {
      description: 'Refers/redirects players to another cluster host or port.',
      usage: '/refer <host> <port> [--force]',
      options: [
        { name: '<host>', desc: 'The host name or IP address of the target server.' },
        { name: '<port>', desc: 'The port of the target server.' },
        { name: '--force', desc: 'Optional flag to redirect players immediately.' }
      ]
    },
    '/spawning': {
      description: 'Manage NPC spawning, global spawners, or toggle entity spawns.',
      usage: '/spawning <enable|disable|spawn> [<entity_id>]',
      options: [
        { name: '<enable|disable|spawn>', desc: 'Spawner control action.' },
        { name: '[<entity_id>]', desc: 'Optional specific Hytale entity ID.' }
      ]
    },
    '/stop': {
      description: 'Stops the active server process gracefully.',
      usage: '/stop [--save] [--graceful <seconds>]',
      options: [
        { name: '--save', desc: 'Force world state save before shutting down.' },
        { name: '--graceful <seconds>', desc: 'Countdown delay before process termination.' }
      ]
    },
    '/tp': {
      description: 'Teleports target players to absolute x, y, z coordinates.',
      usage: '/tp <player> <x> <y> <z>',
      options: [
        { name: '<player>', desc: 'Target player username.' },
        { name: '<x> <y> <z>', desc: 'Target coordinates.' }
      ]
    },
    '/unban': {
      description: 'Removes a player\'s active ban by username or IP address.',
      usage: '/unban <username>',
      options: [
        { name: '<username>', desc: 'The username of the player to unban.' }
      ]
    }
  };

  const getActiveCommandHelp = (cmdText) => {
    const trimmed = cmdText.trim();
    if (!trimmed) return null;
    
    // Sort keys by length descending to match the most specific command first
    const keys = Object.keys(COMMAND_METADATA).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (trimmed.toLowerCase().startsWith(key.toLowerCase())) {
        return { key, ...COMMAND_METADATA[key] };
      }
    }
    return null;
  };

  const [detectedIssues, setDetectedIssues] = useState([]);
  const consoleBottomRef = useRef(null);
  const consoleContainerRef = useRef(null);
  const isAutoScrollRef = useRef(true);
  const [metricsRange, setMetricsRange] = useState('30m');
  const metricsRangeRef = useRef('30m');
  const wsRef = useRef(null);
  const isMountedRef = useRef(true);

  // 2. Files Tab State
  const [currentRelPath, setCurrentRelPath] = useState('');
  const [filesList, setFilesList] = useState([]);
  const [editingFile, setEditingFile] = useState(null); // { relPath, content }
  const [editingContent, setEditingContent] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const fileInputRef = useRef(null);

  // 3. Mods Tab State
  const modFileInputRef = useRef(null);
  const [installedMods, setInstalledMods] = useState([]);
  const [modsSearchQuery, setModsSearchQuery] = useState('');
  const [modsSource, setModsSource] = useState('curseforge'); // 'curseforge' | 'nexus'
  const [remoteMods, setRemoteMods] = useState([]);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [selectedMod, setSelectedMod] = useState(null);
  const [selectedModFiles, setSelectedModFiles] = useState([]);
  const [conflictsList, setConflictsList] = useState([]);
  const [activeDownloads, setActiveDownloads] = useState([]);
  const [expandedModConfigs, setExpandedModConfigs] = useState({});
  const [modConfigsList, setModConfigsList] = useState({});
  const [fetchingConfigs, setFetchingConfigs] = useState({});
  const [modUpdates, setModUpdates] = useState({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingMods, setUpdatingMods] = useState({});
  const [selectedInstalledMod, setSelectedInstalledMod] = useState(null);
  const [selectedInstalledModDetails, setSelectedInstalledModDetails] = useState(null);
  const [loadingInstalledModDetails, setLoadingInstalledModDetails] = useState(false);
  const [modsSortBy, setModsSortBy] = useState('featured');
  const [remoteSearchError, setRemoteSearchError] = useState(null);
  const [modsSubTab, setModsSubTab] = useState('installed'); // 'installed' | 'marketplace'

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
  const [serverType, setServerType] = useState('Survival');
  const [serverVersion, setServerVersion] = useState('Use Global Default');
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState('');

  // 6. Players Tab State
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [playerHistory, setPlayerHistory] = useState([]);
  const [whitelistContent, setWhitelistContent] = useState('');
  const [bansContent, setBansContent] = useState('');
  const [savingPlayers, setSavingPlayers] = useState(false);
  const [whitelistArray, setWhitelistArray] = useState([]);
  const [bansArray, setBansArray] = useState([]);
  const [playerStats, setPlayerStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsSearchQuery, setStatsSearchQuery] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyEventFilter, setHistoryEventFilter] = useState('all');
  const [newWhitelistName, setNewWhitelistName] = useState('');
  const [newBanName, setNewBanName] = useState('');
  const [ticker, setTicker] = useState(0);

  useEffect(() => {
    if (activeTab !== 'players') return;
    const interval = setInterval(() => {
      setTicker(t => t + 1);
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // 7. Diagnostics / Logger Tab State
  const [diagnostics, setDiagnostics] = useState([]);
  const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false);
  const [diagFilter, setDiagFilter] = useState('all'); // 'all' | 'error' | 'warning'
  const [diagSearch, setDiagSearch] = useState('');
  const [logsFilter, setLogsFilter] = useState('all'); // 'all' | 'stdout' | 'stderr' | 'sent'


  useEffect(() => {
    isMountedRef.current = true;
    setCurrentUser(getUser());
    fetchServerDetails();
    fetchBackups();
    fetchInstalledMods();
    fetchActiveDownloads();
    handleCheckUpdates();
    
    fetchMetrics();
    fetchSchedules();

    const dlInterval = setInterval(fetchActiveDownloads, 2000);
    const metricsInterval = setInterval(fetchMetrics, 15000);

    return () => {
      isMountedRef.current = false;
      clearInterval(dlInterval);
      clearInterval(metricsInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [id]);

  useEffect(() => {
    if (!selectedInstalledMod) {
      setSelectedInstalledModDetails(null);
      return;
    }

    const fileName = selectedInstalledMod.fileName;
    
    // Automatically load configs
    if (!modConfigsList[fileName] && !fetchingConfigs[fileName]) {
      const loadConfigs = async () => {
        setFetchingConfigs(prev => ({ ...prev, [fileName]: true }));
        try {
          const data = await apiRequest(`/mods/server/${id}/configs?fileName=${encodeURIComponent(fileName)}`);
          if (isMountedRef.current) {
            setModConfigsList(prev => ({
              ...prev,
              [fileName]: data.configs || []
            }));
          }
        } catch (err) {
          console.error('Failed to load configs for ' + fileName, err);
        } finally {
          if (isMountedRef.current) {
            setFetchingConfigs(prev => ({ ...prev, [fileName]: false }));
          }
        }
      };
      loadConfigs();
    }

    // Automatically load remote details if CurseForge mod
    if (selectedInstalledMod.modId && selectedInstalledMod.modId !== 'manual') {
      const loadDetails = async () => {
        setLoadingInstalledModDetails(true);
        setSelectedInstalledModDetails(null);
        try {
          const details = await apiRequest(`/mods/details/curseforge/${selectedInstalledMod.modId}`);
          if (isMountedRef.current) {
            setSelectedInstalledModDetails(details);
          }
        } catch (err) {
          console.error('Failed to fetch details for mod ' + selectedInstalledMod.modId, err);
        } finally {
          if (isMountedRef.current) {
            setLoadingInstalledModDetails(false);
          }
        }
      };
      loadDetails();
    } else {
      setSelectedInstalledModDetails(null);
    }
  }, [selectedInstalledMod, id]);

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
      fetchPlayerHistory();
      fetchPlayerStats();
    }

    if (activeTab === 'schedules') {
      fetchSchedules();
    }

    if (activeTab === 'config') {
      fetchServerConfig();
    }

    if (activeTab === 'logger') {
      fetchDiagnostics();
      fetchLogs();
    }
  }, [activeTab, currentRelPath]);

  const fetchLogs = async () => {
    try {
      const data = await apiRequest(`/servers/${id}/logs?limit=200`, { skipErrorModal: true });
      setLogs(data.map(log => log.line));
      scrollToConsoleBottom(true);
    } catch (err) {
      console.error('Failed to fetch historical logs:', err);
    }
  };

  const fetchDiagnostics = async () => {
    try {
      setIsDiagnosticsLoading(true);
      const data = await apiRequest(`/servers/${id}/diagnostics`);
      setDiagnostics(data || []);
    } catch (err) {
      console.error('Failed to fetch historical diagnostics:', err);
    } finally {
      setIsDiagnosticsLoading(false);
    }
  };

  const handleClearLogsHistory = async () => {
    if (!await showConfirm('Are you sure you want to permanently delete all server console and error log history from the database? This cannot be undone.', { title: 'Wipe Log History', isDanger: true })) return;
    try {
      await apiRequest(`/servers/${id}/logs`, { method: 'DELETE' });
      setLogs([]);
      setDiagnostics([]);
      alert('Server logs history database successfully cleared.');
    } catch (err) {
      alert(`Failed to clear log history: ${err.message}`);
    }
  };

  const handleDownloadLogs = () => {
    const filteredLogs = logs.filter(line => {
      // Search text filtering
      if (diagSearch && !cleanAnsiCodes(line).toLowerCase().includes(diagSearch.toLowerCase())) {
        return false;
      }
      return true;
    });

    const fileContent = filteredLogs.map(line => cleanAnsiCodes(line)).join('\r\n');
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${server?.slug || 'server'}-logs.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
      console.log('Console WebSocket closed. Reconnecting in 3s...');
      if (wsRef.current === ws) {
        wsRef.current = null;
        setTimeout(() => {
          if (isMountedRef.current && activeTab === 'console') {
            connectWebSocket();
          }
        }, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error('Console WebSocket error:', err);
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

  const cleanAnsiCodes = (line) => {
    if (!line) return '';
    const str = typeof line === 'string' ? line : String(line);
    // Strip real ANSI escape codes
    let clean = str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    // Strip literal raw ANSI remnants like [m, [32m, [1m, [0m
    clean = clean.replace(/\[[0-9;]*m/g, '');
    return clean;
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
      cmd.toLowerCase().startsWith(val.toLowerCase())
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
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length > 0) {
          let nextIdx = historyIndex;
          if (nextIdx === -1) {
            nextIdx = commandHistory.length - 1;
          } else if (nextIdx > 0) {
            nextIdx = nextIdx - 1;
          }
          setHistoryIndex(nextIdx);
          setCommand(commandHistory[nextIdx]);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (commandHistory.length > 0) {
          let nextIdx = historyIndex;
          if (nextIdx !== -1) {
            if (nextIdx < commandHistory.length - 1) {
              nextIdx = nextIdx + 1;
              setHistoryIndex(nextIdx);
              setCommand(commandHistory[nextIdx]);
            } else {
              setHistoryIndex(-1);
              setCommand('');
            }
          }
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
      setAutostart(!!data.autostart);
      
      const configData = data.config_json ? JSON.parse(data.config_json) : {};
      setJvmArgs(configData.jvmArgs || '');
      setRestartPolicy(data.restart_policy || 'never');
      setRestartSchedule(data.restart_schedule || '');
      setWebhookUrl(data.webhook_url || '');
      setServerType(data.server_type || 'Survival');
      setServerVersion(data.server_version || 'Use Global Default');

      // Load whitelist/bans configs
      const wl = configData.whitelist || '';
      const bn = configData.bans || '';
      setWhitelistContent(wl);
      setBansContent(bn);
      setWhitelistArray(wl.split('\n').map(x => x.trim()).filter(Boolean));
      setBansArray(bn.split('\n').map(x => x.trim()).filter(Boolean));
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

    // Save to command history
    setCommandHistory(prev => {
      if (prev.length > 0 && prev[prev.length - 1] === command.trim()) {
        return prev;
      }
      const updated = [...prev, command.trim()].slice(-50);
      try {
        localStorage.setItem('hytale_console_history', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
    setHistoryIndex(-1);

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
        body: { command: command.trim() },
        skipErrorModal: true
      }).catch(err => {
        const errorLine = `[System Command Error] Failed to execute /${command.trim()}: ${err.message}`;
        setLogs(prev => [...prev, errorLine]);
        
        const newIssue = {
          id: Math.random().toString(),
          severity: 'error',
          type: 'Command Execution Failure',
          line: errorLine,
          hint: 'The RCON console API call failed. Verify backend service is listening on port 5600 and server status is active.'
        };
        setDetectedIssues(prev => [newIssue, ...prev.slice(0, 9)]);
        scrollToConsoleBottom();
      });
    }
    
    setLogs(prev => [...prev, `> ${command}`]);
    setCommand('');
    scrollToConsoleBottom();
  };

  // FILES TAB API
  const fetchFiles = async (relPath) => {
    try {
      const files = await apiRequest(`/files?serverId=${id}&relPath=${encodeURIComponent(relPath)}`);
      // Sort directories to the top, followed by files alphabetically
      const sortedFiles = (files || []).sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      setFilesList(sortedFiles);
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
    if (!await showConfirm(`Are you sure you want to permanently delete "${filename}"?`, { title: 'Delete File', isDanger: true })) return;
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

  const fetchPlayerHistory = async (search = historySearchQuery, event = historyEventFilter) => {
    try {
      const queryParams = new URLSearchParams({
        search: search,
        event: event,
        limit: 100
      }).toString();
      const data = await apiRequest(`/servers/${id}/players/history?${queryParams}`);
      setPlayerHistory(data || []);
    } catch (err) {
      console.error('Failed to fetch player connection history:', err);
    }
  };

  const fetchPlayerStats = async () => {
    try {
      setStatsLoading(true);
      const data = await apiRequest(`/servers/${id}/players/stats`);
      setPlayerStats(data || []);
    } catch (err) {
      console.error('Failed to fetch player statistics:', err);
    } finally {
      setStatsLoading(false);
    }
  };
  const getAvatarStyle = (username) => {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return {
      background: `linear-gradient(135deg, hsl(${h}, 70%, 45%), hsl(${(h + 40) % 360}, 75%, 35%))`,
      color: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 'bold',
      fontSize: '16px',
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      fontFamily: 'var(--font-heading)',
      boxShadow: `0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)`,
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
      userSelect: 'none'
    };
  };

  const getSessionDurationStr = (player) => {
    const lastJoin = playerHistory.find(h => h.player === player && h.event === 'join');
    if (!lastJoin) return 'Just joined';
    
    const joinedMs = new Date(lastJoin.timestamp).getTime();
    const diffMs = Date.now() - joinedMs;
    if (diffMs < 0) return 'Just joined';
    
    const diffS = Math.floor(diffMs / 1000);
    const h = Math.floor(diffS / 3600);
    const m = Math.floor((diffS % 3600) / 60);
    const s = diffS % 60;
    
    if (h > 0) return `${h}h ${m}m online`;
    if (m > 0) return `${m}m online`;
    return `${s}s online`;
  };

  const formatPlaytime = (ms) => {
    if (!ms) return '0s';
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const handlePlayerCommand = async (commandString) => {
    try {
      await apiRequest(`/servers/${id}/command`, {
        method: 'POST',
        body: { command: commandString }
      });
      alert(`Command sent: /${commandString}`);
    } catch (err) {
      alert(`Failed to execute command: ${err.message}`);
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
      const data = await apiRequest(`/servers/${id}/metrics?limit=${limit}`, { skipErrorModal: true });
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

  const openCreateScheduleModal = () => {
    setEditingSchedule(null);
    setSchedName('');
    setSchedCron('0 4 * * *'); // Amber default: daily at 4:00 AM
    setSchedAction('restart');
    setSchedPayload('');
    
    // Reset simple mode states
    setSchedModalMode('simple');
    setSimpleSchedFreq('daily');
    setSimpleSchedDailyTime('04:00');
    setSimpleSchedMinute(0);
    setSimpleSchedHourStep(12);
    setSimpleSchedWeeklyDay(1);
    setSimpleSchedWeeklyTime('04:00');
    setSimpleSchedIntervalMin(15);
    
    setShowScheduleModal(true);
  };

  const openEditScheduleModal = (sched) => {
    setEditingSchedule(sched);
    setSchedName(sched.name);
    setSchedAction(sched.action);
    setSchedPayload(sched.action_payload || '');
    
    const cron = sched.cron_expression.trim();
    setSchedCron(cron);

    // Try parsing the cron expression to see if it fits a simple preset
    const fields = cron.split(/\s+/);
    let matched = false;

    if (fields.length === 5) {
      const [min, hour, dom, month, dow] = fields;
      
      // 1. Interval: */X * * * *
      if (min.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
        const interval = parseInt(min.split('/')[1], 10);
        if ([5, 10, 15, 30].includes(interval)) {
          setSchedModalMode('simple');
          setSimpleSchedFreq('interval');
          setSimpleSchedIntervalMin(interval);
          matched = true;
        }
      }
      
      // 2. Hourly: X * * * *
      if (!matched && !isNaN(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
        const minuteVal = parseInt(min, 10);
        if (minuteVal >= 0 && minuteVal <= 59) {
          setSchedModalMode('simple');
          setSimpleSchedFreq('hourly');
          setSimpleSchedMinute(minuteVal);
          matched = true;
        }
      }

      // 3. Every X Hours: M */H * * *
      if (!matched && !isNaN(min) && hour.startsWith('*/') && dom === '*' && month === '*' && dow === '*') {
        const minuteVal = parseInt(min, 10);
        const hourStep = parseInt(hour.split('/')[1], 10);
        if (minuteVal >= 0 && minuteVal <= 59 && [2, 3, 4, 6, 8, 12].includes(hourStep)) {
          setSchedModalMode('simple');
          setSimpleSchedFreq('everyXHours');
          setSimpleSchedMinute(minuteVal);
          setSimpleSchedHourStep(hourStep);
          matched = true;
        }
      }

      // 4. Daily: M H * * *
      if (!matched && !isNaN(min) && !isNaN(hour) && dom === '*' && month === '*' && dow === '*') {
        const minVal = parseInt(min, 10);
        const hrVal = parseInt(hour, 10);
        if (minVal >= 0 && minVal <= 59 && hrVal >= 0 && hrVal <= 23) {
          setSchedModalMode('simple');
          setSimpleSchedFreq('daily');
          setSimpleSchedDailyTime(`${String(hrVal).padStart(2, '0')}:${String(minVal).padStart(2, '0')}`);
          matched = true;
        }
      }

      // 5. Weekly: M H * * D
      if (!matched && !isNaN(min) && !isNaN(hour) && dom === '*' && month === '*' && !isNaN(dow)) {
        const minVal = parseInt(min, 10);
        const hrVal = parseInt(hour, 10);
        const dayVal = parseInt(dow, 10);
        if (minVal >= 0 && minVal <= 59 && hrVal >= 0 && hrVal <= 23 && dayVal >= 0 && dayVal <= 6) {
          setSchedModalMode('simple');
          setSimpleSchedFreq('weekly');
          setSimpleSchedWeeklyDay(dayVal);
          setSimpleSchedWeeklyTime(`${String(hrVal).padStart(2, '0')}:${String(minVal).padStart(2, '0')}`);
          matched = true;
        }
      }
    }

    if (!matched) {
      setSchedModalMode('advanced');
    }
    setShowScheduleModal(true);
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
      
      // Reset simple mode states
      setSchedModalMode('simple');
      setSimpleSchedFreq('daily');
      setSimpleSchedDailyTime('04:00');
      setSimpleSchedMinute(0);
      setSimpleSchedHourStep(12);
      setSimpleSchedWeeklyDay(1);
      setSimpleSchedWeeklyTime('04:00');
      setSimpleSchedIntervalMin(15);
      
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
    if (!await showConfirm('Are you sure you want to delete this scheduled task?', { title: 'Delete Schedule', isDanger: true })) return;
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
    if (!server || server.status !== 'running') {
      return (
        <div style={{ color: 'var(--text-dark)', textAlign: 'center', padding: '48px 16px', fontSize: '11px', fontStyle: 'italic' }}>
          Server is offline
        </div>
      );
    }

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
      const list = data.mods || [];
      setInstalledMods(list);
      setSelectedInstalledMod(current => {
        if (!current) return null;
        const updated = list.find(m => m.fileName === current.fileName);
        return updated || null;
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleConfigs = async (fileName) => {
    const isExpanded = !!expandedModConfigs[fileName];
    
    setExpandedModConfigs(prev => ({
      ...prev,
      [fileName]: !isExpanded
    }));

    if (isExpanded) return;

    setFetchingConfigs(prev => ({ ...prev, [fileName]: true }));
    try {
      const data = await apiRequest(`/mods/server/${id}/configs?fileName=${encodeURIComponent(fileName)}`);
      setModConfigsList(prev => ({
        ...prev,
        [fileName]: data.configs || []
      }));
    } catch (err) {
      console.error('Failed to load configs for ' + fileName, err);
      alert('Failed to load configs: ' + err.message);
    } finally {
      setFetchingConfigs(prev => ({ ...prev, [fileName]: false }));
    }
  };

  const handleEditConfig = async (config) => {
    try {
      const data = await apiRequest(`/files/read?serverId=${id}&relPath=${encodeURIComponent(config.relPath)}`);
      setEditingContent(data.content || '');
      setEditingFile({ relPath: config.relPath, name: config.name });
    } catch (err) {
      console.error('Failed to read config file', err);
      alert('Failed to open config file: ' + err.message);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const data = await apiRequest(`/mods/server/${id}/updates`);
      const updatesMap = {};
      for (const upd of data.updates) {
        updatesMap[upd.fileName] = upd;
      }
      setModUpdates(updatesMap);
    } catch (err) {
      console.error('Failed to check for mod updates', err);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdateMod = async (oldFileName, update) => {
    setUpdatingMods(prev => ({ ...prev, [oldFileName]: true }));
    try {
      await apiRequest(`/mods/server/${id}/install`, {
        method: 'POST',
        body: JSON.stringify({
          source: 'curseforge',
          modId: update.curseforgeModId,
          fileId: update.latestFileId,
          fileName: update.latestFileName,
          sha1: update.latestSha1,
          deleteOldFileName: oldFileName
        })
      });
      
      setModUpdates(prev => {
        const copy = { ...prev };
        delete copy[oldFileName];
        return copy;
      });

      fetchActiveDownloads();
    } catch (err) {
      console.error('Failed to update mod ' + oldFileName, err);
      alert('Update failed: ' + err.message);
    } finally {
      setUpdatingMods(prev => ({ ...prev, [oldFileName]: false }));
    }
  };

  const handleBulkUpdate = async () => {
    const list = Object.entries(modUpdates);
    if (list.length === 0) return;

    if (!confirm(`Are you sure you want to update all ${list.length} outdated mods?`)) return;

    for (const [oldFileName, update] of list) {
      await handleUpdateMod(oldFileName, update);
    }
  };

  const fetchActiveDownloads = async () => {
    try {
      const data = await apiRequest(`/mods/server/${id}/downloads`);
      setActiveDownloads(prev => {
        const hadActive = prev.some(dl => dl.status === 'downloading' || dl.status === 'verifying');
        const hasFinished = data && data.some(dl => dl.status === 'completed' || dl.status === 'failed');
        if (hadActive && (hasFinished || (data && data.length < prev.length))) {
          fetchInstalledMods();
        }
        return data || [];
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearchMods = async (e) => {
    e?.preventDefault();
    setSearchingRemote(true);
    setRemoteSearchError(null);
    try {
      const data = await apiRequest(`/mods/search?source=${modsSource}&q=${encodeURIComponent(modsSearchQuery)}&sortBy=${modsSortBy}`);
      setRemoteMods(data || []);
      setSelectedMod(null);
    } catch (err) {
      console.error('Remote search failed: ', err);
      setRemoteSearchError(err.message || 'An error occurred fetching remote mods.');
    } finally {
      setSearchingRemote(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'mods' && modsSubTab === 'marketplace') {
      handleSearchMods();
    }
  }, [modsSortBy, modsSource, activeTab, modsSubTab]);

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
      // Check if there is an existing backup for this mod
      const check = await apiRequest(`/mods/server/${id}/install-check?fileName=${encodeURIComponent(modFile.fileName)}`);
      let restoreBackupId = null;

      if (check.hasBackup && check.backups.length > 0) {
        const newestBackup = check.backups[0];
        const restoreConfirm = await showConfirm(
          `We found a previous configuration/data backup for this mod (backed up on ${newestBackup.dateFormatted}). Would you like to restore this backup alongside the installation?`,
          {
            title: 'Restore Previous Backup?',
            confirmText: 'Restore Backup',
            cancelText: 'Install Clean',
          }
        );
        if (restoreConfirm) {
          restoreBackupId = newestBackup.id;
        }
      }

      await apiRequest(`/mods/server/${id}/install`, {
        method: 'POST',
        body: {
          source: selectedMod.source,
          modId: selectedMod.id,
          fileId: modFile.id,
          downloadUrl: modFile.downloadUrl,
          fileName: modFile.fileName,
          sha1: modFile.hashes?.find(h => h.algo === 1)?.value || null,
          restoreBackupId
        }
      });
      
      const successMsg = restoreBackupId 
        ? `Mod installation for "${modFile.fileName}" started in the background (restored config backup!).`
        : `Mod download for "${modFile.fileName}" started in the background.`;
      
      alert(successMsg);
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
    // Find the mod in our state list to check associated folders
    const mod = installedMods.find(m => m.fileName === fileName);
    let deleteFoldersAction = 'keep';

    if (mod && mod.associatedFolders && mod.associatedFolders.length > 0) {
      const choice = await showModDeleteConfirm(fileName, mod.associatedFolders);
      if (choice === 'cancel') return;
      deleteFoldersAction = choice;
    } else {
      if (!await showConfirm(`Are you sure you want to delete mod file "${fileName}"?`, { title: 'Delete Mod', isDanger: true })) return;
    }

    try {
      await apiRequest(`/mods/server/${id}`, {
        method: 'DELETE',
        body: { fileName, deleteFoldersAction }
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

  const handleUploadMod = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'jar' && ext !== 'zip') {
      alert('Only .jar and .zip mod files are allowed.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/mods/server/${id}/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`
        },
        body: file
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || 'Mod upload failed.');
      }

      alert(`Successfully uploaded mod: ${file.name}`);
      fetchInstalledMods();
    } catch (err) {
      alert(`Mod upload failed: ${err.message}`);
    } finally {
      if (modFileInputRef.current) modFileInputRef.current.value = '';
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
    if (!await showConfirm('WARNING: Restoring a backup will overwrite current server files. Are you sure you want to proceed?', { title: 'Restore Backup', confirmText: 'Restore', isDanger: true })) return;
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
    if (!await showConfirm(`Permanently delete backup file "${fileName}"?`, { title: 'Delete Backup', isDanger: true })) return;
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
          autostart: !!autostart,
          server_type: serverType,
          server_version: serverVersion,
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
    if (!await showConfirm(confirmMsg, { title: 'Delete Server Profile', isDanger: true })) return;

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
    if (e) e.preventDefault();
    setSavingPlayers(true);
    try {
      const configData = server.config_json ? JSON.parse(server.config_json) : {};
      const wlString = whitelistArray.join('\n');
      const bansString = bansArray.join('\n');
      
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
            whitelist: wlString,
            bans: bansString
          })
        }
      });
      setWhitelistContent(wlString);
      setBansContent(bansString);
      alert('Whitelist and Bans permissions synchronized successfully.');
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
      <header className="fancy-header" style={{ borderBottom: 'none' }}>
        <div className="fancy-nav-container">
          <nav className="fancy-nav">
            <Link to="/" className="fancy-nav-item">
              <span>&larr;</span> Back
            </Link>
            <Link to="/" className="fancy-nav-item">Dashboard</Link>
            <Link to="/metrics" className="fancy-nav-item">System Metrics</Link>
          </nav>
        </div>

        <div className="fancy-title-container">
          <h1 className="fancy-title">
            <span className="fancy-title-brackets">[</span>
            {server.name}
            <span className="fancy-title-brackets">]</span>
          </h1>
          <span className="badge badge-warning" style={{ textTransform: 'uppercase', marginRight: '8px' }}>
            {server.server_type || 'Survival'}
          </span>
          <span className="badge badge-accent" style={{ textTransform: 'none', marginRight: '8px', backgroundColor: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
            v{server.server_version || 'latest'}
          </span>
          <span className={`badge ${server.status === 'running' ? 'badge-success' : server.status === 'stopped' ? 'badge-secondary' : server.status === 'uninstalled' ? 'badge-secondary' : 'badge-warning'}`}>
            <span className={`status-dot ${server.status === 'running' ? 'active' : server.status === 'stopped' ? 'stopped' : 'warning'}`}></span>
            {server.status}
          </span>
        </div>

        <div className="fancy-right-container">
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
              <button onClick={() => handleServerAction('start')} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }}>Start Server</button>
            ) : (
              <>
                <button onClick={() => handleServerAction('stop')} className="btn btn-danger" style={{ padding: '8px 16px', fontSize: '13px' }}>Stop</button>
                <button onClick={() => handleServerAction('restart')} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>Restart</button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Tab Selection */}
      <div style={{
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        padding: '0 32px 16px 32px'
      }}>
        <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '16px', flexWrap: 'wrap' }}>
          {['console', 'files', 'mods', 'backups', 'schedules', 'players', 'config', 'logger'].map((tab) => (
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
              {tab === 'logger' ? '🔍 Diagnostics & Logs' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Panels */}
      <main style={{ flex: 1, padding: '32px', width: '100%' }}>
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
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: '16px' }}>
              <div 
                ref={consoleContainerRef}
                onScroll={handleConsoleScroll}
                style={{
                  flex: 1,
                  minHeight: 0,
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
                  logs.map((line, idx) => {
                    const cleanLine = cleanAnsiCodes(line);
                    return (
                      <div 
                        key={idx} 
                        style={{ 
                          color: cleanLine.startsWith('>') 
                            ? 'var(--primary)' 
                            : cleanLine.includes('ERROR') || cleanLine.includes('Exception') 
                            ? 'var(--error)' 
                            : cleanLine.includes('WARN') 
                            ? 'var(--warning)' 
                            : 'var(--text-main)',
                          marginBottom: '4px'
                        }}
                      >
                        {renderLineWithLinks(cleanLine)}
                      </div>
                    );
                  })
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
                  
                  {(() => {
                    const activeHelp = (showSuggestions && suggestions.length > 0 && activeSuggestionIdx < suggestions.length)
                      ? { key: suggestions[activeSuggestionIdx], ...COMMAND_METADATA[suggestions[activeSuggestionIdx]] }
                      : getActiveCommandHelp(command);

                    // Case A: Suggestions are open
                    if (showSuggestions && suggestions.length > 0) {
                      return (
                        <div style={{
                          position: 'absolute',
                          bottom: 'calc(100% + 8px)',
                          left: 0,
                          width: '100%',
                          minWidth: '550px',
                          backgroundColor: 'rgba(11, 12, 16, 0.95)',
                          backdropFilter: 'blur(12px)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5), var(--shadow-glow)',
                          zIndex: 100,
                          maxHeight: '280px',
                          display: 'flex',
                          overflow: 'hidden',
                          animation: 'fadeIn 0.2s ease-out'
                        }}>
                          {/* Left Column: Command Suggestions */}
                          <div style={{
                            width: '40%',
                            borderRight: '1px solid var(--border)',
                            overflowY: 'auto',
                            padding: '6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px'
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
                                  alignItems: 'center',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                <span>{sug}</span>
                                <span style={{ fontSize: '9px', opacity: activeSuggestionIdx === idx ? 0.8 : 0, color: 'var(--primary)' }}>
                                  [Tab]
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Right Column: Live Command Metadata */}
                          <div style={{
                            width: '60%',
                            padding: '16px',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                            backgroundColor: 'rgba(15, 17, 23, 0.4)'
                          }}>
                            {activeHelp ? (
                              <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    color: 'var(--primary)'
                                  }}>
                                    {activeHelp.key}
                                  </span>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                  {activeHelp.description}
                                </div>
                                <div style={{ marginTop: '4px' }}>
                                  <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-dark)', fontWeight: '600', letterSpacing: '0.05em' }}>
                                    Usage
                                  </span>
                                  <div style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '11px',
                                    padding: '6px 10px',
                                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                    borderRadius: '6px',
                                    border: '1px solid rgba(255,255,255,0.05)',
                                    marginTop: '4px',
                                    color: 'var(--text-main)'
                                  }}>
                                    {activeHelp.usage}
                                  </div>
                                </div>
                                {activeHelp.options && activeHelp.options.length > 0 && (
                                  <div style={{ marginTop: '4px' }}>
                                    <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-dark)', fontWeight: '600', letterSpacing: '0.05em' }}>
                                      Arguments
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                                      {activeHelp.options.map(opt => (
                                        <div key={opt.name} style={{ display: 'flex', flexDirection: 'column', fontSize: '11px' }}>
                                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--secondary)', fontWeight: '500' }}>
                                            {opt.name}
                                          </span>
                                          <span style={{ color: 'var(--text-muted)', paddingLeft: '4px', borderLeft: '2px solid var(--border)' }}>
                                            {opt.desc}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div style={{ fontSize: '12px', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', height: '100%', justifyContent: 'center' }}>
                                Select a command to see details.
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Case B: Suggestions closed, but active typed command matches help (persistent argument reference)
                    if (activeHelp) {
                      return (
                        <div style={{
                          position: 'absolute',
                          bottom: 'calc(100% + 8px)',
                          left: 0,
                          width: '100%',
                          minWidth: '550px',
                          backgroundColor: 'rgba(11, 12, 16, 0.95)',
                          backdropFilter: 'blur(12px)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5), var(--shadow-glow)',
                          zIndex: 100,
                          padding: '14px 16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          animation: 'fadeIn 0.2s ease-out'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '13px',
                              fontWeight: '600',
                              color: 'var(--primary)'
                            }}>
                              {activeHelp.key}
                            </span>
                            <span style={{ fontSize: '10px', color: 'var(--text-dark)' }}>
                              Live Syntax Guide
                            </span>
                          </div>
                          
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {activeHelp.description}
                          </div>

                          <div style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            padding: '6px 10px',
                            backgroundColor: 'rgba(0, 0, 0, 0.3)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255,255,255,0.05)',
                            color: 'var(--text-main)'
                          }}>
                            {activeHelp.usage}
                          </div>

                          {activeHelp.options && activeHelp.options.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                                {activeHelp.options.map(opt => (
                                  <div key={opt.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--secondary)', fontWeight: '600' }}>
                                      {opt.name}
                                    </span>
                                    <span style={{ color: 'var(--text-dark)' }}>
                                      — {opt.desc}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return null;
                  })()}
                </div>
                <button type="submit" className="btn btn-primary" disabled={server.status !== 'running' || isViewer}>
                  Send
                </button>
              </form>
            </div>

            {/* Classification sidebar */}
            <div className="glass-panel" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              {/* Process Performance Charts */}
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
                    Server Metrics ({metricsRange})
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '500' }}>
                      <span>CPU Utilization</span>
                      <span style={{ color: '#10b981', fontWeight: '600' }}>
                        {server.status === 'running' && metrics.length > 0 ? `${metrics[metrics.length - 1].cpu_percentage}%` : '0%'}
                      </span>
                    </div>
                    <div style={{ height: '120px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                      {renderSVGChart('cpu')}
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '500' }}>
                      <span>Memory Utilization</span>
                      <span style={{ color: '#3b82f6', fontWeight: '600' }}>
                        {server.status === 'running' && metrics.length > 0 ? `${(metrics[metrics.length - 1].ram_bytes / (1024*1024*1024)).toFixed(2)} GB` : '0.00 GB'}
                      </span>
                    </div>
                    <div style={{ height: '120px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                      {renderSVGChart('ram')}
                    </div>
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
                      <button 
                        onClick={() => showError(issue.hint, { title: issue.type || 'Crashed Log Pattern', details: issue.line })}
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '11px', marginTop: '8px', width: '100%', borderColor: 'rgba(244, 63, 94, 0.3)', color: 'var(--error)' }}
                      >
                        🔍 View Modal Details
                      </button>
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

              {(() => {
                const getFileIcon = (file) => {
                  if (file.isDir) {
                    return (
                      <span style={{ fontSize: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                        📂
                      </span>
                    );
                  }

                  const ext = file.name.split('.').pop().toLowerCase();
                  let icon = '📄';
                  let bgColor = 'rgba(255, 255, 255, 0.03)';
                  let borderColor = 'rgba(255, 255, 255, 0.1)';
                  let textColor = 'var(--text-main)';

                  if (ext === 'jar') {
                    icon = '☕';
                    bgColor = 'rgba(244, 63, 94, 0.1)';
                    borderColor = 'rgba(244, 63, 94, 0.25)';
                    textColor = 'var(--error)';
                  } else if (ext === 'json') {
                    icon = '⚙️';
                    bgColor = 'rgba(245, 158, 11, 0.1)';
                    borderColor = 'rgba(245, 158, 11, 0.25)';
                    textColor = 'var(--primary)';
                  } else if (ext === 'zip' || ext === 'tar' || ext === 'gz' || ext === 'rar') {
                    icon = '📦';
                    bgColor = 'rgba(16, 185, 129, 0.1)';
                    borderColor = 'rgba(16, 185, 129, 0.25)';
                    textColor = 'var(--success)';
                  } else if (ext === 'yml' || ext === 'yaml' || ext === 'properties' || ext === 'cfg') {
                    icon = '📝';
                    bgColor = 'rgba(59, 130, 246, 0.1)';
                    borderColor = 'rgba(59, 130, 246, 0.25)';
                    textColor = 'var(--secondary)';
                  } else if (ext === 'txt' || ext === 'log') {
                    icon = '🗒️';
                    bgColor = 'rgba(156, 163, 175, 0.1)';
                    borderColor = 'rgba(156, 163, 175, 0.25)';
                    textColor = 'var(--text-muted)';
                  } else if (ext === 'sh' || ext === 'bat') {
                    icon = '⚡';
                    bgColor = 'rgba(217, 119, 6, 0.1)';
                    borderColor = 'rgba(217, 119, 6, 0.25)';
                    textColor = 'var(--warning)';
                  }

                  return (
                    <span 
                      style={{ 
                        fontSize: '16px', 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        width: '28px', 
                        height: '28px', 
                        backgroundColor: bgColor, 
                        borderRadius: '6px', 
                        border: `1px solid ${borderColor}`,
                        color: textColor
                      }}
                    >
                      {icon}
                    </span>
                  );
                };

                return filesList.length === 0 ? (
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
                        padding: '10px 8px', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        fontSize: '13px',
                        alignItems: 'center',
                        transition: 'background-color 0.2s',
                        marginBottom: '4px'
                      }}
                      className="glass-card"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: file.isDir ? '600' : '400' }}>
                        {getFileIcon(file)}
                        <span style={{ color: file.isDir ? 'var(--primary)' : 'var(--text-main)' }}>{file.name}</span>
                      </div>
                      <div>
                        {file.isDir ? (
                          <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '2px 8px' }}>Folder</span>
                        ) : (
                          <span className="badge badge-warning" style={{ fontSize: '10px', padding: '2px 8px', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                            {file.name.split('.').pop().toUpperCase()}
                          </span>
                        )}
                      </div>
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
                );
              })()}
            </div>


          </div>
        )}

        {/* 3. MODS TAB */}
        {activeTab === 'mods' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Sub-Tab Navigation Header */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '8px' }}>
              <button
                onClick={() => setModsSubTab('installed')}
                style={{
                  padding: '10px 20px',
                  fontSize: '13px',
                  fontWeight: '600',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: modsSubTab === 'installed' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  color: modsSubTab === 'installed' ? 'var(--primary)' : 'var(--text-muted)',
                  borderBottom: modsSubTab === 'installed' ? '2px solid var(--primary)' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                📂 Installed Mods
                <span style={{ fontSize: '11px', backgroundColor: 'rgba(255,255,255,0.05)', padding: '1px 7px', borderRadius: '10px', color: 'var(--text-main)', border: '1px solid var(--border)', fontWeight: '600' }}>
                  {installedMods.length}
                </span>
              </button>

              <button
                onClick={() => setModsSubTab('marketplace')}
                style={{
                  padding: '10px 20px',
                  fontSize: '13px',
                  fontWeight: '600',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: modsSubTab === 'marketplace' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  color: modsSubTab === 'marketplace' ? 'var(--primary)' : 'var(--text-muted)',
                  borderBottom: modsSubTab === 'marketplace' ? '2px solid var(--primary)' : '2px solid transparent',
                  transition: 'all 0.15s ease'
                }}
              >
                🌐 Mod Marketplace
              </button>
            </div>

            {/* Installed Server Mods Grid Container */}
            {modsSubTab === 'installed' && (
              <div style={{ display: 'grid', gridTemplateColumns: selectedInstalledMod ? '1.2fr 1fr' : '1fr', gap: '24px', transition: 'all 0.3s ease' }}>
              
              {/* Left Side: Installed List */}
              <div className="glass-panel animate-fade-in" style={{ height: 'fit-content' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)' }}>Installed Mods</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Local mods in the server/mods folder.</p>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {Object.keys(modUpdates).length > 0 && (
                      <button 
                        onClick={handleBulkUpdate} 
                        className="btn btn-primary" 
                        style={{ padding: '6px 12px', fontSize: '13px', backgroundColor: 'rgba(16, 185, 129, 0.2)', border: '1px solid var(--success)', color: 'var(--success)' }}
                        disabled={isViewer}
                      >
                        ⚡ Update All ({Object.keys(modUpdates).length})
                      </button>
                    )}
                    <button 
                      onClick={handleCheckUpdates} 
                      className="btn btn-secondary" 
                      style={{ padding: '6px 12px', fontSize: '13px' }}
                      disabled={checkingUpdates}
                    >
                      {checkingUpdates ? 'Scanning...' : '🔄 Check Updates'}
                    </button>
                    <button onClick={() => modFileInputRef.current?.click()} className="btn btn-accent" style={{ padding: '6px 12px', fontSize: '13px' }} disabled={isViewer}>
                      Upload Mod
                    </button>
                    <input 
                      type="file" 
                      ref={modFileInputRef} 
                      onChange={handleUploadMod} 
                      style={{ display: 'none' }} 
                      accept=".jar,.zip"
                      disabled={isViewer}
                    />
                    <button onClick={handleScanConflicts} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px' }} disabled={isViewer}>
                      Scan Conflicts
                    </button>
                  </div>
                </div>

                {/* Active Downloads HUD */}
                {activeDownloads.length > 0 && (
                  <div style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <h4 style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                        Background Downloads
                      </h4>
                      <span style={{ fontSize: '11px', backgroundColor: 'var(--primary-glow)', color: 'var(--primary)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '10px', padding: '1px 7px', fontWeight: '600' }}>
                        {activeDownloads.length}
                      </span>
                    </div>

                    {activeDownloads.map((dl) => {
                      const isFailed = dl.status === 'failed';
                      const isCompleted = dl.status === 'completed';
                      const isVerifying = dl.status === 'verifying';
                      const isActive = dl.status === 'downloading';

                      const barColor = isFailed
                        ? 'var(--error)'
                        : isCompleted
                        ? 'var(--success)'
                        : 'var(--primary)';

                      const badgeStyle = isFailed
                        ? { backgroundColor: 'rgba(244,63,94,0.12)', color: 'var(--error)', border: '1px solid rgba(244,63,94,0.35)' }
                        : isCompleted
                        ? { backgroundColor: 'rgba(16,185,129,0.12)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.35)' }
                        : isVerifying
                        ? { backgroundColor: 'rgba(245,158,11,0.12)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.35)' }
                        : { backgroundColor: 'var(--primary-glow)', color: 'var(--primary)', border: '1px solid var(--primary-border)' };

                      const formatBytes = (b) => {
                        if (!b) return '0 B';
                        if (b < 1024) return `${b} B`;
                        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
                        return `${(b / (1024 * 1024)).toFixed(2)} MB`;
                      };

                      return (
                        <div
                          key={dl.downloadId}
                          style={{
                            backgroundColor: isFailed ? 'rgba(244,63,94,0.04)' : isCompleted ? 'rgba(16,185,129,0.04)' : 'var(--primary-glow)',
                            border: `1px solid ${isFailed ? 'rgba(244,63,94,0.2)' : isCompleted ? 'rgba(16,185,129,0.2)' : 'var(--primary-border)'}`,
                            borderRadius: '10px',
                            padding: '12px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '13px', fontWeight: '600', fontFamily: 'var(--font-mono)', color: 'var(--text-main)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {dl.fileName}
                            </span>
                            <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', borderRadius: '6px', padding: '2px 8px', whiteSpace: 'nowrap', ...badgeStyle }}>
                              {isVerifying ? 'Verifying' : isActive ? 'Downloading' : isCompleted ? 'Complete' : 'Failed'}
                            </span>
                            {(isFailed || isCompleted) && (
                              <button
                                onClick={() => setActiveDownloads(prev => prev.filter(d => d.downloadId !== dl.downloadId))}
                                style={{ background: 'none', border: 'none', color: 'var(--text-dark)', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                                title="Dismiss"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          <div style={{ position: 'relative', width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{
                              width: `${dl.progress || 0}%`,
                              height: '100%',
                              backgroundColor: barColor,
                              boxShadow: isFailed ? 'none' : `0 0 8px ${barColor}`,
                              borderRadius: '3px',
                              transition: 'width 0.4s ease-in-out',
                            }} />
                            {isActive && (
                              <div style={{
                                position: 'absolute',
                                top: 0, left: 0,
                                width: '100%', height: '100%',
                                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
                                animation: 'shimmer 1.4s infinite',
                              }} />
                            )}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                            {isFailed ? (
                              <span style={{ color: 'var(--error)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span>⚠</span>
                                <span>{dl.error || 'Download failed. Check your connection.'}</span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-dark)' }}>
                                {isCompleted
                                  ? `✓ ${formatBytes(dl.downloadedBytes)} — installed`
                                  : isVerifying
                                  ? 'Verifying SHA1 checksum...'
                                  : dl.totalBytes > 0
                                  ? `${formatBytes(dl.downloadedBytes)} / ${formatBytes(dl.totalBytes)}`
                                  : `${formatBytes(dl.downloadedBytes)} downloaded`}
                              </span>
                            )}
                            <span style={{ color: isFailed ? 'var(--error)' : isCompleted ? 'var(--success)' : 'var(--primary)', fontWeight: '700', fontVariantNumeric: 'tabular-nums' }}>
                              {dl.progress || 0}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Installed Grid List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: selectedInstalledMod ? '3fr 1fr' : '3fr 1fr 1.5fr', 
                    padding: '8px', 
                    color: 'var(--text-muted)', 
                    fontSize: '12px', 
                    borderBottom: '1px solid var(--border)', 
                    fontWeight: '600' 
                  }}>
                    <div>Mod Name</div>
                    <div>Enabled</div>
                    {!selectedInstalledMod && <div style={{ textAlign: 'right' }}>Provider / Actions</div>}
                  </div>

                  {installedMods.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dark)', fontSize: '14px' }}>
                      No mods installed yet.
                    </div>
                  ) : (
                    installedMods.map((mod) => {
                      const isSelected = selectedInstalledMod?.fileName === mod.fileName;
                      return (
                        <div 
                          key={mod.fileName}
                          onClick={() => setSelectedInstalledMod(mod)}
                          style={{ 
                            display: 'grid', 
                            gridTemplateColumns: selectedInstalledMod ? '3fr 1fr' : '3fr 1fr 1.5fr', 
                            padding: '12px 10px', 
                            borderRadius: '8px',
                            fontSize: '13px',
                            alignItems: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            border: isSelected ? '1px solid var(--primary)' : '1px solid transparent',
                            backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                            boxShadow: isSelected ? '0 0 10px rgba(99, 102, 241, 0.12)' : 'none',
                            borderLeft: mod.conflicts.length > 0 
                              ? '3px solid var(--error)' 
                              : isSelected 
                              ? '3px solid var(--primary)' 
                              : '3px solid transparent',
                            marginBottom: '4px'
                          }}
                          className="glass-card"
                        >
                          <div>
                            <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ color: isSelected ? 'var(--primary)' : 'var(--text-main)' }}>{mod.name}</span>
                              {modUpdates[mod.fileName] && (
                                <span 
                                  style={{ 
                                    backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                                    border: '1px solid rgba(16, 185, 129, 0.3)', 
                                    borderRadius: '4px', 
                                    padding: '1px 5px', 
                                    fontSize: '9px', 
                                    color: 'var(--success)',
                                    fontWeight: '600'
                                  }}
                                  title={`New version: ${modUpdates[mod.fileName].latestVersion}`}
                                >
                                  ✨ Update
                                </span>
                              )}
                              {mod.associatedFolders && mod.associatedFolders.length > 0 && (
                                <span 
                                  style={{ 
                                    backgroundColor: 'rgba(245, 158, 11, 0.1)', 
                                    border: '1px solid rgba(245, 158, 11, 0.3)', 
                                    borderRadius: '4px', 
                                    padding: '1px 5px', 
                                    fontSize: '9px', 
                                    color: 'var(--primary)',
                                    fontWeight: '500'
                                  }}
                                  title={`Associated folders: ${mod.associatedFolders.join(', ')}`}
                                >
                                  📂 {mod.associatedFolders.length} Data Folder{mod.associatedFolders.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-dark)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                              {mod.fileName}
                            </div>
                            {mod.conflicts.map((conf, cIdx) => (
                              <div key={cIdx} style={{ color: 'var(--error)', fontSize: '11px', marginTop: '4px' }}>
                                ⚠ {conf.details}
                              </div>
                            ))}
                          </div>
                          
                          <div onClick={(e) => e.stopPropagation()}>
                            <input 
                              type="checkbox"
                              checked={mod.isActive}
                              onChange={() => handleToggleMod(mod.fileName)}
                              disabled={isViewer}
                              style={{ cursor: isViewer ? 'not-allowed' : 'pointer', scale: '1.2', accentColor: 'var(--primary)' }}
                            />
                          </div>

                          {!selectedInstalledMod && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                              <span className="badge badge-warning" style={{ fontSize: '10px', padding: '2px 8px' }}>
                                {mod.modId !== 'manual' ? 'curseforge' : 'manual'}
                              </span>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                {modUpdates[mod.fileName] && (
                                  <button
                                    onClick={() => handleUpdateMod(mod.fileName, modUpdates[mod.fileName])}
                                    className="btn btn-primary"
                                    style={{ padding: '3px 8px', fontSize: '11px', backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--success)', color: 'var(--success)' }}
                                    disabled={isViewer || !!updatingMods[mod.fileName]}
                                  >
                                    Update
                                  </button>
                                )}
                                <button 
                                  onClick={() => handleDeleteMod(mod.fileName)} 
                                  className="btn btn-secondary" 
                                  style={{ padding: '3px 8px', fontSize: '11px', borderColor: 'rgba(244, 63, 94, 0.3)', color: 'var(--error)' }}
                                  disabled={isViewer}
                                >
                                  Uninstall
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Side: Selected Mod Details Panel */}
              {selectedInstalledMod && (
                <div className="glass-panel animate-fade-in" style={{ height: 'fit-content', border: '1px solid var(--border)', position: 'relative', padding: '20px' }}>
                  
                  {/* Close button */}
                  <button 
                    onClick={() => setSelectedInstalledMod(null)}
                    style={{
                      position: 'absolute',
                      top: '16px',
                      right: '16px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-dark)',
                      cursor: 'pointer',
                      fontSize: '18px',
                      transition: 'color 0.15s ease'
                    }}
                    onMouseEnter={(e) => e.target.style.color = 'var(--primary)'}
                    onMouseLeave={(e) => e.target.style.color = 'var(--text-dark)'}
                    title="Close Panel"
                  >
                    ✕
                  </button>

                  {loadingInstalledModDetails ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px' }}>
                      <div className="spinner" style={{ width: '32px', height: '32px', border: '3px solid rgba(255,255,255,0.05)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: '12px', color: 'var(--text-dark)' }}>Fetching CurseForge details...</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      
                      {/* Logo + Header */}
                      <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                        {selectedInstalledModDetails?.logoUrl ? (
                          <img 
                            src={selectedInstalledModDetails.logoUrl} 
                            alt={selectedInstalledMod.name} 
                            style={{ width: '64px', height: '64px', borderRadius: '12px', objectFit: 'cover', border: '1px solid var(--border)' }} 
                          />
                        ) : (
                          <div style={{ width: '64px', height: '64px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                            📦
                          </div>
                        )}
                        <div style={{ flex: 1, paddingRight: '24px' }}>
                          <h4 style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--primary)', margin: 0, fontFamily: 'var(--font-heading)' }}>
                            {selectedInstalledModDetails?.name || selectedInstalledMod.name}
                          </h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                            <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '1px 6px' }}>
                              {selectedInstalledMod.modId !== 'manual' ? 'CurseForge' : 'Manual Install'}
                            </span>
                            <span style={{ fontSize: '11px', color: selectedInstalledMod.isActive ? 'var(--success)' : 'var(--text-dark)', fontWeight: '600' }}>
                              ● {selectedInstalledMod.isActive ? 'Active' : 'Disabled'}
                            </span>
                          </div>
                          {selectedInstalledModDetails?.author && (
                            <div style={{ fontSize: '11px', color: 'var(--text-dark)', marginTop: '4px' }}>
                              By: <strong style={{ color: 'var(--text-muted)' }}>{selectedInstalledModDetails.author}</strong>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Technical Info */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', backgroundColor: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)', fontSize: '12px' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>File Size</span>
                          <div style={{ fontWeight: '600', color: 'var(--text-main)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                            {(selectedInstalledMod.size / (1024 * 1024)).toFixed(2)} MB
                          </div>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Date Updated</span>
                          <div style={{ fontWeight: '600', color: 'var(--text-main)', marginTop: '2px' }}>
                            {new Date(selectedInstalledMod.mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Local Path</span>
                          <div style={{ fontWeight: '500', color: 'var(--text-dark)', fontFamily: 'var(--font-mono)', marginTop: '2px', wordBreak: 'break-all' }}>
                            /mods/{selectedInstalledMod.fileName}
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
                          Summary
                        </span>
                        <p style={{ color: 'var(--text-main)', margin: 0 }}>
                          {selectedInstalledModDetails?.summary || selectedInstalledModDetails?.description || 'No summary details available for this manually installed mod.'}
                        </p>
                      </div>

                      {/* Active Conflicts warning box */}
                      {selectedInstalledMod.conflicts.length > 0 && (
                        <div style={{ border: '1px solid rgba(244, 63, 94, 0.25)', backgroundColor: 'rgba(244, 63, 94, 0.04)', borderRadius: '8px', padding: '12px', fontSize: '12px' }}>
                          <strong style={{ color: 'var(--error)', display: 'block', marginBottom: '6px' }}>⚠ Active Conflicts</strong>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {selectedInstalledMod.conflicts.map((conf, cIdx) => (
                              <div key={cIdx} style={{ color: 'var(--text-main)' }}>
                                {conf.details}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Associated Folders info */}
                      {selectedInstalledMod.associatedFolders && selectedInstalledMod.associatedFolders.length > 0 && (
                        <div style={{ border: '1px solid rgba(245, 158, 11, 0.2)', backgroundColor: 'rgba(245, 158, 11, 0.03)', borderRadius: '8px', padding: '12px', fontSize: '12px' }}>
                          <strong style={{ color: 'var(--primary)', display: 'block', marginBottom: '6px' }}>📂 Associated Directories</strong>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'var(--font-mono)', color: 'var(--text-dark)' }}>
                            {selectedInstalledMod.associatedFolders.map((folder, fIdx) => (
                              <div key={fIdx}>/ {folder}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Configurations section */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>
                          Configuration Files
                        </span>
                        {fetchingConfigs[selectedInstalledMod.fileName] ? (
                          <div style={{ fontSize: '12px', color: 'var(--text-dark)' }}>Scanning folders...</div>
                        ) : !modConfigsList[selectedInstalledMod.fileName] || modConfigsList[selectedInstalledMod.fileName].length === 0 ? (
                          <div style={{ fontSize: '12px', color: 'var(--text-dark)', padding: '10px', backgroundColor: 'rgba(255,255,255,0.01)', borderRadius: '6px', border: '1px dashed var(--border)' }}>
                            No editable configurations discovered.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                            {modConfigsList[selectedInstalledMod.fileName].map((cfg) => (
                              <div 
                                key={cfg.relPath}
                                style={{ 
                                  display: 'flex', 
                                  justifyContent: 'space-between', 
                                  alignItems: 'center', 
                                  padding: '8px 10px', 
                                  backgroundColor: 'rgba(255, 255, 255, 0.01)', 
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  border: '1px solid var(--border)'
                                }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, paddingRight: '12px' }}>
                                  <strong style={{ color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{cfg.name}</strong>
                                  <span style={{ fontSize: '10px', color: 'var(--text-dark)', fontFamily: 'var(--font-mono)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{cfg.relPath}</span>
                                </div>
                                <button
                                  onClick={() => handleEditConfig(cfg)}
                                  className="btn btn-primary"
                                  style={{ padding: '3px 8px', fontSize: '11px', flexShrink: 0 }}
                                >
                                  Edit
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Management Buttons */}
                      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                        <button
                          onClick={() => handleToggleMod(selectedInstalledMod.fileName)}
                          className="btn btn-secondary"
                          style={{ flex: 1, fontSize: '12px', padding: '8px 12px' }}
                          disabled={isViewer}
                        >
                          {selectedInstalledMod.isActive ? '⏸ Disable' : '▶ Enable'}
                        </button>

                        {modUpdates[selectedInstalledMod.fileName] && (
                          <button
                            onClick={() => handleUpdateMod(selectedInstalledMod.fileName, modUpdates[selectedInstalledMod.fileName])}
                            className="btn btn-primary"
                            style={{ flex: 1, fontSize: '12px', padding: '8px 12px', backgroundColor: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--success)', color: 'var(--success)' }}
                            disabled={isViewer || !!updatingMods[selectedInstalledMod.fileName]}
                          >
                            {updatingMods[selectedInstalledMod.fileName] ? 'Updating...' : '⚡ Update'}
                          </button>
                        )}

                        <button 
                          onClick={() => handleDeleteMod(selectedInstalledMod.fileName)} 
                          className="btn btn-secondary" 
                          style={{ flex: 1, fontSize: '12px', padding: '8px 12px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                          disabled={isViewer}
                        >
                          Uninstall
                        </button>
                      </div>

                    </div>
                  )}

                </div>
              )}

            </div>
          )}

          {/* Install New Mods Browser */}
          {modsSubTab === 'marketplace' && (
            <div className="glass-panel animate-fade-in">
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '20px' }}>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', marginBottom: '12px' }}>Mod Marketplace Discovery</h3>
                
                <form onSubmit={handleSearchMods} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
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
                    <option value="nexus">Nexus Mods (Manual Info)</option>
                  </select>

                  <select
                    value={modsSortBy}
                    onChange={(e) => setModsSortBy(e.target.value)}
                    style={{
                      backgroundColor: 'var(--bg-dark)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border)',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '13px'
                    }}
                  >
                    <option value="featured">⭐ Featured</option>
                    <option value="popularity">🔥 Popularity</option>
                    <option value="latest_released">📅 Latest Released</option>
                    <option value="latest_updated">🔄 Latest Updated</option>
                    <option value="name">🔤 Alphabetical</option>
                  </select>

                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search mods... (e.g. essentials, map)"
                    value={modsSearchQuery}
                    onChange={(e) => setModsSearchQuery(e.target.value)}
                    style={{ flex: 1, minWidth: '150px' }}
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
                  {remoteSearchError ? (
                    <div style={{ border: '1px solid rgba(245, 158, 11, 0.25)', backgroundColor: 'rgba(245, 158, 11, 0.04)', borderRadius: '10px', padding: '24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                      <span style={{ fontSize: '32px' }}>⚠️</span>
                      <strong style={{ color: 'var(--primary)', fontSize: '15px' }}>Discovery Service Offline</strong>
                      <p style={{ color: 'var(--text-main)', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
                        {remoteSearchError}
                      </p>
                      <a href="#/settings" className="btn btn-primary" style={{ display: 'inline-block', textDecoration: 'none', padding: '6px 16px', fontSize: '13px', marginTop: '4px' }}>
                        ⚙️ Configure API Keys
                      </a>
                    </div>
                  ) : remoteMods.length === 0 ? (
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dark)', marginTop: '8px', flexWrap: 'wrap', gap: '8px' }}>
                            <span>By: {mod.author}</span>
                            {mod.updatedAt && (
                              <span>Updated: {new Date(mod.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            )}
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
                                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                                    <span>{file.fileName}</span>
                                    <span>({(file.fileLength / (1024 * 1024)).toFixed(2)} MB)</span>
                                    {file.releaseDate && (
                                      <span style={{ color: 'var(--text-dark)' }}>
                                        Released: {new Date(file.releaseDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                      </span>
                                    )}
                                  </div>
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
          )}
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
                  onClick={openCreateScheduleModal} 
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
                          onClick={() => openEditScheduleModal(sched)} 
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
            <div className="glass-panel animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '20px' }}>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
                  Active Online Players
                </h3>
                <span className="badge badge-accent">
                  {onlinePlayers.length} {onlinePlayers.length === 1 ? 'Player' : 'Players'} Online
                </span>
              </div>
              
              {onlinePlayers.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px 0' }}>
                  No players currently online. The panel polls the active Hytale console session every 90 seconds.
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
                  {onlinePlayers.map((player) => {
                    const isWhitelisted = whitelistArray.includes(player);
                    const isBanned = bansArray.includes(player);
                    
                    return (
                      <div 
                        key={player} 
                        style={{ 
                          backgroundColor: 'var(--bg-panel-hover)', 
                          border: '1px solid var(--border)', 
                          borderRadius: '16px', 
                          padding: '20px', 
                          fontSize: '14px', 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '16px',
                          minWidth: '310px',
                          flex: '1 1 320px',
                          boxShadow: 'var(--shadow-lg)',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Header Details */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
                          <div style={getAvatarStyle(player)}>
                            {player.charAt(0).toUpperCase()}
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <strong style={{ color: 'var(--text-main)', fontSize: '17px' }}>{player}</strong>
                              <span className="status-dot active" style={{ width: '8px', height: '8px' }}></span>
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--success)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                              {getSessionDurationStr(player)}
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                            {isWhitelisted && (
                              <span className="badge badge-success" style={{ fontSize: '10px', padding: '2px 8px' }}>
                                Whitelisted
                              </span>
                            )}
                            {isBanned && (
                              <span className="badge badge-error" style={{ fontSize: '10px', padding: '2px 8px' }}>
                                Banned
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Direct Control Buttons */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '8px 12px', fontSize: '12px', justifyContent: 'center', gap: '6px' }}
                            onClick={() => handlePlayerCommand(`op add ${player}`)}
                            disabled={isViewer}
                          >
                            👑 Grant OP
                          </button>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '8px 12px', fontSize: '12px', justifyContent: 'center', gap: '6px' }}
                            onClick={() => handlePlayerCommand(`op remove ${player}`)}
                            disabled={isViewer}
                          >
                            🛡️ De-OP
                          </button>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '8px 12px', fontSize: '12px', justifyContent: 'center', gap: '6px' }}
                            onClick={() => handlePlayerCommand(`heal ${player}`)}
                            disabled={isViewer}
                          >
                            ❤️ Heal Player
                          </button>
                          <button 
                            className="btn btn-danger" 
                            style={{ padding: '8px 12px', fontSize: '12px', justifyContent: 'center', gap: '6px' }}
                            onClick={async () => {
                              if (await showConfirm(`Kick player ${player}?`, { title: 'Kick Player', confirmText: 'Kick', isDanger: true })) {
                                handlePlayerCommand(`kick ${player}`);
                              }
                            }}
                            disabled={isViewer}
                          >
                            🚪 Kick Player
                          </button>
                        </div>

                        {/* Interactive Dropdowns & Inputs */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.02)' }}>
                          {/* Gamemode Selector */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Game Mode:</span>
                            <select 
                              style={{ 
                                backgroundColor: '#050608', 
                                color: 'var(--text-main)', 
                                border: '1px solid var(--border)', 
                                borderRadius: '6px', 
                                padding: '6px 12px', 
                                fontSize: '12px',
                                outline: 'none',
                                cursor: isViewer ? 'not-allowed' : 'pointer'
                              }}
                              disabled={isViewer}
                              onChange={(e) => {
                                if (e.target.value) {
                                  handlePlayerCommand(`gamemode ${player} ${e.target.value}`);
                                  e.target.value = '';
                                }
                              }}
                            >
                              <option value="">Select mode...</option>
                              <option value="survival">Survival</option>
                              <option value="creative">Creative</option>
                              <option value="adventure">Adventure</option>
                              <option value="spectator">Spectator</option>
                            </select>
                          </div>

                          {/* TP Coordinates */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input 
                              id={`tp-coords-${player}`}
                              type="text" 
                              placeholder="Coords (x,y,z) or player" 
                              style={{ 
                                backgroundColor: '#050608', 
                                color: 'var(--text-main)', 
                                border: '1px solid var(--border)', 
                                borderRadius: '6px', 
                                padding: '6px 10px', 
                                fontSize: '12px', 
                                flex: '1',
                                outline: 'none'
                              }}
                              disabled={isViewer}
                            />
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '6px 12px', fontSize: '12px' }}
                              onClick={() => {
                                const input = document.getElementById(`tp-coords-${player}`);
                                const val = input ? input.value.trim() : '';
                                if (!val) {
                                  alert('Please specify target player or coordinates (e.g. 100,50,-200)');
                                  return;
                                }
                                const target = val.includes(',') ? val.split(',').map(c => c.trim()).join(' ') : val;
                                handlePlayerCommand(`tp ${player} ${target}`);
                              }}
                              disabled={isViewer}
                            >
                              ⚡ Teleport
                            </button>
                          </div>
                        </div>

                        {/* Ban Button Row */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '6px 12px', fontSize: '11px', borderColor: 'rgba(244, 63, 94, 0.3)', color: 'var(--error)' }}
                            onClick={async () => {
                              if (await showConfirm(`Ban player ${player} permanently?`, { title: 'Ban Player', confirmText: 'Ban', isDanger: true })) {
                                handlePlayerCommand(`ban ${player}`);
                              }
                            }}
                            disabled={isViewer}
                          >
                            🚫 Ban Permanently
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Access Permission Tag Editors */}
            <div className="glass-panel animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '24px' }}>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
                    Player Access Permissions
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px', margin: 0 }}>
                    Configure server Whitelist and Ban list rules instantly.
                  </p>
                </div>
                <button 
                  onClick={handleSavePlayers} 
                  className="btn btn-primary" 
                  disabled={savingPlayers || isViewer}
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                >
                  {savingPlayers ? 'Syncing...' : '💾 Save Access Lists'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
                
                {/* 1. Whitelist Card Tag Manager */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>
                      Whitelist Wholesome List
                    </span>
                    <span className="badge badge-success" style={{ fontSize: '11px' }}>
                      {whitelistArray.length} Players
                    </span>
                  </div>

                  {/* Tag Input */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text"
                      className="form-input"
                      placeholder="Add whitelisted player name..."
                      value={newWhitelistName}
                      disabled={isViewer}
                      onChange={(e) => setNewWhitelistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = newWhitelistName.trim();
                          if (val && !whitelistArray.includes(val)) {
                            setWhitelistArray([...whitelistArray, val]);
                            setNewWhitelistName('');
                          }
                        }
                      }}
                      style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
                    />
                    <button 
                      type="button" 
                      className="btn btn-primary"
                      disabled={isViewer}
                      onClick={() => {
                        const val = newWhitelistName.trim();
                        if (val && !whitelistArray.includes(val)) {
                          setWhitelistArray([...whitelistArray, val]);
                          setNewWhitelistName('');
                        }
                      }}
                      style={{ padding: '8px 14px', fontSize: '13px' }}
                    >
                      Add
                    </button>
                  </div>

                  {/* Tags Flex wrap list */}
                  <div style={{ 
                    minHeight: '140px', 
                    maxHeight: '220px', 
                    overflowY: 'auto', 
                    border: '1px dashed var(--border)', 
                    borderRadius: '8px', 
                    padding: '12px', 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    alignContent: 'flex-start',
                    gap: '8px',
                    backgroundColor: 'rgba(0,0,0,0.1)'
                  }}>
                    {whitelistArray.length === 0 ? (
                      <div style={{ color: 'var(--text-dark)', fontSize: '12px', margin: 'auto', textAlign: 'center' }}>
                        No players currently whitelisted. Whitelist is idle.
                      </div>
                    ) : (
                      whitelistArray.map((player) => (
                        <div 
                          key={player}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: 'var(--primary-glow)',
                            border: '1px solid var(--primary)',
                            borderRadius: '20px',
                            padding: '4px 10px',
                            color: 'var(--text-main)',
                            fontSize: '12px',
                            fontWeight: '500'
                          }}
                        >
                          <span>{player}</span>
                          <button
                            type="button"
                            disabled={isViewer}
                            onClick={() => setWhitelistArray(whitelistArray.filter(p => p !== player))}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--text-muted)',
                              cursor: isViewer ? 'not-allowed' : 'pointer',
                              fontSize: '14px',
                              padding: '0 2px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 2. Ban Card Tag Manager */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>
                      Permanent Blacklist list
                    </span>
                    <span className="badge badge-error" style={{ fontSize: '11px' }}>
                      {bansArray.length} Players
                    </span>
                  </div>

                  {/* Tag Input */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text"
                      className="form-input"
                      placeholder="Add banned player name..."
                      value={newBanName}
                      disabled={isViewer}
                      onChange={(e) => setNewBanName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = newBanName.trim();
                          if (val && !bansArray.includes(val)) {
                            setBansArray([...bansArray, val]);
                            setNewBanName('');
                          }
                        }
                      }}
                      style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
                    />
                    <button 
                      type="button" 
                      className="btn btn-primary"
                      disabled={isViewer}
                      onClick={() => {
                        const val = newBanName.trim();
                        if (val && !bansArray.includes(val)) {
                          setBansArray([...bansArray, val]);
                          setNewBanName('');
                        }
                      }}
                      style={{ padding: '8px 14px', fontSize: '13px' }}
                    >
                      Add
                    </button>
                  </div>

                  {/* Tags Flex wrap list */}
                  <div style={{ 
                    minHeight: '140px', 
                    maxHeight: '220px', 
                    overflowY: 'auto', 
                    border: '1px dashed var(--border)', 
                    borderRadius: '8px', 
                    padding: '12px', 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    alignContent: 'flex-start',
                    gap: '8px',
                    backgroundColor: 'rgba(0,0,0,0.1)'
                  }}>
                    {bansArray.length === 0 ? (
                      <div style={{ color: 'var(--text-dark)', fontSize: '12px', margin: 'auto', textAlign: 'center' }}>
                        No players currently banned. Ban lists are clear.
                      </div>
                    ) : (
                      bansArray.map((player) => (
                        <div 
                          key={player}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: 'rgba(244, 63, 94, 0.08)',
                            border: '1px solid var(--error)',
                            borderRadius: '20px',
                            padding: '4px 10px',
                            color: 'var(--text-main)',
                            fontSize: '12px',
                            fontWeight: '500'
                          }}
                        >
                          <span>{player}</span>
                          <button
                            type="button"
                            disabled={isViewer}
                            onClick={() => setBansArray(bansArray.filter(p => p !== player))}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--text-muted)',
                              cursor: isViewer ? 'not-allowed' : 'pointer',
                              fontSize: '14px',
                              padding: '0 2px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            </div>

            {/* 3. Player statistics dashboard */}
            <div className="glass-panel animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
                    Aggregated Player Statistics
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px', margin: 0 }}>
                    Playtime records and connection stats calculated from server stdout history logs.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Search stats name..." 
                    value={statsSearchQuery} 
                    onChange={(e) => setStatsSearchQuery(e.target.value)}
                    style={{ width: '220px', padding: '6px 12px', fontSize: '12px' }}
                  />
                  <button 
                    className="btn btn-secondary" 
                    onClick={fetchPlayerStats} 
                    disabled={statsLoading}
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                  >
                    {statsLoading ? 'Scanning...' : '🔄 Recalculate Stats'}
                  </button>
                </div>
              </div>

              {statsLoading ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '48px 0', textAlign: 'center' }}>
                  Reconstructing player session timelines from database console logs...
                </div>
              ) : playerStats.length === 0 ? (
                <div style={{ color: 'var(--text-dark)', fontSize: '14px', padding: '48px 0', textAlign: 'center' }}>
                  No player sessions registered yet. Connect to the server to establish log stats.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1.5fr 1fr', padding: '10px 12px', color: 'var(--text-muted)', fontSize: '12px', borderBottom: '1px solid var(--border)', fontWeight: '600' }}>
                    <div>Player Identity</div>
                    <div>Total Playtime</div>
                    <div>Sessions count</div>
                    <div>Last Active Date</div>
                    <div style={{ textAlign: 'right' }}>Permission Actions</div>
                  </div>

                  {playerStats
                    .filter(p => !statsSearchQuery || p.username.toLowerCase().includes(statsSearchQuery.toLowerCase()))
                    .map((p) => {
                      const isWhitelisted = whitelistArray.includes(p.username);
                      const isBanned = bansArray.includes(p.username);

                      return (
                        <div 
                          key={p.username} 
                          style={{ 
                            display: 'grid', 
                            gridTemplateColumns: '1.5fr 1fr 1fr 1.5fr 1fr', 
                            padding: '12px', 
                            borderRadius: '8px', 
                            fontSize: '13px', 
                            alignItems: 'center' 
                          }}
                          className="glass-card"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={getAvatarStyle(p.username)}>
                              {p.username.charAt(0).toUpperCase()}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <strong style={{ color: 'var(--text-main)', fontSize: '14px' }}>{p.username}</strong>
                              <span style={{ fontSize: '10px', color: p.isOnline ? 'var(--success)' : 'var(--text-dark)' }}>
                                {p.isOnline ? 'Active Online' : 'Offline'}
                              </span>
                            </div>
                          </div>

                          <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {formatPlaytime(p.playtimeMs)}
                          </div>

                          <div style={{ color: 'var(--text-muted)' }}>
                            {p.sessionCount} connections
                          </div>

                          <div style={{ color: 'var(--text-dark)', fontSize: '12px' }}>
                            {new Date(p.lastActive).toLocaleString()}
                          </div>

                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ 
                                padding: '4px 10px', 
                                fontSize: '11px', 
                                borderColor: isWhitelisted ? 'var(--primary)' : 'rgba(255,255,255,0.08)',
                                color: isWhitelisted ? 'var(--primary)' : 'var(--text-muted)'
                              }}
                              disabled={isViewer}
                              onClick={() => {
                                if (isWhitelisted) {
                                  setWhitelistArray(whitelistArray.filter(x => x !== p.username));
                                } else {
                                  setWhitelistArray([...whitelistArray, p.username]);
                                }
                              }}
                            >
                              {isWhitelisted ? '✔ Whitelisted' : 'Whitelist'}
                            </button>
                            
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ 
                                padding: '4px 10px', 
                                fontSize: '11px', 
                                borderColor: isBanned ? 'var(--error)' : 'rgba(255,255,255,0.08)',
                                color: isBanned ? 'var(--error)' : 'var(--text-muted)'
                              }}
                              disabled={isViewer}
                              onClick={() => {
                                if (isBanned) {
                                  setBansArray(bansArray.filter(x => x !== p.username));
                                } else {
                                  setBansArray([...bansArray, p.username]);
                                }
                              }}
                            >
                              {isBanned ? '🚫 Banned' : 'Ban'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Player Connection History Log */}
            <div className="glass-panel animate-fade-in" style={{ marginTop: '-16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
                    Recent Connection History
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px', margin: 0 }}>
                    Historical logs and records of connection sessions.
                  </p>
                </div>
                
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Search logs player..." 
                    value={historySearchQuery} 
                    onChange={(e) => {
                      setHistorySearchQuery(e.target.value);
                      fetchPlayerHistory(e.target.value, historyEventFilter);
                    }}
                    style={{ width: '200px', padding: '6px 12px', fontSize: '12px' }}
                  />

                  <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', height: '30px' }}>
                    {['all', 'join', 'leave'].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setHistoryEventFilter(t);
                          fetchPlayerHistory(historySearchQuery, t);
                        }}
                        style={{
                          backgroundColor: historyEventFilter === t ? 'rgba(255,255,255,0.06)' : 'transparent',
                          color: historyEventFilter === t ? 'var(--primary)' : 'var(--text-muted)',
                          border: 'none',
                          padding: '0 12px',
                          fontSize: '11px',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          outline: 'none'
                        }}
                      >
                        {t === 'all' ? 'All' : t === 'join' ? 'Joins' : 'Leaves'}
                      </button>
                    ))}
                  </div>

                  <button 
                    className="btn btn-secondary" 
                    style={{ padding: '6px 12px', fontSize: '12px' }} 
                    onClick={() => fetchPlayerHistory(historySearchQuery, historyEventFilter)}
                  >
                    🔄 Refresh
                  </button>
                </div>
              </div>

              {playerHistory.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px 0' }}>
                  No connection events recorded yet. Connect to the server to populate logs.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '380px', overflowY: 'auto', paddingRight: '8px' }}>
                  {playerHistory.map((item, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        padding: '12px 16px', 
                        backgroundColor: 'rgba(255,255,255,0.01)', 
                        border: '1px solid var(--border)', 
                        borderRadius: '8px',
                        fontSize: '13px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span 
                          style={{ 
                            width: '8px', 
                            height: '8px', 
                            borderRadius: '50%', 
                            backgroundColor: item.event === 'join' ? 'var(--success)' : 'var(--error)',
                            boxShadow: item.event === 'join' ? '0 0 8px var(--success)' : '0 0 8px var(--error)'
                          }}
                        ></span>
                        <strong style={{ color: 'var(--text-main)' }}>{item.player}</strong>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {item.event === 'join' ? 'joined the server' : 'left the server'}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: 'var(--text-dark)', fontSize: '11px' }}>
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                        {item.event === 'leave' && (
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                            onClick={async () => {
                              if (await showConfirm(`Ban player ${item.player} permanently?`, { title: 'Ban Player', confirmText: 'Ban', isDanger: true })) {
                                handlePlayerCommand(`ban ${item.player}`);
                              }
                            }}
                            disabled={isViewer}
                          >
                            🚫 Ban
                          </button>
                        )}
                        {item.event === 'join' && (
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                            onClick={async () => {
                              if (await showConfirm(`Kick player ${item.player}?`, { title: 'Kick Player', confirmText: 'Kick', isDanger: true })) {
                                handlePlayerCommand(`kick ${item.player}`);
                              }
                            }}
                            disabled={isViewer}
                          >
                            🚪 Kick
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                  <label className="form-label">Scheduled Daily Restart (24h Format)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 04:00"
                    value={restartSchedule}
                    onChange={(e) => setRestartSchedule(e.target.value)}
                    disabled={isViewer}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>Enter a daily restart time in 24-hour HH:mm format, or leave empty to disable.</span>
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

                <div className="form-group">
                  <label className="form-label">Server Type</label>
                  <select
                    value={serverType}
                    onChange={(e) => setServerType(e.target.value)}
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
                    <option value="Use Global Default">Use Global Default</option>
                    <option value="latest">latest</option>
                    <option value="0.2.0">0.2.0</option>
                    <option value="0.1.0">0.1.0</option>
                  </select>
                  <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>Change the specific Hytale core version or choose to inherit the global default.</span>
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

        {/* 7. DIAGNOSTICS & LOGGER TAB */}
        {activeTab === 'logger' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            
            {/* 1. Log Statistics Dashboard */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
              
              {/* Card 1: Total Lines */}
              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                  Total Log Entries
                </span>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: '28px', fontWeight: 'bold', color: 'var(--text-main)' }}>
                    {logs.length}
                  </span>
                  <span style={{ fontSize: '24px' }}>📄</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dark)' }}>
                  Stored in buffer and scanned historically
                </div>
              </div>

              {/* Card 2: Critical Failures */}
              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--error)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                  Critical Exceptions
                </span>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: '28px', fontWeight: 'bold', color: 'var(--error)' }}>
                    {diagnostics.filter(d => d.severity === 'error').length}
                  </span>
                  <span style={{ fontSize: '24px' }}>⚠️</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dark)' }}>
                  Failed library loading or JVM issues
                </div>
              </div>

              {/* Card 3: Warnings */}
              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                  System Warnings
                </span>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: '28px', fontWeight: 'bold', color: 'var(--primary)' }}>
                    {diagnostics.filter(d => d.severity === 'warning').length}
                  </span>
                  <span style={{ fontSize: '24px' }}>⚡</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dark)' }}>
                  Performance lag & deprecated warnings
                </div>
              </div>

              {/* Card 4: Health Status */}
              <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                  Diagnostics Status
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                  {diagnostics.filter(d => d.severity === 'error').length > 0 ? (
                    <>
                      <div className="status-dot warning" style={{ width: '12px', height: '12px' }} />
                      <span className="badge badge-error" style={{ fontSize: '12px', padding: '6px 12px' }}>
                        ERRORS DETECTED
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="status-dot active" style={{ width: '12px', height: '12px' }} />
                      <span className="badge badge-success" style={{ fontSize: '12px', padding: '6px 12px' }}>
                        BOOT HEALTHY
                      </span>
                    </>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dark)', marginTop: '4px' }}>
                  Server diagnostic scanner state
                </div>
              </div>

            </div>

            {/* 2. Interactive Diagnostics Scanner */}
            <div className="glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
                    Exception & Issue Classifier
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                    Historical and real-time scanned logs analyzed for immediate resolution guides.
                  </p>
                </div>
                
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button 
                    onClick={fetchDiagnostics} 
                    className="btn btn-secondary" 
                    disabled={isDiagnosticsLoading}
                    style={{ padding: '6px 16px', fontSize: '13px' }}
                  >
                    {isDiagnosticsLoading ? 'Scanning...' : '🔄 Run Diagnostic Scan'}
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                {['all', 'error', 'warning'].map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setDiagFilter(sev)}
                    className="btn"
                    style={{
                      padding: '4px 12px',
                      fontSize: '11px',
                      borderRadius: '6px',
                      backgroundColor: diagFilter === sev ? 'var(--primary-glow)' : 'rgba(0,0,0,0.2)',
                      borderColor: diagFilter === sev ? 'var(--primary)' : 'var(--border)',
                      color: diagFilter === sev ? 'var(--primary)' : 'var(--text-muted)',
                      textTransform: 'uppercase',
                      fontWeight: '600'
                    }}
                  >
                    {sev === 'all' ? 'All Issues' : `${sev}s`}
                  </button>
                ))}
              </div>

              {isDiagnosticsLoading ? (
                <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                  Scanning SQLite database logs history for Hytale server...
                </div>
              ) : diagnostics.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-dark)', fontSize: '14px' }}>
                  No issues caught in log history. Hytale server boot sequence is clean and healthy.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {diagnostics
                    .filter(d => diagFilter === 'all' || d.severity === diagFilter)
                    .map((issue, idx) => (
                      <div 
                        key={idx}
                        className="glass-panel"
                        style={{
                          padding: '20px',
                          borderLeft: issue.severity === 'error' ? '4px solid var(--error)' : '4px solid var(--primary)',
                          backgroundColor: issue.severity === 'error' ? 'rgba(244, 63, 94, 0.02)' : 'rgba(245, 158, 11, 0.02)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span className={issue.severity === 'error' ? 'badge badge-error' : 'badge badge-warning'}>
                              {issue.severity}
                            </span>
                            <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)', fontFamily: 'var(--font-heading)' }}>
                              {issue.title || 'Log Exception Pattern'}
                            </span>
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--text-dark)', fontFamily: 'var(--font-mono)' }}>
                            Logged at: {issue.created_at || 'just now'}
                          </span>
                        </div>

                        <div style={{ backgroundColor: '#050608', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', overflowX: 'auto' }}>
                          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--error)' }}>
                            {issue.line}
                          </code>
                        </div>

                        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            <strong style={{ color: 'var(--primary)' }}>Diagnostics & Remediation:</strong> {issue.hint}
                          </div>
                          
                          <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                            {issue.type === 'dependency' && (
                              <button 
                                onClick={() => setActiveTab('mods')}
                                className="btn btn-secondary"
                                style={{ padding: '4px 12px', fontSize: '11px', fontWeight: '600', borderColor: 'var(--primary-border)', color: 'var(--primary)' }}
                              >
                                📦 Go to Mod Manager
                              </button>
                            )}
                            {issue.type === 'conflict' && (
                              <button 
                                onClick={() => setActiveTab('mods')}
                                className="btn btn-secondary"
                                style={{ padding: '4px 12px', fontSize: '11px', fontWeight: '600', borderColor: 'var(--primary-border)', color: 'var(--primary)' }}
                              >
                                💥 Resolve Conflicts
                              </button>
                            )}
                            {issue.line.toLowerCase().includes('java') && (
                              <button 
                                onClick={() => setActiveTab('config')}
                                className="btn btn-secondary"
                                style={{ padding: '4px 12px', fontSize: '11px', fontWeight: '600', borderColor: 'var(--primary-border)', color: 'var(--primary)' }}
                              >
                                ⚙️ Configure JVM / Java
                              </button>
                            )}
                            <button 
                              onClick={() => setActiveTab('files')}
                              className="btn btn-secondary"
                              style={{ padding: '4px 12px', fontSize: '11px' }}
                            >
                              📂 Browse Files
                            </button>
                            <button 
                              onClick={() => showError(issue.hint, { title: issue.title || 'Log Exception Pattern', details: issue.line })}
                              className="btn btn-primary"
                              style={{ padding: '4px 12px', fontSize: '11px' }}
                            >
                              🔍 View Exception Details
                            </button>
                          </div>
                        </div>

                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* 3. Log Explorer Console */}
            <div className="glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>
                    Log Explorer & Console History
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                    Inspect, search, and export persistent console outputs stored in the SQLite database.
                  </p>
                </div>
                
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button 
                    onClick={handleDownloadLogs} 
                    className="btn btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '13px' }}
                    disabled={logs.length === 0}
                  >
                    📥 Download Filtered Logs
                  </button>
                  <button 
                    onClick={handleClearLogsHistory} 
                    className="btn btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '13px', borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--error)' }}
                    disabled={logs.length === 0 || isViewer}
                  >
                    🗑️ Wipe Logs Database
                  </button>
                </div>
              </div>

              {/* Console search & stream filters bar */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search logs pattern..."
                    value={diagSearch}
                    onChange={(e) => setDiagSearch(e.target.value)}
                    style={{ width: '100%', paddingLeft: '36px', height: '36px', fontSize: '13px' }}
                  />
                  <span style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-dark)' }}>🔍</span>
                  {diagSearch && (
                    <button 
                      onClick={() => setDiagSearch('')}
                      style={{ position: 'absolute', right: '12px', top: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>STREAM:</span>
                  {['all', 'stdout', 'stderr', 'sent'].map((stream) => (
                    <button
                      key={stream}
                      onClick={() => setLogsFilter(stream)}
                      className="btn"
                      style={{
                        padding: '4px 12px',
                        fontSize: '11px',
                        borderRadius: '6px',
                        backgroundColor: logsFilter === stream ? 'var(--primary-glow)' : 'rgba(0,0,0,0.2)',
                        borderColor: logsFilter === stream ? 'var(--primary)' : 'var(--border)',
                        color: logsFilter === stream ? 'var(--primary)' : 'var(--text-muted)',
                        textTransform: 'uppercase',
                        fontWeight: '600'
                      }}
                    >
                      {stream === 'sent' ? 'Input Cmds' : stream}
                    </button>
                  ))}
                </div>
              </div>

              {/* Terminal View Panel */}
              <div 
                className="console-terminal"
                style={{
                  backgroundColor: '#040508',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '20px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  lineHeight: '1.6',
                  height: '450px',
                  overflowY: 'auto',
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
              >
                {logs.length === 0 ? (
                  <div style={{ color: 'var(--text-dark)', textAlign: 'center', marginTop: '180px' }}>
                    No console logs history retrieved. Run the server to stream outputs.
                  </div>
                ) : (
                  (() => {
                    const filtered = logs.filter(line => {
                      // Stream filtering
                      if (logsFilter !== 'all') {
                        if (logsFilter === 'sent' && !line.startsWith('>')) return false;
                        if (logsFilter === 'stdout' && (line.startsWith('>') || line.toLowerCase().includes('err') || line.toLowerCase().includes('exception'))) return false;
                        if (logsFilter === 'stderr' && !line.startsWith('>') && (line.toLowerCase().includes('err') || line.toLowerCase().includes('exception'))) return true;
                      }

                      // Search filtering
                      if (diagSearch && !cleanAnsiCodes(line).toLowerCase().includes(diagSearch.toLowerCase())) {
                        return false;
                      }
                      return true;
                    });

                    if (filtered.length === 0) {
                      return (
                        <div style={{ color: 'var(--text-dark)', textAlign: 'center', marginTop: '180px' }}>
                          No log lines match the search criteria.
                        </div>
                      );
                    }

                    return filtered.map((line, idx) => {
                      const isError = line.toLowerCase().includes('error') || line.toLowerCase().includes('exception') || line.toLowerCase().includes('fatal');
                      const isWarning = line.toLowerCase().includes('warn') || line.toLowerCase().includes('warning');
                      const isCommand = line.startsWith('>');

                      let color = 'rgba(255,255,255,0.85)';
                      if (isError) color = 'var(--error)';
                      else if (isWarning) color = 'var(--primary)';
                      else if (isCommand) color = 'var(--secondary)';

                      return (
                        <div 
                          key={idx} 
                          style={{ 
                            color, 
                            whiteSpace: 'pre-wrap', 
                            wordBreak: 'break-all',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            backgroundColor: isError ? 'rgba(244, 63, 94, 0.05)' : 'transparent'
                          }}
                        >
                          {renderLineWithLinks(cleanAnsiCodes(line))}
                        </div>
                      );
                    });
                  })()
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dark)', marginTop: '8px' }}>
                <span>Showing up to 200 buffered database log lines</span>
                <span>Click parsed links to open documentation references</span>
              </div>
            </div>
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
                <div className="form-group animate-fade-in" style={{ marginBottom: '16px' }}>
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

              {/* Mode Toggle Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px', gap: '16px' }}>
                <button
                  type="button"
                  onClick={() => setSchedModalMode('simple')}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderBottom: schedModalMode === 'simple' ? '2px solid var(--primary)' : '2px solid transparent',
                    color: schedModalMode === 'simple' ? 'var(--primary)' : 'var(--text-muted)',
                    padding: '8px 0',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  Simple Builder
                </button>
                <button
                  type="button"
                  onClick={() => setSchedModalMode('advanced')}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderBottom: schedModalMode === 'advanced' ? '2px solid var(--primary)' : '2px solid transparent',
                    color: schedModalMode === 'advanced' ? 'var(--primary)' : 'var(--text-muted)',
                    padding: '8px 0',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  Advanced (Cron)
                </button>
              </div>

              {/* Simple Picker Options */}
              {schedModalMode === 'simple' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: '8px' }}>
                    <label className="form-label">Frequency</label>
                    <select
                      value={simpleSchedFreq}
                      onChange={(e) => setSimpleSchedFreq(e.target.value)}
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
                      <option value="interval">Repeat every N Minutes</option>
                      <option value="hourly">Run every Hour</option>
                      <option value="everyXHours">Run every N Hours</option>
                      <option value="daily">Run Daily</option>
                      <option value="weekly">Run Weekly</option>
                    </select>
                  </div>

                  {simpleSchedFreq === 'interval' && (
                    <div className="form-group animate-fade-in" style={{ marginBottom: '8px' }}>
                      <label className="form-label">Minute Interval</label>
                      <select
                        value={simpleSchedIntervalMin}
                        onChange={(e) => setSimpleSchedIntervalMin(parseInt(e.target.value, 10))}
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
                        <option value="5">Every 5 minutes</option>
                        <option value="10">Every 10 minutes</option>
                        <option value="15">Every 15 minutes</option>
                        <option value="30">Every 30 minutes</option>
                      </select>
                    </div>
                  )}

                  {simpleSchedFreq === 'hourly' && (
                    <div className="form-group animate-fade-in" style={{ marginBottom: '8px' }}>
                      <label className="form-label">Minute of the Hour</label>
                      <input
                        type="number"
                        className="form-input"
                        min="0"
                        max="59"
                        placeholder="e.g. 0 (at the start of the hour)"
                        value={simpleSchedMinute}
                        onChange={(e) => setSimpleSchedMinute(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                        required
                      />
                    </div>
                  )}

                  {simpleSchedFreq === 'everyXHours' && (
                    <div style={{ display: 'flex', gap: '12px' }} className="animate-fade-in">
                      <div className="form-group" style={{ flex: 1, marginBottom: '8px' }}>
                        <label className="form-label">Hour Step</label>
                        <select
                          value={simpleSchedHourStep}
                          onChange={(e) => setSimpleSchedHourStep(parseInt(e.target.value, 10))}
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
                          <option value="2">Every 2 hours</option>
                          <option value="3">Every 3 hours</option>
                          <option value="4">Every 4 hours</option>
                          <option value="6">Every 6 hours</option>
                          <option value="8">Every 8 hours</option>
                          <option value="12">Every 12 hours</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ flex: 1, marginBottom: '8px' }}>
                        <label className="form-label">At Minute</label>
                        <input
                          type="number"
                          className="form-input"
                          min="0"
                          max="59"
                          value={simpleSchedMinute}
                          onChange={(e) => setSimpleSchedMinute(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                          required
                        />
                      </div>
                    </div>
                  )}

                  {simpleSchedFreq === 'daily' && (
                    <div className="form-group animate-fade-in" style={{ marginBottom: '8px' }}>
                      <label className="form-label">Trigger Time</label>
                      <input
                        type="time"
                        className="form-input"
                        value={simpleSchedDailyTime}
                        onChange={(e) => setSimpleSchedDailyTime(e.target.value || '00:00')}
                        required
                      />
                    </div>
                  )}

                  {simpleSchedFreq === 'weekly' && (
                    <div style={{ display: 'flex', gap: '12px' }} className="animate-fade-in">
                      <div className="form-group" style={{ flex: 1, marginBottom: '8px' }}>
                        <label className="form-label">Day of the Week</label>
                        <select
                          value={simpleSchedWeeklyDay}
                          onChange={(e) => setSimpleSchedWeeklyDay(parseInt(e.target.value, 10))}
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
                          <option value="1">Monday</option>
                          <option value="2">Tuesday</option>
                          <option value="3">Wednesday</option>
                          <option value="4">Thursday</option>
                          <option value="5">Friday</option>
                          <option value="6">Saturday</option>
                          <option value="0">Sunday</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ flex: 1, marginBottom: '8px' }}>
                        <label className="form-label">Trigger Time</label>
                        <input
                          type="time"
                          className="form-input"
                          value={simpleSchedWeeklyTime}
                          onChange={(e) => setSimpleSchedWeeklyTime(e.target.value || '00:00')}
                          required
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Advanced Raw Input */}
              {schedModalMode === 'advanced' && (
                <div className="form-group animate-fade-in" style={{ marginBottom: '8px' }}>
                  <label className="form-label">Cron Expression (5-field)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 0 4 * * * (daily 4 AM)"
                    value={schedCron}
                    onChange={(e) => setSchedCron(e.target.value)}
                    required
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-dark)', marginTop: '4px' }}>Format: minute hour day-of-month month day-of-week</span>
                </div>
              )}

              {/* Live Preview Box */}
              <div 
                style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.02)', 
                  border: '1px dashed var(--border)', 
                  borderRadius: '8px', 
                  padding: '12px 16px', 
                  marginTop: '16px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '6px' 
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Resulting Cron
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 'bold', color: 'var(--primary)' }}>
                    {schedCron}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--primary)' }}>⏰</span>
                  <span>{explainCron(schedCron)}</span>
                </div>
              </div>

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
  );
}
