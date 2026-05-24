const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const config = require('../config');
const logger = require('../utils/logger');
const { HttpError } = require('../middleware/errorHandler');
const AdmZip = require('adm-zip');

// Event emitter to broadcast logs and status changes (e.g. to WebSocket)
const serverEvents = new EventEmitter();

// In-memory active child processes: Map<serverId, { proc, startedAt }>
const activeProcesses = new Map();

// Helper to classify logs for console issue catcher
function classifyConsoleIssue(line, stream) {
  const lowercase = line.toLowerCase();
  
  const isProblematic = 
    stream === 'stderr' ||
    lowercase.includes('error') ||
    lowercase.includes('exception') ||
    lowercase.includes('fatal') ||
    lowercase.includes('failed') ||
    lowercase.includes('failure') ||
    lowercase.includes('crash') ||
    lowercase.includes('could not') ||
    lowercase.includes('unable to') ||
    lowercase.includes('nosuchfileexception') ||
    lowercase.includes('classnotfoundexception') ||
    lowercase.includes('noclassdeffounderror') ||
    lowercase.includes('nullpointerexception') ||
    lowercase.includes('illegalstateexception') ||
    lowercase.includes('stacktrace') ||
    lowercase.includes('warn') ||
    lowercase.includes('warning') ||
    lowercase.includes('missing dependency') ||
    lowercase.includes('incompatible') ||
    lowercase.includes('conflict') ||
    lowercase.includes('deprecated');

  if (!isProblematic) return null;

  const isModRelated = 
    lowercase.includes('mod') ||
    lowercase.includes('plugin') ||
    lowercase.includes('.jar') ||
    lowercase.includes('dependency') ||
    lowercase.includes('manifest') ||
    lowercase.includes('loader') ||
    lowercase.includes('classpath') ||
    lowercase.includes('permission') ||
    lowercase.includes('resourcepack') ||
    lowercase.includes('datapack');

  let title = 'General Log Warning';
  let hint = 'Check the log line details for warnings/errors.';
  let type = 'general';
  let severity = lowercase.includes('error') || lowercase.includes('fatal') || lowercase.includes('exception') ? 'error' : 'warning';

  if (lowercase.includes('classnotfoundexception') || lowercase.includes('noclassdeffounderror')) {
    title = 'Missing Class or Library';
    hint = 'A mod may require another library or a different Hytale build.';
    type = 'dependency';
  } else if (isModRelated && (lowercase.includes('incompatible') || lowercase.includes('conflict'))) {
    title = 'Mod Conflict Detected';
    hint = 'Check mod versions and dependencies for version conflicts.';
    type = 'conflict';
  } else if (lowercase.includes('nosuchfileexception') || lowercase.includes('could not find file')) {
    title = 'Missing Config or Data File';
    hint = 'The server is looking for a file that does not exist.';
    type = 'file';
  }

  // Attempt to extract mod filename
  let modFile = null;
  const jarMatch = line.match(/[\w\-]+\.jar/);
  if (jarMatch) {
    modFile = jarMatch[0];
  }

  return {
    severity,
    type,
    title,
    hint,
    modFile,
    line,
  };
}

const onlinePlayers = new Map();

function getOnlinePlayers(serverId) {
  const set = onlinePlayers.get(parseInt(serverId, 10));
  return set ? Array.from(set) : [];
}

function broadcastPlayers(serverId) {
  serverEvents.emit('players', {
    serverId: parseInt(serverId, 10),
    type: 'players',
    players: getOnlinePlayers(serverId),
  });
}

function parsePlayersFromLog(serverId, line) {
  // Join/login matcher
  const joinMatch = line.match(/\[?(\w+)\]? (?:joined the game|connected|logged in)/i);
  if (joinMatch) {
    const username = joinMatch[1];
    const id = parseInt(serverId, 10);
    if (!onlinePlayers.has(id)) {
      onlinePlayers.set(id, new Set());
    }
    onlinePlayers.get(id).add(username);
    broadcastPlayers(id);
    return;
  }

  // Leave/logout matcher
  const leaveMatch = line.match(/\[?(\w+)\]? (?:left the game|disconnected|logged out)/i);
  if (leaveMatch) {
    const username = leaveMatch[1];
    const id = parseInt(serverId, 10);
    if (onlinePlayers.has(id)) {
      onlinePlayers.get(id).delete(username);
      broadcastPlayers(id);
    }
    return;
  }

  // Hytale /who command response matcher (e.g. "default (1): : Maximilkian (Maximilkian)")
  const whoMatch = line.match(/^\s*[\w\-]+\s*\((\d+)\):\s*:\s*(.*)/i);
  if (whoMatch) {
    const playersStr = whoMatch[2].trim();
    const id = parseInt(serverId, 10);
    const set = new Set();
    if (playersStr) {
      const parts = playersStr.split(',').map(p => p.trim());
      for (const part of parts) {
        const nameMatch = part.match(/^([^\s\()]+)/);
        if (nameMatch) {
          set.add(nameMatch[1]);
        }
      }
    }
    onlinePlayers.set(id, set);
    broadcastPlayers(id);
    return;
  }

  // List command response matcher
  const listMatch = line.match(/(?:players online|online players|players):\s*(.*)/i);
  if (listMatch) {
    const namesStr = listMatch[1].trim();
    const id = parseInt(serverId, 10);
    const set = new Set();
    if (namesStr && namesStr !== 'none' && !namesStr.includes('0/')) {
      const names = namesStr.split(',').map(n => n.trim()).filter(n => n.length > 0);
      for (const name of names) {
        set.add(name);
      }
    }
    onlinePlayers.set(id, set);
    broadcastPlayers(id);
  }
}

// Read and buffer lines from stream
function bindLogStream(db, serverId, stream, rawStream) {
  const rl = readline.createInterface({
    input: rawStream,
    terminal: false,
  });

  rl.on('line', (line) => {
    // 1. Persist log to DB
    try {
      db.prepare('INSERT INTO server_logs (server_id, stream, line) VALUES (?, ?, ?)')
        .run(serverId, stream, line);
    } catch (err) {
      logger.error(`Failed to write server log to DB for server ${serverId}`, err);
    }

    // 2. Classify issue
    const issue = classifyConsoleIssue(line, stream);

    // 3. Parse players
    if (stream === 'stdout') {
      parsePlayersFromLog(serverId, line);
    }

    // 4. Emit event to WebSockets
    serverEvents.emit('log', {
      serverId,
      stream,
      line,
      ts: Date.now(),
      issue,
    });
  });
}

function getServer(db, id) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!server) {
    throw new HttpError(404, 'Server not found.');
  }
  return rowToServer(server);
}

function rowToServer(row) {
  return {
    ...row,
    autostart: row.autostart === 1,
    isRunning: activeProcesses.has(row.id),
  };
}

async function startServer(db, id) {
  const server = getServer(db, id);
  if (server.isRunning) {
    throw new HttpError(400, 'Server is already running.');
  }

  if (!fs.existsSync(server.install_path)) {
    throw new HttpError(400, `Install path does not exist: ${server.install_path}`);
  }

  // Determine scripts and shells (Windows vs POSIX)
  const isWin = process.platform === 'win32';
  const jarPath = path.join(server.install_path, 'Server', 'HytaleServer.jar');
  const hasJar = fs.existsSync(jarPath);

  const env = { ...process.env };
  if (config.javaHome) {
    env.JAVA_HOME = config.javaHome;
    const binDir = path.join(config.javaHome, 'bin');
    if (env.PATH) {
      env.PATH = `${binDir}${path.delimiter}${env.PATH}`;
    } else {
      env.PATH = binDir;
    }
  }

  let proc;
  if (hasJar) {
    // 1. Direct Java spawning (for real Hytale server process stdin/stdout proxying)
    const javaExe = isWin ? 'java.exe' : 'java';
    const javaPath = config.javaHome ? path.join(config.javaHome, 'bin', javaExe) : javaExe;
    
    const jvmArgs = server.jvm_args ? server.jvm_args.split(/\s+/).filter(Boolean) : ['-Xms2G', '-Xmx2G'];
    const javaArgs = [
      ...jvmArgs,
      '-jar',
      'Server/HytaleServer.jar',
      '--assets',
      'Assets.zip',
      '--bind',
      `0.0.0.0:${server.port || 25565}`
    ];
    
    logger.info(`Spawning direct Java process for server ${server.slug} in ${server.install_path}`);
    logger.info(`Command: ${javaPath} ${javaArgs.join(' ')}`);
    
    proc = spawn(javaPath, javaArgs, {
      cwd: server.install_path,
      env,
    });
  } else {
    // 2. Shell startup script fallback (for testing/stubs convenience)
    const shell = isWin ? 'cmd.exe' : '/bin/bash';
    const scriptName = isWin ? 'start.bat' : 'start.sh';
    const scriptPath = path.join(server.install_path, scriptName);

    if (!fs.existsSync(scriptPath)) {
      try {
        if (isWin) {
          fs.writeFileSync(scriptPath, `@echo off\necho [System] Stub server starting...\nping 127.0.0.1 -n 5 > nul\necho [System] Stub server running...\nping 127.0.0.1 -n 3600 > nul`, 'utf8');
        } else {
          fs.writeFileSync(scriptPath, `#!/bin/bash\necho "[System] Stub server starting..."\nsleep 3\necho "[System] Stub server running..."\nsleep 3600`, 'utf8');
          fs.chmodSync(scriptPath, '755');
        }
        logger.info(`Created stub server startup script at: ${scriptPath}`);
      } catch (err) {
        throw new HttpError(500, `Failed to create stub script at ${scriptPath}: ${err.message}`);
      }
    }

    const args = isWin 
      ? ['/c', scriptPath, '--bind', `0.0.0.0:${server.port || 25565}`]
      : ['--norc', '--noprofile', scriptPath, '--bind', `0.0.0.0:${server.port || 25565}`];

    logger.info(`Spawning shell script for server stub ${server.slug} from ${server.install_path}`);
    proc = spawn(shell, args, {
      cwd: server.install_path,
      env,
    });
  }

  activeProcesses.set(server.id, {
    proc,
    startedAt: Date.now(),
  });

  // Update server status in DB
  db.prepare('UPDATE servers SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('running', server.id);

  serverEvents.emit('status', { serverId: server.id, status: 'running' });

  // Stream logs
  bindLogStream(db, server.id, 'stdout', proc.stdout);
  bindLogStream(db, server.id, 'stderr', proc.stderr);

  // Monitor exit
  proc.on('close', (code, signal) => {
    logger.info(`Server process ${server.id} exited with code ${code} (signal ${signal})`);
    
    activeProcesses.delete(server.id);
    onlinePlayers.delete(server.id); // clear online players list

    const isFailure = code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL';
    const status = isFailure ? 'error' : 'stopped';

    db.prepare('UPDATE servers SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(status, server.id);

    serverEvents.emit('status', { serverId: server.id, status });

    // Handle restart policies
    if (server.restart_policy === 'always' || (server.restart_policy === 'on-failure' && isFailure)) {
      const delay = (server.restart_delay_s || 10) * 1000;
      logger.info(`Scheduling restart for server ${server.id} in ${delay}ms`);
      setTimeout(() => {
        // Confirm DB state has not been deleted or status changed manually
        const current = db.prepare('SELECT status FROM servers WHERE id = ?').get(server.id);
        if (current && (current.status === 'error' || current.status === 'stopped')) {
          startServer(db, server.id).catch(err => logger.error(`Auto-restart failed for server ${server.id}`, err));
        }
      }, delay);
    }
  });
}

async function stopServer(db, id) {
  const active = activeProcesses.get(id);
  if (!active) {
    // If not in-memory but status is running, correct DB
    db.prepare('UPDATE servers SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run('stopped', id);
    serverEvents.emit('status', { serverId: id, status: 'stopped' });
    return;
  }

  logger.info(`Stopping server process ID ${id}...`);
  
  db.prepare('UPDATE servers SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('stopped', id);
  serverEvents.emit('status', { serverId: id, status: 'stopping' });

  // Send termination request (platform-specific process tree kill on Windows)
  if (process.platform === 'win32') {
    const { exec } = require('child_process');
    exec(`taskkill /F /T /PID ${active.proc.pid}`, (err) => {
      if (err) {
        logger.error(`Failed to taskkill Windows process tree for server ${id}: ${err.message}`);
      } else {
        logger.info(`Successfully taskkilled Windows process tree for server ${id}`);
      }
    });
  } else {
    active.proc.kill('SIGTERM');
  }

  // Set 15s SIGKILL timeout fallback
  const killTimeout = setTimeout(() => {
    if (activeProcesses.has(id)) {
      logger.warn(`Server ${id} failed to exit gracefully, issuing SIGKILL.`);
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec(`taskkill /F /T /PID ${active.proc.pid}`);
      } else {
        active.proc.kill('SIGKILL');
      }
    }
  }, 15000);

  // Cleanup timeout when process exits
  active.proc.on('close', () => {
    clearTimeout(killTimeout);
  });
}

async function restartServer(db, id) {
  await stopServer(db, id);
  // Wait a small buffer before starting
  await new Promise(resolve => setTimeout(resolve, 1000));
  await startServer(db, id);
}

function sendCommand(db, id, command) {
  const active = activeProcesses.get(id);
  if (!active) {
    throw new HttpError(400, 'Server is not running.');
  }

  logger.debug(`Sending command to server ${id}: ${command}`);
  active.proc.stdin.write(command + '\n');
  
  // Also persist command line as system input logs
  db.prepare('INSERT INTO server_logs (server_id, stream, line) VALUES (?, ?, ?)')
    .run(id, 'sent', `> ${command}`);
}

let schedulerInterval = null;
let lastTriggeredMinute = '';

const { exec } = require('child_process');

function getProcessMetrics(pid) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    if (isWin) {
      exec(`powershell -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -Property CPU, WorkingSet"`, (err, stdout) => {
        if (err || !stdout) return resolve({ cpu: 0, ram: 0 });
        const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length >= 2) {
          const dataLine = lines[lines.length - 1];
          const parts = dataLine.split(/\s+/);
          if (parts.length >= 2) {
            const cpu = parseFloat(parts[0]) || 0;
            const ram = parseInt(parts[1], 10) || 0;
            return resolve({ cpu: Math.min(100, Math.round(cpu)), ram });
          }
        }
        resolve({ cpu: 0, ram: 0 });
      });
    } else {
      exec(`ps -p ${pid} -o %cpu,rss`, (err, stdout) => {
        if (err || !stdout) return resolve({ cpu: 0, ram: 0 });
        const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length >= 2) {
          const dataLine = lines[1];
          const parts = dataLine.split(/\s+/);
          if (parts.length >= 2) {
            const cpu = parseFloat(parts[0]) || 0;
            const rssKB = parseInt(parts[1], 10) || 0;
            return resolve({ cpu: Math.round(cpu), ram: rssKB * 1024 });
          }
        }
        resolve({ cpu: 0, ram: 0 });
      });
    }
  });
}

function matchCronField(field, value) {
  if (field === '*') return true;
  
  if (field.includes(',')) {
    return field.split(',').some(part => matchCronField(part, value));
  }

  if (field.includes('/')) {
    const [range, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step)) return false;

    if (range === '*') {
      return value % step === 0;
    } else if (range.includes('-')) {
      const [startStr, endStr] = range.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) return false;
      return value >= start && value <= end && (value - start) % step === 0;
    } else {
      const start = parseInt(range, 10);
      if (isNaN(start)) return false;
      return value >= start && (value - start) % step === 0;
    }
  }

  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  const num = parseInt(field, 10);
  return num === value;
}

function matchCron(expression, date) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const min = date.getMinutes();
  const hr = date.getHours();
  const dom = date.getDate();
  const mon = date.getMonth() + 1;
  const dow = date.getDay();

  return (
    matchCronField(fields[0], min) &&
    matchCronField(fields[1], hr) &&
    matchCronField(fields[2], dom) &&
    matchCronField(fields[3], mon) &&
    matchCronField(fields[4], dow)
  );
}

function startScheduler(db) {
  if (schedulerInterval) return;

  logger.info('Initializing background scheduler for scheduled restarts, cron schedules, and process metrics...');
  let loopCount = 0;

  schedulerInterval = setInterval(async () => {
    loopCount++;
    try {
      const now = new Date();
      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const currentMinuteStr = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
      
      // Fetch all running servers
      const runningServers = db.prepare('SELECT id, name, restart_schedule FROM servers WHERE status = ?').all('running');

      // 1. Core poller tasks (restarts and list command player tracker)
      for (const srv of runningServers) {
        // Scheduled Restarts check (basic HH:mm)
        if (srv.restart_schedule && srv.restart_schedule === currentHHMM) {
          const checkKey = `restart-${srv.id}-${currentMinuteStr}`;
          const isTriggered = db.prepare("SELECT 1 FROM audit_log WHERE action = 'scheduled-restart-triggered' AND target = ?").get(checkKey);
          if (!isTriggered) {
            db.prepare("INSERT INTO audit_log (action, target, details) VALUES ('scheduled-restart-triggered', ?, ?)").run(checkKey, `Server ${srv.name} restart initiated`);
            logger.info(`Scheduled restart matches for server: ${srv.name} (${srv.id})`);
            try {
              sendCommand(db, srv.id, 'say Server restarting in 30 seconds!');
            } catch (_) {}

            setTimeout(async () => {
              try {
                logger.info(`Executing scheduled restart on server ID ${srv.id}`);
                await restartServer(db, srv.id);
              } catch (err) {
                logger.error(`Failed to execute scheduled restart for server ${srv.id}`, err);
              }
            }, 30000);
          }
        }

        // Player list polling (every 90 seconds = 3 loops * 30s)
        if (loopCount % 3 === 0) {
          try {
            sendCommand(db, srv.id, 'who');
          } catch (_) {}
        }
      }

      // 2. Custom Cron Task Scheduler (Runs once per minute)
      if (currentMinuteStr !== lastTriggeredMinute) {
        lastTriggeredMinute = currentMinuteStr;
        
        const activeSchedules = db.prepare('SELECT * FROM server_schedules WHERE is_active = 1').all();
        for (const sched of activeSchedules) {
          if (matchCron(sched.cron_expression, now)) {
            logger.info(`Cron match triggered for schedule "${sched.name}" (${sched.action}) on server ${sched.server_id}`);
            
            (async () => {
              try {
                if (sched.action === 'restart') {
                  sendCommand(db, sched.server_id, 'say Scheduled restart in progress...');
                  await restartServer(db, sched.server_id);
                } else if (sched.action === 'backup') {
                  const { createBackup } = require('./backupService');
                  createBackup(db, sched.server_id);
                } else if (sched.action === 'command') {
                  if (sched.action_payload) {
                    sendCommand(db, sched.server_id, sched.action_payload);
                  }
                }

                db.prepare("INSERT INTO audit_log (action, target, details) VALUES ('cron-schedule-triggered', ?, ?)")
                  .run(`schedule:${sched.id}`, `Schedule ${sched.name} executed successfully`);
              } catch (err) {
                logger.error(`Failed to execute scheduled cron task: ${sched.name}`, err);
              }
            })();
          }
        }
      }

      // 3. Process Metrics Collector Ticker (Every 30 seconds)
      for (const [srvId, active] of activeProcesses.entries()) {
        const pid = active.proc.pid;
        if (pid) {
          const metrics = await getProcessMetrics(pid);
          const players = getOnlinePlayers(srvId).length;
          
          try {
            db.prepare('INSERT INTO server_metrics (server_id, cpu_percentage, ram_bytes, player_count) VALUES (?, ?, ?, ?)')
              .run(srvId, metrics.cpu, metrics.ram, players);
          } catch (err) {
            logger.error(`Failed to save metrics for server ${srvId}`, err);
          }
        }
      }

      // 4. Metric Pruning logs (Prune logs older than 24 hours)
      db.prepare("DELETE FROM server_metrics WHERE recorded_at < datetime('now', '-24 hours')").run();

    } catch (err) {
      logger.error('Error running background scheduler cycle', err);
    }
  }, 30000); // Check every 30 seconds
}

function extractZipNative(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const zipName = path.basename(zipPath);
    
    // We will attempt multiple extraction methods in sequence
    const methods = [];
    
    if (isWin) {
      // Method 1: tar -xf <zipName>
      methods.push({
        cmd: 'tar',
        args: ['-xf', zipName],
        cwd: destDir
      });
      // Method 2: PowerShell Expand-Archive
      methods.push({
        cmd: 'powershell',
        args: ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Path "${zipName}" -DestinationPath "." -Force`],
        cwd: destDir
      });
    } else {
      // Method 1: tar -xf <zipName>
      methods.push({
        cmd: 'tar',
        args: ['-xf', zipName],
        cwd: destDir
      });
      // Method 2: unzip -o <zipName>
      methods.push({
        cmd: 'unzip',
        args: ['-o', zipName],
        cwd: destDir
      });
    }
    
    let currentMethodIndex = 0;
    
    function tryNextMethod() {
      if (currentMethodIndex >= methods.length) {
        // Fall back to AdmZip if native tools fail, but warn that it might run out of memory for large files
        logger.warn(`Native zip extraction failed for ${zipName}. Falling back to AdmZip...`);
        try {
          const zip = new AdmZip(zipPath);
          zip.extractAllTo(destDir, true);
          resolve();
        } catch (err) {
          reject(new Error(`All extraction methods failed for ${zipName}: ${err.message}`));
        }
        return;
      }
      
      const method = methods[currentMethodIndex];
      currentMethodIndex++;
      
      logger.info(`Attempting extraction using: ${method.cmd} ${method.args.join(' ')}`);
      
      const child = spawn(method.cmd, method.args, { cwd: method.cwd, shell: true });
      
      let stderrData = '';
      child.stderr.on('data', (data) => {
        stderrData += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          logger.info(`Successfully extracted ${zipName} using ${method.cmd}`);
          resolve();
        } else {
          logger.warn(`${method.cmd} failed with exit code ${code}. Error: ${stderrData.trim()}`);
          tryNextMethod();
        }
      });
      
      child.on('error', (err) => {
        logger.warn(`${method.cmd} execution failed with error: ${err.message}`);
        tryNextMethod();
      });
    }
    
    tryNextMethod();
  });
}

// Global state for Hytale Installer download progress
let installerDownloadState = {
  status: 'idle', // 'idle' | 'downloading' | 'extracting' | 'completed' | 'failed' | 'awaiting_auth' | 'downloading_game'
  progress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  speedFormatted: '0 B/s',
  etaFormatted: 'Estimating...',
  authUrl: null,
  authCode: null,
  error: null,
};

function getInstallerDownloadState() {
  return installerDownloadState;
}

function isInstallerCached() {
  const sharedDir = path.join(__dirname, '..', '..', '..', 'shared');
  const jarPath = path.join(sharedDir, 'Server', 'HytaleServer.jar');
  const assetsPath = path.join(sharedDir, 'Assets.zip');
  return fs.existsSync(jarPath) && fs.existsSync(assetsPath);
}

async function cacheInstaller(db, downloadUrl) {
  if (installerDownloadState.status === 'downloading' || installerDownloadState.status === 'extracting') {
    throw new HttpError(400, 'Installer download or extraction is already in progress.');
  }

  if (!downloadUrl) {
    throw new HttpError(400, 'Hytale installer download URL is required.');
  }

  const sharedDir = path.join(__dirname, '..', '..', '..', 'shared');
  if (!fs.existsSync(sharedDir)) {
    fs.mkdirSync(sharedDir, { recursive: true });
  }

  const zipPath = path.join(sharedDir, 'installer.zip');
  const tempZipPath = path.join(sharedDir, 'installer.zip.tmp');

  installerDownloadState = {
    status: 'downloading',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speedFormatted: '0 B/s',
    etaFormatted: 'Estimating...',
    error: null,
  };

  // Run in background
  (async () => {
    const maxRetries = 3;
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries && !success) {
      attempt++;
      let fileStream = null;
      let stallChecker = null;
      const controller = new AbortController();

      try {
        if (attempt > 1) {
          logger.info(`Retrying Hytale installer download (attempt ${attempt}/${maxRetries}) after failure...`);
          // Exponential backoff pause
          await new Promise(resolve => setTimeout(resolve, attempt * 3000));
        }

        installerDownloadState.status = 'downloading';
        installerDownloadState.error = null;
        installerDownloadState.downloadedBytes = 0;
        installerDownloadState.progress = 0;

        logger.info(`Starting Hytale installer download from ${downloadUrl} (Attempt ${attempt}/${maxRetries})`);
        
        // Connect timeout setup
        const connectionTimeout = setTimeout(() => {
          if (installerDownloadState.downloadedBytes === 0) {
            controller.abort();
          }
        }, 15000);

        const res = await fetch(downloadUrl, { signal: controller.signal });
        clearTimeout(connectionTimeout);

        if (!res.ok) {
          throw new Error(`Failed to download: ${res.statusText} (${res.status})`);
        }

        const totalBytes = parseInt(res.headers.get('content-length'), 10) || 0;
        installerDownloadState.totalBytes = totalBytes;

        fileStream = fs.createWriteStream(tempZipPath);

        let lastDataTime = Date.now();
        const startTime = Date.now();

        // Stalls check interval (Aborts download if no chunks are received for 15 seconds)
        stallChecker = setInterval(() => {
          if (installerDownloadState.status === 'downloading' && Date.now() - lastDataTime > 15000) {
            logger.warn('Hytale installer download stalled. Aborting stream...');
            controller.abort();
          }
        }, 2000);

        for await (const chunk of res.body) {
          lastDataTime = Date.now();
          installerDownloadState.downloadedBytes += chunk.length;
          fileStream.write(chunk);

          const elapsedSeconds = (Date.now() - startTime) / 1000;
          if (elapsedSeconds > 0.5) {
            const speed = installerDownloadState.downloadedBytes / elapsedSeconds;
            
            let speedFormatted = '';
            if (speed > 1024 * 1024) {
              speedFormatted = `${(speed / (1024 * 1024)).toFixed(2)} MB/s`;
            } else if (speed > 1024) {
              speedFormatted = `${(speed / 1024).toFixed(2)} KB/s`;
            } else {
              speedFormatted = `${speed.toFixed(0)} B/s`;
            }
            installerDownloadState.speedFormatted = speedFormatted;

            if (totalBytes > 0) {
              installerDownloadState.progress = Math.round((installerDownloadState.downloadedBytes / totalBytes) * 100);
              const remainingBytes = totalBytes - installerDownloadState.downloadedBytes;
              const etaSeconds = Math.max(0, Math.round(remainingBytes / speed));
              
              let etaFormatted = '';
              if (etaSeconds > 60) {
                etaFormatted = `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`;
              } else {
                etaFormatted = `${etaSeconds}s`;
              }
              installerDownloadState.etaFormatted = etaFormatted;
            }
          }
        }

        clearInterval(stallChecker);
        stallChecker = null;

        await new Promise((resolve, reject) => {
          fileStream.end((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Rename temporary to finalized ZIP
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }
        fs.renameSync(tempZipPath, zipPath);
        success = true;

      } catch (err) {
        logger.error(`Error on download attempt ${attempt}/${maxRetries}`, err);
        if (stallChecker) clearInterval(stallChecker);
        if (fileStream) {
          try { fileStream.end(); } catch (_) {}
        }
        try {
          if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
        } catch (_) {}

        if (attempt >= maxRetries) {
          installerDownloadState.status = 'failed';
          installerDownloadState.error = `Download failed after ${maxRetries} attempts: ${err.message}`;
          return;
        }
      }
    }

    // Extraction phase
    try {
      logger.info('Extracting Hytale downloader utility ZIP...');
      installerDownloadState.status = 'extracting';
      installerDownloadState.progress = 100;

      await extractZipNative(zipPath, sharedDir);

      // Clean up zip
      try {
        fs.unlinkSync(zipPath);
      } catch (_) {}

      // Run Downloader utility automatically
      const isWin = process.platform === 'win32';
      const binaryName = isWin ? 'hytale-downloader-windows-amd64.exe' : 'hytale-downloader-linux-amd64';
      const binaryPath = path.join(sharedDir, binaryName);

      if (fs.existsSync(binaryPath)) {
        if (!isWin) {
          fs.chmodSync(binaryPath, '755');
        }

        logger.info(`Spawning Hytale downloader utility: ${binaryName}`);
        
        // Spawn downloader inside shared/ directory to download the actual game.zip
        const child = spawn(binaryPath, ['-download-path', 'game.zip', '-skip-update-check'], { cwd: sharedDir });
        
        installerDownloadState.status = 'downloading_game';
        installerDownloadState.progress = 0;
        installerDownloadState.authUrl = null;
        installerDownloadState.authCode = null;

        // Handle child output
        child.stdout.on('data', (data) => {
          const chunk = data.toString();
          logger.info(`[Downloader] ${chunk.trim()}`);

          // Parse visit / code prompt for authentication
          if (chunk.includes('visit') || chunk.includes('http') || chunk.includes('code') || chunk.includes('device')) {
            const urls = chunk.match(/(https?:\/\/[^\s]+)/);
            if (urls && urls[0]) {
              installerDownloadState.status = 'awaiting_auth';
              installerDownloadState.authUrl = urls[0].replace(/[.,;:()'"\s]$/, '');
            }
            const codes = chunk.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4}|[A-Z0-9]{6,8})\b/i);
            if (codes && codes[0]) {
              installerDownloadState.authCode = codes[0];
            }
          }

          // Parse download progress
          if (chunk.includes('%') || chunk.includes('Download') || chunk.includes('progress')) {
            if (installerDownloadState.status !== 'awaiting_auth') {
              installerDownloadState.status = 'downloading_game';
            }
            const progressMatch = chunk.match(/(\d+)%/);
            if (progressMatch && progressMatch[1]) {
              installerDownloadState.progress = parseInt(progressMatch[1], 10);
            }
          }
        });

        child.stderr.on('data', (data) => {
          const chunk = data.toString();
          logger.warn(`[Downloader Error] ${chunk.trim()}`);
        });

        const exitCode = await new Promise((resolve) => {
          child.on('close', (code) => resolve(code));
          child.on('error', (err) => {
            logger.error('Downloader utility process error', err);
            resolve(-1);
          });
        });

        if (exitCode === 0) {
          // If exited successfully, game.zip is downloaded inside shared/
          const gameZipPath = path.join(sharedDir, 'game.zip');
          if (fs.existsSync(gameZipPath)) {
            logger.info('Extracting game release files from game.zip...');
            installerDownloadState.status = 'extracting';
            installerDownloadState.progress = 100;
            installerDownloadState.authUrl = null;
            installerDownloadState.authCode = null;

            await extractZipNative(gameZipPath, sharedDir);

            // Clean up game.zip
            try {
              fs.unlinkSync(gameZipPath);
            } catch (_) {}
          }
        }
      }

      // Fallback: If required assets still missing, generate mock Hytale assets for local testing
      if (!isInstallerCached()) {
        logger.info('ZIP did not contain required Hytale server files. Generating dummy Assets.zip and Server/HytaleServer.jar for testing...');
        
        // 1. Create Server/ directory
        const serverDir = path.join(sharedDir, 'Server');
        if (!fs.existsSync(serverDir)) {
          fs.mkdirSync(serverDir, { recursive: true });
        }
        
        // 2. Create dummy HytaleServer.jar if missing
        const jarPath = path.join(serverDir, 'HytaleServer.jar');
        if (!fs.existsSync(jarPath)) {
          const jarZip = new AdmZip();
          jarZip.addFile('META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0\r\nMain-Class: hytale.Server\r\n'));
          jarZip.writeZip(jarPath);
        }

        // 3. Create dummy Assets.zip if missing
        const assetsPath = path.join(sharedDir, 'Assets.zip');
        if (!fs.existsSync(assetsPath)) {
          const assetsZip = new AdmZip();
          assetsZip.addFile('config.json', Buffer.from('{}'));
          assetsZip.writeZip(assetsPath);
        }
      }

      if (!isInstallerCached()) {
        throw new Error('Game extraction failed, and required Assets.zip or Server/HytaleServer.jar was not found.');
      }

      installerDownloadState.status = 'completed';
      logger.info('Hytale server files successfully cached and verified.');
    } catch (err) {
      logger.error('Failed to run Hytale downloader utility or extract server files', err);
      installerDownloadState.status = 'failed';
      installerDownloadState.error = err.message || 'Unknown extraction error';
      try {
        const zipPath = path.join(sharedDir, 'installer.zip');
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        const gameZipPath = path.join(sharedDir, 'game.zip');
        if (fs.existsSync(gameZipPath)) fs.unlinkSync(gameZipPath);
      } catch (_) {}
    }
  })();

  return { message: 'Installer download started in background.' };
}

async function installServerFiles(db, serverId) {
  const server = getServer(db, serverId);
  if (server.status !== 'uninstalled') {
    throw new HttpError(400, 'Server files are already installed.');
  }

  if (!isInstallerCached()) {
    throw new HttpError(400, 'Central Hytale installer cache is missing or corrupt. Go to Settings to download it first.');
  }

  logger.info(`Deploying Hytale server files to server ID ${serverId} from central shared/ cache...`);

  const sharedDir = path.join(__dirname, '..', '..', '..', 'shared');
  const targetDir = path.resolve(server.install_path);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Deploy Assets.zip (Use native symbolic link with fallback to copy)
  const srcAssets = path.join(sharedDir, 'Assets.zip');
  const destAssets = path.join(targetDir, 'Assets.zip');
  try {
    if (fs.existsSync(destAssets)) {
      fs.unlinkSync(destAssets);
    }
    logger.info(`Linking Assets.zip from central cache: ${destAssets} -> ${srcAssets}`);
    fs.symlinkSync(srcAssets, destAssets, 'file');
  } catch (err) {
    logger.warn(`Symlink failed for Assets.zip, falling back to file copy: ${err.message}`);
    fs.copyFileSync(srcAssets, destAssets);
  }

  // Deploy Server/ folder (Physically isolate directory, symlink massive HytaleServer.jar, copy secondary files)
  const srcServer = path.join(sharedDir, 'Server');
  const destServer = path.join(targetDir, 'Server');
  try {
    if (fs.existsSync(destServer)) {
      const stat = fs.statSync(destServer);
      if (stat.isDirectory()) {
        fs.rmSync(destServer, { recursive: true, force: true });
      } else {
        fs.unlinkSync(destServer);
      }
    }
    fs.mkdirSync(destServer, { recursive: true });

    // 1. Symlink the massive HytaleServer.jar to save space
    const srcJar = path.join(srcServer, 'HytaleServer.jar');
    const destJar = path.join(destServer, 'HytaleServer.jar');
    try {
      logger.info(`Linking HytaleServer.jar from central cache: ${destJar} -> ${srcJar}`);
      fs.symlinkSync(srcJar, destJar, 'file');
    } catch (err) {
      logger.warn(`Symlink failed for HytaleServer.jar, falling back to file copy: ${err.message}`);
      if (fs.existsSync(srcJar)) {
        fs.copyFileSync(srcJar, destJar);
      }
    }

    // 2. Copy secondary files/configs from shared Server folder
    if (fs.existsSync(srcServer)) {
      const files = fs.readdirSync(srcServer);
      files.forEach(file => {
        if (file === 'HytaleServer.jar') return;
        const srcFile = path.join(srcServer, file);
        const destFile = path.join(destServer, file);
        try {
          fs.cpSync(srcFile, destFile, { recursive: true, dereference: false });
        } catch (copyErr) {
          logger.warn(`Failed to copy secondary Server file ${file}: ${copyErr.message}`);
        }
      });
    }
  } catch (err) {
    logger.error(`Deployment failed for Server/ directory: ${err.message}`);
    throw new HttpError(500, `Failed to deploy Server/ directory: ${err.message}`);
  }

  // Generate startup scripts
  const isWin = process.platform === 'win32';
  
  // Windows start.bat
  const batScript = `@echo off\r\njava -Xms2G -Xmx2G -jar Server/HytaleServer.jar --assets Assets.zip %*\r\n`;
  fs.writeFileSync(path.join(targetDir, 'start.bat'), batScript, 'utf8');

  // Linux start.sh
  const shScript = `#!/bin/bash\r\njava -Xms2G -Xmx2G -jar Server/HytaleServer.jar --assets Assets.zip "$@"\r\n`;
  const shPath = path.join(targetDir, 'start.sh');
  fs.writeFileSync(shPath, shScript, 'utf8');
  try {
    fs.chmodSync(shPath, '755');
  } catch (_) {}

  // Update status in DB to stopped
  db.prepare("UPDATE servers SET status = ?, updated_at = datetime('now') WHERE id = ?").run('stopped', serverId);

  // Emit Websocket status change
  serverEvents.emit('status', { serverId, status: 'stopped' });

  logger.info(`Successfully installed Hytale server files to ${targetDir}`);
  return { message: 'Hytale server files installed successfully.' };
}

module.exports = {
  serverEvents,
  getServer,
  startServer,
  stopServer,
  restartServer,
  sendCommand,
  rowToServer,
  getOnlinePlayers,
  startScheduler,
  getInstallerDownloadState,
  isInstallerCached,
  cacheInstaller,
  installServerFiles,
};
// Java 25 reload trigger comment

