const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
const path = require('path');
const APP_ROOT = path.resolve(__dirname, '..', '..');
const ASSETS_DIR = path.join(APP_ROOT, 'assets');
const RENDERER_DIR = path.join(APP_ROOT, 'src', 'renderer');
const PRELOAD_PATH = path.join(APP_ROOT, 'src', 'preload', 'preload.js');
const os = require('os');
const fs = require('graceful-fs');
const _nativeFs = require('fs');
const fsp = require('fs/promises');
fs.gracefulify(_nativeFs);
const http = require('http');
const https = require('https');
const childProcess = require('child_process');
http.globalAgent.maxSockets = 24;
https.globalAgent.maxSockets = 24;

// Ensure Electron can write its caches/databases (fixes Database IO error on some systems)
try {
  const base = path.join(app.getPath('appData'), 'NocLauncher');
  _nativeFs.mkdirSync(base, { recursive: true });
  app.setPath('userData', path.join(base, 'userData'));
  app.setPath('cache', path.join(base, 'cache'));
} catch (_) {}

// Reduce GPU disk cache issues
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-features', 'Vulkan,UseSkiaRenderer');

async function ensureOptionalDependency(pkgName) {
  try {
    require.resolve(pkgName);
    return true;
  } catch (_) {
    // missing
  }

  // In packaged builds node_modules are bundled; if it's missing there, installation won't help.
  if (app.isPackaged) return false;

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['install', '--no-audit', '--no-fund', `${pkgName}`];

  return await new Promise((resolve) => {
    const p = childProcess.spawn(npmCmd, args, { cwd: APP_ROOT, stdio: 'inherit' });
    p.on('error', () => resolve(false));
    p.on('exit', () => {
      try {
        require.resolve(pkgName);
        resolve(true);
      } catch (_) {
        resolve(false);
      }
    });
  });
}


// Auth disabled (temporarily)
const authService = {
  loginMicrosoftJava: async () => ({ ok: false, disabled: true, error: 'auth_disabled' }),
  logoutMicrosoft: async () => ({ ok: true, disabled: true }),
  validateCachedSession: async () => ({ ok: false, disabled: true })
};
const { loginMicrosoftJava, logoutMicrosoft, validateCachedSession } = authService;
function applyDownloadMode(mode) {
  const m = String(mode || 'fast').toLowerCase();
  let sockets = 24;
  if (m === 'normal') sockets = 12;
  else if (m === 'turbo') sockets = 64;
  else sockets = 32; // fast

  http.globalAgent.maxSockets = sockets;
  https.globalAgent.maxSockets = sockets;
  return sockets;
}


// --- Top10: instances + robust downloads + repair/fix helpers ---
function getActiveInstanceId(settings) {
  return String(settings?.activeInstanceId || 'default');
}
function getInstanceMeta(settings, id) {
  const meta = settings?.instancesMeta || {};
  return meta[id] || (id === 'default' ? { name: 'Default' } : { name: id });
}
function resolveActiveGameDir(settings) {
  const base = settings?.gameDir || path.join(os.homedir(), '.noclauncher');
  const id = getActiveInstanceId(settings);
  if (!id || id === 'default') return base;
  return path.join(base, 'instances', id);
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function safeId(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'instance';
}
function listInstances(settings) {
  const base = settings?.gameDir || path.join(os.homedir(), '.noclauncher');
  const meta = settings?.instancesMeta || {};
  const out = [{ id: 'default', name: (meta.default?.name || 'Default'), dir: base }];
  const instRoot = path.join(base, 'instances');
  if (fs.existsSync(instRoot)) {
    for (const id of fs.readdirSync(instRoot)) {
      const dir = path.join(instRoot, id);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        out.push({ id, name: (meta[id]?.name || id), dir });
      } catch {}
    }
  }
  return out;
}

function restoreSafeLaunchModsIfNeeded(gameDir) {
  try {
    const mods = path.join(gameDir, 'mods');
    const disabled = path.join(gameDir, 'mods.__noc_disabled');
    if (!fs.existsSync(mods) && fs.existsSync(disabled)) {
      fs.renameSync(disabled, mods);
    }
  } catch {}
}


// --- Mods manager (Fabric/Forge) ---
function getModsDir(gameDir) {
  const p = path.join(gameDir, 'mods');
  ensureDir(p);
  return p;
}
function modsManifestPath(gameDir) {
  return path.join(gameDir, 'mods.noc.json');
}
function readModsManifest(gameDir) {
  try {
    const p = modsManifestPath(gameDir);
    if (!fs.existsSync(p)) return { mods: {} };
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || typeof j !== 'object') return { mods: {} };
    if (!j.mods || typeof j.mods !== 'object') j.mods = {};
    return j;
  } catch { return { mods: {} }; }
}
function writeModsManifest(gameDir, data) {
  try {
    fs.writeFileSync(modsManifestPath(gameDir), JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}
function listLocalMods(gameDir) {
  const modsDir = getModsDir(gameDir);
  const out = [];
  const entries = fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : [];
  for (const fn of entries) {
    if (!fn.endsWith('.jar') && !fn.endsWith('.disabled')) continue;
    const fp = path.join(modsDir, fn);
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      const enabled = fn.endsWith('.jar');
      out.push({
        filename: fn,
        displayName: fn.replace(/\.disabled$/, ''),
        enabled,
        sizeMB: st.size / (1024*1024)
      });
    } catch {}
  }
  out.sort((a,b)=>a.displayName.localeCompare(b.displayName));
  // enrich from manifest
  const man = readModsManifest(gameDir);
  for (const m of out) {
    const key = m.displayName;
    const meta = man.mods[key];
    if (meta) {
      m.source = meta.source || 'Modrinth';
      m.projectId = meta.projectId;
      m.versionId = meta.versionId;
    }
  }
  return out;
}

// Analyze installed mods (basic): loader mismatch, duplicates, missing Fabric deps.
function analyzeInstalledMods(settings, gameDir) {
  const modsDir = getModsDir(gameDir);
  const jars = (fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : []).filter(f=>f.endsWith('.jar'));
  const issues = [];
  const mods = [];
  const idToFiles = new Map();

  const wantLoader = String(settings?.loaderMode || 'vanilla').toLowerCase(); // fabric|forge|neoforge|vanilla
  const wantForgeLike = (wantLoader === 'forge' || wantLoader === 'neoforge');
  for (const fn of jars) {
    const fp = path.join(modsDir, fn);
    try {
      const AdmZipLocal = require('adm-zip');
      const zip = new AdmZipLocal(fp);
      let loaderDetected = 'unknown';
      let modId = null;
      let depends = [];

      const fabricEntry = zip.getEntry('fabric.mod.json');
      if (fabricEntry) {
        loaderDetected = 'fabric';
        try {
          const j = JSON.parse(zip.readAsText(fabricEntry));
          modId = String(j.id || '');
          const depObj = j.depends && typeof j.depends === 'object' ? j.depends : {};
          depends = Object.keys(depObj || {}).filter(k => !['minecraft','java','fabricloader','forge','neoforge'].includes(k));
        } catch {}
      } else {
        const tomlEntry = zip.getEntry('META-INF/mods.toml');
        if (tomlEntry) {
          loaderDetected = 'forge';
          // naive parse modId from mods.toml: modId="..."
          try {
            const t = zip.readAsText(tomlEntry);
            const mm = t.match(/modId\s*=\s*["']([^"']+)["']/);
            if (mm) modId = String(mm[1] || '');
          } catch {}
        }
      }

      mods.push({ fn, fp, loaderDetected, modId, depends });

      if (wantLoader === 'fabric' && loaderDetected === 'forge') {
        issues.push({ type: 'loader', file: fn, message: 'Forge-мод в Fabric-профиле' });
      } else if (wantForgeLike && loaderDetected === 'fabric') {
        issues.push({ type: 'loader', file: fn, message: 'Fabric-мод в Forge-профиле' });
      }

      if (modId) {
        if (!idToFiles.has(modId)) idToFiles.set(modId, []);
        idToFiles.get(modId).push(fn);
      }
    } catch (e) {
      issues.push({ type: 'read', file: fn, message: 'Не удалось прочитать jar (повреждён?)' });
    }
  }

  // duplicates by modId
  for (const [id, files] of idToFiles.entries()) {
    if (files.length > 1) {
      issues.push({ type: 'duplicate', id, files, message: `Дубликаты мода "${id}"` });
    }
  }

  // missing deps (Fabric only)
  if (wantLoader === 'fabric') {
    const presentIds = new Set(mods.map(m=>m.modId).filter(Boolean));
    for (const m of mods) {
      if (m.loaderDetected !== 'fabric') continue;
      for (const depId of (m.depends || [])) {
        if (!presentIds.has(depId)) {
          issues.push({ type: 'missing_dep', file: m.fn, dep: depId, message: `Нет зависимости "${depId}" для ${m.fn}` });
        }
      }
    }
  }

  // save light metadata into manifest for better updates/UI
  try {
    const man = readModsManifest(gameDir);
    if (!man.mods) man.mods = {};
    for (const m of mods) {
      const key = m.fn.replace(/\.jar$/, '');
      man.mods[key] = Object.assign({}, man.mods[key] || {}, {
        filename: m.fn,
        detectedLoader: m.loaderDetected,
        detectedModId: m.modId || undefined
      });
    }
    writeModsManifest(gameDir, man);
  } catch {}

  return { ok: true, issues };
}

async function autoSnapshotBeforeModsChange(settings, gameDir, note) {
  try {
    await createSnapshot(settings, gameDir, note || 'Auto snapshot before mods change');
  } catch {}
}

async function rollbackLastSnapshot(settings, gameDir) {
  const snaps = await listSnapshots(gameDir);
  if (!snaps.length) return { ok:false, error:'no snapshots' };
  snaps.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const last = snaps[0];
  await restoreSnapshot(settings, gameDir, last.id);
  return { ok:true, id:last.id };
}

async function modrinthFetchJson(url) {
  const u = new URL(url);
  const client = u.protocol === 'https:' ? https : http;
  return await new Promise((resolve,reject)=>{
    const req = client.request(u, { method:'GET', headers: { 'User-Agent': 'NocLauncher/1.0 (mods)' } }, (res)=>{
      let data='';
      res.setEncoding('utf8');
      res.on('data', d=>data+=d);
      res.on('end', ()=>{
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error('HTTP '+res.statusCode));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
function currentLoaderAndVersion(settings) {
  const loaderMode = String(settings?.loaderMode || 'vanilla').toLowerCase();
  const gameVersion = String(settings?.lastVersion || '');
  let loaders = [];
  if (loaderMode === 'fabric') loaders = ['fabric'];
  else if (loaderMode === 'forge') loaders = ['forge', 'neoforge']; // allow neo if mod is tagged
  else if (loaderMode === 'neoforge') loaders = ['neoforge', 'forge']; // show NeoForge first, but keep Forge-compatible mods
  else loaders = []; // vanilla
  return { loaderMode, loaders, gameVersion };
}
async function modrinthSearch(settings, query, limit=20) {
  const { loaders, gameVersion } = currentLoaderAndVersion(settings);
  const facets = [];
  facets.push(['project_type:mod']);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loaders.length) facets.push(loaders.map(l=>`categories:${l}`));
  const url = 'https://api.modrinth.com/v2/search?query=' + encodeURIComponent(query) +
    '&limit=' + encodeURIComponent(limit) +
    '&facets=' + encodeURIComponent(JSON.stringify(facets));
  const j = await modrinthFetchJson(url);
  const hits = (j?.hits || []).map(h=>({
    project_id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    downloads: h.downloads,
    icon_url: h.icon_url,
    loader: (loaders[0] || '')
  }));
  return hits;
}
async function modrinthResolveVersion(projectId, settings) {
  const { loaders, gameVersion } = currentLoaderAndVersion(settings);
  const qs = [];
  if (loaders.length) qs.push('loaders=' + encodeURIComponent(JSON.stringify(loaders)));
  if (gameVersion) qs.push('game_versions=' + encodeURIComponent(JSON.stringify([gameVersion])));
  const url = 'https://api.modrinth.com/v2/project/' + encodeURIComponent(projectId) + '/version' + (qs.length ? '?' + qs.join('&') : '');
  const versions = await modrinthFetchJson(url);
  if (!Array.isArray(versions) || !versions.length) return null;
  // pick newest by date_published
  versions.sort((a,b)=>String(b.date_published||'').localeCompare(String(a.date_published||'')));
  return versions[0];
}
async function installModrinthVersion(versionObj, settings, gameDir, progressCb) {
  const modsDir = getModsDir(gameDir);
  const files = Array.isArray(versionObj?.files) ? versionObj.files : [];
  const primary = files.find(f=>f.primary) || files[0];
  if (!primary?.url || !primary?.filename) throw new Error('No downloadable file');
  const destName = primary.filename;
  const destPath = path.join(modsDir, destName);
  const mirrors = [primary.url];
  await downloadFile(primary.url, destPath, progressCb, { label: destName, mirrors, maxKBps: Number(settings?.downloadLimitKBps||0) });
  // manifest update keyed by base name
  const man = readModsManifest(gameDir);
  const key = destName.replace(/\.jar$/, '');
  man.mods[key] = { source: 'Modrinth', projectId: versionObj.project_id, versionId: versionObj.id, filename: destName, installedAt: new Date().toISOString() };
  man.lastInstalled = { key, filename: destName, at: new Date().toISOString() };
  writeModsManifest(gameDir, man);
  return { filename: destName };
}
async function installModrinthProjectRecursive(projectId, settings, gameDir, seen = new Set(), progressCb) {
  const key = String(projectId);
  if (seen.has(key)) return { ok:true, installed:0 };
  seen.add(key);
  const ver = await modrinthResolveVersion(projectId, settings);
  if (!ver) throw new Error('No compatible version for this loader/version');
  // install required deps first
  const deps = Array.isArray(ver.dependencies) ? ver.dependencies : [];
  for (const d of deps) {
    if (d.dependency_type === 'required' && d.project_id) {
      await installModrinthProjectRecursive(d.project_id, settings, gameDir, seen, progressCb);
    }
  }
  await installModrinthVersion(ver, settings, gameDir, progressCb);
  return { ok:true, installed:1 };
}
async function updateAllModrinth(settings, gameDir) {
  const man = readModsManifest(gameDir);
  let updated = 0;
  for (const [k, meta] of Object.entries(man.mods || {})) {
    if (!meta?.projectId) continue;
    const ver = await modrinthResolveVersion(meta.projectId, settings);
    if (!ver || !ver.id || ver.id === meta.versionId) continue;
    // download new file, remove old if same key
    await installModrinthVersion(ver, settings, gameDir);
    updated++;
  }
  return { ok:true, updated };
}

// Version -> recommended Java major
function parseMcVersionId(id) {
  // supports "1.20.1", "1.20.5", "1.21", "1.21.1", ignores snapshots for now
  const m = String(id || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] || 0) };
}
function recommendedJavaMajorForMc(id) {
  const v = parseMcVersionId(id);
  if (!v) return 17;
  // <=1.16 -> 8
  if (v.major === 1 && v.minor <= 16) return 8;
  // 1.17 -> 16
  if (v.major === 1 && v.minor === 17) return 16;
  // 1.18..1.20.4 -> 17
  if (v.major === 1 && (v.minor === 18 || v.minor === 19 || v.minor === 20) && (v.minor !== 20 || v.patch <= 4)) return 17;
  // 1.20.5+ and 1.21+ -> 21
  if (v.major === 1 && v.minor >= 20 && v.patch >= 5) return 21;
  if (v.major === 1 && v.minor >= 21) return 21;
  return 17;
}
function recommendMemoryMB() {
  const total = Math.floor(os.totalmem() / (1024 * 1024));
  // simple heuristic: keep 2GB for OS, allocate 30-50% for MC
  const max = Math.max(2048, Math.min(8192, Math.floor((total - 2048) * 0.6)));
  const min = Math.max(1024, Math.min(4096, Math.floor(max * 0.5)));
  return { min, max, total };
}

// Simple SHA1 helper for repair
function sha1FileSync(filePath) {
  const h = require('crypto').createHash('sha1');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
    return h.digest('hex');
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}
const { execFileSync, execFile } = require('child_process');

function execFileAsync(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

const MCDL_RELEASE_URL = 'https://github.com/edshPC/mc-w10-downloader/releases/download/0.5.0.1/MCDownloader.zip';
const DEFAULT_JAVA_SERVER = { name: 'Сервер ноука!', ip: 'noctraze.my-craft.cc.' };
const DEFAULT_BEDROCK_SERVER = { name: 'Сервер ноука!', ip: '213.171.17.43', port: 2579 };

function runPowerShellAsync(command) {
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-Command', command], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message || err)));
      resolve(String(stdout || '').trim());
    });
  });
}
const Store = require('electron-store');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const AdmZip = require('adm-zip');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

// minecraft-launcher-core
const { Client, Authenticator } = require('minecraft-launcher-core');

// Microsoft auth
const msmc = require('msmc');

// Simple uuid fallback without extra deps
function randomUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Poor man's uuid
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const store = new Store({
  name: 'noclauncher',
  defaults: {
    gameDir: path.join(os.homedir(), '.noclauncher'),
    memoryMinMB: 1024,
    memoryMaxMB: 4096,
    javaPath: '',
    lastVersion: 'latest-release',
    lastUsername: 'Player',
    rememberUsername: true,
    account: null,
    loaderMode: 'vanilla',
    lastProfileVersion: '',
    selectedForgeBuild: '',
    selectedOptiFineBuild: null,
    downloadMode: 'fast', // normal | fast | turbo
    enableMirrorFallback: true,
    bedrockDemoMode: false,
    fpsBoostMode: true,
    fpsPreset: 'balanced',
    offlineSkinPath: '',
    skinMode: 'auto', // off | file | nick | url | auto
    skinNick: '',
    skinUrl: '',
    // cached Mojang manifest for offline UI
    manifestCache: null,
    manifestCacheTs: 0,
    // top10 additions
    activeInstanceId: 'default',
    instancesMeta: { default: { name: 'Default' } },
    downloadMaxKBps: 0, // 0 = unlimited
    downloadParallel: 0, // 0 = auto
    downloadSource: 'auto', // auto | mojang | bmclapi
    jvmPreset: 'auto', // auto | stable | fps | lowend
    safeLaunchNoMods: false,
    autoFixOnCrash: true,
    uiLowPower: true,
    closeLauncherOnGameStart: false,
    localServersRegistryUrl: 'http://127.0.0.1:8787',
    localServersHostId: '',
    bedrockDataRoot: '',
    localServersVisibility: 'public',
    transportPolicy: 'auto'
  }
});

// Compatibility helper: some IPC handlers call loadSettings();
// electron-store is our single source of truth.
function loadSettings() {
  return store.store;
}

// Online auth is temporarily disabled for stability.
try {
  store.set('preferOnline', false);
  store.set('account', null);
} catch (_) {}

let win;
let pendingInviteCode = '';
// Single-instance web catalog windows (Modrinth/CurseForge)
const webWindows = new Map();
let catalogWinModrinth = null;
let catalogWinCurseforge = null;

let splashWin = null;
let bedrockHubWin = null;
const BEDROCK_HUB_EXPANDED = { width: 760, height: 480, minWidth: 680, minHeight: 420 };
const BEDROCK_HUB_COLLAPSED = { width: 220, height: 56, minWidth: 220, minHeight: 56 };
const BEDROCK_HUB_COLLAPSED_MENU = { width: 220, height: 132, minWidth: 220, minHeight: 56 };
let bedrockHubCollapsedState = false;
let bedrockHubQuickMenuOpen = false;
let launcherClient = null;
let pendingAuth = null;
let pendingAuthId = null;
let lastAuthCode = null;
let lastAuthError = null;
// Microsoft device-code auth session (managed in main process)
let msSession = null; // legacy
let msFlow = null; // { state, code, url, expiresIn, interval, steps:[], promise, result, error }

// --- Resource packs / shader packs helpers ---
function getResourceDir(gameDir, kind) {
  const k = String(kind || 'resourcepacks').toLowerCase();
  const map = {
    resourcepacks: 'resourcepacks',
    shaderpacks: 'shaderpacks',
    datapacks: path.join('saves', 'datapacks'), // rarely used; kept for completeness
    screenshots: 'screenshots'
  };
  const rel = map[k] || k;
  return path.isAbsolute(rel) ? rel : path.join(gameDir, rel);
}

function listResourceFiles(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.isFile()) continue;
      out.push({ name, size: st.size, mtime: st.mtimeMs });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch {
    return [];
  }
}

// --- Vanilla versions list (manifest v2) ---
let cachedManifest = { at: 0, data: null };

async function getVersionManifest(settings, gameDir) {
  const now = Date.now();
  const ttlMs = 30 * 60 * 1000; // 30m
  if (cachedManifest.data && (now - cachedManifest.at) < ttlMs) return cachedManifest.data;

  const cacheDir = path.join(gameDir, 'launcher_cache');
  const cacheFile = path.join(cacheDir, 'version_manifest_v2.json');
  try {
    if (fs.existsSync(cacheFile)) {
      const st = fs.statSync(cacheFile);
      if ((now - st.mtimeMs) < ttlMs) {
        const txt = fs.readFileSync(cacheFile, 'utf-8');
        const data = JSON.parse(txt);
        cachedManifest = { at: now, data };
        return data;
      }
    }
  } catch {}

  const url = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
  const data = await fetchJson(url, settings);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
  cachedManifest = { at: now, data };
  return data;
}



// Per-run log file + last lines buffer to debug instant close/crash
let runLogPath = null;
let runLogStream = null;
let mcRing = [];

function openRunLog(gameDir) {
  try {
    const logDir = path.join(gameDir, 'launcher_logs');
    fs.mkdirSync(logDir, { recursive: true });
    runLogPath = path.join(logDir, 'latest.txt');
    try { if (runLogStream) runLogStream.end(); } catch (_) {}
    runLogStream = fs.createWriteStream(runLogPath, { flags: 'w' });
    mcRing = [];
    return { logDir, logPath: runLogPath };
  } catch {
    runLogPath = null;
    runLogStream = null;
    mcRing = [];
    return { logDir: null, logPath: null };
  }
}

function pushRing(line) {
  if (!line) return;
  mcRing.push(line);
  if (mcRing.length > 350) mcRing.splice(0, mcRing.length - 350);
}

function getRingText() {
  return mcRing.join('');
}

function tsIso() {
  return new Date().toISOString();
}

function appendBedrockLaunchLog(line) {
  try {
    const settings = store?.store || {};
    const gameDir = resolveActiveGameDir(settings);
    const logDir = path.join(gameDir, 'launcher_logs');
    fs.mkdirSync(logDir, { recursive: true });
    const bedrockLog = path.join(logDir, 'latest-bedrock.txt');
    const commonLog = path.join(logDir, 'latest.txt');
    const row = `[${tsIso()}] ${line}${os.EOL}`;
    fs.appendFileSync(bedrockLog, row, 'utf8');
    // Mirror Bedrock diagnostics to common latest.txt so existing UI log flows can find it.
    fs.appendFileSync(commonLog, row, 'utf8');
    return bedrockLog;
  } catch (_) {
    return null;
  }
}

async function bedrockPreflightChecks() {
  if (process.platform !== 'win32') return { ok: false, critical: true, error: 'windows_only' };

  const hasPkg = async (name) => {
    try {
      const out = await runPowerShellAsync(`(Get-AppxPackage -Name ${name} | Select-Object -First 1 Name).Name`);
      return !!String(out || '').trim();
    } catch (_) { return false; }
  };
  const svcState = async (name) => {
    try {
      const out = await runPowerShellAsync(`(Get-Service -Name '${name}' -ErrorAction SilentlyContinue).Status`);
      return String(out || '').trim();
    } catch (_) { return ''; }
  };

  const minecraftInstalled = await hasPkg('Microsoft.MinecraftUWP');
  const gamingServicesInstalled = await hasPkg('Microsoft.GamingServices');
  const xboxIdentityInstalled = await hasPkg('Microsoft.XboxIdentityProvider');

  const clip = await svcState('ClipSVC');
  const bits = await svcState('BITS');
  const wu = await svcState('wuauserv');
  const gs = await svcState('GamingServices');
  const gsn = await svcState('GamingServicesNet');

  const criticalMissing = [];
  if (!minecraftInstalled) criticalMissing.push('Minecraft for Windows');
  if (!gamingServicesInstalled) criticalMissing.push('Gaming Services');

  const serviceProblems = [];
  if (!['Running', 'StartPending'].includes(clip)) serviceProblems.push(`ClipSVC=${clip || 'N/A'}`);
  if (!['Running', 'StartPending'].includes(bits)) serviceProblems.push(`BITS=${bits || 'N/A'}`);
  if (!['Running', 'StartPending'].includes(wu)) serviceProblems.push(`wuauserv=${wu || 'N/A'}`);
  if (gs && !['Running', 'StartPending'].includes(gs)) serviceProblems.push(`GamingServices=${gs}`);
  if (gsn && !['Running', 'StartPending'].includes(gsn)) serviceProblems.push(`GamingServicesNet=${gsn}`);

  return {
    ok: true,
    critical: criticalMissing.length > 0,
    criticalMissing,
    warnings: [
      ...(!xboxIdentityInstalled ? ['Xbox Identity Provider missing'] : []),
      ...serviceProblems
    ],
    details: {
      minecraftInstalled,
      gamingServicesInstalled,
      xboxIdentityInstalled,
      services: { ClipSVC: clip, BITS: bits, wuauserv: wu, GamingServices: gs, GamingServicesNet: gsn }
    }
  };
}

async function collectBedrockLaunchFailureDiagnostics() {
  const out = {
    preflight: null,
    appInfo: null,
    startApps: '',
    protocol: '',
    packageList: ''
  };
  try { out.preflight = await bedrockPreflightChecks(); } catch (_) {}
  try { out.appInfo = getBedrockAppInfo(); } catch (_) {}
  try {
    out.startApps = await runPowerShellAsync("Get-StartApps | Where-Object { $_.Name -match 'Minecraft' -or $_.AppID -match 'Minecraft' } | Select-Object Name,AppID | ConvertTo-Json -Compress");
  } catch (_) {}
  try {
    out.protocol = await runPowerShellAsync("Get-ItemProperty -Path 'HKCU:\\Software\\Classes\\minecraft\\shell\\open\\command' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty '(default)' -ErrorAction SilentlyContinue");
  } catch (_) {}
  try {
    out.packageList = await runPowerShellAsync("Get-AppxPackage -Name Microsoft.MinecraftUWP,Microsoft.GamingServices,Microsoft.XboxIdentityProvider,Microsoft.GamingApp | Select-Object Name,Version,PackageFamilyName | ConvertTo-Json -Compress");
  } catch (_) {}
  return out;
}

// Aggregated install progress (across libs/assets/natives)
let aggProgress = { totals: {}, currents: {}, lastSent: 0 };
function resetAggProgress() { aggProgress = { totals: {}, currents: {}, lastSent: 0 }; }
function updateAggProgress(e, gameDir) {
  if (!e || !e.type) return null;
  const t = String(e.type);
  if (typeof e.total === 'number' && e.total > 0) aggProgress.totals[t] = e.total;
  if (typeof e.current === 'number' && e.current >= 0) aggProgress.currents[t] = e.current;
  const total = Object.values(aggProgress.totals).reduce((a,b)=>a+b,0);
  const current = Object.entries(aggProgress.currents).reduce((a,[k,v])=>a+Math.min(v, aggProgress.totals[k]||v),0);
  const overallPercent = total ? Math.floor((current/total)*100) : 0;
  return { overallTotal: total, overallCurrent: current, overallPercent, installPath: gameDir };
}


let splashShownAt = 0;
let mainReady = false;

function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 980,
    height: 640,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#0b0712',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  splashWin.loadFile(path.join(RENDERER_DIR, 'splash.html'));
  splashWin.once('ready-to-show', () => {
    splashShownAt = Date.now();
    splashWin?.show();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#0b0712',
    title: 'NocLauncher',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH
    }
  });

  // Fully remove top menu (File/Edit/View...)
  Menu.setApplicationMenu(null);
  win.removeMenu();

  win.loadFile(path.join(RENDERER_DIR, 'index.html'));

  win.once('ready-to-show', () => {
    mainReady = true;
    const minSplashMs = 10000;
    const elapsed = splashShownAt ? (Date.now() - splashShownAt) : 0;
    const waitMs = Math.max(0, minSplashMs - elapsed);

    setTimeout(() => {
      win.show();
      win.focus();
      if (splashWin && !splashWin.isDestroyed()) {
        splashWin.close();
        splashWin = null;
      }
    }, waitMs);
  });
}

function openWebWindow(key, url, title = 'Catalog') {
  try {
    const existing = webWindows.get(key);
    if (existing && !existing.isDestroyed()) {
      try { existing.loadURL(url); } catch (_) {}
      existing.show();
      existing.focus();
      return { ok: true, reused: true };
    }

    const child = new BrowserWindow({
      width: 1150,
      height: 760,
      minWidth: 980,
      minHeight: 640,
      title,
      backgroundColor: '#0b0712',
      autoHideMenuBar: true,
      parent: win && !win.isDestroyed() ? win : undefined,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    webWindows.set(key, child);
    child.on('closed', () => webWindows.delete(key));
    child.loadURL(url);
    return { ok: true, reused: false };
  } catch (e) {
    console.error('openWebWindow failed', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

function openBedrockHubWindow() {
  try {
    if (bedrockHubWin && !bedrockHubWin.isDestroyed()) {
      bedrockHubWin.show();
      bedrockHubWin.focus();
      return { ok: true, reused: true };
    }

    bedrockHubWin = new BrowserWindow({
      width: BEDROCK_HUB_EXPANDED.width,
      height: BEDROCK_HUB_EXPANDED.height,
      minWidth: BEDROCK_HUB_EXPANDED.minWidth,
      minHeight: BEDROCK_HUB_EXPANDED.minHeight,
      title: 'NocLauncher — Локальные сервера',
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      icon: path.join(ASSETS_DIR, 'icon.png'),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: PRELOAD_PATH
      }
    });

    try {
      const area = screen.getPrimaryDisplay().workArea;
      const x = Math.max(area.x + 8, area.x + area.width - 760 - 12);
      const y = area.y + 10;
      bedrockHubWin.setPosition(x, y);
      bedrockHubWin.setAlwaysOnTop(true, 'screen-saver');
      bedrockHubWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (_) {}

    bedrockHubCollapsedState = false;
    bedrockHubQuickMenuOpen = false;
    bedrockHubWin.on('closed', () => { bedrockHubWin = null; });
    bedrockHubWin.loadFile(path.join(RENDERER_DIR, 'bedrock-hub.html'));
    return { ok: true, reused: false };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function applyBedrockHubBounds() {
  if (!bedrockHubWin || bedrockHubWin.isDestroyed()) return { ok: false, error: 'hub_not_open' };
  const area = screen.getDisplayMatching(bedrockHubWin.getBounds())?.workArea || screen.getPrimaryDisplay().workArea;
  const mode = bedrockHubCollapsedState
    ? (bedrockHubQuickMenuOpen ? BEDROCK_HUB_COLLAPSED_MENU : BEDROCK_HUB_COLLAPSED)
    : BEDROCK_HUB_EXPANDED;
  bedrockHubWin.setMinimumSize(mode.minWidth, mode.minHeight);
  bedrockHubWin.setSize(mode.width, mode.height, true);
  const [w, h] = bedrockHubWin.getSize();
  const x = Math.max(area.x + 8, area.x + area.width - w - 12);
  const y = area.y + 10;
  bedrockHubWin.setPosition(x, y);
  return { ok: true };
}

function setBedrockHubCollapsed(collapsed) {
  try {
    if (!bedrockHubWin || bedrockHubWin.isDestroyed()) return { ok: false, error: 'hub_not_open' };
    bedrockHubCollapsedState = !!collapsed;
    if (!bedrockHubCollapsedState) bedrockHubQuickMenuOpen = false;
    const r = applyBedrockHubBounds();
    return { ok: !!r?.ok, collapsed: bedrockHubCollapsedState, menuOpen: bedrockHubQuickMenuOpen };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function setBedrockHubQuickMenuOpen(open) {
  try {
    if (!bedrockHubWin || bedrockHubWin.isDestroyed()) return { ok: false, error: 'hub_not_open' };
    bedrockHubQuickMenuOpen = !!open;
    if (!bedrockHubCollapsedState && bedrockHubQuickMenuOpen) bedrockHubQuickMenuOpen = false;
    const r = applyBedrockHubBounds();
    return { ok: !!r?.ok, collapsed: bedrockHubCollapsedState, menuOpen: bedrockHubQuickMenuOpen };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function closeBedrockHubWindow() {
  try {
    if (bedrockHubWin && !bedrockHubWin.isDestroyed()) {
      bedrockHubWin.close();
      bedrockHubWin = null;
    }
  } catch (_) {}
}

function hideLauncherForGame() {
  try {
    if (win && !win.isDestroyed()) win.hide();
  } catch (_) {}
}

function restoreLauncherAfterGame() {
  try {
    if (!win || win.isDestroyed()) createWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  } catch (_) {}
}

function isBedrockRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Minecraft.Windows.exe', '/FO', 'CSV', '/NH'], {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString();
    if (out && out.toLowerCase().includes('minecraft.windows.exe')) return true;
  } catch (_) {}

  try {
    const out2 = execFileSync('tasklist', ['/FI', 'IMAGENAME eq MinecraftWindowsBeta.exe', '/FO', 'CSV', '/NH'], {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString();
    if (out2 && out2.toLowerCase().includes('minecraftwindowsbeta.exe')) return true;
  } catch (_) {}

  return false;
}

let bedrockFpsMonitorProc = null;
let bedrockFpsMonitorBuf = '';
let bedrockFpsMonitorTimer = null;
let bedrockFpsState = {
  enabled: false,
  backend: 'none',
  available: false,
  current: 0,
  min: 0,
  max: 0,
  samples: 0,
  lastUpdateTs: 0,
  error: ''
};

function emitBedrockFpsState() {
  const payload = { ...bedrockFpsState, ts: Date.now() };
  try { if (win && !win.isDestroyed()) win.webContents.send('bedrock:fps', payload); } catch (_) {}
  try { if (bedrockHubWin && !bedrockHubWin.isDestroyed()) bedrockHubWin.webContents.send('bedrock:fps', payload); } catch (_) {}
}

async function ensurePresentMonBinary() {
  // Deterministic mode: no runtime downloads.
  // We only use bundled/local binary paths to avoid "works/doesn't work" behavior.
  const toolsDir = path.join(APP_ROOT, 'tools', 'presentmon');
  ensureDir(toolsDir);

  const candidates = [
    path.join(toolsDir, 'PresentMon.exe'),
    path.join(toolsDir, 'presentmon.exe'),
    path.join(APP_ROOT, 'bin', 'PresentMon.exe'),
    path.join(APP_ROOT, 'assets', 'tools', 'PresentMon.exe')
  ];

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return { ok: true, exe: p, downloaded: false, source: 'bundled' };
    } catch (_) {}
  }

  // Fallback: try system PATH if user installed PresentMon manually.
  try {
    const out = execFileSync('where', ['presentmon.exe'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    const first = String(out || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return { ok: true, exe: first, downloaded: false, source: 'system' };
  } catch (_) {}

  return { ok: false, error: 'presentmon_not_bundled' };
}

function stopBedrockFpsMonitor() {
  try { if (bedrockFpsMonitorTimer) clearTimeout(bedrockFpsMonitorTimer); } catch (_) {}
  bedrockFpsMonitorTimer = null;
  try { if (bedrockFpsMonitorProc && !bedrockFpsMonitorProc.killed) bedrockFpsMonitorProc.kill(); } catch (_) {}
  bedrockFpsMonitorProc = null;
  bedrockFpsMonitorBuf = '';
  bedrockFpsState.enabled = false;
  emitBedrockFpsState();
  return { ok: true };
}

async function startBedrockFpsMonitor() {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  if (bedrockFpsMonitorProc && !bedrockFpsMonitorProc.killed) return { ok: true, already: true };

  const pm = await ensurePresentMonBinary();
  if (!pm?.ok) {
    bedrockFpsState = { ...bedrockFpsState, enabled: false, available: false, backend: 'none', error: pm?.error || 'presentmon_unavailable' };
    emitBedrockFpsState();
    return { ok: false, error: bedrockFpsState.error };
  }

  bedrockFpsState = { enabled: true, backend: 'presentmon', available: true, current: 0, min: 0, max: 0, samples: 0, lastUpdateTs: 0, error: '' };
  emitBedrockFpsState();

  try {
    const argVariants = [
      ['--output_stdout'],
      ['-output_stdout'],
      ['--process_name', 'Minecraft.Windows.exe', '--output_stdout'],
      ['--process_name', 'MinecraftWindowsBeta.exe', '--output_stdout'],
      ['-process_name', 'Minecraft.Windows.exe', '-output_stdout'],
      ['-process_name', 'MinecraftWindowsBeta.exe', '-output_stdout']
    ];

    let proc = null;
    let lastErr = '';
    for (const args of argVariants) {
      try {
        proc = childProcess.spawn(pm.exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        if (proc?.pid) { lastErr = ''; break; }
      } catch (e) {
        lastErr = String(e?.message || e);
      }
    }
    if (!proc) throw new Error(lastErr || 'presentmon_spawn_failed');

    bedrockFpsMonitorProc = proc;
    let header = null;
    let msIdx = -1;
    let procIdx = -1;

    const onLine = (line) => {
      const s = String(line || '').trim();
      if (!s) return;
      if (!header) {
        header = s.split(',').map(x => String(x || '').trim().toLowerCase().replace(/"/g, ''));
        msIdx = header.findIndex(h => h === 'msbetweenpresents' || h === 'ms between presents');
        procIdx = header.findIndex(h => h === 'processname' || h === 'process_name' || h === 'exename');
        return;
      }
      const parts = s.split(',').map(x => String(x || '').trim().replace(/^"|"$/g, ''));
      if (procIdx >= 0 && procIdx < parts.length) {
        const pn = String(parts[procIdx] || '').toLowerCase();
        if (pn && !pn.includes('minecraft.windows.exe') && !pn.includes('minecraftwindowsbeta.exe')) return;
      }
      if (msIdx < 0 || msIdx >= parts.length) return;
      const ms = Number(parts[msIdx]);
      if (!Number.isFinite(ms) || ms <= 0) return;
      const fps = Math.max(1, Math.min(999, Math.round(1000 / ms)));
      bedrockFpsState.current = fps;
      bedrockFpsState.min = bedrockFpsState.min ? Math.min(bedrockFpsState.min, fps) : fps;
      bedrockFpsState.max = Math.max(bedrockFpsState.max || 0, fps);
      bedrockFpsState.samples = (bedrockFpsState.samples || 0) + 1;
      bedrockFpsState.lastUpdateTs = Date.now();
      emitBedrockFpsState();
    };

    proc.stdout?.on('data', (chunk) => {
      bedrockFpsMonitorBuf += chunk.toString('utf8');
      let i;
      while ((i = bedrockFpsMonitorBuf.indexOf('\n')) >= 0) {
        const line = bedrockFpsMonitorBuf.slice(0, i);
        bedrockFpsMonitorBuf = bedrockFpsMonitorBuf.slice(i + 1);
        onLine(line);
      }
    });

    let stderrText = '';
    proc.stderr?.on('data', (d) => {
      const s = String(d || '').trim();
      if (!s) return;
      stderrText = `${stderrText}\n${s}`.slice(-1200);
    });

    proc.on('exit', () => {
      bedrockFpsMonitorProc = null;
      if (bedrockFpsState.enabled) {
        bedrockFpsState.enabled = false;
        bedrockFpsState.error = (stderrText || '').trim() || bedrockFpsState.error || 'presentmon_exited';
        emitBedrockFpsState();
      }
    });

    return { ok: true, backend: 'presentmon' };
  } catch (e) {
    bedrockFpsState = { ...bedrockFpsState, enabled: false, error: String(e?.message || e) };
    emitBedrockFpsState();
    return { ok: false, error: bedrockFpsState.error };
  }
}

function hasRecentBedrockWorldActivity(maxAgeMs = 180000) {
  try {
    const p = bedrockPaths();
    const worldsDir = p?.worlds;
    if (!worldsDir || !fs.existsSync(worldsDir)) return false;
    const list = fs.readdirSync(worldsDir, { withFileTypes: true }).filter(d => d.isDirectory());
    const nowTs = Date.now();
    for (const d of list) {
      const wp = path.join(worldsDir, d.name);
      const m = fs.statSync(wp).mtimeMs || 0;
      if (nowTs - m <= maxAgeMs) return true;
      const levelname = path.join(wp, 'levelname.txt');
      if (fs.existsSync(levelname)) {
        const m2 = fs.statSync(levelname).mtimeMs || 0;
        if (nowTs - m2 <= maxAgeMs) return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

let _worldOpenHardCache = false;
let _worldOpenHardCacheTs = 0;

function isBedrockWorldOpen() {
  const running = isBedrockRunning();
  if (!running) return false;

  // Faster hard check so closed worlds disappear quickly from list.
  const nowTs = Date.now();
  if (nowTs - _worldOpenHardCacheTs > 2500) {
    _worldOpenHardCacheTs = nowTs;
    try {
      const psHard = "$pids=(Get-Process Minecraft.Windows,MinecraftWindowsBeta -ErrorAction SilentlyContinue|Select-Object -ExpandProperty Id); if(-not $pids){'0';exit}; $eps=Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess -and ($_.LocalPort -eq 19132 -or $_.LocalPort -eq 19133) }; if($eps){'1'}else{'0'}";
      const outHard = execFileSync('powershell', ['-NoProfile', '-Command', psHard], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      _worldOpenHardCache = (outHard === '1');
    } catch (_) {
      _worldOpenHardCache = false;
    }
  }

  // Very short soft fallback for transition moments only.
  const recentWorldActivity = hasRecentBedrockWorldActivity(6000);
  return !!(_worldOpenHardCache || recentWorldActivity);
}

function watchBedrockAndRestore() {
  let seenRunning = false;
  const startedAt = Date.now();
  const maxWaitToAppearMs = 30000;
  const hardStopMs = 8 * 60 * 60 * 1000;

  const timer = setInterval(() => {
    try {
      const running = isBedrockRunning();
      if (running) seenRunning = true;

      const elapsed = Date.now() - startedAt;
      if (seenRunning && !running) {
        clearInterval(timer);
        closeBedrockHubWindow();
        restoreLauncherAfterGame();
        return;
      }

      // If process never appeared, return launcher back
      if (!seenRunning && elapsed > maxWaitToAppearMs) {
        clearInterval(timer);
        closeBedrockHubWindow();
        restoreLauncherAfterGame();
        return;
      }

      if (elapsed > hardStopMs) {
        clearInterval(timer);
        closeBedrockHubWindow();
        restoreLauncherAfterGame();
      }
    } catch (_) {
      clearInterval(timer);
      closeBedrockHubWindow();
      restoreLauncherAfterGame();
    }
  }, 2000);
}

function extractInviteCodeFromArgv(argv = []) {
  for (const a of argv) {
    const s = String(a || '').trim();
    const m = s.match(/^noclauncher:\/\/join\/([A-Za-z0-9_-]{4,32})/i);
    if (m) return String(m[1] || '').toUpperCase();
  }
  return '';
}

async function routeResolveRoom(base, room) {
  try {
    const roomId = String(room?.roomId || room?.id || '').trim();
    if (!roomId) return { ok: false, error: 'room_id_missing' };
    const r = await fetch(`${base}/route/resolve?roomId=${encodeURIComponent(roomId)}`, { headers: { 'User-Agent': 'NocLauncher/1.0' } });
    const j = await r.json();
    if (!r.ok || !j?.ok) return { ok: false, error: j?.error || `http_${r.status}` };
    return j;
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function openBedrockJoinTarget(room, routeData) {
  const name = encodeURIComponent(room?.worldName || 'Noc World');
  let host = String(routeData?.direct?.ip || room?.connect?.ip || '').trim();
  let port = Number(routeData?.direct?.port || room?.connect?.port || 19132);

  if (routeData?.route === 'relay' && routeData?.relay?.host && routeData?.relay?.port) {
    host = String(routeData.relay.host || '').trim();
    port = Number(routeData.relay.port || port);
  }

  if (!host) return { ok: false, error: 'no_route_host' };

  await shell.openExternal(`minecraft://?addExternalServer=${name}|${host}:${port}`);
  setTimeout(() => { try { shell.openExternal('minecraft://'); } catch (_) {} }, 700);
  return { ok: true, route: routeData?.route || 'direct', host, port };
}

async function tryJoinByInviteCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return { ok: false, error: 'code_required' };
  const base = await ensureRegistryUrlAuto();
  if (!base) return { ok: false, error: 'registry_not_set' };
  try {
    const r = await fetch(`${base}/invite/resolve?code=${encodeURIComponent(c)}`, { headers: { 'User-Agent': 'NocLauncher/1.0' } });
    const j = await r.json();
    if (!r.ok || !j?.ok) return { ok: false, error: j?.error || `http_${r.status}` };
    const room = j.room || {};
    const routeData = await routeResolveRoom(base, room);
    if (!routeData?.ok) {
      // Fallback to direct from room if resolve endpoint unavailable
      return await openBedrockJoinTarget(room, { route: 'direct', direct: room?.connect || null });
    }
    return await openBedrockJoinTarget(room, routeData);
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

process.on('uncaughtException', (e) => {
  try { sendLog('error', `uncaughtException: ${String(e?.stack || e)}`); } catch (_) {}
});
process.on('unhandledRejection', (e) => {
  try { sendLog('error', `unhandledRejection: ${String(e?.stack || e)}`); } catch (_) {}
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', async (_event, argv) => {
    const code = extractInviteCodeFromArgv(argv);
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
    if (code) {
      const r = await tryJoinByInviteCode(code);
      if (!r?.ok) pendingInviteCode = code;
    }
  });
}

app.whenReady().then(async () => {
  try {
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient('noclauncher', process.execPath, [path.resolve(process.argv[1] || '')]);
    } else {
      app.setAsDefaultProtocolClient('noclauncher');
    }
  } catch (_) {}

  // Do NOT block app startup with dependency installation.
  // Optional deps are installed lazily when a feature actually needs them.
  // (This prevents multi-minute "not clickable" freezes on first run.)
  // Apply download profile at startup
  applyDownloadMode(store.get('downloadMode'));
  try { restoreSafeLaunchModsIfNeeded(resolveActiveGameDir(store.store)); } catch {}

  // Remove application menu globally
  Menu.setApplicationMenu(null);

  app.on('browser-window-created', (_event, window) => {
    try {
      window.setMenuBarVisibility(false);
      window.removeMenu();
    } catch (_) {}
  });

  createSplashWindow();
  createWindow();
  ensureLocalRegistryProcess();
  ensureAutoLocalHostWatcher();

  const codeFromArgs = extractInviteCodeFromArgv(process.argv || []);
  const code = codeFromArgs || pendingInviteCode;
  if (code) {
    setTimeout(async () => {
      await tryJoinByInviteCode(code);
      pendingInviteCode = '';
    }, 1800);
  }

  // Lazy optional dependency warm-up (non-blocking)
  ensureOptionalDependency('prismarine-auth').catch(() => {});

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  try { stopBedrockFpsMonitor(); } catch (_) {}
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

function sendLog(type, message) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('log', { type, message, ts: Date.now() });

  // Also write to per-run log on disk
  try {
    if (runLogStream) {
      const ts = new Date().toISOString();
      const line = `[${ts}] ${String(type || 'info').toUpperCase()}: ${String(message || '')}\n`;
      runLogStream.write(line);
      pushRing(line);
    }
  } catch (_) {}
}


async function fetchManifestWithFallback() {
  const mirrorsEnabled = !!store.get('enableMirrorFallback');
  const urls = [
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    ...(mirrorsEnabled ? ['https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'] : [])
  ];

  let lastErr;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'NocLauncher/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return {
        latest: data.latest,
        versions: (data.versions || []).map(v => ({ id: v.id, type: v.type, time: v.time }))
      };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error('Не удалось загрузить список версий');
}

async function getManifest() {
  // Prefer cached manifest; refresh if older than 6h
  const cached = store.get('manifestCache');
  const ts = Number(store.get('manifestCacheTs') || 0);
  const fresh = cached?.versions?.length && (Date.now() - ts) < 6 * 60 * 60 * 1000;
  if (fresh) return cached;

  const payload = await fetchManifestWithFallback();
  store.set('manifestCache', payload);
  store.set('manifestCacheTs', Date.now());
  return payload;
}

async function resolveVersion(id) {
  const manifest = await getManifest().catch(() => store.get('manifestCache'));

  // Accept compound ids like "1.20.1-forge-47.4.16", "1.20.3 • FORGE • default",
  // or accidental typos like "1.21.11" (non-existent). We always resolve to a real Minecraft version id.
  const raw = String(id || 'latest-release').trim();
  const extractMc = (s) => {
    const m = s.match(/^(\d+\.\d+(?:\.\d+)?)/);
    if (m) return m[1];
    // If the string doesn't start with a version (e.g. "fabric-loader-0.18.4-1.19"),
    // pick the *last* Minecraft-like version token, not the first (which might be a loader/build number).
    const all = String(s).match(/(\d+\.\d+(?:\.\d+)?)/g);
    if (all && all.length) return all[all.length - 1];
    return s;
  };

  let chosen = raw;

  if (/-forge-/i.test(chosen)) chosen = chosen.split(/-forge-/i)[0];
  if (/-fabric-/i.test(chosen)) chosen = chosen.split(/-fabric-/i)[0];
  if (/-quilt-/i.test(chosen)) chosen = chosen.split(/-quilt-/i)[0];
  if (/-nocflat/i.test(chosen)) chosen = chosen.replace(/-nocflat.*/i, '');
  chosen = extractMc(chosen) || chosen;

  if (chosen === 'latest-release' && manifest?.latest?.release) chosen = manifest.latest.release;
  if (chosen === 'latest-snapshot' && manifest?.latest?.snapshot) chosen = manifest.latest.snapshot;
  if (chosen === 'latest-release' && manifest?.latest?.release) chosen = manifest.latest.release;
  if (chosen === 'latest-snapshot' && manifest?.latest?.snapshot) chosen = manifest.latest.snapshot;

  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
  let entry = versions.find(v => v.id === chosen);

  const pickClosestSameMinor = (wanted) => {
    if (!versions.length) return null;
    const mm = wanted.match(/^(\d+\.\d+)/)?.[1] || '';
    if (!mm) return null;
    // Prefer releases; if none, allow snapshots.
    const candidates = versions
      .filter(v => typeof v?.id === 'string' && v.id.startsWith(mm + '.') && (v.type === 'release' || v.type === 'snapshot'))
      .map(v => v.id)
      .sort((a,b) => compareSemverLike(a,b));
    return candidates.length ? candidates[0] : null;
  };

  if (!entry && /^\d+\.\d+(?:\.\d+)?$/.test(chosen) && versions.length) {
    // Common typo: too large patch number like 1.21.11 -> try 1.21.1 then 1.21.0
    const parts = chosen.split('.').map(x => parseInt(x,10));
    if (parts.length === 3 && Number.isFinite(parts[2]) && parts[2] > 1) {
      const try1 = `${parts[0]}.${parts[1]}.1`;
      const try0 = `${parts[0]}.${parts[1]}.0`;
      entry = versions.find(v => v.id === try1) || versions.find(v => v.id === try0);
      if (entry) chosen = entry.id;
    }
    if (!entry) {
      const closest = pickClosestSameMinor(chosen);
      if (closest) {
        chosen = closest;
        entry = versions.find(v => v.id === chosen);
      }
    }
  }

  if (!entry && /^\d+\.\d+(?:\.\d+)?$/.test(chosen) && versions.length) {
    const mm = chosen.match(/^(\d+\.\d+)/)?.[1] || '';
    if (mm) {
      const sameMinor = versions
        .filter(v => typeof v?.id === 'string' && v.id.startsWith(mm + '.') && v.type === 'release')
        .map(v => v.id)
        .sort((a,b) => compareSemverLike(a,b)); // compareSemverLike already sorts desc
      if (sameMinor.length) {
        chosen = sameMinor[0];
        entry = versions.find(v => v.id === chosen);
      }
    }
  }

  let type = 'release';
  if (entry?.type) type = entry.type;

  // If still unknown and manifest exists, fail with a clear message
  if (!entry && versions.length && /^\d+\.\d+/.test(chosen)) {
    throw new Error(`Версия Minecraft не найдена: ${chosen}`);
  }

  return { id: chosen, type };
}

// Resolve a version id for launching.
// If the requested id is a locally installed profile (e.g. Fabric/Forge custom profile in versions/),
// we must keep it intact and NOT "resolve" it to a vanilla Minecraft id from the manifest.
async function resolveVersionForLaunch(id, gameDir) {
  const raw = String(id || 'latest-release').trim() || 'latest-release';

  // Handle aliases via manifest.
  if (raw === 'latest-release' || raw === 'latest-snapshot') {
    return await resolveVersion(raw);
  }

  // If it's a local profile, keep it as-is.
  if (gameDir) {
    const local = readLocalVersionJson(gameDir, raw);
    if (local) {
      return { id: raw, type: String(local?.type || 'release'), local: true };
    }
  }

  // Fallback: resolve to a real Mojang version id.
  return await resolveVersion(raw);
}

function readLocalVersionJson(gameDir, versionId) {
  try {
    const base = path.join(gameDir, 'versions', versionId);
    const jsonPath = path.join(base, `${versionId}.json`);
    if (!fs.existsSync(jsonPath)) return null;
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeLocalVersionJson(gameDir, versionId, data) {
  try {
    const base = path.join(gameDir, 'versions', versionId);
    fs.mkdirSync(base, { recursive: true });
    const jsonPath = path.join(base, `${versionId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

function mergeLibraries(baseLibs, ownLibs) {
  const map = new Map();
  const score = (x) => {
    if (!x || typeof x !== 'object') return 0;
    let s = 0;
    if (x.name) s += 1;
    if (x.url) s += 2;
    if (x.downloads) s += 4;
    if (x.rules) s += 1;
    if (x.natives) s += 1;
    return s;
  };

  for (const lib of [...(baseLibs || []), ...(ownLibs || [])]) {
    const key = String(lib?.name || JSON.stringify(lib));
    const prev = map.get(key);
    if (!prev || score(lib) >= score(prev)) map.set(key, lib);
  }

  return Array.from(map.values());
}

function enrichOptiFineLibraryEntry(lib) {
  try {
    const name = String(lib?.name || '');
    if (!name.toLowerCase().startsWith('optifine:')) return lib;
    const parts = name.split(':');
    if (parts.length < 3) return lib;
    const artifact = parts[1];
    const version = parts.slice(2).join(':');
    const rel = `optifine/${artifact}/${version}/${artifact}-${version}.jar`;
    return {
      ...lib,
      url: lib?.url || 'https://libraries.minecraft.net/',
      downloads: {
        ...(lib?.downloads || {}),
        artifact: {
          ...((lib?.downloads && lib.downloads.artifact) ? lib.downloads.artifact : {}),
          path: rel,
          url: `https://libraries.minecraft.net/${rel}`
        }
      }
    };
  } catch {
    return lib;
  }
}

function resolveInheritedMeta(gameDir, versionId, depth = 0) {
  if (depth > 6) return null;
  const own = readLocalVersionJson(gameDir, versionId);
    // Don't "flatten" Fabric/Quilt profiles: they rely on their loader jar/mainClass and breaking that causes KnotClient CNFE.
    if (typeof own?.mainClass === 'string') {
      const mc = own.mainClass;
      if (mc.includes('net.fabricmc.loader') || mc.includes('org.quiltmc.loader')) {
        return versionId;
      }
    }
    if (typeof versionId === 'string' && (versionId.startsWith('fabric-loader-') || versionId.startsWith('quilt-loader-'))) {
      return versionId;
    }
  if (!own) return null;
  const parentId = own.inheritsFrom ? String(own.inheritsFrom).trim() : '';
  if (!parentId) return own;
  const parent = resolveInheritedMeta(gameDir, parentId, depth + 1) || readLocalVersionJson(gameDir, parentId);
  if (!parent) return own;

  // Deep-merge launcher arguments.
  // Important for Forge/ModLauncher profiles: child json often overrides only "jvm" while "game" lives in parent.
  // A shallow "own.arguments || parent.arguments" drops required flags like --accessToken/--version.
  const mergeArgsObj = (parentArgs, ownArgs) => {
    const p = (parentArgs && typeof parentArgs === 'object') ? parentArgs : null;
    const o = (ownArgs && typeof ownArgs === 'object') ? ownArgs : null;
    if (!p && !o) return undefined;
    const out = {};
    const mergeArr = (a, b) => {
      const aa = Array.isArray(a) ? a : [];
      const bb = Array.isArray(b) ? b : [];
      return aa.concat(bb);
    };
    if (p?.game || o?.game) out.game = mergeArr(p?.game, o?.game);
    if (p?.jvm || o?.jvm) out.jvm = mergeArr(p?.jvm, o?.jvm);
    return out;
  };

  const mergedArguments = mergeArgsObj(parent.arguments, own.arguments);

  return {
    ...parent,
    ...own,
    id: own.id || versionId,
    libraries: filterLibrariesForPlatform(mergeLibraries(parent.libraries, own.libraries)),
    downloads: { ...(parent.downloads || {}), ...(own.downloads || {}) },
    assetIndex: own.assetIndex || parent.assetIndex,
    assets: own.assets || parent.assets,
    javaVersion: own.javaVersion || parent.javaVersion,
    logging: own.logging || parent.logging,
    mainClass: own.mainClass || parent.mainClass,
    arguments: mergedArguments || own.arguments || parent.arguments,
    minecraftArguments: own.minecraftArguments || parent.minecraftArguments
  };
}

function mavenPathFromName(name) {
  try {
    const parts = String(name || '').split(':');
    if (parts.length < 3) return null;
    const group = parts[0].replace(/\./g, '/');
    const artifact = parts[1];
    const version = parts.slice(2).join(':');
    return `${group}/${artifact}/${version}/${artifact}-${version}.jar`;
  } catch {
    return null;
  }
}


function filterLibrariesForPlatform(libraries) {
  try {
    if (!Array.isArray(libraries)) return libraries;
    const platform = process.platform; // 'win32', 'darwin', 'linux'
    const arch = process.arch; // 'x64', 'arm64', 'ia32'

    const dropNative = (name) => {
      const n = String(name || '').toLowerCase();
      if (!n.includes(':natives-')) return false;
      if (platform === 'win32') {
        // Keep only the correct Windows natives for this arch.
        if (arch === 'x64') return n.includes(':natives-windows-x86') || n.includes(':natives-windows-arm64');
        if (arch === 'arm64') return n.includes(':natives-windows-x86') || (n.includes(':natives-windows') && !n.includes(':natives-windows-arm64'));
        if (arch === 'ia32') return n.includes(':natives-windows-arm64') || (n.includes(':natives-windows') && !n.includes(':natives-windows-x86'));
      }
      return false;
    };

    return libraries.filter(lib => !dropNative(lib?.name));
  } catch {
    return libraries;
  }
}

function collectForcedClasses(gameDir, versionId) {
  try {
    const v = readLocalVersionJson(gameDir, versionId);
    if (!v) return [];
    const out = [];
    const pushIfExists = (relOrAbs) => {
      if (!relOrAbs) return;
      const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(gameDir, 'libraries', relOrAbs.replace(/\//g, path.sep));
      if (fs.existsSync(abs)) out.push(abs);
    };

    for (const lib of (v.libraries || [])) {
      const rel = lib?.downloads?.artifact?.path || mavenPathFromName(lib?.name);
      pushIfExists(rel);
    }

    return Array.from(new Set(out));
  } catch {
    return [];
  }
}

function dedupeSingletonGameArgs(versionJson) {
  // Historical name kept, but it now sanitizes BOTH game+jvm args for modded profiles.
  try {
    if (!versionJson || typeof versionJson !== 'object') return versionJson;

    const singleton = new Set([
      '--launchTarget', '--fml.forgeVersion', '--fml.mcVersion', '--fml.forgeGroup', '--fml.mcpVersion',
      '--version', '--gameDir', '--assetsDir', '--assetIndex', '--uuid', '--accessToken', '--userType', '--versionType',
      '--clientId', '--xuid'
    ]);

    const seen = new Set();

    const dedupeArray = (arr) => {
      if (!Array.isArray(arr)) return arr;
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const cur = arr[i];

        if (typeof cur !== 'string') {
          // Keep rule-objects, but sanitize their internal string arrays too.
          if (cur && typeof cur === 'object' && Array.isArray(cur.value)) {
            out.push({ ...cur, value: dedupeArray(cur.value) });
          } else {
            out.push(cur);
          }
          continue;
        }

        if (singleton.has(cur)) {
          const next = arr[i + 1];
          if (seen.has(cur)) {
            if (typeof next === 'string' && !next.startsWith('--')) i++;
            continue;
          }
          seen.add(cur);
          out.push(cur);
          if (typeof next === 'string' && !next.startsWith('--')) {
            out.push(next);
            i++;
          }
          continue;
        }

        out.push(cur);
      }
      return out;
    };

    // sanitize arguments.game and arguments.jvm if present
    if (versionJson.arguments && typeof versionJson.arguments === 'object') {
      if (Array.isArray(versionJson.arguments.game)) {
        versionJson.arguments.game = dedupeArray(versionJson.arguments.game);
      }
      if (Array.isArray(versionJson.arguments.jvm)) {
        versionJson.arguments.jvm = dedupeArray(versionJson.arguments.jvm);
      }
    }
    return versionJson;
  } catch {
    return versionJson;
  }
}

function buildFlattenedVersionProfile(gameDir, versionId) {
  try {
    const own = readLocalVersionJson(gameDir, versionId);
    if (!own?.inheritsFrom) return versionId;

    const merged = resolveInheritedMeta(gameDir, versionId);
    if (!merged) return versionId;

    const flatId = `${versionId}-nocflat`;
    const flatDir = path.join(gameDir, 'versions', flatId);
    fs.mkdirSync(flatDir, { recursive: true });

    const flat = {
      ...merged,
      id: flatId,
      inheritsFrom: undefined,
      libraries: filterLibrariesForPlatform(mergeLibraries(merged.libraries, [])).map(enrichOptiFineLibraryEntry),
      downloads: { ...(merged.downloads || {}) }
    };

    if (String(flat.mainClass || '').trim() === 'net.minecraft.launchwrapper.Launch') {
      const libs = Array.isArray(flat.libraries) ? flat.libraries : [];
      const hasLaunchWrapper = libs.some(l => String(l?.name || '').toLowerCase().startsWith('net.minecraft:launchwrapper:1.12'));
      if (!hasLaunchWrapper) {
        libs.push({
          name: 'net.minecraft:launchwrapper:1.12',
          url: 'https://libraries.minecraft.net/',
          downloads: {
            artifact: {
              path: 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar',
              url: 'https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar'
            }
          }
        });
      }
      flat.libraries = filterLibrariesForPlatform(libs);
    }

    // remove undefined keys for clean JSON
    if (!flat.inheritsFrom) delete flat.inheritsFrom;

    const sanitized = dedupeSingletonGameArgs(flat);

    // NeoForge/Forge installers may emit a JVM arg with placeholder `${library_directory}`.
    // Many third-party launcher libs do NOT substitute it, so we bake an absolute path into the flattened profile.
    try {
      const libDir = path.join(gameDir, 'libraries');
      const repl = (v) => (typeof v === 'string'
        ? v.replace(/\$\{library_directory\}/g, libDir).replace(/\$\{libraryDirectory\}/g, libDir)
        : v);

      const jvm = sanitized?.arguments?.jvm;
      if (Array.isArray(jvm)) {
        sanitized.arguments.jvm = jvm.map((a) => {
          if (typeof a === 'string') return repl(a);
          if (a && typeof a === 'object') {
            const vv = a.value;
            if (typeof vv === 'string') a.value = repl(vv);
            else if (Array.isArray(vv)) a.value = vv.map(repl);
            return a;
          }
          return a;
        });
      }
    } catch (_) {}

    const outPath = path.join(flatDir, `${flatId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sanitized, null, 2));
    return flatId;
  } catch (e) {
    sendLog('warn', `Flatten profile failed (${versionId}): ${String(e?.message || e)}`);
    return versionId;
  }
}

async function ensureLaunchWrapperArtifacts(gameDir, versionId) {
  try {
    const v = readLocalVersionJson(gameDir, versionId);
    if (!v) return;
    if (String(v.mainClass || '').trim() !== 'net.minecraft.launchwrapper.Launch') return;

    const libRel = path.join('net', 'minecraft', 'launchwrapper', '1.12', 'launchwrapper-1.12.jar');
    const libAbs = path.join(gameDir, 'libraries', libRel);

    const hasLaunchClass = (jarPath) => {
      try {
        if (!fs.existsSync(jarPath)) return false;
        const z = new AdmZip(jarPath);
        return !!z.getEntry('net/minecraft/launchwrapper/Launch.class');
      } catch {
        return false;
      }
    };

    if (!hasLaunchClass(libAbs)) {
      try { fs.rmSync(libAbs, { force: true }); } catch (_) {}
      const urls = [
        'https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar',
        'https://repo1.maven.org/maven2/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar'
      ];
      let ok = false;
      let lastErr = null;
      for (const u of urls) {
        try {
          await downloadFile(u, libAbs);
          if (hasLaunchClass(libAbs)) { ok = true; break; }
          try { fs.rmSync(libAbs, { force: true }); } catch (_) {}
        } catch (e) {
          lastErr = e;
        }
      }
      if (!ok) throw new Error(`launchwrapper jar invalid (${String(lastErr?.message || lastErr || 'unknown')})`);
      sendLog('info', 'Downloaded valid launchwrapper-1.12.jar for profile');
    }

    let libs = Array.isArray(v.libraries) ? v.libraries : [];
    // Canonicalize OptiFine libs so MCLC always adds them to classpath.
    libs = libs.map(enrichOptiFineLibraryEntry);

    // Ensure OptiFine jars exist for every optifine:* entry.
    for (const lib of libs) {
      const n = String(lib?.name || '').toLowerCase();
      if (!n.startsWith('optifine:')) continue;
      const rel = lib?.downloads?.artifact?.path;
      if (!rel) continue;
      const abs = path.join(gameDir, 'libraries', rel.replace(/\//g, path.sep));
      if (!fs.existsSync(abs)) {
        sendLog('warn', `Missing OptiFine library file: ${abs}`);
      }
    }

    // Force a canonical launchwrapper entry (replace weak/partial entries).
    libs = libs.filter(l => !String(l?.name || '').toLowerCase().startsWith('net.minecraft:launchwrapper:'));
    libs.push({
      name: 'net.minecraft:launchwrapper:1.12',
      url: 'https://libraries.minecraft.net/',
      downloads: {
        artifact: {
          path: 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar',
          url: 'https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar'
        }
      }
    });
    v.libraries = libs;
    writeLocalVersionJson(gameDir, versionId, dedupeSingletonGameArgs(v));
  } catch (e) {
    sendLog('warn', `LaunchWrapper ensure failed: ${String(e?.message || e)}`);
  }
}

function hydrateVersionJsonForLaunch(gameDir, versionId) {
  try {
    const own = readLocalVersionJson(gameDir, versionId);
    if (!own || !own.inheritsFrom) return;
    const merged = resolveInheritedMeta(gameDir, versionId);
    if (!merged) return;

    const mustHave = !!(merged.assetIndex && (merged.assetIndex.url || merged.assetIndex.id) && merged.mainClass);
    if (!mustHave) return;

    const patched = {
      ...own,
      mainClass: own.mainClass || merged.mainClass,
      libraries: filterLibrariesForPlatform(mergeLibraries(merged.libraries, own.libraries)).map(enrichOptiFineLibraryEntry),
      downloads: { ...(merged.downloads || {}), ...(own.downloads || {}) },
      assetIndex: own.assetIndex || merged.assetIndex,
      assets: own.assets || merged.assets,
      logging: own.logging || merged.logging,
      arguments: own.arguments || merged.arguments,
      minecraftArguments: own.minecraftArguments || merged.minecraftArguments,
      javaVersion: own.javaVersion || merged.javaVersion
    };

    // Legacy OptiFine profiles often need LaunchWrapper explicitly.
    if (String(patched.mainClass || '').trim() === 'net.minecraft.launchwrapper.Launch') {
      const libs = Array.isArray(patched.libraries) ? patched.libraries : [];
      const hasLaunchWrapper = libs.some(l => String(l?.name || '').toLowerCase().startsWith('net.minecraft:launchwrapper:'));
      if (!hasLaunchWrapper) {
        libs.push({
          name: 'net.minecraft:launchwrapper:1.12',
          url: 'https://libraries.minecraft.net/',
          downloads: {
            artifact: {
              path: 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar',
              url: 'https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar'
            }
          }
        });
      }
      patched.libraries = libs;
    }

    // Forge Bootstrap on JPMS is sensitive to duplicate GA (e.g. failureaccess 1.0.1 + 1.0.2),
    // which can produce split-package / ResolutionException. Dedupe a few known offenders.
    try {
      const mc = String(patched?.id || versionId || "");
      const mainCls = String(patched?.mainClass || "");
      const isForge = /forge/i.test(mc) || /net\.minecraftforge\./i.test(mainCls) || /net\.forge/i.test(mainCls);
      if (isForge && Array.isArray(patched.libraries)) {
        const keepHighest = (arr) => {
          // semver-ish compare: split by non-alnum, compare numbers, fallback lexicographic
          const cmp = (a, b) => {
            const pa = String(a || "").split(/[^0-9A-Za-z]+/).filter(Boolean);
            const pb = String(b || "").split(/[^0-9A-Za-z]+/).filter(Boolean);
            const n = Math.max(pa.length, pb.length);
            for (let i = 0; i < n; i++) {
              const xa = pa[i] ?? "0";
              const xb = pb[i] ?? "0";
              const ia = xa.match(/^\d+$/) ? parseInt(xa, 10) : NaN;
              const ib = xb.match(/^\d+$/) ? parseInt(xb, 10) : NaN;
              if (!Number.isNaN(ia) && !Number.isNaN(ib)) {
                if (ia !== ib) return ia - ib;
              } else {
                if (xa !== xb) return xa < xb ? -1 : 1;
              }
            }
            return 0;
          };
          const best = {};
          for (const lib of arr) {
            const name = lib?.name;
            if (!name) continue;
            const parts = String(name).split(":");
            if (parts.length < 3) continue;
            const ga = parts[0] + ":" + parts[1];
            const ver = parts.slice(2).join(":");
            const cur = best[ga];
            if (!cur || cmp(cur.ver, ver) < 0) best[ga] = { ver, lib };
          }
          const out = [];
          const seen = new Set();
          for (const lib of arr) {
            const name = lib?.name;
            if (!name) { out.push(lib); continue; }
            const parts = String(name).split(":");
            if (parts.length < 3) { out.push(lib); continue; }
            const ga = parts[0] + ":" + parts[1];
            if (seen.has(name)) continue;
            const pick = best[ga]?.lib;
            if (pick && pick === lib) out.push(lib);
            // keep libs without GA match
            if (!pick) out.push(lib);
            seen.add(name);
          }
          return out;
        };

        const offenders = new Set(["com.google.guava:failureaccess", "com.google.guava:guava"]);
        const libs = patched.libraries;
        const grouped = {};
        for (const lib of libs) {
          const name = lib?.name;
          if (!name) continue;
          const parts = String(name).split(":");
          if (parts.length < 3) continue;
          const ga = parts[0] + ":" + parts[1];
          if (offenders.has(ga)) {
            grouped[ga] = grouped[ga] || [];
            grouped[ga].push(lib);
          }
        }
        let changed = false;
        let newLibs = libs;
        for (const ga of Object.keys(grouped)) {
          if (grouped[ga].length > 1) {
            changed = true;
          }
        }
        if (changed) {
          // Remove all offender libs and re-add only highest versions for each offender.
          newLibs = libs.filter(l => {
            const name = l?.name;
            if (!name) return true;
            const parts = String(name).split(":");
            if (parts.length < 3) return true;
            const ga = parts[0] + ":" + parts[1];
            return !offenders.has(ga);
          });
          const bestOff = keepHighest(libs.filter(l => {
            const n = l?.name;
            if (!n) return false;
            const parts = String(n).split(":");
            if (parts.length < 3) return false;
            const ga = parts[0] + ":" + parts[1];
            return offenders.has(ga);
          }));
          newLibs = newLibs.concat(bestOff);
          patched.libraries = newLibs;
        }
      }
    } catch (e) {}

    writeLocalVersionJson(gameDir, versionId, dedupeSingletonGameArgs(patched));
    sendLog('info', `Профиль ${versionId} подготовлен для запуска (merged inheritsFrom)`);
  } catch (e) {
    sendLog('warn', `Не удалось гидратировать профиль ${versionId}: ${String(e?.message || e)}`);
  }
}

function isVersionInstalled(gameDir, versionId) {
  try {
    const base = path.join(gameDir, 'versions', versionId);
    const jsonPath = path.join(base, `${versionId}.json`);
    const jarPath = path.join(base, `${versionId}.jar`);
    if (!fs.existsSync(jsonPath)) return false;
    if (fs.existsSync(jarPath)) return true;

    // Modded profiles (forge/optifine) often inherit from base version and have no local .jar
    const parsed = readLocalVersionJson(gameDir, versionId);
    return !!parsed?.inheritsFrom;
  } catch (_) {
    return false;
  }
}

function existsFile(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function preferJavaExe(p) {
  try {
    if (!p) return p;
    const s = String(p);
    if (s.toLowerCase().endsWith('javaw.exe')) {
      const j = s.slice(0, -9) + 'java.exe';
      if (fs.existsSync(j)) return j;
    }
    return s;
  } catch {
    return p;
  }
}

function parseNbtAsync(buf) {
  return new Promise((resolve, reject) => {
    nbt.parse(buf, (err, data) => {
      if (err) return reject(err);
      resolve(nbt.simplify ? data : data);
    });
  });
}

function makeJavaServerEntry(name, ip) {
  return {
    name: { type: 'string', value: String(name || '') },
    ip: { type: 'string', value: String(ip || '') },
    hidden: { type: 'byte', value: 0 },
    acceptTextures: { type: 'byte', value: 0 }
  };
}

async function ensureJavaServerInListAt(filePath) {
  try {
    const p = filePath;
    let root;
    let wasGzip = false;

    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p);
      let parsed = null;

      // servers.dat may be gzip-compressed OR plain NBT depending on tools/version
      try {
        const inflated = zlib.gunzipSync(raw);
        parsed = await parseNbtAsync(inflated);
        wasGzip = true;
      } catch (_) {
        try {
          parsed = await parseNbtAsync(raw);
        } catch {
          parsed = null;
        }
      }

      root = parsed?.parsed || parsed;
    }

    if (!root || root.type !== 'compound') {
      root = {
        type: 'compound',
        name: '',
        value: {
          servers: {
            type: 'list',
            value: { type: 'compound', value: [] }
          }
        }
      };
    }

    if (!root.value.servers || root.value.servers.type !== 'list') {
      root.value.servers = { type: 'list', value: { type: 'compound', value: [] } };
    }

    const listObj = root.value.servers.value || { type: 'compound', value: [] };
    if (!Array.isArray(listObj.value)) listObj.value = [];

    // sanitize malformed blank entries
    const beforeLen = listObj.value.length;
    listObj.value = listObj.value.filter((entry) => {
      const e = entry?.value || entry || {};
      return !!(e.ip?.value || e.name?.value);
    });

    const exists = listObj.value.some((entry) => {
      const e = entry?.value || entry || {};
      const ip = String(e.ip?.value || '').toLowerCase().replace(/\.$/, '');
      const target = DEFAULT_JAVA_SERVER.ip.toLowerCase().replace(/\.$/, '');
      return ip === target;
    });

    let changed = listObj.value.length !== beforeLen;
    if (!exists) {
      listObj.type = 'compound';
      listObj.value.push(makeJavaServerEntry(DEFAULT_JAVA_SERVER.name, DEFAULT_JAVA_SERVER.ip));
      changed = true;
    }

    if (changed) {
      root.value.servers.value = listObj;
      const out = nbt.writeUncompressed(root);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, wasGzip ? zlib.gzipSync(out) : out);
      return true;
    }
    return false;
  } catch {
    try {
      const fresh = {
        type: 'compound',
        name: '',
        value: {
          servers: {
            type: 'list',
            value: { type: 'compound', value: [makeJavaServerEntry(DEFAULT_JAVA_SERVER.name, DEFAULT_JAVA_SERVER.ip)] }
          }
        }
      };
      const out = nbt.writeUncompressed(fresh);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, out);
      return true;
    } catch {
      return false;
    }
  }
}

async function ensureJavaServerInList(gameDir) {
  const targets = [
    path.join(gameDir, 'servers.dat'),
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft', 'servers.dat')
  ];

  let added = 0;
  for (const t of targets) {
    const r = await ensureJavaServerInListAt(t);
    if (r) added++;
  }
  if (added > 0) {
    sendLog('info', `Сервер добавлен в Java список: ${DEFAULT_JAVA_SERVER.name} (${DEFAULT_JAVA_SERVER.ip})`);
  }
}

async function ensureBedrockServerLink() {
  try {
    const uri = `minecraft://?addExternalServer=${encodeURIComponent(DEFAULT_BEDROCK_SERVER.name)}|${DEFAULT_BEDROCK_SERVER.ip}:${DEFAULT_BEDROCK_SERVER.port}`;
    await shell.openExternal(uri);
    return true;
  } catch (_) {
    return false;
  }
}

function findSystemJava() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where', ['java'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      const first = out.split(/\r?\n/).find(Boolean);
      return first || '';
    }
    const out = execFileSync('which', ['java'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out || '';
  } catch {
    return '';
  }
}

function getJavaMajor(javaPath) {
  try {
    const out = execFileSync(javaPath, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    const m = out.match(/version\s+"(\d+)(?:\.(\d+))?/i);
    if (!m) return null;
    const major = Number(m[1]);
    if (!Number.isFinite(major)) return null;
    // Java 8 reports 1.8
    if (major === 1 && Number(m[2]) === 8) return 8;
    return major;
  } catch (e) {
    try {
      const err = String(e?.stderr || '');
      const m = err.match(/version\s+"(\d+)(?:\.(\d+))?/i);
      if (!m) return null;
      const major = Number(m[1]);
      if (major === 1 && Number(m[2]) === 8) return 8;
      return Number.isFinite(major) ? major : null;
    } catch {
      return null;
    }
  }
}

function isJavaCompatible(required, actual) {
  if (!required || !actual) return false;
  if (required === 21) return actual >= 21;
  // For older MC/Forge better to keep exact major runtime
  return actual === required;
}

function guessJavaMajorForMc(versionId) {
  // Practical mapping for modern Minecraft:
  // <= 1.16.x        -> Java 8
  // 1.17.x           -> Java 16 (official requirement)
  // 1.18.x - 1.20.4  -> Java 17
  // >= 1.20.5        -> Java 21 (Minecraft updated runtime)
  // Snapshots/default -> 21
  const v = String(versionId || '').trim();
  const m = v.match(/^1\.(\d+)(?:\.(\d+))?/);
  if (!m) return 21;
  const minor = Number(m[1]);
  if (!Number.isFinite(minor)) return 17;
  if (minor <= 16) return 8;
  if (minor === 17) return 16;
  if (minor >= 21) return 21;
  if (minor === 20) {
    const patch = Number(m[2] || 0);
    if (Number.isFinite(patch) && patch >= 5) return 21;
    return 17;
  }
  return 17;
}

async function downloadFile(url, dest, onProgress, opts = {}) {
  // opts: { label, maxKBps, timeoutMs, mirrors: [url1,url2,...], allowResume=true }
  const label = opts.label || path.basename(dest);
  const allowResume = opts.allowResume !== false;
  const timeoutMs = Number(opts.timeoutMs || 30000);
  const maxKBps = Number(opts.maxKBps || 0);
  const mirrors = Array.isArray(opts.mirrors) && opts.mirrors.length ? opts.mirrors : [url];
  const maxAttempts = Number(opts.maxAttempts || 5);

  ensureDir(path.dirname(dest));
  const part = dest + '.part';

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const withTimeout = async (p) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
    try {
      return await p(ac.signal);
    } finally {
      clearTimeout(t);
    }
  };

  const tryOnce = async (u) => withTimeout(async (signal) => {
    let start = 0;
    if (allowResume && fs.existsSync(part)) {
      try { start = fs.statSync(part).size || 0; } catch { start = 0; }
    }
    const headers = {};
    if (allowResume && start > 0) headers['Range'] = `bytes=${start}-`;

    const res = await fetch(u, { headers, signal });
    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const total = Number(res.headers.get('content-length') || 0) + (res.status === 206 ? start : 0);
    const ws = fs.createWriteStream(part, { flags: (res.status === 206 && start > 0) ? 'a' : 'w' });

    let received = (res.status === 206) ? start : 0;
    let lastTick = Date.now();
    let bucket = 0;

    return await new Promise((resolve, reject) => {
      const onErr = (e) => {
        try { ws.close(); } catch {}
        reject(e);
      };
      res.body.on('error', onErr);
      ws.on('error', onErr);
      ws.on('finish', () => {
        try {
          fs.renameSync(part, dest);
        } catch (e) { return reject(e); }
        resolve({ ok: true, total, received });
      });

      res.body.on('data', async (chunk) => {
        received += chunk.length;
        // rate limit
        if (maxKBps > 0) {
          bucket += chunk.length;
          const now = Date.now();
          const elapsed = now - lastTick;
          const allowed = (maxKBps * 1024) * (elapsed / 1000);
          if (bucket > allowed) {
            const excess = bucket - allowed;
            const waitMs = Math.ceil((excess / (maxKBps * 1024)) * 1000);
            res.body.pause();
            setTimeout(() => {
              bucket = 0;
              lastTick = Date.now();
              res.body.resume();
            }, Math.min(5000, Math.max(10, waitMs)));
          }
        }

        if (typeof onProgress === 'function') {
          try { onProgress(received, total, label); } catch {}
        }
      });

      res.body.pipe(ws);
    });
  });

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const u of mirrors) {
      try {
        return await tryOnce(u);
      } catch (e) {
        lastErr = e;
        // if server doesn't support range, retry from scratch once
        if (String(e?.message || '').includes('416')) {
          try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch {}
        }
      }
    }
    await sleep(Math.min(8000, 250 * (2 ** (attempt - 1))));
  }
  throw new Error(`[${label}] download failed: ${String(lastErr?.message || lastErr || 'unknown')}`);
}


function buildMirrorsForUrl(settings, url) {
  const enable = settings?.enableMirrorFallback !== false;
  const mode = String(settings?.downloadSource || 'auto').toLowerCase();
  if (!enable) return [url];

  const u = String(url);
  const out = [u];

  const bmcl = (x) => x
    .replace('https://piston-meta.mojang.com/', 'https://bmclapi2.bangbang93.com/')
    .replace('https://piston-data.mojang.com/', 'https://bmclapi2.bangbang93.com/')
    .replace('https://launchermeta.mojang.com/', 'https://bmclapi2.bangbang93.com/')
    .replace('https://resources.download.minecraft.net/', 'https://bmclapi2.bangbang93.com/assets/')
    .replace('https://libraries.minecraft.net/', 'https://bmclapi2.bangbang93.com/libraries/');

  const bmclUrl = bmcl(u);
  if (bmclUrl !== u) out.push(bmclUrl);

  // prefer based on mode
  if (mode === 'bmclapi') return Array.from(new Set([bmclUrl, u].filter(Boolean)));
  if (mode === 'mojang') return Array.from(new Set([u, bmclUrl].filter(Boolean)));
  // auto: try mojang then bmcl
  return Array.from(new Set(out));
}


async function ensureBundledJavaWindows(runtimeDir, major) {
  // Download Temurin JRE via Adoptium API (latest GA)
  // NOTE: For Windows this endpoint returns a .zip.
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  const zipPath = path.join(runtimeDir, `temurin-jre${major}.zip`);
  const outDir = path.join(runtimeDir, `jre${major}`);

  // If already extracted, reuse
  if (fs.existsSync(outDir)) {
    const javaExe = path.join(outDir, 'bin', 'java.exe');
    const javawExe = path.join(outDir, 'bin', 'javaw.exe');
    if (fs.existsSync(javaExe) || fs.existsSync(javawExe)) {
      return fs.existsSync(javawExe) ? javawExe : javaExe;
    }
  }

  await fs.promises.mkdir(runtimeDir, { recursive: true });
  sendLog('info', `Java не найдена — скачиваю встроенную Java ${major}...`);
  sendMcState('java-downloading', { major, progress: 0 });
  await downloadFile(
    url,
    zipPath,
    (received, total) => sendMcState('java-downloading', { major, progress: total ? Math.round((received / total) * 100) : 0 }),
    { label: `Temurin JRE ${major}`, mirrors: buildMirrorsForUrl(store.store, url), maxKBps: store.get('downloadMaxKBps') || 0 }
  );
  sendMcState('java-unpacking', { major });

  // Extract zip
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  // Find the top-level folder inside zip (usually 'jdk-...' or 'jre-...')
  const topFolder = entries
    .map(e => e.entryName.split('/')[0])
    .find(Boolean);

  const tmpExtract = path.join(runtimeDir, `_tmp_extract_${major}`);
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  zip.extractAllTo(tmpExtract, true);

  // Move extracted folder content into outDir
  fs.rmSync(outDir, { recursive: true, force: true });
  const extractedRoot = topFolder ? path.join(tmpExtract, topFolder) : tmpExtract;
  fs.mkdirSync(outDir, { recursive: true });

  // Copy recursively (Node 16+ supports fs.cp)
  if (fs.cpSync) {
    fs.cpSync(extractedRoot, outDir, { recursive: true });
  } else {
    // fallback: minimal recursive copy
    const copyDir = (src, dst) => {
      fs.mkdirSync(dst, { recursive: true });
      for (const item of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, item.name);
        const d = path.join(dst, item.name);
        if (item.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    };
    copyDir(extractedRoot, outDir);
  }

  fs.rmSync(tmpExtract, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  // Prefer java.exe for better process control/logging.
  const javaExe = path.join(outDir, 'bin', 'java.exe');
  const javawExe = path.join(outDir, 'bin', 'javaw.exe');
  if (fs.existsSync(javaExe)) return javaExe;
  if (fs.existsSync(javawExe)) return javawExe;
  throw new Error('Java скачалась, но не удалось найти java.exe');
}

async function resolveJavaPathForMc(versionId, settingsJavaPath, gameDir, forcedMajor = null) {
  const requiredMajor = forcedMajor || guessJavaMajorForMc(versionId);

  // 1) User-defined javaPath (only if compatible)
  const p = (settingsJavaPath || '').trim();
  if (existsFile(p)) {
    const pp = preferJavaExe(p);
    const m = getJavaMajor(pp);
    if (isJavaCompatible(requiredMajor, m)) return pp;
    store.set('javaPath', '');
    sendLog('info', `Java Path из настроек недоступен/неподходящий (${m || 'unknown'}) для ${versionId}. Авто-выбор Java ${requiredMajor}.`);
  }

  // 2) System Java (only if compatible)
  const sys = findSystemJava();
  if (existsFile(sys)) {
    const m = getJavaMajor(sys);
    if (isJavaCompatible(requiredMajor, m)) return preferJavaExe(sys);
  }

  // 3) Auto-install (Windows only)
  if (process.platform !== 'win32') {
    throw new Error('Java не найдена (или не подходит по версии). Установи нужную Java или укажи путь в настройках.');
  }

  const runtimeDir = path.join(gameDir, '.runtime');
  const bundled = await ensureBundledJavaWindows(runtimeDir, requiredMajor);
  return preferJavaExe(bundled);
}

async function ensureBaseForCustomProfileIfNeeded(gameDir, versionId, javaPath) {
  const meta = readLocalVersionJson(gameDir, versionId);
  if (!meta?.inheritsFrom) return;
  const base = normalizeBaseMcVersion(meta.inheritsFrom);
  if (!base || base === versionId) return;
  if (!isVersionInstalled(gameDir, base)) {
    sendLog('info', `Профиль ${versionId} требует базу ${base} — докачиваю ваниллу...`);
    await ensureVanillaInstalledBase(base, gameDir, javaPath);
  }
}

function sendMcState(state, extra = {}) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('mc:state', { state, ...extra, ts: Date.now() });
}

function ensureOptiFineSafeBoot(gameDir) {
  try {
    const of = path.join(gameDir, 'optionsof.txt');

    // Hard reset of OptiFine options (shaders OFF) to avoid startup shader NPE loops.
    const safe = [
      'ofShaderPack:OFF',
      'shaderPack:OFF',
      'ofFastRender:false',
      'ofAaLevel:0',
      'ofAfLevel:1',
      'ofDynamicLights:3'
    ].join('\n') + '\n';

    if (fs.existsSync(of)) {
      try { fs.copyFileSync(of, `${of}.bak`); } catch (_) {}
    }
    fs.writeFileSync(of, safe, 'utf8');

    // Clear shader cache if exists
    const shaderCache = path.join(gameDir, 'shaderpacks', '.cache');
    try { fs.rmSync(shaderCache, { recursive: true, force: true }); } catch (_) {}

    sendLog('info', 'OptiFine safe boot applied (shaders OFF + optionsof reset)');
  } catch (e) {
    sendLog('warn', `OptiFine safe boot failed: ${String(e?.message || e)}`);
  }
}

function applyFpsBoostOptions(gameDir, preset = 'safe') {
  try {
    const p = path.join(gameDir, 'options.txt');
    let lines = [];
    if (fs.existsSync(p)) {
      lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    }

    const map = new Map();
    for (const ln of lines) {
      const i = ln.indexOf(':');
      if (i <= 0) continue;
      map.set(ln.slice(0, i), ln.slice(i + 1));
    }

    const profile = String(preset || 'safe').toLowerCase();
    const cfg = {
      safe: { maxFps: '160', renderDistance: '10', simulationDistance: '8', particles: '2', mipmapLevels: '3' },
      balanced: { maxFps: '260', renderDistance: '8', simulationDistance: '6', particles: '1', mipmapLevels: '2' },
      aggressive: { maxFps: '360', renderDistance: '6', simulationDistance: '5', particles: '0', mipmapLevels: '1' }
    }[profile] || { maxFps: '160', renderDistance: '10', simulationDistance: '8', particles: '2', mipmapLevels: '3' };

    map.set('enableVsync', 'false');
    map.set('graphicsMode', '0'); // fast
    map.set('entityShadows', 'false');
    map.set('biomeBlendRadius', '0');
    map.set('maxFps', cfg.maxFps);
    map.set('renderDistance', cfg.renderDistance);
    map.set('simulationDistance', cfg.simulationDistance);
    map.set('particles', cfg.particles);
    map.set('mipmapLevels', cfg.mipmapLevels);

    const out = Array.from(map.entries()).map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, out, 'utf8');

    // OptiFine safety: disable shaders to avoid startup crashes from broken/old shader packs.
    const of = path.join(gameDir, 'optionsof.txt');
    let ofLines = [];
    if (fs.existsSync(of)) ofLines = fs.readFileSync(of, 'utf8').split(/\r?\n/).filter(Boolean);
    const ofMap = new Map();
    for (const ln of ofLines) {
      const i = ln.indexOf(':');
      if (i <= 0) continue;
      ofMap.set(ln.slice(0, i), ln.slice(i + 1));
    }
    ofMap.set('ofShaderPack', 'OFF');
    ofMap.set('ofFastRender', 'true');
    ofMap.set('ofAaLevel', '0');
    ofMap.set('ofAfLevel', '1');
    ofMap.set('ofDynamicLights', '3');
    const ofOut = Array.from(ofMap.entries()).map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
    fs.writeFileSync(of, ofOut, 'utf8');

    sendLog('info', `FPS boost profile applied: ${preset} (options + OptiFine safe defaults)`);
  } catch (e) {
    sendLog('warn', `FPS boost options apply failed: ${String(e?.message || e)}`);
  }
}

async function fetchSkinByNickname(gameDir, nickname) {
  const nick = String(nickname || '').trim();
  if (!nick) throw new Error('Ник пустой');

  let skinBuffer = null;
  let lastErr = null;

  try {
    const prof = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`);
    if (prof.ok) {
      const p = await prof.json();
      const uuid = String(p?.id || '').trim();
      if (uuid) {
        const s = await fetch(`https://crafatar.com/skins/${uuid}`);
        if (s.ok) {
          const ab = await s.arrayBuffer();
          skinBuffer = Buffer.from(ab);
        }
      }
    }
  } catch (e) {
    lastErr = e;
  }

  if (!skinBuffer) {
    try {
      const s2 = await fetch(`https://mc-heads.net/skin/${encodeURIComponent(nick)}`);
      if (s2.ok) {
        const ab2 = await s2.arrayBuffer();
        skinBuffer = Buffer.from(ab2);
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!skinBuffer || !skinBuffer.length) {
    throw new Error(`Скин по нику ${nick} не найден${lastErr ? ` (${String(lastErr.message || lastErr)})` : ''}`);
  }

  const skinsDir = path.join(gameDir, 'skins');
  fs.mkdirSync(skinsDir, { recursive: true });
  const outPath = path.join(skinsDir, `${nick}.png`);
  fs.writeFileSync(outPath, skinBuffer);
  return outPath;
}

async function fetchSkinByUrl(gameDir, skinUrl, tag = 'custom') {
  const url = String(skinUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Ссылка скина должна начинаться с http/https');

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Скин по ссылке не скачан: HTTP ${r.status}`);

  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  if (!buf.length) throw new Error('Пустой файл скина');

  const safeTag = String(tag || 'custom').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const skinsDir = path.join(gameDir, 'skins');
  fs.mkdirSync(skinsDir, { recursive: true });
  const outPath = path.join(skinsDir, `${safeTag}_url.png`);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

async function resolveOfflineSkinPath(settings, gameDir, username) {
  const mode = String(settings?.skinMode || 'auto').toLowerCase();
  const filePath = String(settings?.offlineSkinPath || '').trim();
  const skinNick = String(settings?.skinNick || '').trim();
  const skinUrl = String(settings?.skinUrl || '').trim();

  if (mode === 'off') return null;

  if (mode === 'file') {
    return (filePath && fs.existsSync(filePath)) ? filePath : null;
  }

  if (mode === 'nick') {
    const nick = skinNick || String(username || '').trim();
    if (!nick) return null;
    return await fetchSkinByNickname(gameDir, nick);
  }

  if (mode === 'url') {
    if (!skinUrl) return null;
    return await fetchSkinByUrl(gameDir, skinUrl, skinNick || username || 'custom');
  }

  // auto priority: file -> nick -> username -> url
  if (filePath && fs.existsSync(filePath)) return filePath;
  if (skinNick) {
    try { return await fetchSkinByNickname(gameDir, skinNick); } catch (_) {}
  }
  if (username) {
    try { return await fetchSkinByNickname(gameDir, username); } catch (_) {}
  }
  if (skinUrl) {
    try { return await fetchSkinByUrl(gameDir, skinUrl, skinNick || username || 'custom'); } catch (_) {}
  }

  return null;
}

function packMetaForMcVersion(versionId) {
  const v = normalizeBaseMcVersion(versionId || '1.20.1');
  const parts = String(v).split('.').map(n => Number(n || 0));
  const major = parts[0] || 1;
  const minor = parts[1] || 20;

  // Rough compatibility map for resource pack formats.
  let packFormat = 12; // 1.19.4 default fallback
  if (major === 1 && minor <= 8) packFormat = 1;
  else if (major === 1 && minor <= 10) packFormat = 2;
  else if (major === 1 && minor <= 12) packFormat = 3;
  else if (major === 1 && minor <= 14) packFormat = 4;
  else if (major === 1 && minor <= 16) packFormat = 6;
  else if (major === 1 && minor <= 17) packFormat = 7;
  else if (major === 1 && minor <= 18) packFormat = 8;
  else if (major === 1 && minor <= 19) packFormat = 9;
  else if (major === 1 && minor <= 20) packFormat = 15;
  else if (major === 1 && minor <= 21) packFormat = 34;

  return {
    pack: {
      pack_format: packFormat,
      description: `NocLauncher Offline Skin Pack (${v})`
    }
  };
}

function applyOfflineSkinPack(gameDir, skinPath, versionId) {
  try {
    if (!skinPath || !fs.existsSync(skinPath)) return false;
    const rpDir = path.join(gameDir, 'resourcepacks', 'NocOfflineSkin');
    const texBase = path.join(rpDir, 'assets', 'minecraft', 'textures', 'entity');
    const wideDir = path.join(texBase, 'player', 'wide');
    const slimDir = path.join(texBase, 'player', 'slim');

    fs.mkdirSync(wideDir, { recursive: true });
    fs.mkdirSync(slimDir, { recursive: true });

    // modern textures
    fs.copyFileSync(skinPath, path.join(wideDir, 'steve.png'));
    fs.copyFileSync(skinPath, path.join(slimDir, 'alex.png'));
    // legacy fallback textures
    fs.copyFileSync(skinPath, path.join(texBase, 'steve.png'));
    fs.copyFileSync(skinPath, path.join(texBase, 'alex.png'));

    const mcmeta = packMetaForMcVersion(versionId);
    fs.writeFileSync(path.join(rpDir, 'pack.mcmeta'), JSON.stringify(mcmeta, null, 2), 'utf8');

    const optionsPath = path.join(gameDir, 'options.txt');
    let lines = [];
    if (fs.existsSync(optionsPath)) lines = fs.readFileSync(optionsPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const map = new Map();
    for (const ln of lines) {
      const i = ln.indexOf(':');
      if (i > 0) map.set(ln.slice(0, i), ln.slice(i + 1));
    }

    let packs = ['vanilla'];
    try {
      const raw = map.get('resourcePacks');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) packs = parsed;
    } catch (_) {}

    if (!packs.includes('file/NocOfflineSkin')) packs.push('file/NocOfflineSkin');
    map.set('resourcePacks', JSON.stringify(packs));
    map.set('incompatibleResourcePacks', '[]');
    map.set('resourcePackPrompted', 'true');

    const out = Array.from(map.entries()).map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
    fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
    fs.writeFileSync(optionsPath, out, 'utf8');

    sendLog('info', 'Offline skin pack applied (NocOfflineSkin)');
    return true;
  } catch (e) {
    sendLog('warn', `Offline skin apply failed: ${String(e?.message || e)}`);
    return false;
  }
}

function getMcDownloaderPaths() {
  const dir = path.join(app.getPath('userData'), 'tools', 'MCDownloader');
  const exe = path.join(dir, 'MCDownloader.exe');
  const nestedExe = path.join(dir, 'MCDownloader', 'MCDownloader.exe');
  const versionsJson = path.join(dir, 'MCDownloader', 'versions.json');
  const zip = path.join(dir, 'MCDownloader.zip');
  return { dir, exe, nestedExe, versionsJson, zip };
}

async function ensureMcDownloaderInstalled() {
  const p = getMcDownloaderPaths();

  if (fs.existsSync(p.exe)) return { ...p, runExe: p.exe };
  if (fs.existsSync(p.nestedExe)) return { ...p, runExe: p.nestedExe };

  await fs.promises.mkdir(p.dir, { recursive: true });
  await downloadFile(MCDL_RELEASE_URL, p.zip);
  const z = new AdmZip(p.zip);
  z.extractAllTo(p.dir, true);

  if (fs.existsSync(p.exe)) return { ...p, runExe: p.exe };
  if (fs.existsSync(p.nestedExe)) return { ...p, runExe: p.nestedExe };

  throw new Error('Не удалось подготовить MCDownloader.exe');
}



async function fetchJson(url, settings) {
  const mirrors = buildMirrorsForUrl(settings, url);
  let lastErr = null;
  for (const u of mirrors) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'NocLauncher' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('fetchJson failed');
}

async function ensureVanillaFiles(settings, gameDir, versionId, onProgress) {
  // Downloads client.jar + libraries + asset index + assets. Skips existing verified files.
  const manifest = await getManifest();
  const entry = manifest?.versions?.find(v => v.id === versionId);
  if (!entry?.url) throw new Error(`Version meta URL not found for ${versionId}`);
  const vjson = await fetchJson(entry.url, settings);
  writeLocalVersionJson(gameDir, versionId, vjson);

  const tasks = [];
  const pushTask = (url, dest, sha1, label) => tasks.push({ url, dest, sha1, label });

  // client.jar
  const client = vjson?.downloads?.client;
  if (client?.url && client?.sha1) {
    const jarPath = path.join(gameDir, 'versions', versionId, `${versionId}.jar`);
    pushTask(client.url, jarPath, client.sha1, `client ${versionId}`);
  }

  // libraries
  const libs = Array.isArray(vjson?.libraries) ? vjson.libraries : [];
  for (const lib of libs) {
    const art = lib?.downloads?.artifact;
    if (!art?.path || !art?.url) continue;
    const dest = path.join(gameDir, 'libraries', art.path);
    pushTask(art.url, dest, art.sha1 || null, `lib ${path.basename(art.path)}`);
  }

  // asset index
  const ai = vjson?.assetIndex;
  let assetIndex = null;
  if (ai?.url) {
    const idxPath = path.join(gameDir, 'assets', 'indexes', `${ai.id}.json`);
    ensureDir(path.dirname(idxPath));
    // download index if missing
    if (!fs.existsSync(idxPath)) {
      await downloadFile(ai.url, idxPath, (r,t)=>onProgress?.({ phase:'assets-index', received:r, total:t, label:'asset index' }), {
        label: 'asset index',
        mirrors: buildMirrorsForUrl(settings, ai.url),
        maxKBps: settings.downloadMaxKBps || 0
      });
    }
    assetIndex = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  }

  // assets objects (limit concurrency by simple batching)
  const objects = assetIndex?.objects || {};
  const assetUrls = (hash) => {
    const p = `${hash.slice(0,2)}/${hash}`;
    const u = `https://resources.download.minecraft.net/${p}`;
    return buildMirrorsForUrl(settings, u);
  };
  for (const [name, obj] of Object.entries(objects)) {
    const hash = obj?.hash;
    if (!hash) continue;
    const dest = path.join(gameDir, 'assets', 'objects', hash.slice(0,2), hash);
    pushTask(`https://resources.download.minecraft.net/${hash.slice(0,2)}/${hash}`, dest, hash, `asset ${name}`);
  }

  const totalTasks = tasks.length;
  let done = 0;
  const maxParallel = Number(settings.downloadParallel || 0) || 6;

  const worker = async () => {
    while (tasks.length) {
      const t = tasks.shift();
      done += 0; // keep lint quiet
      try {
        // verify existing
        if (fs.existsSync(t.dest) && t.sha1) {
          try {
            const local = sha1FileSync(t.dest);
            if (String(local).toLowerCase() === String(t.sha1).toLowerCase()) {
              done++;
              onProgress?.({ phase:'verify', done, total: totalTasks, label: t.label });
              continue;
            }
          } catch {}
        }
        await downloadFile(t.url, t.dest, (r, tot) => onProgress?.({ phase:'download', received:r, total: tot, label: t.label, done, totalTasks }), {
          label: t.label,
          mirrors: buildMirrorsForUrl(settings, t.url),
          maxKBps: settings.downloadMaxKBps || 0
        });
        // verify after
        if (t.sha1) {
          const local = sha1FileSync(t.dest);
          if (String(local).toLowerCase() !== String(t.sha1).toLowerCase()) {
            throw new Error(`SHA1 mismatch for ${t.label}`);
          }
        }
        done++;
        onProgress?.({ phase:'done', done, total: totalTasks, label: t.label });
      } catch (e) {
        throw e;
      }
    }
  };

  const workers = [];
  for (let i=0;i<Math.max(1, Math.min(maxParallel, 12));i++) workers.push(worker());
  await Promise.all(workers);
}

async function runRepair(settings, gameDir, versionId) {
  const resolved = await resolveVersion(versionId);
  await ensureVanillaFiles(settings, gameDir, resolved.id, (p) => {
    try { sendMcState('progress', { kind: 'repair', ...p }); } catch {}
  });
  return { ok: true, version: resolved.id };
}

function removePartFiles(gameDir) {
  const roots = ['versions','libraries','assets'].map(x=>path.join(gameDir,x));
  const rmParts = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) rmParts(p);
      else if (entry.isFile() && entry.name.endsWith('.part')) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
  };
  roots.forEach(rmParts);
}

async function runFix(settings, gameDir, versionId) {
  restoreSafeLaunchModsIfNeeded(gameDir);
  removePartFiles(gameDir);
  // ensure key dirs exist
  ensureDir(path.join(gameDir, 'assets'));
  ensureDir(path.join(gameDir, 'versions'));
  ensureDir(path.join(gameDir, 'libraries'));
  return await runRepair(settings, gameDir, versionId);
}

function snapshotPaths(gameDir) {
  const include = [
    'mods','config','resourcepacks','shaderpacks','options.txt','servers.dat'
  ];
  return include.map(x=>path.join(gameDir,x));
}

async function createSnapshot(settings, gameDir, note='') {
  const id = Date.now().toString();
  const snapDir = path.join(gameDir, 'snapshots');
  ensureDir(snapDir);
  const zipPath = path.join(snapDir, `snapshot_${id}.zip`);
  const metaPath = path.join(snapDir, `snapshot_${id}.json`);
  const { createGzip } = require('zlib');
  const archiver = require('archiver');

  const output = _nativeFs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  const done = new Promise((resolve,reject)=>{
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  for (const p of snapshotPaths(gameDir)) {
    if (!fs.existsSync(p)) continue;
    const rel = path.relative(gameDir, p);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) archive.directory(p, rel);
    else archive.file(p, { name: rel });
  }
  archive.append(JSON.stringify({ createdAt: new Date().toISOString(), note }, null, 2), { name: 'snapshot_meta.json' });
  await archive.finalize();
  await done;

  fs.writeFileSync(metaPath, JSON.stringify({ id, createdAt: Date.now(), note, zipPath }, null, 2), 'utf8');
  return { ok: true, id, zipPath };
}

function listSnapshots(gameDir) {
  const snapDir = path.join(gameDir, 'snapshots');
  if (!fs.existsSync(snapDir)) return [];
  const items = [];
  for (const f of fs.readdirSync(snapDir)) {
    if (!f.endsWith('.json') || !f.startsWith('snapshot_')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(snapDir,f),'utf8'));
      items.push({ id: meta.id, createdAt: meta.createdAt, note: meta.note || '', zipPath: meta.zipPath });
    } catch {}
  }
  return items.sort((a,b)=>b.createdAt-a.createdAt);
}

async function restoreSnapshot(settings, gameDir, snapshotId) {
  const snaps = listSnapshots(gameDir);
  const snap = snaps.find(s=>String(s.id)===String(snapshotId));
  if (!snap) throw new Error('snapshot not found');
  const unzipper = require('unzipper');
  // backup current as auto snapshot
  if (settings.autoFixOnCrash) {
    try { await createSnapshot(settings, gameDir, 'auto-backup-before-restore'); } catch {}
  }
  await new Promise((resolve,reject)=>{
    _nativeFs.createReadStream(snap.zipPath)
      .pipe(unzipper.Extract({ path: gameDir }))
      .on('close', resolve)
      .on('error', reject);
  });
  return { ok: true, id: snapshotId };
}

async function exportInstanceZip(settings, gameDir) {
  const id = getActiveInstanceId(settings);
  const outDir = path.join(gameDir, 'exports');
  ensureDir(outDir);
  const outPath = path.join(outDir, `instance_${id}_${Date.now()}.zip`);
  const archiver = require('archiver');
  const output = _nativeFs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise((resolve,reject)=>{ output.on('close', resolve); archive.on('error', reject); });
  archive.pipe(output);

  // include config-like paths only (small)
  for (const p of snapshotPaths(gameDir)) {
    if (!fs.existsSync(p)) continue;
    const rel = path.relative(gameDir, p);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) archive.directory(p, rel);
    else archive.file(p, { name: rel });
  }
  archive.append(JSON.stringify({
    exportedAt: new Date().toISOString(),
    instanceId: id,
    instanceName: getInstanceMeta(settings,id)?.name || id,
    lastVersion: settings.lastVersion,
    loaderMode: settings.loaderMode,
    jvmPreset: settings.jvmPreset,
    memoryMinMB: settings.memoryMinMB,
    memoryMaxMB: settings.memoryMaxMB
  }, null, 2), { name: 'noc_instance.json' });

  await archive.finalize();
  await done;
  return { ok: true, path: outPath };
}

async function importFromMinecraftDot(settings, gameDir, sourceDir = '') {
  let src = String(sourceDir || '').trim();
  if (!src) src = path.join(process.env.APPDATA || '', '.minecraft');
  if (!src || !fs.existsSync(src)) {
    const owner = BrowserWindow.getAllWindows()[0] || null;
    const pick = await dialog.showOpenDialog(owner, {
      title: 'Выбери папку .minecraft для импорта',
      properties: ['openDirectory']
    });
    if (pick.canceled || !pick.filePaths?.[0]) return { ok: false, error: 'cancel' };
    src = pick.filePaths[0];
  }
  const copyDir = (a,b) => {
    if (!fs.existsSync(a)) return;
    ensureDir(b);
    for (const ent of fs.readdirSync(a,{withFileTypes:true})) {
      const sp = path.join(a, ent.name);
      const dp = path.join(b, ent.name);
      if (ent.isDirectory()) copyDir(sp, dp);
      else {
        try { fs.copyFileSync(sp, dp); } catch {}
      }
    }
  };
  // backup snapshot
  if (settings.autoFixOnCrash) {
    try { await createSnapshot(settings, gameDir, 'auto-backup-before-import'); } catch {}
  }
  copyDir(path.join(src,'saves'), path.join(gameDir,'saves'));
  copyDir(path.join(src,'resourcepacks'), path.join(gameDir,'resourcepacks'));
  copyDir(path.join(src,'shaderpacks'), path.join(gameDir,'shaderpacks'));
  try { if (fs.existsSync(path.join(src,'options.txt'))) fs.copyFileSync(path.join(src,'options.txt'), path.join(gameDir,'options.txt')); } catch {}
  try { if (fs.existsSync(path.join(src,'servers.dat'))) fs.copyFileSync(path.join(src,'servers.dat'), path.join(gameDir,'servers.dat')); } catch {}
  return { ok: true };
}
ipcMain.handle('settings:get', async () => {
  return store.store;
});

ipcMain.handle('settings:set', async (_e, patch) => {
  const safePatch = { ...(patch || {}) };
  // Online auth temporarily disabled by request.
  safePatch.preferOnline = false;
  if (Object.prototype.hasOwnProperty.call(safePatch, 'account')) safePatch.account = null;
  Object.entries(safePatch).forEach(([k, v]) => store.set(k, v));

  if (patch && Object.prototype.hasOwnProperty.call(patch, 'downloadMode')) {
    applyDownloadMode(store.get('downloadMode'));
  }

  return store.store;
});



// --- Top10 IPC ---
ipcMain.handle('instances:list', async () => {
  const settings = store.store;
  return { ok: true, active: getActiveInstanceId(settings), items: listInstances(settings) };
});

ipcMain.handle('instances:setActive', async (_e, id) => {
  const settings = store.store;
  const instId = (id && typeof id === 'string') ? id : 'default';
  store.set('activeInstanceId', instId);
  return { ok: true, active: instId };
});

ipcMain.handle('instances:create', async (_e, name) => {
  const settings = store.store;
  const base = settings.gameDir;
  const id = safeId(name || `instance-${Date.now()}`);
  const dir = path.join(base, 'instances', id);
  ensureDir(dir);
  const meta = settings.instancesMeta || {};
  meta[id] = { name: String(name || id) };
  store.set('instancesMeta', meta);
  return { ok: true, id, dir };
});

ipcMain.handle('instances:clone', async (_e, payload) => {
  const settings = store.store;
  const srcId = payload?.fromId || getActiveInstanceId(settings);
  const dstName = payload?.name || `Copy of ${srcId}`;
  const dstId = safeId(payload?.toId || dstName);
  const base = settings.gameDir;
  const srcDir = (srcId === 'default') ? base : path.join(base, 'instances', srcId);
  const dstDir = path.join(base, 'instances', dstId);
  if (!fs.existsSync(srcDir)) throw new Error('source instance not found');
  ensureDir(dstDir);

  const copy = (a,b) => {
    ensureDir(b);
    for (const ent of fs.readdirSync(a,{withFileTypes:true})) {
      const sp = path.join(a, ent.name);
      const dp = path.join(b, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'assets' || ent.name === 'libraries' || ent.name === 'versions') continue; // keep clone lightweight
        copy(sp, dp);
      } else {
        if (ent.name.endsWith('.log') || ent.name.endsWith('.part')) continue;
        try { fs.copyFileSync(sp, dp); } catch {}
      }
    }
  };
  copy(srcDir, dstDir);

  const meta = settings.instancesMeta || {};
  meta[dstId] = { name: String(dstName) };
  store.set('instancesMeta', meta);
  return { ok: true, id: dstId, dir: dstDir };
});

ipcMain.handle('wizard:autoSetup', async (_e, payload) => {
  const settings = store.store;
  const tier = String(payload?.tier || 'normal'); // lowend|normal|high
  const { min, max } = recommendMemoryMB();
  let memMax = max;
  if (tier === 'lowend') memMax = Math.min(3072, max);
  if (tier === 'high') memMax = Math.min(8192, max);
  const memMin = Math.max(1024, Math.floor(memMax * 0.5));

  store.set('memoryMinMB', memMin);
  store.set('memoryMaxMB', memMax);

  // download knobs
  if (tier === 'lowend') {
    store.set('downloadParallel', 4);
    store.set('downloadMode', 'normal');
    store.set('jvmPreset', 'lowend');
  } else if (tier === 'high') {
    store.set('downloadParallel', 12);
    store.set('downloadMode', 'turbo');
    store.set('jvmPreset', 'fps');
  } else {
    store.set('downloadParallel', 8);
    store.set('downloadMode', 'fast');
    store.set('jvmPreset', 'stable');
  }

  store.set('downloadSource', String(payload?.source || 'auto'));

  return { ok: true, memoryMinMB: memMin, memoryMaxMB: memMax, tier };
});

ipcMain.handle('mc:repair', async (_e, payload) => {
  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  const versionId = payload?.version || settings.lastVersion || 'latest-release';
  return await runRepair(settings, gameDir, versionId);
});

ipcMain.handle('mc:fix', async (_e, payload) => {
  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  const versionId = payload?.version || settings.lastVersion || 'latest-release';
  return await runFix(settings, gameDir, versionId);
});

ipcMain.handle('snapshots:create', async (_e, note) => {
  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  return await createSnapshot(settings, gameDir, String(note || ''));
});

ipcMain.handle('snapshots:list', async () => {
  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  return { ok: true, items: listSnapshots(gameDir) };
});

ipcMain.handle('snapshots:restore', async (_e, id) => {
  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  return await restoreSnapshot(settings, gameDir, id);
});


ipcMain.handle('mods:list', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  restoreSafeLaunchModsIfNeeded(gameDir);
  const mods = listLocalMods(gameDir);
  return { ok: true, mods };
});

ipcMain.handle('mods:openFolder', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const modsDir = getModsDir(gameDir);
  await shell.openPath(modsDir);
  return { ok: true, path: modsDir };
});

ipcMain.handle('mods:remove', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  await autoSnapshotBeforeModsChange(settings, gameDir, 'Auto: before remove mod');
  const modsDir = getModsDir(gameDir);
  const fn = String(payload?.filename || '');
  if (!fn) return { ok:false, error:'filename required' };
  const fp = path.join(modsDir, fn);
  if (!fp.startsWith(modsDir)) return { ok:false, error:'bad path' };
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { return { ok:false, error:String(e.message||e) }; }
  return { ok:true };
});

ipcMain.handle('mods:toggle', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  await autoSnapshotBeforeModsChange(settings, gameDir, 'Auto: before toggle mod');
  const modsDir = getModsDir(gameDir);
  const fn = String(payload?.filename || '');
  const enabled = !!payload?.enabled;
  if (!fn) return { ok:false, error:'filename required' };
  const src = path.join(modsDir, fn);
  if (!src.startsWith(modsDir)) return { ok:false, error:'bad path' };
  if (!fs.existsSync(src)) return { ok:false, error:'not found' };
  let dst = src;
  if (enabled && fn.endsWith('.disabled')) dst = path.join(modsDir, fn.replace(/\.disabled$/, '.jar'));
  if (!enabled && fn.endsWith('.jar')) dst = path.join(modsDir, fn + '.disabled');
  try { if (dst !== src) fs.renameSync(src, dst); } catch (e) { return { ok:false, error:String(e.message||e) }; }
  return { ok:true };
});

ipcMain.handle('mods:installFromFile', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  await autoSnapshotBeforeModsChange(settings, gameDir, 'Auto: before install jar');
  const modsDir = getModsDir(gameDir);
  const res = await dialog.showOpenDialog({ properties:['openFile','multiSelections'], filters:[{name:'Mod (.jar)', extensions:['jar']}] });
  if (res.canceled) return { ok:false, canceled:true };
  let installed = 0;
  for (const f of res.filePaths || []) {
    try {
      const dest = path.join(modsDir, path.basename(f));
      fs.copyFileSync(f, dest);
      installed++;
      try {
        const man = readModsManifest(gameDir);
        const key = path.basename(f).replace(/\.jar$/,'');
        man.mods[key] = Object.assign({}, man.mods[key]||{}, { source:'Local', filename:path.basename(f), installedAt: new Date().toISOString() });
        man.lastInstalled = { key, filename: path.basename(f), at: new Date().toISOString() };
        writeModsManifest(gameDir, man);
      } catch {}
    } catch {}
  }
  return { ok:true, installed };
});

ipcMain.handle('mods:search', async (_e, payload) => {
  const settings = loadSettings();
  const q = String(payload?.q || '').trim();
  if (!q) return { ok:true, hits: [] };
  const hits = await modrinthSearch(settings, q, 25);
  return { ok:true, hits };
});


ipcMain.handle('mods:searchCurse', async (_e, payload) => {
  const settings = loadSettings();
  const apiKey = settings?.curseforgeApiKey;
  if (!apiKey) return { ok: false, error: 'NO_API_KEY' };

  const query = String(payload?.query || '').trim();
  if (!query) return { ok: true, hits: [] };

  const mcVersion = String(payload?.mcVersion || '');
  const loader = String(payload?.loader || '').toLowerCase(); // fabric/forge
  // CurseForge modLoaderType: 4=Forge, 5=Fabric
  const modLoaderType = loader === 'fabric' ? 5 : (loader === 'forge' ? 4 : undefined);

  const params = new URLSearchParams({
    gameId: '432',
    classId: '6',
    searchFilter: query,
    pageSize: '20',
    sortField: '2', // popularity
    sortOrder: 'desc'
  });
  if (mcVersion) params.set('gameVersion', mcVersion);
  if (modLoaderType) params.set('modLoaderType', String(modLoaderType));

  const url = `https://api.curseforge.com/v1/mods/search?${params.toString()}`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey, 'Accept': 'application/json', 'User-Agent': 'NocLauncher' } });
  if (!res.ok) return { ok: false, error: `HTTP_${res.status}` };
  const data = await res.json();
  const hits = (data?.data || []).map(m => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    summary: m.summary,
    logo: m.logo?.thumbnailUrl || m.logo?.url || '',
    downloads: m.downloadCount || 0
  }));
  return { ok: true, hits };
});

ipcMain.handle('mods:installCurse', async (_e, payload) => {
  const settings = loadSettings();
  const apiKey = settings?.curseforgeApiKey;
  if (!apiKey) return { ok: false, error: 'NO_API_KEY' };

  const modId = Number(payload?.modId || 0);
  if (!modId) return { ok: false, error: 'BAD_ID' };

  const mcVersion = String(payload?.mcVersion || '');
  const loader = String(payload?.loader || '').toLowerCase();
  const modLoaderType = loader === 'fabric' ? 5 : (loader === 'forge' ? 4 : undefined);

  const gameDir = resolveActiveGameDir(settings);
  const modsDir = getModsDir(gameDir);
  fs.mkdirSync(modsDir, { recursive: true });

  // Find a suitable file
  const filesUrl = `https://api.curseforge.com/v1/mods/${modId}/files?pageSize=50`;
  const fres = await fetch(filesUrl, { headers: { 'x-api-key': apiKey, 'Accept': 'application/json', 'User-Agent': 'NocLauncher' } });
  if (!fres.ok) return { ok: false, error: `HTTP_${fres.status}` };
  const fdata = await fres.json();
  let files = (fdata?.data || []);
  if (mcVersion) files = files.filter(f => (f.gameVersions || []).includes(mcVersion));
  if (modLoaderType) files = files.filter(f => (f.gameVersions || []).some(v => (loader==='fabric' ? v.toLowerCase().includes('fabric') : v.toLowerCase().includes('forge')) ) || true);

  // Prefer latest
  files.sort((a,b) => (b.fileDate ? Date.parse(b.fileDate) : 0) - (a.fileDate ? Date.parse(a.fileDate) : 0));
  const file = files.find(f => (f.downloadUrl || f.fileName)) || files[0];
  if (!file) return { ok: false, error: 'NO_FILE' };

  const dl = file.downloadUrl || `https://edge.forgecdn.net/files/${String(file.id).slice(0,4)}/${String(file.id).slice(4)}/${file.fileName}`;
  const dest = path.join(modsDir, file.fileName || `${modId}.jar`);
  await downloadFileWithManager(dl, dest, settings, { label: `CurseForge: ${file.fileName || modId}` });
  trackInstalledMod(settings, gameDir, { source: 'curseforge', id: modId, fileName: path.basename(dest) });
  return { ok: true, file: path.basename(dest) };
});

ipcMain.handle('mods:installModrinth', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  await autoSnapshotBeforeModsChange(settings, gameDir, 'Auto: before install Modrinth');
  const projectId = String(payload?.projectId || '');
  if (!projectId) return { ok:false, error:'projectId required' };
  const { loaderMode } = currentLoaderAndVersion(settings);
  if (loaderMode !== 'fabric' && loaderMode !== 'forge' && loaderMode !== 'neoforge') {
    return { ok:false, error:'Выберите Fabric / Forge / NeoForge в настройках/лоадере' };
  }
  const r = await installModrinthProjectRecursive(projectId, settings, gameDir);
  return { ok:true, installed: r.installed || 1 };
});

ipcMain.handle('mods:updateAll', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  await autoSnapshotBeforeModsChange(settings, gameDir, 'Auto: before update all mods');
  const { loaderMode } = currentLoaderAndVersion(settings);
  if (loaderMode !== 'fabric' && loaderMode !== 'forge' && loaderMode !== 'neoforge') {
    return { ok:false, error:'Выберите Fabric / Forge / NeoForge' };
  }
  return await updateAllModrinth(settings, gameDir);
});

ipcMain.handle('mods:analyze', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  restoreSafeLaunchModsIfNeeded(gameDir);
  return analyzeInstalledMods(settings, gameDir);
});

ipcMain.handle('mods:rollbackLast', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  return await rollbackLastSnapshot(settings, gameDir);
});

ipcMain.handle('mods:disableLastInstalled', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const modsDir = getModsDir(gameDir);
  const man = readModsManifest(gameDir);
  const li = man.lastInstalled;
  const fn = String(li?.filename || '');
  if (!fn) return { ok:false, error:'no lastInstalled' };
  const p = path.join(modsDir, fn);
  if (fs.existsSync(p) && fn.endsWith('.jar')) {
    try {
      await autoSnapshotBeforeModsChange(settings, gameDir, 'Auto: before disable last mod');
      fs.renameSync(p, path.join(modsDir, fn + '.disabled'));
      return { ok:true, disabled: fn };
    } catch (e) { return { ok:false, error:String(e.message||e) }; }
  }
  return { ok:false, error:'file not found' };
});


ipcMain.handle('instance:exportZip', async () => {
  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  return await exportInstanceZip(settings, gameDir);
});

ipcMain.handle('instance:importDotMinecraft', async (_e, payload) => {
  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  try {
    return await importFromMinecraftDot(settings, gameDir, payload?.sourceDir || '');
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

function getLocalServersHostId() {
  let id = String(store.get('localServersHostId') || '').trim();
  if (!id) {
    id = randomUUID();
    store.set('localServersHostId', id);
  }
  return id;
}

function getLocalServersRegistryUrl() {
  return String(store.get('localServersRegistryUrl') || '').trim().replace(/\/+$/, '');
}

async function probeRegistryBase(base) {
  const clean = String(base || '').trim().replace(/\/+$/, '');
  if (!clean) return false;
  try {
    const r = await fetch(`${clean}/health`, { headers: { 'User-Agent': 'NocLauncher/1.0' } });
    return !!(r && r.ok);
  } catch (_) {
    return false;
  }
}

async function ensureRegistryUrlAuto() {
  const current = getLocalServersRegistryUrl();
  if (current && await probeRegistryBase(current)) return current;

  const candidates = [
    process.env.NOC_REGISTRY_URL || '',
    current || '',
    'http://127.0.0.1:8787',
    'http://localhost:8787'
  ].filter(Boolean);

  for (const c of candidates) {
    if (await probeRegistryBase(c)) {
      store.set('localServersRegistryUrl', c);
      return c;
    }
  }

  // Try auto-start local registry and probe again.
  ensureLocalRegistryProcess();
  await new Promise(r => setTimeout(r, 500));
  for (const c of ['http://127.0.0.1:8787', 'http://localhost:8787']) {
    if (await probeRegistryBase(c)) {
      store.set('localServersRegistryUrl', c);
      return c;
    }
  }
  return '';
}

let autoLocalRoomId = null;
let autoLocalHeartbeatTimer = null;
let autoLocalWatchTimer = null;
let autoLocalLastWorldName = '';
let manualHostWanted = false;
let localRegistryProc = null;
let cachedBedrockRunning = false;
let cachedWorldOpen = false;
let worldOpenHitStreak = 0;
let worldOpenMissStreak = 0;
let lastWorldOpenSeenAt = 0;

function ensureLocalRegistryProcess() {
  try {
    if (localRegistryProc && !localRegistryProc.killed) return true;
    const devPath = path.join(APP_ROOT, 'tools', 'local-servers-registry', 'server.js');
    const packagedPath = path.join(process.resourcesPath || '', 'tools', 'local-servers-registry', 'server.js');
    const scriptPath = fs.existsSync(devPath) ? devPath : (fs.existsSync(packagedPath) ? packagedPath : '');
    if (!scriptPath) return false;

    const nodeExe = process.execPath && process.execPath.toLowerCase().includes('electron') ? 'node' : process.execPath;
    localRegistryProc = childProcess.spawn(nodeExe, [scriptPath], {
      cwd: APP_ROOT,
      windowsHide: true,
      detached: false,
      stdio: 'ignore'
    });
    localRegistryProc.on('exit', () => { localRegistryProc = null; });
    return true;
  } catch (_) {
    return false;
  }
}

function readTextSmart(filePath) {
  try {
    const b = fs.readFileSync(filePath);
    const utf8 = b.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (utf8) return utf8;
    const u16 = b.toString('utf16le').replace(/^\uFEFF/, '').trim();
    if (u16) return u16;
  } catch (_) {}
  return '';
}

function parseMcpeOptions(filePath) {
  const out = {};
  try {
    const raw = readTextSmart(filePath);
    if (!raw) return out;
    const lines = raw.split(/\r?\n/);
    for (const ln of lines) {
      const i = ln.indexOf(':');
      if (i <= 0) continue;
      const k = ln.slice(0, i).trim();
      const v = ln.slice(i + 1).trim();
      out[k] = v;
    }
  } catch (_) {}
  return out;
}

function detectBedrockHostName() {
  try {
    const p = bedrockPaths();
    const opts = parseMcpeOptions(p?.optionsTxt || '');
    const mp = String(opts.mp_username || '').trim();
    if (mp) return mp;
  } catch (_) {}
  return String(store.get('lastUsername') || 'Host');
}

function detectBedrockWorldMeta() {
  try {
    const p = bedrockPaths();
    const worldsDir = p?.worlds;
    if (!worldsDir || !fs.existsSync(worldsDir)) return { worldName: autoLocalLastWorldName || 'Мой Bedrock мир', maxPlayers: 10 };
    const dirs = fs.readdirSync(worldsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    let best = null;
    let bestM = 0;

    for (const d of dirs) {
      const wp = path.join(worldsDir, d);
      let score = 0;
      try { score = Math.max(score, fs.statSync(wp).mtimeMs || 0); } catch (_) {}
      const levelNamePath = path.join(wp, 'levelname.txt');
      const levelDatPath = path.join(wp, 'level.dat');
      const dbPath = path.join(wp, 'db');
      try { if (fs.existsSync(levelNamePath)) score = Math.max(score, fs.statSync(levelNamePath).mtimeMs || 0); } catch (_) {}
      try { if (fs.existsSync(levelDatPath)) score = Math.max(score, fs.statSync(levelDatPath).mtimeMs || 0); } catch (_) {}
      try { if (fs.existsSync(dbPath)) score = Math.max(score, fs.statSync(dbPath).mtimeMs || 0); } catch (_) {}
      if (score > bestM) { bestM = score; best = wp; }
    }

    if (!best) return { worldName: autoLocalLastWorldName || 'Мой Bedrock мир', maxPlayers: 10 };

    const nmPath = path.join(best, 'levelname.txt');
    let worldName = readTextSmart(nmPath) || autoLocalLastWorldName || 'Мой Bedrock мир';
    worldName = String(worldName).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80) || (autoLocalLastWorldName || 'Мой Bedrock мир');

    return { worldName, maxPlayers: 10 };
  } catch (_) {
    return { worldName: autoLocalLastWorldName || 'Мой Bedrock мир', maxPlayers: 10 };
  }
}

async function localServersApi(pathname, method = 'GET', body = null) {
  const base = await ensureRegistryUrlAuto();
  if (!base) return { ok: false, error: 'registry_not_set' };
  const url = `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'NocLauncher/1.0' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { ok: r.ok, raw: text }; }
    if (!r.ok) return { ok: false, error: json?.error || `http_${r.status}`, status: r.status };
    return json && typeof json === 'object' ? json : { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function stopAutoLocalHeartbeat() {
  if (autoLocalHeartbeatTimer) {
    clearInterval(autoLocalHeartbeatTimer);
    autoLocalHeartbeatTimer = null;
  }
}

function startAutoLocalHeartbeat() {
  stopAutoLocalHeartbeat();
  autoLocalHeartbeatTimer = setInterval(async () => {
    try {
      const meta = detectBedrockWorldMeta();
      const currentPlayers = autoLocalRoomId ? 1 : 0;
      await localServersApi('/world/heartbeat', 'POST', {
        hostId: getLocalServersHostId(),
        roomId: autoLocalRoomId,
        worldName: String(meta.worldName || 'Мой Bedrock мир'),
        maxPlayers: Number(meta.maxPlayers || 10),
        currentPlayers
      });
    } catch (_) {}
  }, 3000);
}

function ensureAutoLocalHostWatcher() {
  if (autoLocalWatchTimer) return;
  autoLocalWatchTimer = setInterval(async () => {
    try {
      const running = isBedrockRunning();
      const worldOpenRaw = isBedrockWorldOpen();

      if (worldOpenRaw) {
        worldOpenHitStreak = Math.min(worldOpenHitStreak + 1, 10);
        worldOpenMissStreak = 0;
      } else {
        worldOpenMissStreak = Math.min(worldOpenMissStreak + 1, 10);
        worldOpenHitStreak = 0;
      }

      // Hysteresis: avoid false dropouts.
      const worldOpenStable = worldOpenHitStreak >= 1 || (cachedWorldOpen && worldOpenMissStreak < 4);
      if (worldOpenStable && running) lastWorldOpenSeenAt = Date.now();

      cachedBedrockRunning = running;
      cachedWorldOpen = running && worldOpenStable;

      // Grace window: don't drop host immediately on transient detector misses.
      const worldGraceMs = 15000;
      const withinGrace = running && (Date.now() - lastWorldOpenSeenAt < worldGraceMs);
      const shouldHost = running && (cachedWorldOpen || withinGrace);

      if (shouldHost && !autoLocalRoomId) {
        const meta = detectBedrockWorldMeta();
        const vis = String(store.get('localServersVisibility') || 'public');
        const opened = await localServersApi('/world/open', 'POST', {
          hostId: getLocalServersHostId(),
          hostName: detectBedrockHostName(),
          worldName: String(meta.worldName || 'Мой Bedrock мир'),
          gameVersion: 'bedrock',
          mode: 'survival',
          connect: { type: 'direct', ip: '', port: 19132 },
          isPrivate: vis !== 'public',
          joinCode: vis === 'code' ? Math.random().toString(36).slice(2,8).toUpperCase() : null,
          maxPlayers: Number(meta.maxPlayers || 10),
          currentPlayers: 1
        });
        if (opened?.ok) {
          autoLocalRoomId = opened.roomId || opened.id || null;
          autoLocalLastWorldName = String(meta.worldName || '');
          startAutoLocalHeartbeat();
        }
      }

      if (shouldHost && autoLocalRoomId) {
        const meta = detectBedrockWorldMeta();
        const newName = String(meta.worldName || '');
        if (newName && autoLocalLastWorldName && newName !== autoLocalLastWorldName) {
          await localServersApi('/world/close', 'POST', { hostId: getLocalServersHostId(), roomId: autoLocalRoomId });
          autoLocalRoomId = null;
          const vis = String(store.get('localServersVisibility') || 'public');
          const reopened = await localServersApi('/world/open', 'POST', {
            hostId: getLocalServersHostId(),
            hostName: detectBedrockHostName(),
            worldName: newName,
            gameVersion: 'bedrock',
            mode: 'survival',
            connect: { type: 'direct', ip: '', port: 19132 },
            isPrivate: vis !== 'public',
            joinCode: vis === 'code' ? Math.random().toString(36).slice(2,8).toUpperCase() : null,
            maxPlayers: Number(meta.maxPlayers || 10),
            currentPlayers: 1
          });
          if (reopened?.ok) {
            autoLocalRoomId = reopened.roomId || reopened.id || null;
            autoLocalLastWorldName = newName;
            startAutoLocalHeartbeat();
          }
        }
      }

      if ((!running || !shouldHost) && autoLocalRoomId) {
        await localServersApi('/world/close', 'POST', { hostId: getLocalServersHostId(), roomId: autoLocalRoomId });
        autoLocalRoomId = null;
        autoLocalLastWorldName = '';
        manualHostWanted = false;
        lastWorldOpenSeenAt = 0;
        stopAutoLocalHeartbeat();
      }

      if ((!running || !cachedWorldOpen) && manualHostWanted) {
        manualHostWanted = false;
      }
    } catch (_) {}
  }, 1200);
}

ipcMain.handle('localservers:list', async () => {
  const r = await localServersApi('/world/list', 'GET');
  if (!r?.ok) return r;
  return { ok: true, servers: Array.isArray(r.servers) ? r.servers : (Array.isArray(r.items) ? r.items : []) };
});

ipcMain.handle('localservers:open', async (_e, payload) => {
  const hostId = getLocalServersHostId();
  const settings = store.store || {};

  let ip = String(payload?.connect?.ip || '').trim();
  if (!ip) {
    try {
      const r = await fetch('https://api.ipify.org?format=json', { headers: { 'User-Agent': 'NocLauncher/1.0' } });
      const j = await r.json();
      ip = String(j?.ip || '').trim();
    } catch (_) {}
  }

  const vis = String(payload?.visibility || settings.localServersVisibility || 'public');
  const data = {
    hostId,
    hostName: String(payload?.hostName || detectBedrockHostName() || settings.lastUsername || 'Host'),
    worldName: String(payload?.worldName || 'Bedrock world'),
    gameVersion: String(payload?.gameVersion || settings.lastVersion || ''),
    mode: String(payload?.mode || 'survival'),
    connect: {
      type: String(payload?.connect?.type || 'direct'),
      ip,
      port: Number(payload?.connect?.port || 19132)
    },
    isPrivate: vis !== 'public',
    joinCode: vis === 'code' ? (payload?.joinCode ? String(payload.joinCode) : Math.random().toString(36).slice(2,8).toUpperCase()) : null,
    transportPolicy: String(payload?.transportPolicy || settings.transportPolicy || 'auto'),
    maxPlayers: Number(payload?.maxPlayers || 10),
    currentPlayers: Number(payload?.currentPlayers ?? (isBedrockRunning() && isBedrockWorldOpen() ? 1 : 0))
  };
  return await localServersApi('/world/open', 'POST', data);
});

ipcMain.handle('localservers:heartbeat', async (_e, payload) => {
  const hostId = getLocalServersHostId();
  return await localServersApi('/world/heartbeat', 'POST', { hostId, roomId: payload?.roomId || null });
});

ipcMain.handle('localservers:close', async (_e, payload) => {
  const hostId = getLocalServersHostId();
  return await localServersApi('/world/close', 'POST', { hostId, roomId: payload?.roomId || null });
});

ipcMain.handle('localservers:joinByCode', async (_e, payload) => {
  return await localServersApi('/world/join-by-code', 'POST', { joinCode: String(payload?.joinCode || '') });
});

ipcMain.handle('localservers:hostSetWanted', async (_e, payload) => {
  manualHostWanted = !!payload?.enabled;
  return { ok: true, enabled: manualHostWanted };
});

ipcMain.handle('localservers:visibilitySet', async (_e, payload) => {
  const v = String(payload?.visibility || 'public');
  const allowed = new Set(['public', 'code']);
  const vis = allowed.has(v) ? v : 'public';
  store.set('localServersVisibility', vis);
  return { ok: true, visibility: vis };
});

ipcMain.handle('localservers:visibilityGet', async () => {
  return { ok: true, visibility: String(store.get('localServersVisibility') || 'public') };
});

ipcMain.handle('localservers:transportSet', async (_e, payload) => {
  const v = String(payload?.transport || 'auto');
  const allowed = new Set(['auto', 'direct-only', 'relay-preferred']);
  const transport = allowed.has(v) ? v : 'auto';
  store.set('transportPolicy', transport);
  return { ok: true, transport };
});

ipcMain.handle('localservers:transportGet', async () => {
  return { ok: true, transport: String(store.get('transportPolicy') || 'auto') };
});

ipcMain.handle('localservers:inviteCreate', async () => {
  if (!autoLocalRoomId) return { ok: false, error: 'room_not_open' };
  return await localServersApi('/invite/create', 'POST', {
    hostId: getLocalServersHostId(),
    roomId: autoLocalRoomId
  });
});

ipcMain.handle('localservers:inviteResolve', async (_e, payload) => {
  const code = String(payload?.code || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'code_required' };
  const base = await ensureRegistryUrlAuto();
  if (!base) return { ok: false, error: 'registry_not_set' };
  try {
    const r = await fetch(`${base}/invite/resolve?code=${encodeURIComponent(code)}`, { headers: { 'User-Agent': 'NocLauncher/1.0' } });
    const j = await r.json();
    if (!r.ok || !j?.ok) return { ok: false, error: j?.error || `http_${r.status}` };
    return { ok: true, room: j.room };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('localservers:inviteRevoke', async (_e, payload) => {
  const code = String(payload?.code || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'code_required' };
  return await localServersApi('/invite/revoke', 'POST', { hostId: getLocalServersHostId(), code });
});

ipcMain.handle('localservers:joinByCodeOpen', async (_e, payload) => {
  const code = String(payload?.code || '').trim().toUpperCase();
  return await tryJoinByInviteCode(code);
});

ipcMain.handle('bedrock:hubOpen', async () => {
  ensureAutoLocalHostWatcher();
  return openBedrockHubWindow();
});

ipcMain.handle('bedrock:hubSetCollapsed', async (_e, payload) => {
  return setBedrockHubCollapsed(!!payload?.collapsed);
});

ipcMain.handle('bedrock:hubQuickMenuSetOpen', async (_e, payload) => {
  return setBedrockHubQuickMenuOpen(!!payload?.open);
});

ipcMain.handle('bedrock:fpsStart', async () => {
  return await startBedrockFpsMonitor();
});

ipcMain.handle('bedrock:fpsStop', async () => {
  return stopBedrockFpsMonitor();
});

ipcMain.handle('bedrock:fpsGet', async () => {
  return { ok: true, ...bedrockFpsState };
});

ipcMain.handle('bedrock:openSettings', async () => {
  try {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('ui:openBedrockSettings');
      return { ok: true };
    }
    return { ok: false, error: 'main_window_unavailable' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:hostStatus', async () => {
  const registryUrl = await ensureRegistryUrlAuto();
  const meta = detectBedrockWorldMeta();
  return {
    ok: true,
    bedrockRunning: !!cachedBedrockRunning,
    worldOpen: !!cachedWorldOpen,
    registryUrl,
    autoHosting: !!autoLocalRoomId,
    manualHostWanted,
    worldName: String(meta.worldName || 'Мой Bedrock мир'),
    hostName: detectBedrockHostName(),
    maxPlayers: Number(meta.maxPlayers || 10),
    currentPlayers: autoLocalRoomId ? 1 : 0
  };
});

ipcMain.handle('bedrock:pathInfo', async () => {
  const p = bedrockPaths();
  const worlds = p?.worlds;
  let worldsCount = 0;
  try { if (worlds && fs.existsSync(worlds)) worldsCount = fs.readdirSync(worlds, { withFileTypes: true }).filter(d => d.isDirectory()).length; } catch (_) {}
  return {
    ok: true,
    comMojang: p?.comMojang || '',
    worldsPath: worlds || '',
    source: bedrockComMojangSource,
    worldsCount
  };
});

ipcMain.handle('bedrock:pathSet', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Выбери папку com.mojang', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths?.[0]) return { ok: false, canceled: true };
  let picked = String(r.filePaths[0]);
  if (picked.toLowerCase().endsWith('minecraftworlds')) picked = path.dirname(picked);
  const worlds = path.join(picked, 'minecraftWorlds');
  if (!fs.existsSync(worlds)) return { ok: false, error: 'not_com_mojang_folder' };
  store.set('bedrockDataRoot', picked);
  bedrockComMojangCache = '';
  bedrockComMojangCacheTs = 0;
  return { ok: true, comMojang: picked };
});

ipcMain.handle('bedrock:connectivity', async () => {
  const registryUrl = await ensureRegistryUrlAuto();
  let publicIp = '';
  try {
    const r = await fetch('https://api.ipify.org?format=json', { headers: { 'User-Agent': 'NocLauncher/1.0' } });
    const j = await r.json();
    publicIp = String(j?.ip || '');
  } catch (_) {}
  return {
    ok: true,
    registryOk: !!registryUrl,
    registryUrl,
    publicIp,
    bedrockRunning: !!cachedBedrockRunning,
    worldOpen: !!cachedWorldOpen,
    hostActive: !!autoLocalRoomId
  };
});

ipcMain.handle('shell:openExternal', async (_e, payload) => {
  const url = String(payload?.url || '');
  if (!url) return { ok: false };
  try { await shell.openExternal(url); return { ok: true }; } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});


ipcMain.handle('catalog:open', async (_e, payload) => {
  try {
    const provider = String(payload?.provider || 'modrinth').toLowerCase();
    const mc = String(payload?.mcVersion || store.get('lastVersion') || '').trim();
    const loader = String(payload?.loader || store.get('loaderMode') || 'vanilla').toLowerCase();

    let url;
    if (provider === 'curseforge') {
      url = 'https://www.curseforge.com/minecraft/mc-mods';
      // Use CF search query instead of fragile game-version filter
      if (mc) url += `?sort=popularity&version=${encodeURIComponent(mc)}`;
    } else {
      const params = new URLSearchParams();
      if (mc) params.set('g', mc);
      if (loader === 'fabric' || loader === 'forge' || loader === 'quilt' || loader === 'neoforge') params.set('l', loader);
      url = `https://modrinth.com/mods?${params.toString()}`;
    }

    const key = provider === 'curseforge' ? 'curseforge' : 'modrinth';
    return openWebWindow(key, url, key === 'curseforge' ? 'CurseForge' : 'Modrinth');
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('web:open', async (_e, payload) => {
  const key = String(payload?.key || 'web');
  const url = String(payload?.url || '');
  const title = String(payload?.title || 'Web');
  if (!url) return { ok: false, error: 'no_url' };
  return openWebWindow(key, url, title);
});



ipcMain.handle('dialog:pickDir', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Выбери папку для игры',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths?.[0]) return null;
  store.set('gameDir', res.filePaths[0]);
  return res.filePaths[0];
});

ipcMain.handle('dialog:pickOptiFineJar', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Выбери OptiFine installer .jar',
    properties: ['openFile'],
    filters: [{ name: 'Java Archive', extensions: ['jar'] }]
  });
  if (res.canceled || !res.filePaths?.[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle('dialog:pickSkin', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Выбери PNG скин',
    properties: ['openFile'],
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (res.canceled || !res.filePaths?.[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle('skin:fetchByNick', async (_e, nickname) => {
  try {
    const settings = store.store;
    const p = await fetchSkinByNickname(settings.gameDir, nickname);
    store.set('offlineSkinPath', p);
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('skin:fetchByUrl', async (_e, payload) => {
  try {
    const settings = store.store;
    const p = await fetchSkinByUrl(settings.gameDir, payload?.url, payload?.tag || 'custom');
    store.set('offlineSkinPath', p);
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('versions:fetch', async () => {
  // Version manifest with mirror fallback + offline cache fallback
  try {
    const payload = await fetchManifestWithFallback();
    store.set('manifestCache', payload);
    store.set('manifestCacheTs', Date.now());
    return payload;
  } catch (e) {
    const cached = store.get('manifestCache');
    if (cached?.versions?.length) {
      sendLog('warn', 'Не удалось обновить список версий — использую кэш.');
      return cached;
    }
    throw e;
  }
});

ipcMain.handle('ms:begin', async () => {
  // Online auth disabled for now.
  store.set('preferOnline', false);
  store.set('account', null);
  msFlow = null;
  return { ok: false, disabled: true, error: 'online_auth_disabled' };

  /*
  // If an auth flow is already running, just return its current status.
  if (msFlow && msFlow.state === 'pending') {
    return { ok: true, interactive: true };
  }

  // Try silent restore (refresh token) first.
  try {
    const restored = await validateCachedSession({ app });
    if (restored?.ok && restored?.profile?.name && restored?.accessToken) {
      const owns = restored?.entitlements?.ownsJava !== false;
      if (owns) {
        const account = {
          type: 'microsoft',
          name: restored.profile.name,
          uuid: restored.profile.id,
          access_token: restored.accessToken,
          client_token: randomUUID(),
          user_properties: {},
          expires_at: restored.expiresAt || null
        };
        store.set('account', account);
        store.set('lastUsername', restored.profile.name);
        store.set('preferOnline', true);
        return { ok: true, restored: true, interactive: true, account };
      }
    }
  } catch (_) {}

  // Start interactive PKCE loopback flow in background.
  msFlow = {
    state: 'pending',
    startedAt: Date.now(),
    steps: [],
    promise: null,
    result: null,
    error: null
  };
  */
  const onStep = (s) => {
    if (!msFlow) return;
    msFlow.steps.push(String(s || ''));
    if (msFlow.steps.length > 80) msFlow.steps = msFlow.steps.slice(-80);
  };

  msFlow.promise = (async () => {
    return await loginMicrosoftJava({
      app,
      userId: 'default',
      onStep,
      forceRefresh: false,
      openBrowser: async (url) => {
        if (url) await shell.openExternal(String(url));
        return true;
      }
    });
  })();

  msFlow.promise
    .then((res) => {
      if (!msFlow) return;
      msFlow.state = 'done';
      msFlow.result = res;
    })
    .catch((err) => {
      if (!msFlow) return;
      msFlow.state = 'error';
      msFlow.error = String(err?.message || err);
    });

  return {
    ok: true,
    interactive: true
  };
});

ipcMain.handle('ms:open', async (_e, url) => {
  if (url) await shell.openExternal(url);
  return true;
});

ipcMain.handle('ms:status', async () => {
  return {
    hasSession: !!msFlow,
    state: msFlow?.state || 'idle',
    steps: Array.isArray(msFlow?.steps) ? msFlow.steps.slice(-12) : []
  };
});

ipcMain.handle('fs:openPath', async (_e, p) => {
  try {
    if (!p) return false;
    await shell.openPath(String(p));
    return true;
  } catch (_) {
    return false;
  }
});

function getBedrockAppInfo() {
  // Try to detect real installed appId from Start menu entries first
  try {
    const cmd = [
      "$apps = Get-StartApps | Where-Object { $_.AppID -match 'Minecraft' -or $_.Name -match 'Minecraft' };",
      "$pick = $apps | Where-Object { $_.AppID -match 'MinecraftUWP' } | Select-Object -First 1;",
      "if (-not $pick) { $pick = $apps | Select-Object -First 1 }",
      "if ($pick) { $pick | Select-Object Name,AppID | ConvertTo-Json -Compress }"
    ].join(' ');
    const out = execFileSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (out) {
      const s = JSON.parse(out);
      if (s?.AppID) return { appId: s.AppID, displayName: s.Name || 'Minecraft for Windows' };
    }
  } catch (_) {}

  // Fallback to known Bedrock package id
  return { appId: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe!App', displayName: 'Minecraft for Windows' };
}

function resolveBedrockPackageDir() {
  // Windows only
  try {
    const base = process.env.LOCALAPPDATA;
    if (!base) return null;
    const pkgs = path.join(base, 'Packages');
    if (!fs.existsSync(pkgs)) return null;

    const dirNames = fs.readdirSync(pkgs, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const candidates = dirNames
      .filter(n => /minecraft/i.test(n))
      .map((name) => {
        const full = path.join(pkgs, name);
        const com = path.join(full, 'LocalState', 'games', 'com.mojang');
        const worlds = path.join(com, 'minecraftWorlds');
        let score = 0;
        if (/^microsoft\.minecraftuwp_/i.test(name)) score += 100;
        if (/minecraftuwp/i.test(name)) score += 40;
        if (fs.existsSync(com)) score += 30;
        if (fs.existsSync(worlds)) score += 20;
        try {
          const st = fs.statSync(full);
          score += Math.min(10, Math.floor((Date.now() - (st.mtimeMs || Date.now())) / -86400000));
        } catch (_) {}
        return { name, full, score };
      })
      .sort((a, b) => b.score - a.score);

    if (candidates.length) return candidates[0].full;

    // Fallback: old behavior (case-insensitive exact PFN prefix)
    const exact = dirNames.find(n => /^microsoft\.minecraftuwp_/i.test(n));
    if (exact) return path.join(pkgs, exact);

    return null;
  } catch (_) {
    return null;
  }
}

let bedrockComMojangCache = '';
let bedrockComMojangCacheTs = 0;
let bedrockComMojangSource = 'unknown';

function discoverBedrockComMojangDir() {
  const nowTs = Date.now();

  // User override has top priority
  try {
    const override = String(store.get('bedrockDataRoot') || '').trim();
    if (override && fs.existsSync(override)) {
      const worlds = path.join(override, 'minecraftWorlds');
      if (fs.existsSync(worlds)) {
        bedrockComMojangCache = override;
        bedrockComMojangCacheTs = nowTs;
        bedrockComMojangSource = 'override';
        return bedrockComMojangCache;
      }
    }
  } catch (_) {}

  if (bedrockComMojangCache && (nowTs - bedrockComMojangCacheTs) < 15000 && fs.existsSync(bedrockComMojangCache)) {
    return bedrockComMojangCache;
  }

  const candidates = [];

  // 1) Roaming Bedrock users (preferred for many installs)
  try {
    const roaming = process.env.APPDATA;
    if (roaming) {
      const usersRoot = path.join(roaming, 'Minecraft Bedrock', 'Users');
      if (fs.existsSync(usersRoot)) {
        const users = fs.readdirSync(usersRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
        for (const u of users) {
          if (String(u).toLowerCase() === 'shared') continue; // ignore Shared per product decision
          const com = path.join(usersRoot, u, 'games', 'com.mojang');
          if (!fs.existsSync(com)) continue;
          const worlds = path.join(com, 'minecraftWorlds');
          const worldsCount = fs.existsSync(worlds) ? fs.readdirSync(worlds, { withFileTypes: true }).filter(d => d.isDirectory()).length : 0;
          let score = 200;
          if (worldsCount > 0) score += 500;
          try {
            const st = fs.statSync(com);
            if (nowTs - (st.mtimeMs || 0) < 7 * 86400000) score += 40;
          } catch (_) {}
          candidates.push({ com, score, worldsCount, source: `roaming:${u}` });
        }
      }
    }
  } catch (_) {}

  // 2) UWP LocalState fallback
  try {
    const pkgDir = resolveBedrockPackageDir();
    if (pkgDir) {
      const com = path.join(pkgDir, 'LocalState', 'games', 'com.mojang');
      if (fs.existsSync(com)) {
        const worlds = path.join(com, 'minecraftWorlds');
        const worldsCount = fs.existsSync(worlds) ? fs.readdirSync(worlds, { withFileTypes: true }).filter(d => d.isDirectory()).length : 0;
        let score = 100;
        if (worldsCount > 0) score += 250;
        candidates.push({ com, score, worldsCount, source: 'uwp' });
      }
    }
  } catch (_) {}

  // 3) If still empty, create fallback UWP path (new users with empty storage)
  if (!candidates.length) {
    try {
      const pkgDir = resolveBedrockPackageDir();
      if (pkgDir) {
        const com = path.join(pkgDir, 'LocalState', 'games', 'com.mojang');
        fs.mkdirSync(com, { recursive: true });
        candidates.push({ com, score: 10, worldsCount: 0, source: 'fallback' });
      }
    } catch (_) {}
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  bedrockComMojangCache = candidates[0].com;
  bedrockComMojangCacheTs = nowTs;
  bedrockComMojangSource = String(candidates[0].source || 'auto');
  return bedrockComMojangCache;
}

function getBedrockComMojangDir() {
  return discoverBedrockComMojangDir();
}

function getBedrockSharedComMojangDir() {
  try {
    const roaming = process.env.APPDATA;
    if (!roaming) return null;
    const shared = path.join(roaming, 'Minecraft Bedrock', 'Users', 'Shared', 'games', 'com.mojang');
    if (fs.existsSync(shared)) return shared;
  } catch (_) {}
  return null;
}

function bedrockPaths() {
  const com = getBedrockComMojangDir();
  if (!com) return null;
  const mcpe = path.join(com, 'minecraftpe');

  // Some installs store packs in Users/Shared while worlds live in Users/<id>.
  const sharedCom = getBedrockSharedComMojangDir();
  const sharedResourcePacks = sharedCom ? path.join(sharedCom, 'resource_packs') : '';
  const sharedBehaviorPacks = sharedCom ? path.join(sharedCom, 'behavior_packs') : '';
  const resourcePacks = (sharedResourcePacks && fs.existsSync(sharedResourcePacks)) ? sharedResourcePacks : path.join(com, 'resource_packs');
  const behaviorPacks = (sharedBehaviorPacks && fs.existsSync(sharedBehaviorPacks)) ? sharedBehaviorPacks : path.join(com, 'behavior_packs');

  return {
    comMojang: com,
    sharedComMojang: sharedCom || null,
    minecraftpe: mcpe,
    optionsTxt: path.join(mcpe, 'options.txt'),
    resourcePacks,
    behaviorPacks,
    worlds: path.join(com, 'minecraftWorlds'),
    skins: path.join(com, 'skins')
  };
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
}

function safeRm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  } catch (_) {
    return false;
  }
}

function bedrockExtractZipToFolder(zipPath, targetDir, nameHint) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const top = new Set();
  for (const e of entries) {
    const parts = String(e.entryName || '').split('/').filter(Boolean);
    if (parts.length) top.add(parts[0]);
  }
  let outFolder = null;
  // If archive has a single top-level directory, extract as-is
  if (top.size === 1) {
    outFolder = path.join(targetDir, Array.from(top)[0]);
    ensureDir(targetDir);
    zip.extractAllTo(targetDir, true);
    return { ok: true, folder: outFolder };
  }
  // Otherwise, extract into a new folder
  const baseName = (nameHint || path.basename(zipPath)).replace(/\.(zip|mcpack|mcaddon)$/i, '');
  outFolder = path.join(targetDir, baseName);
  ensureDir(outFolder);
  zip.extractAllTo(outFolder, true);
  return { ok: true, folder: outFolder };
}

function dirSizeBytes(p) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
  } catch (_) { return 0; }
  let total = 0;
  try {
    const entries = fs.readdirSync(p, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(p, e.name);
      if (e.isFile()) {
        try { total += fs.statSync(fp).size || 0; } catch (_) {}
      } else if (e.isDirectory()) {
        total += dirSizeBytes(fp);
      }
    }
  } catch (_) {}
  return total;
}

async function readBedrockLevelDat(worldPath) {
  // Bedrock level.dat: int32LE version + int32LE length + NBT (little-endian)
  try {
    const lp = path.join(worldPath, 'level.dat');
    if (!fs.existsSync(lp)) return { ok: false, error: 'no_level_dat' };
    const buf = fs.readFileSync(lp);
    if (buf.length < 12) return { ok: false, error: 'short_level_dat' };
    const ver = buf.readInt32LE(0);
    const len = buf.readInt32LE(4);
    const nbtBuf = buf.slice(8, Math.min(buf.length, 8 + Math.max(0, len)));
    const parsed = await nbt.parse(nbtBuf, { littleEndian: true });
    const simplified = nbt.simplify(parsed.parsed);
    return { ok: true, headerVersion: ver, data: simplified };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function mapBedrockGameType(v) {
  const n = Number(v);
  if (n === 0) return 'Выживание';
  if (n === 1) return 'Творческий';
  if (n === 2) return 'Приключение';
  if (n === 3) return 'Наблюдатель';
  return '—';
}
function mapBedrockDifficulty(v) {
  const n = Number(v);
  if (n === 0) return 'Мирный';
  if (n === 1) return 'Лёгко';
  if (n === 2) return 'Нормально';
  if (n === 3) return 'Сложно';
  return '—';
}

ipcMain.handle('bedrock:check', async () => {
  if (process.platform !== 'win32') {
    return { supported: false, installed: false, reason: 'Bedrock mode поддерживается только на Windows.' };
  }

  try {
    const pkgCmd = "Get-AppxPackage -Name Microsoft.MinecraftUWP | Select-Object -First 1 Name,PackageFamilyName,Version | ConvertTo-Json -Compress";
    const out = await runPowerShellAsync(pkgCmd);
    if (!out) return { supported: true, installed: false };

    const data = JSON.parse(out);

    let appId = 'Microsoft.MinecraftUWP_8wekyb3d8bbwe!App';
    try {
      const appCmd = [
        "$apps = Get-StartApps | Where-Object { $_.AppID -match 'Minecraft' -or $_.Name -match 'Minecraft' };",
        "$pick = $apps | Where-Object { $_.AppID -match 'MinecraftUWP' } | Select-Object -First 1;",
        "if (-not $pick) { $pick = $apps | Select-Object -First 1 }",
        "if ($pick) { $pick.AppID }"
      ].join(' ');
      const foundAppId = await runPowerShellAsync(appCmd);
      if (foundAppId) appId = foundAppId;
    } catch (_) {}

    return {
      supported: true,
      installed: true,
      packageName: data?.Name || 'Microsoft.MinecraftUWP',
      packageFamilyName: data?.PackageFamilyName || 'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
      version: data?.Version || null,
      appId
    };
  } catch (_) {
    return { supported: true, installed: false };
  }
});

ipcMain.handle('bedrock:launch', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Bedrock mode поддерживается только на Windows.' };
  }

  let bedrockLogPath = null;
  try {
    bedrockLogPath = appendBedrockLaunchLog('INFO: Bedrock launch requested');
    if (bedrockLogPath) sendMcState('logpath', { logDir: path.dirname(bedrockLogPath), logPath: bedrockLogPath });

    // Preflight checks before launch
    const pf = await bedrockPreflightChecks();
    appendBedrockLaunchLog(`INFO: preflight=${JSON.stringify(pf)}`);
    if (!pf?.ok) {
      return { ok: false, error: `Preflight не выполнен: ${pf?.error || 'unknown'}`, logPath: bedrockLogPath || '' };
    }
    if (pf.critical) {
      return {
        ok: false,
        error: `Bedrock не готов к запуску: ${pf.criticalMissing.join(', ')}. Открой MS Fix/Xbox Fixer.`,
        logPath: bedrockLogPath || ''
      };
    }

    // Try to add server entry first (harmless if already present)
    await ensureBedrockServerLink();
    appendBedrockLaunchLog('INFO: ensureBedrockServerLink done');

    // Hide launcher immediately, then launch Bedrock
    hideLauncherForGame();

    // Prefer direct app launch from installed apps list (avoids Store redirect when protocol is broken)
    let launched = false;
    const info = getBedrockAppInfo();
    const appId = String(info?.appId || 'Microsoft.MinecraftUWP_8wekyb3d8bbwe!App').trim();
    const appUri = `shell:AppsFolder\\${appId}`;
    const waitStarted = async (ms = 2500) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        try { if (isBedrockRunning()) return true; } catch (_) {}
        await new Promise(r => setTimeout(r, 250));
      }
      return false;
    };

    // Attempt 1: shell.openExternal(appUri)
    try {
      appendBedrockLaunchLog(`INFO: launching via shell.openExternal ${appUri}`);
      const r = await shell.openExternal(appUri);
      appendBedrockLaunchLog(`INFO: shell.openExternal appUri result=${String(r || 'ok')}`);
      launched = await waitStarted(3000);
      appendBedrockLaunchLog(launched ? 'INFO: start confirmed after shell.openExternal' : 'WARN: shell.openExternal did not start process');
    } catch (e) {
      appendBedrockLaunchLog(`WARN: shell.openExternal appUri failed: ${String(e?.message || e)}`);
    }

    // Attempt 2: explorer.exe appUri
    if (!launched) {
      try {
        appendBedrockLaunchLog('INFO: launching via explorer.exe AppsFolder URI');
        await execFileAsync('explorer.exe', [appUri], { windowsHide: true });
        launched = await waitStarted(3000);
        appendBedrockLaunchLog(launched ? 'INFO: start confirmed after explorer.exe' : 'WARN: explorer.exe did not start process');
      } catch (e) {
        appendBedrockLaunchLog(`WARN: explorer.exe appUri failed: ${String(e?.message || e)}`);
      }
    }

    // Attempt 3: cmd start appUri
    if (!launched) {
      try {
        appendBedrockLaunchLog('INFO: launching via cmd start AppsFolder URI');
        await execFileAsync('cmd', ['/c', 'start', '', appUri], { windowsHide: true });
        launched = await waitStarted(3000);
        appendBedrockLaunchLog(launched ? 'INFO: start confirmed after cmd start' : 'WARN: cmd start did not start process');
      } catch (e) {
        appendBedrockLaunchLog(`WARN: cmd start appUri failed: ${String(e?.message || e)}`);
      }
    }

    // Attempt 4: Start-Process by exact StartApps AppID
    if (!launched) {
      try {
        appendBedrockLaunchLog('INFO: launching via PowerShell Start-Process (StartApps AppID)');
        await runPowerShellAsync("$a=(Get-StartApps | Where-Object { $_.Name -like '*Minecraft for Windows*' -or $_.AppID -match 'MinecraftUWP' } | Select-Object -First 1).AppID; if($a){ Start-Process ('shell:AppsFolder\\' + $a); 'ok' } else { 'no_appid' }");
        launched = await waitStarted(3000);
        appendBedrockLaunchLog(launched ? 'INFO: start confirmed after PowerShell Start-Process' : 'WARN: PowerShell Start-Process did not start process');
      } catch (e) {
        appendBedrockLaunchLog(`WARN: PowerShell Start-Process failed: ${String(e?.message || e)}`);
      }
    }

    // Fallback: protocol launch
    if (!launched) {
      appendBedrockLaunchLog('INFO: fallback launching minecraft://');
      await shell.openExternal('minecraft://');
    }

    // Non-blocking diagnostics in background (do not block launch path)
    setTimeout(async () => {
      try {
        const running = isBedrockRunning();
        if (running) {
          appendBedrockLaunchLog('INFO: Bedrock process detected');
          try { await startBedrockFpsMonitor(); } catch (_) {}
          sendMcState('launched', { version: 'bedrock', logPath: bedrockLogPath || '' });
        } else {
          appendBedrockLaunchLog('ERROR: Bedrock process not detected after 4s');
          const diag = await collectBedrockLaunchFailureDiagnostics();
          appendBedrockLaunchLog(`ERROR: failure-diagnostics=${JSON.stringify(diag)}`);
          sendMcState('error', {
            error: 'Bedrock не запустился (процесс не найден через 4с). Открой latest-bedrock.txt.',
            version: 'bedrock',
            logPath: bedrockLogPath || '',
            tail: ''
          });
          restoreLauncherAfterGame();
        }
      } catch (e) {
        appendBedrockLaunchLog(`WARN: post-launch check failed: ${String(e?.message || e)}`);
      }
    }, 4000);

    watchBedrockAndRestore();
    ensureAutoLocalHostWatcher();
    setTimeout(() => { try { openBedrockHubWindow(); } catch (_) {} }, 900);
    return { ok: true, logPath: bedrockLogPath || '' };
  } catch (e) {
    appendBedrockLaunchLog(`ERROR: ${String(e?.message || e)}`);
    restoreLauncherAfterGame();
    return { ok: false, error: String(e?.message || e), logPath: bedrockLogPath || '' };
  }
});

ipcMain.handle('bedrock:openStore', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Microsoft Store доступен только на Windows.' };
  }
  try {
    await shell.openExternal('ms-windows-store://pdp/?PFN=Microsoft.MinecraftUWP_8wekyb3d8bbwe');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:microsoftDiag', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  const hasPkg = async (name) => {
    try {
      const out = await runPowerShellAsync(`(Get-AppxPackage -Name ${name} | Select-Object -First 1 Name).Name`);
      return !!String(out || '').trim();
    } catch (_) { return false; }
  };
  const getPkgVersion = async (name) => {
    try {
      const out = await runPowerShellAsync(`(Get-AppxPackage -Name ${name} | Select-Object -First 1 Version).Version`);
      return String(out || '').trim();
    } catch (_) { return ''; }
  };
  const cmpVer = (a, b) => {
    const pa = String(a || '').split('.').map(x => Number(x) || 0);
    const pb = String(b || '').split('.').map(x => Number(x) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da > db) return 1;
      if (da < db) return -1;
    }
    return 0;
  };
  const serviceOk = async (name) => {
    try {
      const out = await runPowerShellAsync(`(Get-Service -Name '${name}' -ErrorAction SilentlyContinue).Status`);
      const s = String(out || '').trim().toLowerCase();
      return s === 'running' || s === 'startpending';
    } catch (_) { return false; }
  };

  try {
    const storeVersion = await getPkgVersion('Microsoft.WindowsStore');
    const minStoreVersion = '22310.1401.8.0';
    const storeOutdated = !storeVersion ? true : (cmpVer(storeVersion, minStoreVersion) < 0);
    return {
      ok: true,
      minecraftInstalled: await hasPkg('Microsoft.MinecraftUWP'),
      gamingServicesInstalled: await hasPkg('Microsoft.GamingServices'),
      xboxIdentityInstalled: await hasPkg('Microsoft.XboxIdentityProvider'),
      storeInstalled: await hasPkg('Microsoft.WindowsStore'),
      storeVersion,
      minStoreVersion,
      storeOutdated,
      storeServiceOk: await serviceOk('ClipSVC'),
      wuServiceOk: await serviceOk('wuauserv'),
      bitsServiceOk: await serviceOk('BITS')
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:microsoftQuickFix', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  const steps = [];
  const mark = (name, ok, error = '', details = '') => steps.push({ name, ok: !!ok, error: error ? String(error) : '', details: details ? String(details) : '' });

  try {
    try {
      await runPowerShellAsync("Start-Service -Name BITS -ErrorAction SilentlyContinue; Start-Service -Name wuauserv -ErrorAction SilentlyContinue; Start-Service -Name ClipSVC -ErrorAction SilentlyContinue; Start-Service -Name XblAuthManager -ErrorAction SilentlyContinue; Start-Service -Name XblGameSave -ErrorAction SilentlyContinue; Start-Service -Name XboxNetApiSvc -ErrorAction SilentlyContinue; Start-Service -Name GamingServices -ErrorAction SilentlyContinue; Start-Service -Name GamingServicesNet -ErrorAction SilentlyContinue; 'ok'");
      mark('start_core_and_xbox_services', true);
    } catch (e) { mark('start_core_and_xbox_services', false, e?.message || e); }

    try {
      await runPowerShellAsync("$ErrorActionPreference='SilentlyContinue'; Get-AppxPackage -AllUsers Microsoft.GamingServices | Remove-AppxPackage -AllUsers; Start-Sleep -Seconds 1; Start-Process 'ms-windows-store://pdp/?productid=9MWPM2CQNLHN'; 'ok'");
      mark('reinstall_gaming_services_all_users', true);
    } catch (e) { mark('reinstall_gaming_services_all_users', false, e?.message || e); }

    try {
      await execFileAsync('cmd', ['/c', 'start', '', '/b', 'wsreset.exe'], { windowsHide: true });
      mark('wsreset', true);
    } catch (e) { mark('wsreset', false, e?.message || e); }

    try {
      const svc = await runPowerShellAsync("Get-Service ClipSVC,BITS,wuauserv,XblAuthManager,XblGameSave,XboxNetApiSvc,GamingServices,GamingServicesNet | Select-Object Name,Status,StartType | ConvertTo-Json -Compress");
      mark('service_snapshot', true, '', svc);
    } catch (e) { mark('service_snapshot', false, e?.message || e); }

    try {
      await shell.openExternal('ms-windows-store://downloadsandupdates');
      mark('open_store_updates', true);
    } catch (e) { mark('open_store_updates', false, e?.message || e); }

    try {
      await shell.openExternal('ms-windows-store://pdp/?productid=9MV0B5HZVK9Z');
      mark('open_xbox_app_store', true);
    } catch (e) { mark('open_xbox_app_store', false, e?.message || e); }

    try {
      await shell.openExternal('ms-windows-store://pdp/?PFN=Microsoft.MinecraftUWP_8wekyb3d8bbwe');
      mark('open_minecraft_store', true);
    } catch (e) { mark('open_minecraft_store', false, e?.message || e); }

    return { ok: true, steps, note: 'Рекомендуется перезагрузка ПК после завершения фикса.' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), steps };
  }
});

ipcMain.handle('bedrock:xboxDiag', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  const hasPkg = async (name) => {
    try {
      const out = await runPowerShellAsync(`(Get-AppxPackage -Name ${name} | Select-Object -First 1 Name).Name`);
      return !!String(out || '').trim();
    } catch (_) { return false; }
  };
  const serviceState = async (name) => {
    try {
      const out = await runPowerShellAsync(`(Get-Service -Name '${name}' -ErrorAction SilentlyContinue).Status`);
      return String(out || '').trim();
    } catch (_) { return ''; }
  };

  try {
    const svc = {
      XboxGipSvc: await serviceState('XboxGipSvc'),
      XblAuthManager: await serviceState('XblAuthManager'),
      XblGameSave: await serviceState('XblGameSave'),
      XboxNetApiSvc: await serviceState('XboxNetApiSvc')
    };
    return {
      ok: true,
      xboxAppInstalled: await hasPkg('Microsoft.GamingApp'),
      xboxIdentityInstalled: await hasPkg('Microsoft.XboxIdentityProvider'),
      gamingServicesInstalled: await hasPkg('Microsoft.GamingServices'),
      services: svc,
      servicesOk: Object.values(svc).every(v => ['Running', 'StartPending'].includes(String(v || '')))
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:xboxQuickFix', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  const steps = [];
  const mark = (name, ok, error = '') => steps.push({ name, ok: !!ok, error: error ? String(error) : '' });

  try {
    try {
      await runPowerShellAsync("Start-Service -Name XboxGipSvc -ErrorAction SilentlyContinue; Start-Service -Name XblAuthManager -ErrorAction SilentlyContinue; Start-Service -Name XblGameSave -ErrorAction SilentlyContinue; Start-Service -Name XboxNetApiSvc -ErrorAction SilentlyContinue; 'ok'");
      mark('start_xbox_services', true);
    } catch (e) { mark('start_xbox_services', false, e?.message || e); }

    try {
      await runPowerShellAsync("$ErrorActionPreference='SilentlyContinue'; Get-AppxPackage -Name Microsoft.GamingServices | Remove-AppxPackage; Start-Sleep -Seconds 1; Start-Process 'ms-windows-store://pdp/?productid=9MWPM2CQNLHN'; 'ok'");
      mark('repair_gaming_services', true);
    } catch (e) { mark('repair_gaming_services', false, e?.message || e); }

    try {
      await shell.openExternal('ms-windows-store://pdp/?productid=9MV0B5HZVK9Z');
      mark('open_xbox_app_page', true);
    } catch (e) { mark('open_xbox_app_page', false, e?.message || e); }

    try {
      await shell.openExternal('ms-settings:gaming-xboxnetworking');
      mark('open_xbox_networking', true);
    } catch (e) { mark('open_xbox_networking', false, e?.message || e); }

    return { ok: true, steps };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), steps };
  }
});

ipcMain.handle('bedrock:storeDeepFix', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  const steps = [];
  const mark = (name, ok, error = '') => steps.push({ name, ok: !!ok, error: error ? String(error) : '' });
  try {
    try {
      await runPowerShellAsync("$ErrorActionPreference='SilentlyContinue'; Get-AppxPackage -AllUsers Microsoft.StorePurchaseApp | ForEach-Object { Add-AppxPackage -DisableDevelopmentMode -Register ($_.InstallLocation + '\\AppxManifest.xml') }; 'ok'");
      mark('reregister_store_purchase_app', true);
    } catch (e) { mark('reregister_store_purchase_app', false, e?.message || e); }

    try {
      await runPowerShellAsync("$ErrorActionPreference='SilentlyContinue'; Get-AppxPackage -AllUsers Microsoft.WindowsStore | ForEach-Object { Add-AppxPackage -DisableDevelopmentMode -Register ($_.InstallLocation + '\\AppxManifest.xml') }; 'ok'");
      mark('reregister_windows_store', true);
    } catch (e) { mark('reregister_windows_store', false, e?.message || e); }

    try {
      await runPowerShellAsync("$ErrorActionPreference='SilentlyContinue'; Get-AppxPackage -AllUsers Microsoft.GamingServices | Remove-AppxPackage -AllUsers; Start-Sleep -Seconds 1; Start-Process 'ms-windows-store://pdp/?productid=9MWPM2CQNLHN'; 'ok'");
      mark('reinstall_gaming_services', true);
    } catch (e) { mark('reinstall_gaming_services', false, e?.message || e); }

    try {
      await execFileAsync('cmd', ['/c', 'start', '', '/b', 'wsreset.exe'], { windowsHide: true });
      mark('wsreset', true);
    } catch (e) { mark('wsreset', false, e?.message || e); }

    try {
      await shell.openExternal('ms-windows-store://downloadsandupdates');
      mark('open_store_updates', true);
    } catch (e) { mark('open_store_updates', false, e?.message || e); }

    return { ok: true, steps, note: 'Глубокий ремонт Store завершён. Нажми Получить обновления и перезагрузи ПК.' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), steps };
  }
});

ipcMain.handle('bedrock:rebootNow', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  try {
    childProcess.execFile('shutdown', ['/r', '/t', '5'], { windowsHide: true }, () => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:managerStatus', async () => {
  if (process.platform !== 'win32') return { supported: false, installed: false };
  const p = getMcDownloaderPaths();
  const found = fs.existsSync(p.exe) ? p.exe : (fs.existsSync(p.nestedExe) ? p.nestedExe : null);
  return { supported: true, installed: !!found, path: found || p.exe };
});

ipcMain.handle('bedrock:managerSetup', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Only Windows supported' };
  try {
    const p = await ensureMcDownloaderInstalled();
    return { ok: true, path: p.runExe || p.exe };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:managerOpen', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Only Windows supported' };
  try {
    const p = await ensureMcDownloaderInstalled();
    const target = p.runExe || p.exe;
    const err = await shell.openPath(target);
    if (err) return { ok: false, error: err };
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:versionsList', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Only Windows supported', versions: [] };

  try {
    const p = await ensureMcDownloaderInstalled();
    const vp = p.versionsJson;
    if (!fs.existsSync(vp)) {
      return { ok: false, error: 'versions.json не найден', versions: [] };
    }

    const raw = fs.readFileSync(vp, 'utf8');
    const rows = JSON.parse(raw);

    const parseNum = (v) => String(v || '').split('.').map(n => Number(n || 0));
    const cmp = (a, b) => {
      const av = parseNum(a.version);
      const bv = parseNum(b.version);
      const len = Math.max(av.length, bv.length);
      for (let i = 0; i < len; i++) {
        const x = av[i] || 0;
        const y = bv[i] || 0;
        if (x !== y) return y - x;
      }
      return 0;
    };

    const mapped = (rows || [])
      .map(r => ({
        version: String(r?.[0] || ''),
        updateId: String(r?.[1] || ''),
        channelCode: Number(r?.[2] ?? 0)
      }))
      .filter(x => /^\d+\.\d+\.\d+\.\d+$/.test(x.version))
      .map(x => ({
        ...x,
        channel: x.channelCode === 2 ? 'preview' : (x.channelCode === 1 ? 'beta' : 'release')
      }))
      .sort(cmp);

    return { ok: true, versions: mapped };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), versions: [] };
  }
});

ipcMain.handle('bedrock:uninstall', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Bedrock uninstall доступен только на Windows.' };
  }

  try {
    const cmd = "Get-AppxPackage -Name Microsoft.MinecraftUWP | Remove-AppxPackage";
    execFileSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

// Bedrock content management (packs/worlds/skins)
ipcMain.handle('bedrock:contentPaths', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Не удалось найти папку Bedrock (Packages)' };
  // Ensure folders exist
  ensureDir(p.minecraftpe);
  ensureDir(p.resourcePacks);
  ensureDir(p.behaviorPacks);
  ensureDir(p.worlds);
  ensureDir(p.skins);
  return { ok: true, paths: p };
});

function readOptionsTxt(optionsPath) {
  if (!fs.existsSync(optionsPath)) return { ok: false, error: 'options_not_found', path: optionsPath, items: [] };
  const raw = fs.readFileSync(optionsPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      // keep as comment context (ignored)
      continue;
    }
    // Bedrock usually uses ':' but sometimes '='; support both.
    const m = trimmed.match(/^([^:=\s]+)\s*([:=])\s*(.*)$/);
    if (!m) continue;
    items.push({ key: m[1], sep: m[2], value: m[3], lineIndex: i });
  }
  return { ok: true, path: optionsPath, lines, items };
}

function writeOptionsTxt(optionsPath, lines) {
  ensureDir(path.dirname(optionsPath));
  fs.writeFileSync(optionsPath, lines.join(os.EOL), 'utf8');
}

function resolveBedrockTreatmentsFile() {
  const p = bedrockPaths();
  if (!p) return null;
  ensureDir(p.minecraftpe);

  const collectTreatmentCandidates = (root) => {
    const out = [];
    try {
      if (!root || !fs.existsSync(root)) return out;
      const packs = fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(n => /^treatment_packs/i.test(n));
      for (const pack of packs) {
        const fp = path.join(root, pack, 'treatment_tags.json');
        if (fs.existsSync(fp)) out.push(fp);
      }
    } catch (_) {}
    return out;
  };

  // 1) HARD priority: global roaming treatments root (%APPDATA%/Minecraft Bedrock/treatments)
  try {
    const roaming = process.env.APPDATA;
    const root = roaming ? path.join(roaming, 'Minecraft Bedrock', 'treatments') : '';
    const candidates = collectTreatmentCandidates(root);
    if (candidates.length) {
      candidates.sort((a, b) => {
        try { return (fs.statSync(b).mtimeMs || 0) - (fs.statSync(a).mtimeMs || 0); } catch (_) { return 0; }
      });
      return candidates[0];
    }
  } catch (_) {}

  // 2) Secondary: under detected com.mojang root (some installs)
  try {
    const localRoot = path.join(path.dirname(p.minecraftpe), 'treatments');
    const candidates = collectTreatmentCandidates(localRoot);
    if (candidates.length) {
      candidates.sort((a, b) => {
        try { return (fs.statSync(b).mtimeMs || 0) - (fs.statSync(a).mtimeMs || 0); } catch (_) { return 0; }
      });
      return candidates[0];
    }
  } catch (_) {}

  // 3) Newer Bedrock format inside minecraftpe (ignore synthetic file)
  try {
    const files = fs.readdirSync(p.minecraftpe)
      .filter(n => /^treatment_tags---.*\.json$/i.test(String(n || '')))
      .filter(n => String(n || '').toLowerCase() !== 'treatment_tags---noclauncher.json');
    if (files.length) {
      files.sort((a, b) => {
        try {
          const sa = fs.statSync(path.join(p.minecraftpe, a)).mtimeMs || 0;
          const sb = fs.statSync(path.join(p.minecraftpe, b)).mtimeMs || 0;
          return sb - sa;
        } catch (_) { return 0; }
      });
      return path.join(p.minecraftpe, files[0]);
    }
  } catch (_) {}

  return path.join(p.minecraftpe, 'treatment_tags---noclauncher.json');
}

function readBedrockTreatments() {
  const filePath = resolveBedrockTreatmentsFile();
  if (!filePath) return { ok: false, error: 'paths_not_found' };
  try {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify({ tags: [] }, null, 2), 'utf8');
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw || '{}');
    const tags = Array.isArray(data.tags) ? data.tags.map(x => String(x || '').trim()).filter(Boolean) : [];
    return { ok: true, path: filePath, data, tags: Array.from(new Set(tags)).sort((a, b) => a.localeCompare(b)) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), path: filePath };
  }
}

function writeBedrockTreatments(filePath, tags, data = {}) {
  const out = { ...(data || {}), tags: Array.from(new Set((tags || []).map(x => String(x || '').trim()).filter(Boolean))) };
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
}

function applyBedrockLaunchDefaults() {
  try {
    const p = bedrockPaths();
    if (!p) return { ok: false, error: 'paths_not_found' };
    ensureDir(p.minecraftpe);
    const r = readOptionsTxt(p.optionsTxt);
    let lines = r.ok ? r.lines : [''];
    const items = r.ok ? r.items : [];

    const set = (k, v) => {
      const idx = items.findIndex(x => x.key === k);
      if (idx >= 0) {
        const it = items[idx];
        lines[it.lineIndex] = `${it.key}${it.sep}${v}`;
      } else {
        lines.push(`${k}:${v}`);
      }
    };

    // Force launcher defaults for Bedrock start: uncapped FPS + VSync OFF.
    set('gfx_max_framerate', '0');
    set('gfx_vsync', '0');

    writeOptionsTxt(p.optionsTxt, lines);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

ipcMain.handle('bedrock:optionsRead', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only', items: [] };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found', items: [] };
  ensureDir(p.minecraftpe);
  const r = readOptionsTxt(p.optionsTxt);
  if (!r.ok) return { ok: false, error: r.error, path: r.path, items: [] };
  // Return only simple items to renderer
  return { ok: true, path: r.path, items: r.items.map(x => ({ key: x.key, value: x.value })) };
});

ipcMain.handle('bedrock:optionsOpen', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  ensureDir(p.minecraftpe);
  if (!fs.existsSync(p.optionsTxt)) {
    // create empty file so user can see the path
    fs.writeFileSync(p.optionsTxt, '', 'utf8');
  }
  return { ok: true, path: p.optionsTxt };
});

ipcMain.handle('bedrock:optionsSet', async (_e, { key, value }) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  const k = String(key || '').trim();
  if (!k) return { ok: false, error: 'key_required' };
  ensureDir(p.minecraftpe);
  const r = readOptionsTxt(p.optionsTxt);
  // If file absent, create from scratch
  let lines = r.ok ? r.lines : [];
  let items = r.ok ? r.items : [];
  const idx = items.findIndex(x => x.key === k);
  if (idx >= 0) {
    const it = items[idx];
    lines[it.lineIndex] = `${it.key}${it.sep}${String(value ?? '')}`;
  } else {
    lines.push(`${k}:${String(value ?? '')}`);
  }
  try {
    writeOptionsTxt(p.optionsTxt, lines);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:optionsApplyPreset', async (_e, { preset }) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  ensureDir(p.minecraftpe);
  const name = String(preset || '').toLowerCase();
  const r = readOptionsTxt(p.optionsTxt);
  let lines = r.ok ? r.lines : [''];
  const items = r.ok ? r.items : [];
  const set = (k, v) => {
    const idx = items.findIndex(x => x.key === k);
    if (idx >= 0) {
      const it = items[idx];
      lines[it.lineIndex] = `${it.key}${it.sep}${v}`;
    } else {
      lines.push(`${k}:${v}`);
    }
  };

  // Conservative presets: only keys that commonly exist in options.txt.
  // If a key is absent, we still write it — Bedrock ignores unknown safely.
  const presets = {
    low: {
      gfx_viewdistance: '8',
      gfx_field_of_view: '70',
      gfx_fancygraphics: '0',
      gfx_particles: '0',
      gfx_vsync: '0',
      gfx_bloom: '0'
    },
    medium: {
      gfx_viewdistance: '12',
      gfx_field_of_view: '75',
      gfx_fancygraphics: '1',
      gfx_particles: '1',
      gfx_vsync: '0',
      gfx_bloom: '0'
    },
    high: {
      gfx_viewdistance: '18',
      gfx_field_of_view: '80',
      gfx_fancygraphics: '1',
      gfx_particles: '1',
      gfx_vsync: '1',
      gfx_bloom: '1'
    },
    ultra: {
      gfx_viewdistance: '24',
      gfx_field_of_view: '85',
      gfx_fancygraphics: '1',
      gfx_particles: '1',
      gfx_vsync: '1',
      gfx_bloom: '1'
    }
  };

  const cfg = presets[name];
  if (!cfg) return { ok: false, error: 'unknown_preset' };
  try {
    for (const [k, v] of Object.entries(cfg)) set(k, v);
    writeOptionsTxt(p.optionsTxt, lines);
    return { ok: true, applied: Object.keys(cfg).length };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:treatmentsRead', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only', tags: [] };
  return readBedrockTreatments();
});

ipcMain.handle('bedrock:treatmentsSet', async (_e, { tag, enabled }) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const t = String(tag || '').trim();
  if (!t) return { ok: false, error: 'tag_required' };
  const r = readBedrockTreatments();
  if (!r.ok) return r;
  const set = new Set(r.tags || []);
  if (enabled) set.add(t); else set.delete(t);
  try {
    writeBedrockTreatments(r.path, Array.from(set), r.data);
    return { ok: true, path: r.path, enabled: !!enabled };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), path: r.path };
  }
});

ipcMain.handle('bedrock:treatmentsBackup', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const r = readBedrockTreatments();
  if (!r.ok) return r;
  try {
    const backup = `${r.path}.bak_${new Date().toISOString().replace(/[:.]/g, '-').slice(0,19)}`;
    fs.copyFileSync(r.path, backup);
    return { ok: true, path: r.path, backup };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), path: r.path };
  }
});

ipcMain.handle('bedrock:openContentFolder', async (_e, { kind }) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  const map = {
    resourcePacks: p.resourcePacks,
    behaviorPacks: p.behaviorPacks,
    worlds: p.worlds,
    skins: p.skins,
    comMojang: p.comMojang
  };
  const target = map[String(kind || '')] || p.comMojang;
  ensureDir(target);
  const err = await shell.openPath(target);
  if (err) return { ok: false, error: err };
  return { ok: true, path: target };
});

ipcMain.handle('bedrock:installPackFromFile', async (_e, { kind }) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };

  const targetDir = String(kind) === 'behaviorPacks' ? p.behaviorPacks : p.resourcePacks;
  ensureDir(targetDir);

  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Выбери пак (Bedrock) — .mcpack/.mcaddon/.zip',
    properties: ['openFile'],
    filters: [
      { name: 'Bedrock packs', extensions: ['mcpack', 'mcaddon', 'zip'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths?.[0]) return { ok: false, error: 'cancel' };
  const src = filePaths[0];

  try {
    const r = bedrockExtractZipToFolder(src, targetDir, path.basename(src));
    return { ok: true, folder: r.folder };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:worldsList', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only', worlds: [] };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found', worlds: [] };
  ensureDir(p.worlds);
  try {
    const dirs = fs.readdirSync(p.worlds, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    const worlds = dirs.map((id) => {
      const wp = path.join(p.worlds, id);
      let name = id;
      try {
        const ln = path.join(wp, 'levelname.txt');
        if (fs.existsSync(ln)) {
          const t = fs.readFileSync(ln, 'utf8').trim();
          if (t) name = t;
        }
      } catch (_) {}
      return { id, name };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { ok: true, worlds };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), worlds: [] };
  }
});

ipcMain.handle('bedrock:worldsListDetailed', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only', worlds: [] };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found', worlds: [] };
  ensureDir(p.worlds);
  try {
    const dirs = fs.readdirSync(p.worlds, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    const out = [];
    for (const id of dirs) {
      const wp = path.join(p.worlds, id);
      let name = id;
      try {
        const ln = path.join(wp, 'levelname.txt');
        if (fs.existsSync(ln)) {
          const t = fs.readFileSync(ln, 'utf8').trim();
          if (t) name = t;
        }
      } catch (_) {}

      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(wp).mtimeMs || 0; } catch (_) {}

      const sizeBytes = dirSizeBytes(wp);

      let iconDataUrl = null;
      try {
        const ic = path.join(wp, 'world_icon.jpeg');
        if (fs.existsSync(ic)) {
          const raw = fs.readFileSync(ic);
          iconDataUrl = `data:image/jpeg;base64,${raw.toString('base64')}`;
        }
      } catch (_) {}

      let modeText = '—';
      let difficultyText = '—';
      let versionText = '—';
      let seedText = '';

      const ld = await readBedrockLevelDat(wp);
      if (ld.ok) {
        const d = ld.data || {};
        // Different builds store keys slightly differently; try common ones.
        const gt = d.GameType ?? d.gameType ?? d['GameType'] ?? d['game_type'];
        const df = d.Difficulty ?? d.difficulty ?? d['Difficulty'];
        const seed = d.RandomSeed ?? d.randomSeed ?? d['RandomSeed'] ?? d['Seed'];
        const v = d.BaseGameVersion ?? d.baseGameVersion ?? d['BaseGameVersion'] ?? d['lastOpenedWithVersion'];
        if (gt !== undefined) modeText = mapBedrockGameType(gt);
        if (df !== undefined) difficultyText = mapBedrockDifficulty(df);
        if (v) versionText = String(v);
        if (seed !== undefined && seed !== null) seedText = String(seed);
      }

      out.push({ id, name, path: wp, sizeBytes, mtimeMs, iconDataUrl, modeText, difficultyText, versionText, seedText });
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    return { ok: true, worlds: out };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), worlds: [] };
  }
});

ipcMain.handle('bedrock:worldOpen', async (_e, { worldId }) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  const id = String(worldId || '');
  if (!id) return { ok: false, error: 'worldId required' };
  const wp = path.join(p.worlds, id);
  if (!fs.existsSync(wp)) return { ok: false, error: 'not_found' };
  return { ok: true, path: wp };
});

ipcMain.handle('bedrock:worldDelete', async (_e, { worldId }) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  const id = String(worldId || '');
  if (!id) return { ok: false, error: 'worldId required' };
  const wp = path.join(p.worlds, id);
  if (!fs.existsSync(wp)) return { ok: false, error: 'not_found' };
  const ok = safeRm(wp);
  return ok ? { ok: true } : { ok: false, error: 'delete_failed' };
});

ipcMain.handle('bedrock:worldExport', async (_e, { worldId }) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  const id = String(worldId || '');
  if (!id) return { ok: false, error: 'worldId required' };
  const wp = path.join(p.worlds, id);
  if (!fs.existsSync(wp)) return { ok: false, error: 'not_found' };

  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Сохранить мир (zip)',
    defaultPath: path.join(app.getPath('downloads'), `${id}.zip`),
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  });
  if (canceled || !filePath) return { ok: false, error: 'cancel' };

  try {
    const archiver = require('archiver');
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      out.on('close', resolve);
      out.on('error', reject);
      archive.on('error', reject);
      archive.pipe(out);
      archive.directory(wp, false);
      archive.finalize();
    });
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:worldImport', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  ensureDir(p.worlds);
  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Импорт мира (Bedrock) — .mcworld/.zip',
    properties: ['openFile'],
    filters: [
      { name: 'Bedrock worlds', extensions: ['mcworld', 'zip'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths?.[0]) return { ok: false, error: 'cancel' };
  const src = filePaths[0];
  try {
    const zip = new AdmZip(src);
    const entries = zip.getEntries();
    const top = new Set();
    for (const e of entries) {
      const parts = String(e.entryName || '').split('/').filter(Boolean);
      if (parts.length) top.add(parts[0]);
    }
    // If archive root is a folder - extract to worlds folder.
    if (top.size === 1) {
      zip.extractAllTo(p.worlds, true);
      return { ok: true };
    }
    // Otherwise extract into new folder
    const baseName = path.basename(src).replace(/\.(zip|mcworld)$/i, '');
    const outFolder = path.join(p.worlds, baseName);
    ensureDir(outFolder);
    zip.extractAllTo(outFolder, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('bedrock:skinImport', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const p = bedrockPaths();
  if (!p) return { ok: false, error: 'Paths not found' };
  ensureDir(p.skins);
  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Выбери PNG скина (Bedrock)',
    properties: ['openFile'],
    filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (canceled || !filePaths?.[0]) return { ok: false, error: 'cancel' };
  const src = filePaths[0];
  const dst = path.join(p.skins, path.basename(src));
  try {
    fs.copyFileSync(src, dst);
    // Open folder so user can import in-game
    await shell.openPath(p.skins);
    return { ok: true, path: dst };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});


ipcMain.handle('ms:complete', async () => {
  return { ok: false, disabled: true, error: 'online_auth_disabled' };
  try {
    if (!msFlow) return { ok: false, error: 'no_pending' };

    if (msFlow.state === 'pending') {
      return {
        ok: false,
        error: 'pending'
      };
    }
    if (msFlow.state === 'error') {
      const err = msFlow.error || 'auth_error';
      msFlow = null;
      return { ok: false, error: err };
    }

    const res = msFlow.result;
    const steps = Array.isArray(msFlow.steps) ? msFlow.steps.slice() : [];
    msFlow = null;

    if (!res?.profile?.id || !res?.profile?.name) return { ok: false, error: 'INVALID_PROFILE' };
    if (res?.entitlements?.ownsJava === false) {
      // Clear any stored account and force offline mode.
      store.set('account', null);
      store.set('preferOnline', false);
      return { ok: false, error: 'Лицензия Minecraft (Java Edition) не найдена', steps };
    }

    const account = {
      type: 'microsoft',
      name: res.profile.name,
      uuid: res.profile.id,
      access_token: res.accessToken,
      client_token: randomUUID(),
      user_properties: {},
      expires_at: res.expiresAt || null
    };
    store.set('account', account);
    store.set('lastUsername', res.profile.name);
    store.set('preferOnline', true);

    return { ok: true, account, profile: res.profile, steps };
  } catch (e) {
    const msg = String(e?.message || e || '');
    return { ok: false, error: msg };
  }
});

ipcMain.handle('account:logout', async () => {
  store.set('account', null);
  msSession = null;
  msFlow = null;
  try { await logoutMicrosoft({ app }); } catch (_) {}
  try { store.set('preferOnline', false); } catch (_) {}
  return true;
});

ipcMain.handle('ms:validate', async () => {
  return { ok: false, disabled: true, error: 'online_auth_disabled' };
  try {
    // Always validate/refresh through cached refresh-token flow.
    const restored = await validateCachedSession({ app });
    if (!restored?.ok) return { ok: false, error: restored?.error || 'NO_SESSION' };

    if (restored?.entitlements?.ownsJava === false) {
      store.set('account', null);
      store.set('preferOnline', false);
      return { ok: false, error: 'Лицензия Minecraft (Java Edition) не найдена' };
    }

    const account = {
      type: 'microsoft',
      name: restored.profile.name,
      uuid: restored.profile.id,
      access_token: restored.accessToken,
      client_token: randomUUID(),
      user_properties: {},
      expires_at: restored.expiresAt || null
    };
    store.set('account', account);
    store.set('lastUsername', restored.profile.name);
    return { ok: true, name: restored.profile.name, uuid: restored.profile.id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('mc:lastLog', async () => {
  try {
    const tail = getRingText().slice(-8000);
    return { ok: true, logPath: runLogPath || '', tail };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), logPath: runLogPath || '', tail: '' };
  }
});

ipcMain.handle('servers:syncJava', async () => {
  try {
    const gameDir = resolveActiveGameDir(store.store);
    await ensureJavaServerInList(gameDir);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('profile:exists', async (_e, versionId) => {
  try {
    const settings = store.store;
    const gameDir = resolveActiveGameDir(settings);
    const v = String(versionId || '').trim();
    if (!v) return { ok: true, exists: false };
    const verDir = path.join(gameDir, 'versions', v);
    const jsonPath = path.join(verDir, `${v}.json`);
    if (!fs.existsSync(jsonPath)) return { ok: true, exists: false };
    const jarPath = path.join(verDir, `${v}.jar`);
    if (fs.existsSync(jarPath)) return { ok: true, exists: true };
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return { ok: true, exists: !!parsed?.inheritsFrom };
    } catch {
      return { ok: true, exists: false };
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e), exists: false };
  }
});

ipcMain.handle('mc:isInstalled', async (_e, payloadOrVersion) => {
  const payload = (payloadOrVersion && typeof payloadOrVersion === 'object')
    ? payloadOrVersion
    : { version: payloadOrVersion };

  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  const requested = payload?.version || settings.lastVersion || 'latest-release';

  const resolved = await resolveVersion(requested);

  const installed = isVersionInstalled(gameDir, resolved.id);

  return { installed, version: resolved.id, type: resolved.type, requested };
});

ipcMain.handle('mc:launch', async (_e, payload) => {
  const settings = store.store;
  const gameDir = resolveActiveGameDir(settings);
  const sockets = applyDownloadMode(settings.downloadMode);
  const prepareOnly = !!payload?.prepareOnly;
  sendLog('info', `Профиль загрузки: ${settings.downloadMode || 'fast'} (${sockets} соединений)`);

  // Create a fresh log file for this run
  const { logDir, logPath } = openRunLog(gameDir);
  sendMcState('logpath', { logDir, logPath });

  const username = (payload?.username || settings.lastUsername || 'Player').trim() || 'Player';
  const requested = payload?.version || settings.lastVersion || 'latest-release';
  const resolved = await resolveVersionForLaunch(requested, gameDir);

  // Fabric selection can come in as a compound id like "fabric-loader-<loader>-<mc>".
  // Normalize so:
  // - Java selection uses the underlying Minecraft version (mc)
  // - Launch uses our local nocflat profile id (fabric-loader-...-nocflat)
  // This prevents MCLC from trying to install a non-existent "fabric-loader-..." vanilla version.
  let javaMcId = resolved.id;
  try {
    const reqStr = String(requested || resolved.id || '');
    const isFabricCompound = reqStr.startsWith('fabric-loader-') || String(resolved.id || '').startsWith('fabric-loader-');
    if (isFabricCompound) {
      // fabric-loader-<loaderVersion>-<mcVersion>
      const parts = reqStr.split('-');
      const loaderVersion = parts[2];
      const mcVersion = parts.slice(3).join('-');
      if (loaderVersion && mcVersion) {
        javaMcId = mcVersion;
        const fabricProfileId = `fabric-loader-${loaderVersion}-${mcVersion}`;
        const localId = `${fabricProfileId}-nocflat`;

        // ensure the profile exists before any other checks
        await installFabricForVersion(mcVersion, gameDir, loaderVersion);

        // switch resolved id to the local profile for the rest of launch flow
        resolved.id = localId;
      }
    }
  } catch (e) {
    sendLog('warn', `Fabric normalize failed: ${String(e?.message || e)}`);
  }

  if (isUnstableOptiFineProfile(resolved.id)) {
    // User asked for a guaranteed installation flow even when only unstable releases exist.
    // We still warn loudly, but we allow launch.
    const msg = `Выбран pre-билд OptiFine (${resolved.id}). Он может быть нестабилен и крашить.`;
    sendLog('warn', msg);
    sendMcState('warn', { warning: msg, version: resolved.id, logPath });
  }

  await ensureJavaServerInList(gameDir);

  // persist selection (store resolved minecraft id to avoid compound/typo strings)
  store.set('lastVersion', resolved.id);
  store.set('lastUsername', username);

  // Online auth disabled: always launch in offline mode for now.
  let auth = Authenticator.getAuth(username);
  try {
    const skinPath = await resolveOfflineSkinPath(settings, gameDir, username);
    if (skinPath) applyOfflineSkinPack(gameDir, skinPath, resolved.id);
  } catch (e) {
    sendLog('warn', `Offline skin resolve failed: ${String(e?.message || e)}`);
  }

  if (launcherClient) {
    try { launcherClient.kill(); } catch (_) {}
    launcherClient = null;
  }

  resetAggProgress();
  launcherClient = new Client();
  launcherClient.on('debug', (e) => sendLog('debug', String(e)));
  launcherClient.on('data', (e) => sendLog('info', String(e)));
  launcherClient.on('download-status', (e) => {
    // Aggregate progress across multiple stages
    const agg = updateAggProgress(e, gameDir) || {};
    const now = Date.now();
    // throttle UI spam a bit
    if (now - (aggProgress.lastSent || 0) < 50 && e?.current && e?.total) return;
    aggProgress.lastSent = now;
    win?.webContents.send('download', { ...e, ...agg, installPath: gameDir });
  });

  let javaPath = (payload?.javaPath ?? settings.javaPath ?? '').trim();
  const minMem = Number(payload?.memoryMinMB ?? settings.memoryMinMB ?? 1024);
  const maxMem = Number(payload?.memoryMaxMB ?? settings.memoryMaxMB ?? 4096);

  // Only ensure Java when user explicitly starts install/play
  try {
    const resolvedJava = await resolveJavaPathForMc(javaMcId, javaPath, gameDir);
    if (resolvedJava) {
      javaPath = resolvedJava;
      store.set('javaPath', javaPath);
    }
  } catch (e) {
    sendLog('error', e?.stack || String(e));
    sendMcState('error', { error: String(e?.message || e), version: resolved.id, logPath, tail: getRingText().slice(-6000) });
    return { ok: false, error: String(e?.message || e) };
  }

  // For Forge/OptiFine custom profiles ensure inherited vanilla base exists.
  try {
    await ensureBaseForCustomProfileIfNeeded(gameDir, resolved.id, javaPath);
  } catch (e) {
    sendLog('error', e?.stack || String(e));
    sendMcState('error', { error: String(e?.message || e), version: resolved.id, logPath, tail: getRingText().slice(-6000) });
    return { ok: false, error: String(e?.message || e) };
  }

  // Ensure modded profile json has all inherited fields for mclc downloader.
  hydrateVersionJsonForLaunch(gameDir, resolved.id);
  await ensureLaunchWrapperArtifacts(gameDir, resolved.id);

  // Fabric: make sure the version jar is the actual fabric-loader jar (otherwise KnotClient CNFE).
  try {
    await ensureFabricLoaderMainJar(gameDir, resolved.id, (m) => sendLog('info', m));
  } catch (e) {
    sendLog('warn', `Fabric preflight failed: ${String(e?.message || e)}`);
  }

  // Universal fix: launch flattened profile for inherited Forge/OptiFine chains.
  let launchVersionId = buildFlattenedVersionProfile(gameDir, resolved.id);

  // For Forge/ModLauncher profiles, "inheritsFrom" chains often split required GAME args
  // (like --accessToken/--version) into the parent json. We use nocflat to preserve them.
  // Only fall back to the original profile if the flattened one is clearly missing game args.
  try {
    const lm = readLocalVersionJson(gameDir, launchVersionId);
    const isModLauncher = String(lm?.mainClass || '').includes('cpw.mods');
    const hasGameArgs = Array.isArray(lm?.arguments?.game) ? lm.arguments.game.length > 0 : !!lm?.minecraftArguments;
    if (isModLauncher && !hasGameArgs && launchVersionId !== resolved.id) {
      launchVersionId = resolved.id;
      sendLog('warn', `ModLauncher detected but nocflat has no game args -> fallback to original profile ${launchVersionId}`);
    }
  } catch (_) {}

  await ensureLaunchWrapperArtifacts(gameDir, launchVersionId);

  let launchMeta = null;
  // Java policy for LaunchWrapper profiles:
  // old MC (<=1.16) -> Java 8, modern MC keeps its required Java (e.g. 17/21).
  try {
    launchMeta = readLocalVersionJson(gameDir, launchVersionId);
    if (String(launchMeta?.mainClass || '').trim() === 'net.minecraft.launchwrapper.Launch') {
      const baseForRule = normalizeBaseMcVersion(launchVersionId);
      const requiredForMc = guessJavaMajorForMc(baseForRule || launchVersionId);
      const targetMajor = requiredForMc >= 17 ? requiredForMc : 8;
      const currentMajor = getJavaMajor(javaPath);
      if (currentMajor !== targetMajor) {
        const j = await resolveJavaPathForMc(launchVersionId, '', gameDir, targetMajor);
        if (j) {
          javaPath = j;
          store.set('javaPath', javaPath);
          sendLog('info', `Профиль ${launchVersionId} использует LaunchWrapper — выбираю Java ${targetMajor}`);
        }
      }
    }
  } catch (e) {
    sendLog('warn', `Java override for LaunchWrapper failed: ${String(e?.message || e)}`);
  }

  // Final sanitize of launch json args before runtime.
  try {
    const lj = readLocalVersionJson(gameDir, launchVersionId);
    if (lj) writeLocalVersionJson(gameDir, launchVersionId, dedupeSingletonGameArgs(lj));
  } catch (_) {}

  // show progress only if not installed yet
  const alreadyInstalled = isVersionInstalled(gameDir, launchVersionId);

  const runtimeNativesDir = path.join(gameDir, 'natives', '_runtime');
  try { fs.rmSync(runtimeNativesDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.mkdirSync(runtimeNativesDir, { recursive: true }); } catch (_) {}

  const opts = {
    root: gameDir,
    authorization: auth,
    version: { number: launchVersionId, type: resolved.type },
    memory: {
      min: `${Math.max(512, minMem)}M`,
      max: `${Math.max(1024, maxMem)}M`
    }
  };
  if (javaPath) opts.javaPath = javaPath;

  if (settings.fpsBoostMode) {
    const fpsPreset = String(settings.fpsPreset || 'safe');
    applyFpsBoostOptions(gameDir, fpsPreset);
    const gcPause = fpsPreset === 'aggressive' ? '25' : (fpsPreset === 'balanced' ? '35' : '45');
    opts.customArgs = [
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      `-XX:MaxGCPauseMillis=${gcPause}`,
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC'
    ];

}

// Top10: JVM preset (stable/fps/lowend)
const preset = String(settings.jvmPreset || 'auto');
if (preset && preset !== 'auto') {
  const baseArgs = Array.isArray(opts.customArgs) ? opts.customArgs.slice() : [];
  const stableArgs = ['-XX:+UseG1GC','-XX:+DisableExplicitGC','-Dfile.encoding=UTF-8'];
  const fpsArgs = ['-XX:+UseG1GC','-XX:+ParallelRefProcEnabled','-XX:MaxGCPauseMillis=35','-XX:+UnlockExperimentalVMOptions','-XX:+DisableExplicitGC','-Dfile.encoding=UTF-8'];
  const lowArgs = ['-XX:+UseG1GC','-XX:MaxGCPauseMillis=60','-XX:+DisableExplicitGC','-Dfile.encoding=UTF-8'];
  const add = preset === 'fps' ? fpsArgs : (preset === 'lowend' ? lowArgs : stableArgs);
  opts.customArgs = Array.from(new Set(baseArgs.concat(add)));
}

// Universal native extraction path to avoid EPERM/lock issues on per-version native dirs.
  const forcedClasses = collectForcedClasses(gameDir, launchVersionId);
  opts.overrides = { detached: false, natives: runtimeNativesDir };
  if (String(launchMeta?.mainClass || '').trim() === 'net.minecraft.launchwrapper.Launch' && forcedClasses.length) {
    opts.overrides.classes = forcedClasses;
    sendLog('info', `Forced classpath entries: ${forcedClasses.length}`);
  }

  // OptiFine safe boot: force shaders OFF to avoid startup crashes.
  if (String(launchVersionId).toLowerCase().includes('optifine')) {
    ensureOptiFineSafeBoot(gameDir);
  }

  // OptiFine LaunchWrapper needs explicit legacy args; without them it can NPE in acceptOptions.
  if (String(launchMeta?.mainClass || '').trim() === 'net.minecraft.launchwrapper.Launch') {
    // IMPORTANT:
    // minecraft-launcher-core already generates a full legacy arg set for LaunchWrapper profiles
    // from the version json. Injecting another full set here causes duplicated options like
    // --gameDir/--assetsDir and the game fails with MultipleArgumentsForOptionException.
    //
    // Only inject legacy args if the profile json does NOT already declare them.
    const hasArgInArr = (arr, key) => Array.isArray(arr) && arr.some((x) => x === key);
    const gameArgsArr = launchMeta?.arguments?.game;
    const mcArgsStr = String(launchMeta?.minecraftArguments || '');
    const alreadyHasLegacy =
      hasArgInArr(gameArgsArr, '--gameDir') ||
      hasArgInArr(gameArgsArr, '--assetsDir') ||
      hasArgInArr(gameArgsArr, '--assetIndex') ||
      mcArgsStr.includes('--gameDir') ||
      mcArgsStr.includes('--assetsDir') ||
      mcArgsStr.includes('--assetIndex');

    if (!alreadyHasLegacy) {
      const ai = launchMeta?.assetIndex?.id || normalizeBaseMcVersion(launchVersionId);
      opts.customLaunchArgs = [
        '--username', auth?.name || username,
        '--version', launchVersionId,
        '--gameDir', gameDir,
        '--assetsDir', path.join(gameDir, 'assets'),
        '--assetIndex', String(ai),
        '--uuid', auth?.uuid || '0',
        '--accessToken', auth?.access_token || '0',
        '--userType', auth?.meta?.type || 'legacy'
      ];
      sendLog('info', 'LaunchWrapper: injected legacy args (profile had none)');
    } else {
      sendLog('info', 'LaunchWrapper: legacy args already present in profile — skipping injection');
    }
  }

  // ForgeBootstrap (modern Forge) uses a JPMS boot layer. On Java 17/21 it can crash with split-packages
  // (e.g. guava vs failureaccess) unless we pass the same bootstrap system properties as the official launcher.
  // Apply a safe baseline when mainClass is net.minecraftforge.bootstrap.*
  try {
    const mcMain = String(launchMeta?.mainClass || '').trim();
    const isForgeBootstrap = mcMain.startsWith('net.minecraftforge.bootstrap.');
    if (isForgeBootstrap) {
      const baseArgs = Array.isArray(opts.customArgs) ? opts.customArgs.slice() : [];
      const hasProp = (k) => baseArgs.some((a) => typeof a === 'string' && a.startsWith(k));

      const libDir = path.join(gameDir, 'libraries');
      if (!hasProp('-DlibraryDirectory=')) baseArgs.push(`-DlibraryDirectory=${libDir}`);

      if (!hasProp('-DignoreList=')) {
        baseArgs.push('-DignoreList=' + [
          'bootstraplauncher',
          'securejarhandler',
          'asm-commons', 'asm-util', 'asm-analysis', 'asm-tree', 'asm',
          'JarJarFileSystems',
          'client-extra',
          'fmlcore',
          'javafmllanguage',
          'lowcodelanguage',
          'mclanguage',
          'forge-',
          // Split-package offenders (JPMS)
          'failureaccess',
          'guava',
          'com.google.common',
          'com.google.common.util.concurrent.internal',
          'jorbis'
        ].join(','));
      }

      // Merge JNA modules if present (ForgeBootstrap expects this in some setups)
      if (!hasProp('-DmergeModules=')) {
        let jna = '';
        let jnaPlat = '';
        try {
          const jnaRoot = path.join(libDir, 'net', 'java', 'dev', 'jna');
          const pickOne = (sub) => {
            const base = path.join(jnaRoot, sub);
            if (!fs.existsSync(base)) return '';
            const vers = fs.readdirSync(base).filter((x) => !x.startsWith('.')).sort().reverse();
            for (const v of vers) {
              const dir = path.join(base, v);
              if (!fs.existsSync(dir)) continue;
              const files = fs.readdirSync(dir).filter((f) => f.startsWith(sub + '-') && f.endsWith('.jar'));
              if (files[0]) return files[0];
            }
            return '';
          };
          if (fs.existsSync(jnaRoot)) {
            jna = pickOne('jna');
            jnaPlat = pickOne('jna-platform');
          }
        } catch (_) {}
        if (jna && jnaPlat) baseArgs.push(`-DmergeModules=${jna},${jnaPlat}`);
      }

      opts.customArgs = baseArgs;
      sendLog('info', 'ForgeBootstrap safety props applied');
    }
  } catch (e) {
    sendLog('warn', `ForgeBootstrap props apply failed: ${String(e?.message || e)}`);
  }

  // Modern Forge/ModLauncher on Java 17/21 may require explicit module opens.
  // Without these, SecureJarHandler/UnionFS can throw InaccessibleObjectException.
  try {
    const mcMain = String(launchMeta?.mainClass || '').trim();
    const isModLauncher = mcMain.includes('cpw.mods.bootstraplauncher.') || mcMain.includes('cpw.mods.modlauncher.') || mcMain.includes('cpw.mods') || mcMain.includes('net.neoforged') || mcMain.includes('net.minecraftforge');
    const javaMajor = getJavaMajor(javaPath);
    if (isModLauncher && javaMajor >= 17) {
      const baseArgs = Array.isArray(opts.customArgs) ? opts.customArgs.slice() : [];
      const hasOpen = (val) => baseArgs.some((a) => typeof a === 'string' && a.includes(val));

      // Targeted fix for the crash from the log:
      // InaccessibleObjectException: java.base does not "opens java.lang.invoke" to unnamed module
      if (!hasOpen('java.base/java.lang.invoke=ALL-UNNAMED')) {
        baseArgs.push('--add-opens', 'java.base/java.lang.invoke=ALL-UNNAMED');
      }

      // Common safe baseline used by many launchers for Forge on Java 17+.
      const extras = [
        'java.base/java.lang=ALL-UNNAMED',
        'java.base/java.util=ALL-UNNAMED',
        'java.base/java.io=ALL-UNNAMED',
        'java.base/java.net=ALL-UNNAMED',
        'java.base/java.nio=ALL-UNNAMED',
        'java.base/sun.nio.ch=ALL-UNNAMED',
        'java.base/java.util.jar=ALL-UNNAMED'
      ];
      for (const v of extras) {
        if (!hasOpen(v)) baseArgs.push('--add-opens', v);
      }

      opts.customArgs = baseArgs;
      sendLog('info', 'Forge/ModLauncher JPMS opens applied');
    }
  } catch (e) {
    sendLog('warn', `Forge/ModLauncher JPMS opens apply failed: ${String(e?.message || e)}`);
  }

  // NeoForge / Forge (FML/ModLauncher) expect system property `libraryDirectory` to point to the libraries directory.
  // Some version JSONs use a placeholder like ${library_directory} which minecraft-launcher-core does NOT substitute.
  // We append an explicit override here (last one wins) to prevent: "libraryDirectory must point to the libraries directory".
  try {
    const mcMain = String(launchMeta?.mainClass || '').trim();
    const isForgeLike = /neoforge/i.test(launchVersionId) || /forge/i.test(launchVersionId) ||
      /net\.neoforged\./i.test(mcMain) || /net\.minecraftforge\./i.test(mcMain) || /cpw\.mods\./i.test(mcMain);

    if (isForgeLike) {
      const libDir = path.join(gameDir, 'libraries');
      const baseArgs = Array.isArray(opts.customArgs) ? opts.customArgs.slice() : [];

      // Always append (override)
      baseArgs.push(`-DlibraryDirectory=${libDir}`);

      // Harmless safety flag (also reduces noisy exploit warnings in some packs)
      if (!baseArgs.some((a) => typeof a === 'string' && a.startsWith('-Dlog4j2.formatMsgNoLookups='))) {
        baseArgs.push('-Dlog4j2.formatMsgNoLookups=true');
      }

      opts.customArgs = baseArgs;
      sendLog('info', 'Forge/NeoForge: applied -DlibraryDirectory override');
    }
  } catch (e) {
    sendLog('warn', `Forge/NeoForge libraryDirectory apply failed: ${String(e?.message || e)}`);
  }

  sendLog('info', `${prepareOnly ? 'Подготовка' : (alreadyInstalled ? 'Запуск' : 'Установка')} Minecraft: ${resolved.id} -> ${launchVersionId} (dir: ${gameDir})`);
  sendMcState(prepareOnly ? 'preparing' : (alreadyInstalled ? 'launching' : 'installing'), { version: resolved.id, launchVersion: launchVersionId });

  try {
    if (!alreadyInstalled) sendMcState('downloading', { version: resolved.id });

    const startedAt = Date.now();
    let closedHandled = false;

    // Auto-quarantine obviously incompatible mods (helps when user has one shared mods folder for different MC versions)
    try {
      const lm = launchMeta || readLocalVersionJson(gameDir, launchVersionId);
      const isForge = String(lm?.mainClass || '').includes('cpw.mods') || String(lm?.id || launchVersionId).toLowerCase().includes('forge');
      if (isForge) {
        const baseMc = normalizeBaseMcVersion(lm?.id || launchVersionId);
        const q = quarantineModsThatLookWrong(gameDir, baseMc);
        if (q?.moved) sendLog('warn', `Найдены несовместимые моды (другая версия MC) — перемещено в mods.__noc_incompatible: ${q.moved}`);
      }
    } catch (_) {}

    // Safe launch (no mods)
    const modsPath = path.join(gameDir, 'mods');
    const modsDisabledPath = path.join(gameDir, 'mods.__noc_disabled');
    let safeModsRenamed = false;
    try {
      if (settings.safeLaunchNoMods && fs.existsSync(modsPath) && !fs.existsSync(modsDisabledPath)) {
        fs.renameSync(modsPath, modsDisabledPath);
        safeModsRenamed = true;
        sendLog('info', 'Safe launch: mods temporarily disabled');
      }
    } catch (e) { sendLog('warn', `Safe launch: cannot disable mods: ${String(e?.message||e)}`); }

    const onClose = (code) => {
      if (closedHandled) return;
      closedHandled = true;
      try {
        if (safeModsRenamed && !fs.existsSync(modsPath) && fs.existsSync(modsDisabledPath)) fs.renameSync(modsDisabledPath, modsPath);
      } catch (_) {}

      if (shouldHideOnLaunch) restoreLauncherAfterGame();
      const durMs = Date.now() - startedAt;
      const ring = getRingText();
      const ringLower = ring.toLowerCase();
      let hint = '';
      if (ringLower.includes('glfw error 65542') || ringLower.includes('opengl')) {
        hint = 'Похоже, проблема с OpenGL/драйверами видеокарты. Обнови драйвер GPU (NVIDIA/AMD/Intel) и попробуй снова.';
      } else if (ringLower.includes('unsupportedclassversionerror') || ringLower.includes('has been compiled by a more recent version')) {
        hint = 'Неподходящая Java. Если у тебя заполнен Java Path в настройках — очисти его и запусти снова (лаунчер скачает нужную).';
      } else if (ringLower.includes('could not create the java virtual machine') || ringLower.includes('invalid maximum heap size')) {
        hint = 'Похоже, не хватает памяти/неверно задана RAM. Уменьши Max RAM (например 2048–4096MB).';
      } else if (ringLower.includes('failed to download') || ringLower.includes('unable to download')) {
        hint = 'Сбой загрузки файлов (интернет/антивирус/права). Попробуй сменить папку игры на D:\\Games\\NocLauncher и добавь её в исключения антивируса.';
      }
      sendMcState('closed', {
        code,
        version: resolved.id,
        durationMs: durMs,
        logPath,
        hint,
        tail: ring.slice(-6000)
      });
    };

    const attachProc = (proc) => {
      if (!proc || typeof proc.on !== 'function') return;
      if (proc?.pid) sendLog('info', `Minecraft PID: ${proc.pid}`);

      try {
        if (proc?.stdout) proc.stdout.on('data', (d) => sendLog('mc', String(d)));
        if (proc?.stderr) proc.stderr.on('data', (d) => sendLog('mc-err', String(d)));
      } catch (_) {}

      proc.on('close', onClose);
      proc.on('exit', onClose);
      proc.on('error', (err) => {
        sendLog('error', err?.stack || String(err));
        if (shouldHideOnLaunch) restoreLauncherAfterGame();
        sendMcState('error', { error: String(err?.message || err), version: resolved.id, logPath, tail: getRingText().slice(-6000) });
      });
    };

    // "Закрыть лаунчер после запуска" трактуем как "скрыть в фон".
    // Процесс лаунчера должен жить, чтобы корректно вернуться после выхода из игры.
    const shouldHideOnLaunch = (payload?.hideOnLaunch !== false) || payload?.closeLauncherOnLaunch === true || settings.closeLauncherOnGameStart === true;

    const launchResult = launcherClient.launch(opts);

    if (prepareOnly) {
      let proc = launchResult;
      if (proc && typeof proc.then === 'function') proc = await proc;
      if (proc?.pid) sendLog('info', `Minecraft PID (prepare): ${proc.pid}`);

      const startedAt = Date.now();
      const timeoutMs = 6 * 60 * 1000;
      while (!isVersionInstalled(gameDir, resolved.id) && (Date.now() - startedAt) < timeoutMs) {
        await new Promise((r) => setTimeout(r, 1200));
      }

      try { proc?.kill?.(); } catch (_) {}
      try { launcherClient?.kill?.(); } catch (_) {}
      launcherClient = null;

      if (!isVersionInstalled(gameDir, resolved.id)) {
        throw new Error(`Не удалось полностью подготовить ваниллу ${resolved.id} за отведённое время`);
      }

      sendMcState('prepared', { version: resolved.id, logPath });
      return { ok: true, prepared: true, version: resolved.id, type: resolved.type, installedBefore: alreadyInstalled };
    }

    if (launchResult && typeof launchResult.then === 'function') {
      launchResult.then((proc) => {
        attachProc(proc);
        sendMcState('launched', { version: resolved.id, logPath });
        // "Закрыть лаунчер" во время игры = убрать окно (не завершать процесс),
        // чтобы после выхода из игры можно было вернуть лаунчер обратно.
        if (shouldHideOnLaunch) {
          hideLauncherForGame();
        }
      }).catch((err) => {
        restoreLauncherAfterGame();
        sendLog('error', err?.stack || String(err));
        sendMcState('error', { error: String(err?.message || err), version: resolved.id, logPath, tail: getRingText().slice(-6000) });
      });
    } else {
      attachProc(launchResult);
      sendMcState('launched', { version: resolved.id, logPath });
      if (shouldHideOnLaunch) {
        hideLauncherForGame();
      }
    }

    return { ok: true, version: resolved.id, type: resolved.type, installedBefore: alreadyInstalled };
  } catch (err) {
    restoreLauncherAfterGame();
    sendLog('error', err?.stack || String(err));
    sendMcState('error', { error: String(err?.message || err), version: resolved.id, logPath, tail: getRingText().slice(-6000) });
    return { ok: false, error: String(err?.message || err) };
  }
});

function compareSemverLike(a, b) {
  const pa = String(a || '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b || '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return y - x;
  }
  return 0;
}

function normalizeBaseMcVersion(v) {
  // Many profiles include additional tokens (forge/fabric loader, custom suffixes).
  // We need the *Minecraft* base version, not the loader version.
  const raw = String(v || '').trim();
  const s = raw.replace(/-nocflat$/i, '');

  // Fabric profiles look like: fabric-loader-<loaderVersion>-<mcVersion>
  // Example: fabric-loader-0.18.4-1.16.5
  let m = s.match(/^fabric-loader-[^-]+-(\d+\.\d+(?:\.\d+)?)/i);
  if (m) return m[1];

  // Quilt profiles look like: quilt-loader-<loaderVersion>-<mcVersion>
  m = s.match(/^quilt-loader-[^-]+-(\d+\.\d+(?:\.\d+)?)/i);
  if (m) return m[1];

  // Forge profiles typically start with the MC version.
  m = s.match(/^(\d+\.\d+(?:\.\d+)?)/);
  if (m) return m[1];

  // Fallback: if the string contains any MC-like version token, prefer the LAST one
  // (helps with ids that have both loader+mc versions in them).
  const all = [...s.matchAll(/(\d+\.\d+(?:\.\d+)?)/g)].map(x => x[1]);
  if (all.length) return all[all.length - 1];

  return s;
}

function isUnstableOptiFineProfile(versionId) {
  const s = String(versionId || '').toLowerCase();
  return s.includes('optifine') && s.includes('_pre');
}

function quarantineModsThatLookWrong(gameDir, mcVersion) {
  try {
    const modsDir = path.join(gameDir, 'mods');
    if (!fs.existsSync(modsDir)) return { moved: 0 };
    const files = fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith('.jar'));
    if (!files.length) return { moved: 0 };

    const target = String(mcVersion || '').trim();
    if (!target) return { moved: 0 };

    const outDir = path.join(gameDir, 'mods.__noc_incompatible');
    let moved = 0;
    for (const f of files) {
      const name = String(f);
      // Try to detect an explicit MC version in filename.
      const m = name.match(/(\d+\.\d+(?:\.\d+)?)/);
      if (!m) continue;
      const declared = m[1];
      // If mod jar clearly targets a DIFFERENT MC version, quarantine it.
      if (declared !== target) {
        ensureDir(outDir);
        try {
          fs.renameSync(path.join(modsDir, f), path.join(outDir, f));
          moved++;
        } catch {}
      }
    }
    return { moved };
  } catch {
    return { moved: 0 };
  }
}


async function getFabricVersionsForMc(mcVersion) {
  // Fabric meta: https://meta.fabricmc.net/
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'NocLauncher' } });
  if (!r.ok) throw new Error(`Fabric meta HTTP ${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('Нет Fabric loader версий');
  const stable = arr.filter(x => x?.loader?.stable);
  const pool = (stable.length ? stable : arr)
    .filter(x => x?.loader?.version)
    .sort((a,b) => compareSemverLike(String(a.loader.version), String(b.loader.version)));
  const pick = pool[0] || arr[0];
  return {
    loaderVersion: pick.loader.version,
    intermediaryVersion: pick.intermediary?.version || null,
  };
}

async function getFabricLoaderVersionRobust(mcVersion) {
  // 1) Try exact mcVersion.
  try {
    const v = await getFabricVersionsForMc(mcVersion);
    return v.loaderVersion;
  } catch (_) {
    // continue
  }

  // 2) Try closest release within same minor from Mojang manifest.
  const manifest = await getManifest().catch(() => store.get('manifestCache'));
  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
  const mm = String(mcVersion).match(/^(\d+\.\d+)/)?.[1] || '';
  const candidates = versions
    .filter(v => v?.type === 'release' && typeof v?.id === 'string' && (mm ? v.id.startsWith(mm + '.') : true))
    .map(v => v.id)
    .sort((a,b) => compareSemverLike(a,b)); // desc

  for (const cand of candidates) {
    try {
      const v = await getFabricVersionsForMc(cand);
      return v.loaderVersion;
    } catch (_) {
      // try next
    }
  }

  // 3) Last resort: get latest loader version overall.
  try {
    const url = 'https://meta.fabricmc.net/v2/versions/loader';
    const r = await fetch(url, { headers: { 'User-Agent': 'NocLauncher' } });
    if (r.ok) {
      const arr = await r.json();
      const stable = Array.isArray(arr) ? arr.filter(x => x?.stable) : [];
      const pick = (stable[0] || (Array.isArray(arr) ? arr[0] : null));
      if (pick?.version) return pick.version;
    }
  } catch (_) {}

  throw new Error('Не удалось подобрать Fabric Loader');
}

async function getFabricInstallerVersion() {
  const url = 'https://meta.fabricmc.net/v2/versions/installer';
  const r = await fetch(url, { headers: { 'User-Agent': 'NocLauncher' } });
  if (!r.ok) throw new Error(`Fabric installer meta HTTP ${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('Нет Fabric installer версий');
  const stable = arr.filter(x => x?.stable);
  const pool = (stable.length ? stable : arr)
    .filter(x => x?.version)
    .sort((a,b) => compareSemverLike(String(a.version), String(b.version)));
  return (pool[0] || arr[0]).version;
}

async function getFabricInstallerVersionsList() {
  const url = 'https://meta.fabricmc.net/v2/versions/installer';
  const r = await fetch(url, { headers: { 'User-Agent': 'NocLauncher' } });
  if (!r.ok) throw new Error(`Fabric installer meta HTTP ${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('Нет Fabric installer версий');
  const stable = arr.filter(x => x?.stable);
  const pool = (stable.length ? stable : arr).filter(x => x?.version)
    .sort((a,b) => compareSemverLike(String(a.version), String(b.version)));
  // Return unique versions in order.
  const out = [];
  const seen = new Set();
  for (const x of pool) {
    const v = String(x.version);
    if (!seen.has(v)) { out.push(v); seen.add(v); }
  }
  return out;
}


async function getFabricLoaderComboRobust(requestedMcVersion, preferredLoaderVersion) {
  // Returns { mcVersionUsed, loaderVersion } ensuring the combo exists on Fabric meta.
  // 1) Exact
  try {
    // If user picked a specific loader version, validate it exists for this MC version.
    if (preferredLoaderVersion) {
      const pv = String(preferredLoaderVersion).trim();
      // This endpoint returns 200 if combo exists, 404 otherwise.
      const checkUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(requestedMcVersion)}/${encodeURIComponent(pv)}`;
      await fetchJson(checkUrl, loadSettings());
      return { mcVersionUsed: requestedMcVersion, loaderVersion: pv };
    }
    const v = await getFabricVersionsForMc(requestedMcVersion);
    return { mcVersionUsed: requestedMcVersion, loaderVersion: v.loaderVersion };
  } catch (_) {} 

  // 2) Closest release in same minor
  const manifest = await getManifest().catch(() => store.get('manifestCache'));
  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
  const mm = String(requestedMcVersion).match(/^(\d+\.\d+)/)?.[1] || '';
  const candidates = versions
    .filter(v => v?.type === 'release' && typeof v?.id === 'string' && (mm ? v.id.startsWith(mm + '.') : true))
    .map(v => v.id)
    .sort((a,b) => compareSemverLike(a,b));

  for (const cand of candidates) {
    try {
      const v = await getFabricVersionsForMc(cand);
      return { mcVersionUsed: cand, loaderVersion: v.loaderVersion };
    } catch (_) {}
  }

  throw new Error('Не удалось подобрать связку Fabric для этой версии Minecraft');
}

function parseFabricVersionId(versionId) {
  // fabric-loader-<loader>-<mc>
  const m = /^fabric-loader-([^-]+)-(.+)$/.exec(String(versionId || ''));
  if (!m) return null;
  let mc = m[2];
  // our local profiles may add "-nocflat" suffix
  if (mc.endsWith('-nocflat')) mc = mc.slice(0, -'-nocflat'.length);
  return { loaderVersion: m[1], mcVersion: mc };
}

async function ensureFabricLoaderMainJar(gameDir, versionId, log = () => {}) {
  const parsed = parseFabricVersionId(versionId);
  if (!parsed) return;
  const { loaderVersion } = parsed;

  // 1) Ensure fabric-loader jar exists in libraries
  const libRel = path.join('net', 'fabricmc', 'fabric-loader', loaderVersion, `fabric-loader-${loaderVersion}.jar`);
  const libAbs = path.join(gameDir, 'libraries', libRel);
  await fs.promises.mkdir(path.dirname(libAbs), { recursive: true });

  if (!fs.existsSync(libAbs) || fs.statSync(libAbs).size < 50_000) {
    const url = `https://maven.fabricmc.net/net/fabricmc/fabric-loader/${loaderVersion}/fabric-loader-${loaderVersion}.jar`;
    log(`[Fabric] Download fabric-loader ${loaderVersion}`);
    await downloadFile(url, libAbs);
  }

  // 2) Ensure versions/<id>/<id>.jar is the loader jar (MCLC expects a "main jar" per version)
  const verDir = path.join(gameDir, 'versions', versionId);
  const verJar = path.join(verDir, `${versionId}.jar`);
  await fs.promises.mkdir(verDir, { recursive: true });

  const needCopy = !fs.existsSync(verJar) || fs.statSync(verJar).size != fs.statSync(libAbs).size;
  if (needCopy) {
    log(`[Fabric] Sync version jar -> fabric-loader-${loaderVersion}.jar`);
    await fs.promises.copyFile(libAbs, verJar);
  }
}

async function installFabricForVersion(mcVersion, gameDir, javaPathHint, preferredLoaderVersion) {
  // Ironclad approach:
  // 1) Ensure base vanilla files are installed.
  // 2) Resolve a Fabric loader version that exists for the chosen (or closest) MC version.
  // 3) Try to obtain the launcher profile JSON from Fabric Meta.
  //    If /profile/json is unavailable (HTTP 404), fall back to /v2/versions/loader/{mc}/{loader}
  //    and build a compatible profile from launcherMeta.
  // This removes dependency on Fabric Installer CLI (which varies across builds and can break on enums/launcher types).
  const settings = loadSettings();
  const { mcVersionUsed, loaderVersion } = await getFabricLoaderComboRobust(mcVersion, preferredLoaderVersion);
  const javaPath = await resolveJavaPathForMc(mcVersionUsed, javaPathHint || '', gameDir);
  await ensureVanillaInstalledBase(mcVersionUsed, gameDir, javaPath);

  async function fetchFabricProfile(mcV, loaderV) {
    const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcV)}/${encodeURIComponent(loaderV)}/profile/json`;
    try {
      return await fetchJson(profileUrl, settings);
    } catch (e) {
      // If profile endpoint isn't available for this combo, try meta endpoint and build profile.
      const msg = String(e?.message || e);
      if (!/HTTP\s*404/i.test(msg)) throw e;

      const metaUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcV)}/${encodeURIComponent(loaderV)}`;
      const meta = await fetchJson(metaUrl, settings);

      const lm = meta?.launcherMeta || {};
      const libs = [];
      const lmLibs = lm?.libraries;
      if (Array.isArray(lmLibs)) {
        libs.push(...lmLibs);
      } else if (lmLibs && typeof lmLibs === 'object') {
        // Merge common/client/server arrays if present
        for (const key of ['common', 'client', 'server']) {
          if (Array.isArray(lmLibs[key])) libs.push(...lmLibs[key]);
        }
      }

      const mainClass =
        lm?.mainClass?.client ||
        lm?.mainClass?.server ||
        lm?.mainClass ||
        'net.fabricmc.loader.impl.launch.knot.KnotClient';

      // Safety: some meta responses (or older endpoints) may omit the Fabric Loader jar itself.
      // If it's missing, the JVM fails with:
      // "Could not find or load main class net.fabricmc.loader.impl.launch.knot.KnotClient".
      // Force-add fabric-loader + intermediary (if not already present) to keep Fabric launches resilient.
      const hasLib = (namePrefix) => libs.some(l => {
        const n = l?.name;
        return typeof n === 'string' && n.startsWith(namePrefix);
      });
      // IMPORTANT: Fabric artifacts live on Fabric Maven, not Mojang's.
      // If we add a lib without `url`, our downloader falls back to libraries.minecraft.net,
      // causing the jar to never download and KnotClient to be missing at launch.
      const FABRIC_MAVEN = 'https://maven.fabricmc.net/';
      if (!hasLib('net.fabricmc:fabric-loader:')) {
        libs.push({ name: `net.fabricmc:fabric-loader:${loaderV}`, url: FABRIC_MAVEN });
      }
      if (!hasLib('net.fabricmc:intermediary:')) {
        libs.push({ name: `net.fabricmc:intermediary:${mcV}`, url: FABRIC_MAVEN });
      }

      const now = new Date().toISOString();
      const id = `fabric-loader-${loaderV}-${mcV}`;

      const profile = {
        id,
        inheritsFrom: mcV,
        time: now,
        releaseTime: now,
        type: 'release',
        mainClass,
        arguments: lm?.arguments || undefined,
        libraries: libs.filter(Boolean),
      };

      return profile;
    }
  }

  // Try chosen loader first, then fall back to other stable loaders for that MC version (newest first).
  let profile = null;
  let usedLoader = loaderVersion;
  const tried = new Set();
  async function tryWith(loaderV) {
    const k = `${mcVersionUsed}@@${loaderV}`;
    if (tried.has(k)) return null;
    tried.add(k);
    try {
      return await fetchFabricProfile(mcVersionUsed, loaderV);
    } catch (e) {
      throw e;
    }
  }

  try {
    profile = await tryWith(loaderVersion);
  } catch (e) {
    // Get a list of loaders for mcVersionUsed and try stable ones from newest to oldest.
    const listUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersionUsed)}`;
    const arr = await fetchJson(listUrl, settings);
    const stable = Array.isArray(arr) ? arr.filter(x => x?.loader?.stable && x?.loader?.version) : [];
    const pool = (stable.length ? stable : (Array.isArray(arr) ? arr : []))
      .filter(x => x?.loader?.version)
      .map(x => String(x.loader.version))
      .sort((a, b) => compareSemverLike(a, b)); // compareSemverLike sorts DESC
    let lastErr = e;
    for (const lv of pool) {
      try {
        profile = await tryWith(lv);
        usedLoader = lv;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!profile) {
      const msg = String(lastErr?.message || lastErr || e?.message || e);
      throw new Error(`Fabric profile HTTP 404 (и фолбэки не помогли): ${msg}`);
    }
  }

  const versionId = String(profile?.id || `fabric-loader-${usedLoader}-${mcVersionUsed}`);

  // Final guard: ensure the Fabric Loader main class actually exists on the resolved classpath.
  // Some profiles (or custom version IDs) can be missing the loader jar in `libraries`,
  // which leads to ClassNotFoundException for KnotClient.
  if (profile && Array.isArray(profile.libraries)) {
    const hasLib = (namePrefix) => profile.libraries.some(l => {
      const n = l?.name;
      return typeof n === 'string' && n.startsWith(namePrefix);
    });
    const FABRIC_MAVEN = 'https://maven.fabricmc.net/';
    if (!hasLib('net.fabricmc:fabric-loader:')) {
      profile.libraries.push({ name: `net.fabricmc:fabric-loader:${usedLoader}`, url: FABRIC_MAVEN });
    }
    if (!hasLib('net.fabricmc:intermediary:')) {
      profile.libraries.push({ name: `net.fabricmc:intermediary:${mcVersionUsed}`, url: FABRIC_MAVEN });
    }
  }

  const versionsDir = path.join(gameDir, 'versions');
  const outDir = path.join(versionsDir, versionId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${versionId}.json`), JSON.stringify(profile, null, 2), 'utf8');

  // Pre-download libraries so "Установить" completes fully.
  try {
    await ensureLibrariesForVersion(gameDir, versionId);
  } catch (e) {
    // Not fatal; the game can still fetch libs at launch, but we log it.
    sendLog(`Fabric libs prefetch warn: ${String(e?.message || e)}`);
  }

  // Hard guarantee: ensure the Fabric Loader jar (the one that contains KnotClient)
  // exists as the version "main jar" too. Some launch flows rely on the version
  // jar being on the classpath (and our generated profiles can be consumed that way).
  // This prevents: ClassNotFoundException: net.fabricmc.loader.impl.launch.knot.KnotClient
  try {
    const loaderRel = mavenPathFromName(`net.fabricmc:fabric-loader:${usedLoader}`);
    if (loaderRel) {
      const loaderJar = path.join(gameDir, 'libraries', loaderRel);
      const targetJar = path.join(outDir, `${versionId}.jar`);
      if (fs.existsSync(loaderJar) && (!fs.existsSync(targetJar) || !isProbablyValidJar(targetJar))) {
        fs.copyFileSync(loaderJar, targetJar);
      }
    }
  } catch (e) {
    sendLog(`Fabric version jar sync warn: ${String(e?.message || e)}`);
  }

  return { versionId, mcVersionUsed, loaderVersion: usedLoader };
}

async function ensureLibrariesForVersion(gameDir, versionId) {
  const vj = readLocalVersionJson(gameDir, versionId);
  if (!vj || !Array.isArray(vj.libraries)) return;

  const libsDir = path.join(gameDir, 'libraries');
  fs.mkdirSync(libsDir, { recursive: true });

  for (const lib of vj.libraries) {
    const art = lib?.downloads?.artifact;
    let relPath = art?.path;
    let url = art?.url;

    if (!relPath) {
      relPath = mavenPathFromName(lib?.name);
    }
    if (!relPath) continue;

    if (!url) {
      const base = String(lib?.url || 'https://libraries.minecraft.net/').replace(/\/+$/, '') + '/';
      url = base + relPath;
    }

    const out = path.join(libsDir, relPath);
    if (fs.existsSync(out) && isProbablyValidJar(out)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await downloadFile(url, out);
  }
}

async function getForgeBuildsForMc(mcVersion) {
  const metaUrls = [
    'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
    // Mirror (BMCLAPI) — helps when the main maven is slow/unavailable.
    'https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/maven-metadata.xml'
  ];

  let xml = '';
  let lastErr = null;
  for (const url of metaUrls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'NocLauncher/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      if (t && t.includes('<version>')) { xml = t; break; }
    } catch (e) {
      lastErr = e;
    }
  }
  if (!xml) throw new Error(`Forge metadata недоступен: ${String(lastErr?.message || lastErr || '')}`);

  const re = /<version>([^<]+)<\/version>/g;
  const all = [];
  let m;
  while ((m = re.exec(xml)) !== null) all.push(m[1]);

  const prefix = `${mcVersion}-`;
  return all
    .filter(v => v.startsWith(prefix))
    .map(v => v.slice(prefix.length))
    .filter(Boolean)
    .sort(compareSemverLike);
}

async function installForgeForVersion(mcVersion, gameDir, javaPathHint, explicitForgeBuild) {
  const candidatesAll = await getForgeBuildsForMc(mcVersion);
  if (!candidatesAll.length) throw new Error(`Forge не найден для ${mcVersion}`);
  if (explicitForgeBuild && !candidatesAll.includes(explicitForgeBuild)) {
    throw new Error(`Forge ${explicitForgeBuild} не найден для ${mcVersion}`);
  }

  // We'll try a few candidates if the newest one is broken.
  const pool = explicitForgeBuild ? [String(explicitForgeBuild)] : candidatesAll.slice(0, 4);
  let lastErr = null;

  for (const forgeVer of pool) {
    try {
      const toolsDir = path.join(gameDir, '.noc-tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      const installerJar = path.join(toolsDir, `forge-${mcVersion}-${forgeVer}-installer.jar`);

      const rel = `net/minecraftforge/forge/${mcVersion}-${forgeVer}/forge-${mcVersion}-${forgeVer}-installer.jar`;
      const installerUrls = [
        `https://maven.minecraftforge.net/${rel}`,
        `https://bmclapi2.bangbang93.com/maven/${rel}`
      ];

      if (!fs.existsSync(installerJar) || !isProbablyValidJar(installerJar)) {
        let got = false;
        let dlErr = null;
        for (const u of installerUrls) {
          try {
            await downloadFile(u, installerJar);
            if (isProbablyValidJar(installerJar)) { got = true; break; }
          } catch (e) {
            dlErr = e;
          }
        }
        if (!got) throw dlErr || new Error('Не удалось скачать Forge installer');
      }

      const javaPath = await resolveJavaPathForMc(mcVersion, javaPathHint || '', gameDir);
      await ensureVanillaInstalledBase(mcVersion, gameDir, javaPath);

      let forgeInstalled = false;
      let instErr = null;
      const attemptArgs = [
        ['-jar', installerJar, '--installClient', gameDir],
        ['-jar', installerJar, '--installClient']
      ];

      await runWithOfficialMinecraftJunction(gameDir, async () => {
        const mapped = createMappedMinecraftEnv(gameDir, 'forge');

        for (const args of attemptArgs) {
          try {
            await execFileAsync(javaPath, args, { cwd: gameDir, env: mapped.env, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
            forgeInstalled = true;
            break;
          } catch (e) {
            instErr = e;
          }
        }
      });

      if (!forgeInstalled) {
        const err = String(instErr?.stderr || instErr?.stdout || instErr?.message || instErr);
        throw new Error(`Forge installer error: ${err.slice(0, 600)}`);
      }

      const versionsDir = path.join(gameDir, 'versions');
      const dirs = fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir) : [];
      const found = dirs
        .filter(d => d.includes(mcVersion) && d.toLowerCase().includes('forge') && d.includes(forgeVer))
        .sort((a, b) => (fs.statSync(path.join(versionsDir, b)).mtimeMs - fs.statSync(path.join(versionsDir, a)).mtimeMs))[0]
        || dirs
          .filter(d => d.includes(mcVersion) && d.toLowerCase().includes('forge'))
          .sort((a, b) => (fs.statSync(path.join(versionsDir, b)).mtimeMs - fs.statSync(path.join(versionsDir, a)).mtimeMs))[0];

      if (!found) throw new Error('Forge установлен, но профиль не найден');

      // Prefetch Forge libraries for smoother first launch.
      try { await ensureLibrariesForVersion(gameDir, found); } catch (e) {
        sendLog('warn', `Forge libs prefetch warning: ${String(e?.message || e)}`);
      }
      return { versionId: found, forgeVersion: forgeVer };
    } catch (e) {
      lastErr = e;
      if (explicitForgeBuild) break;
    }
  }

  throw lastErr || new Error('Не удалось установить Forge');
}

// =========================================================
// NeoForge (Java Edition)
//  - versions API: https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge
//  - installer jar: https://maven.neoforged.net/releases/net/neoforged/neoforge/<ver>/neoforge-<ver>-installer.jar
// =========================================================

async function fetchJsonFromFallback(urls, opts = {}) {
  const list = Array.isArray(urls) ? urls : [String(urls || '')];
  let lastErr = null;
  for (const url of list) {
    if (!url) continue;
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'NocLauncher/1.0',
          'Accept': 'application/json, text/plain, */*',
          ...(opts.headers || {})
        },
        ...(opts.fetch || {})
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Не удалось получить JSON');
}

function mcToNeoForgeLine(mcVersion) {
  const s = String(mcVersion || '').trim();
  const parts = s.split('.').filter(Boolean);
  if (parts[0] === '1') parts.shift();
  if (parts.length === 1) parts.push('0');
  return parts.slice(0, 2).join('.');
}

async function getNeoForgeBuildsForMc(mcVersion, allowBetas = false) {
  const apiUrls = [
    'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
    // fallback (some installations use the k8s host)
    'https://maven.prod.k8s.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
  ];
  let versions = [];
  try {
    const j = await fetchJsonFromFallback(apiUrls);
    versions = Array.isArray(j?.versions) ? j.versions : [];
  } catch (e) {
    // Fallback: try maven-metadata.xml if API fails
    try {
      const metaUrls = [
        'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
        'https://maven.prod.k8s.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
      ];
      let xml = null;
      for (const u of metaUrls) {
        try {
          const r = await fetch(u, { headers: { 'User-Agent': 'NocLauncher/1.0' } });
          if (r.ok) { xml = await r.text(); break; }
        } catch (_) {}
      }
      if (xml) {
        const re = /<version>([^<]+)<\/version>/g;
        let m;
        while ((m = re.exec(xml)) !== null) versions.push(m[1]);
      }
    } catch (_) {}
  }

  const line = mcToNeoForgeLine(mcVersion);
  const prefix = `${line}.`;
  const filtered = versions.filter(v => String(v).startsWith(prefix));
  const stable = filtered.filter(v => !/beta/i.test(String(v)));
  const beta = filtered.filter(v => /beta/i.test(String(v)));
  stable.sort(compareSemverLike);
  beta.sort(compareSemverLike);
  const ordered = stable.length ? stable.concat(beta) : beta;
  return allowBetas ? ordered : (stable.length ? stable : []);
}

async function installNeoForgeForVersion(mcVersion, gameDir, javaPathHint, explicitNeoForgeVersion, allowBetas = false) {
  const buildsAll = await getNeoForgeBuildsForMc(mcVersion, true);
  if (!buildsAll.length) {
    throw new Error(`NeoForge не найден для Minecraft ${mcVersion}`);
  }

  const preferred = allowBetas ? buildsAll : buildsAll.filter(v => !/beta/i.test(String(v)));
  const candidates = preferred.length ? preferred : buildsAll;

  const pool = explicitNeoForgeVersion ? [String(explicitNeoForgeVersion)] : candidates;

  // We'll try a few candidates if the latest one is broken.
  const tryList = explicitNeoForgeVersion ? pool : pool.slice(0, 4);

  let lastErr = null;
  for (const neoVer of tryList) {
    try {
      const toolsDir = path.join(gameDir, '.noc-tools');
      fs.mkdirSync(toolsDir, { recursive: true });

      const installerRel = `net/neoforged/neoforge/${neoVer}/neoforge-${neoVer}-installer.jar`;
      const installerCandidates = [
        `https://maven.neoforged.net/releases/${installerRel}`,
        `https://maven.prod.k8s.neoforged.net/releases/${installerRel}`
      ];

      const installerJar = path.join(toolsDir, `neoforge-${mcVersion}-${neoVer}-installer.jar`);
      if (!fs.existsSync(installerJar) || !isProbablyValidJar(installerJar)) {
        // Try mirrors
        let got = false;
        let dlErr = null;
        for (const u of installerCandidates) {
          try {
            await downloadFile(u, installerJar);
            if (isProbablyValidJar(installerJar)) { got = true; break; }
          } catch (e) {
            dlErr = e;
          }
        }
        if (!got) throw dlErr || new Error('Не удалось скачать NeoForge installer');
      }

      const javaPath = await resolveJavaPathForMc(mcVersion, javaPathHint || '', gameDir);
      await ensureVanillaInstalledBase(mcVersion, gameDir, javaPath);

      let ok = false;
      let instErr = null;
      const attemptArgs = [
        ['-jar', installerJar, '--install-client', gameDir],
        ['-jar', installerJar, '--installClient', gameDir],
        ['-jar', installerJar, '--install-client'],
        ['-jar', installerJar, '--installClient']
      ];

      await runWithOfficialMinecraftJunction(gameDir, async () => {
        const mapped = createMappedMinecraftEnv(gameDir, 'neoforge');
        for (const args of attemptArgs) {
          try {
            await execFileAsync(javaPath, args, { cwd: gameDir, env: mapped.env, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
            ok = true;
            break;
          } catch (e) {
            instErr = e;
          }
        }
      });

      if (!ok) {
        const err = String(instErr?.stderr || instErr?.stdout || instErr?.message || instErr || 'unknown');
        throw new Error(`NeoForge installer error: ${err.slice(0, 600)}`);
      }

      const versionsDir = path.join(gameDir, 'versions');
      const dirs = fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir) : [];
      const found = dirs
        .filter(d => d.toLowerCase().includes('neoforge') && d.includes(neoVer))
        .sort((a, b) => (fs.statSync(path.join(versionsDir, b)).mtimeMs - fs.statSync(path.join(versionsDir, a)).mtimeMs))[0];

      if (!found) throw new Error('NeoForge установлен, но профиль не найден');

      // Prefetch libs for smoother first launch.
      try { await ensureLibrariesForVersion(gameDir, found); } catch (_) {}

      return { versionId: found, neoforgeVersion: neoVer };
    } catch (e) {
      lastErr = e;
      // If user explicitly chose the build, do not fallback.
      if (explicitNeoForgeVersion) break;
    }
  }

  throw lastErr || new Error('Не удалось установить NeoForge');
}

function isProbablyValidJar(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const st = fs.statSync(filePath);
    if (!st || st.size < 100 * 1024) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b; // PK zip header
  } catch {
    return false;
  }
}

function guessOptiFineMcVersionFromName(filePath) {
  try {
    const n = path.basename(String(filePath || '')).toLowerCase();
    const m = n.match(/(\d+\.\d+(?:\.\d+)?)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function isOptiFineJarForMc(filePath, mcVersion) {
  const guessed = guessOptiFineMcVersionFromName(filePath);
  if (!guessed) return false;
  return String(guessed) === String(mcVersion);
}

async function getOptiFineBuildsForMc(mcVersion) {
  const listUrl = 'https://bmclapi2.bangbang93.com/optifine/versionList';
  const r = await fetch(listUrl, { headers: { 'User-Agent': 'NocLauncher/1.0' } });
  if (!r.ok) throw new Error('Не удалось получить список OptiFine');
  const arr = await r.json();
  return (arr || [])
    .filter(x => String(x.mcversion) === String(mcVersion))
    .map(x => ({
      mcversion: String(x.mcversion),
      type: String(x.type || ''),
      patch: String(x.patch || ''),
      filename: String(x.filename || ''),
      isPre: /pre/i.test(String(x.patch || x.filename || ''))
    }))
    .sort((a, b) => Number(a.isPre) - Number(b.isPre));
}

async function resolveOptiFineInstaller(mcVersion, gameDir, jarPath, explicitBuild) {
  if (jarPath && fs.existsSync(jarPath)) {
    if (!isProbablyValidJar(jarPath)) throw new Error('Выбранный OptiFine .jar повреждён или невалиден');
    if (!isOptiFineJarForMc(jarPath, mcVersion)) {
      throw new Error(`Этот OptiFine installer не для Minecraft ${mcVersion}. Выбери правильный .jar`);
    }
    return jarPath;
  }

  const toolsDir = path.join(gameDir, '.noc-tools', 'optifine');
  fs.mkdirSync(toolsDir, { recursive: true });

  // Cleanup stale installers for other MC versions
  for (const f of fs.readdirSync(toolsDir)) {
    if (!f.toLowerCase().endsWith('.jar')) continue;
    const fp = path.join(toolsDir, f);
    if (!isOptiFineJarForMc(fp, mcVersion)) {
      try { fs.rmSync(fp, { force: true }); } catch (_) {}
    }
  }

  // Reuse cached installer first (exact MC match only)
  const cached = fs.readdirSync(toolsDir).find(f => f.toLowerCase().endsWith('.jar') && isOptiFineJarForMc(path.join(toolsDir, f), mcVersion));
  if (cached) {
    const cp = path.join(toolsDir, cached);
    if (isProbablyValidJar(cp)) return cp;
    try { fs.rmSync(cp, { force: true }); } catch (_) {}
  }

  const rows = await getOptiFineBuildsForMc(mcVersion);
  if (!rows.length) throw new Error(`Для ${mcVersion} нет OptiFine в авто-источнике. Выбери .jar вручную.`);

  let stableFirst = rows;
  if (explicitBuild?.type && explicitBuild?.patch) {
    stableFirst = rows.filter(x => x.type === explicitBuild.type && x.patch === explicitBuild.patch);
    if (!stableFirst.length) {
      throw new Error(`OptiFine ${explicitBuild.type} ${explicitBuild.patch} не найден для ${mcVersion}`);
    }
  }

  let lastErr = null;
  for (const pick of stableFirst.slice(0, 6)) {
    const dlUrl = `https://bmclapi2.bangbang93.com/optifine/${encodeURIComponent(pick.mcversion)}/${encodeURIComponent(pick.type)}/${encodeURIComponent(pick.patch)}`;
    const dst = path.join(toolsDir, pick.filename || `OptiFine_${mcVersion}_${pick.type}_${pick.patch}.jar`);
    try {
      await downloadFile(dlUrl, dst);
      if (isProbablyValidJar(dst) && isOptiFineJarForMc(dst, mcVersion)) return dst;
      try { fs.rmSync(dst, { force: true }); } catch (_) {}
      lastErr = new Error('Загруженный OptiFine jar невалиден или не для выбранной версии Minecraft');
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`Авто-скачивание OptiFine не удалось: ${String(lastErr?.message || lastErr || 'unknown')}`);
}

async function ensureVanillaInstalledBase(mcVersion, gameDir, javaPath) {
  if (isVersionInstalled(gameDir, mcVersion)) return;

  // One-click auto-prepare: install required vanilla files, then stop game process.
  const client = new Client();
  const opts = {
    root: gameDir,
    authorization: Authenticator.getAuth('Player'),
    version: { number: mcVersion, type: 'release' },
    memory: { min: '512M', max: '1024M' },
    javaPath,
    overrides: { detached: false }
  };

  let proc = client.launch(opts);
  if (proc && typeof proc.then === 'function') proc = await proc;

  const startedAt = Date.now();
  const timeoutMs = 6 * 60 * 1000;
  while (!isVersionInstalled(gameDir, mcVersion) && (Date.now() - startedAt) < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1200));
  }

  try { proc?.kill?.(); } catch (_) {}
  await new Promise((r) => setTimeout(r, 1000));

  if (!isVersionInstalled(gameDir, mcVersion)) {
    throw new Error(`Не удалось подготовить базовую версию ${mcVersion} для OptiFine/Forge`);
  }
}

async function ensureLauncherProfilesFiles(mcDir) {
  const launcherProfiles = path.join(mcDir, 'launcher_profiles.json');
  const launcherProfilesMs = path.join(mcDir, 'launcher_profiles_microsoft_store.json');
  const defaultProfilesPayload = JSON.stringify({
    profiles: {},
    selectedProfile: '(Default)',
    authenticationDatabase: {},
    selectedUser: {}
  }, null, 2);

  if (!fs.existsSync(launcherProfiles)) fs.writeFileSync(launcherProfiles, defaultProfilesPayload);
  if (!fs.existsSync(launcherProfilesMs)) fs.writeFileSync(launcherProfilesMs, defaultProfilesPayload);
}

async function runWithOfficialMinecraftJunction(gameDir, fn) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const realMc = path.join(appData, '.minecraft');
  const backupMc = path.join(appData, '.minecraft.noclauncher.bak');

  let hadOriginal = false;
  try {
    if (fs.existsSync(backupMc)) {
      try { fs.rmSync(backupMc, { recursive: true, force: true }); } catch (_) {}
    }

    if (fs.existsSync(realMc)) {
      hadOriginal = true;
      fs.renameSync(realMc, backupMc);
    }

    fs.symlinkSync(gameDir, realMc, 'junction');
    ensureLauncherProfilesFiles(gameDir);

    return await fn({ appData, realMc, backupMc });
  } finally {
    try { if (fs.existsSync(realMc)) fs.rmSync(realMc, { recursive: true, force: true }); } catch (_) {}
    if (hadOriginal && fs.existsSync(backupMc)) {
      try { fs.renameSync(backupMc, realMc); } catch (_) {}
    }
  }
}

function createMappedMinecraftEnv(gameDir, tag) {
  const envRoot = path.join(gameDir, '.noc-tools', `${tag || 'mapped'}-env`);
  const fakeAppData = path.join(envRoot, 'Roaming');
  const mcLink = path.join(fakeAppData, '.minecraft');
  fs.mkdirSync(fakeAppData, { recursive: true });

  try { fs.rmSync(mcLink, { recursive: true, force: true }); } catch (_) {}
  fs.symlinkSync(gameDir, mcLink, 'junction');
  ensureLauncherProfilesFiles(mcLink);

  return { env: { ...process.env, APPDATA: fakeAppData }, mcLink };
}

async function runOptiFineInstallerMappedToGameDir(javaPath, installerJar, gameDir) {
  try {
    await runWithOfficialMinecraftJunction(gameDir, async () => {
      const mapped = createMappedMinecraftEnv(gameDir, 'optifine');
      await execFileAsync(javaPath, ['-jar', installerJar, 'install'], { env: mapped.env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    });
  } catch (e) {
    const err = String(e?.stderr || e?.stdout || e?.message || e);
    throw new Error(`OptiFine installer error: ${err.slice(0, 500)}`);
  }
}

async function installOptiFineForVersion(mcVersion, gameDir, javaPathHint, jarPath, explicitBuild) {
  const installerJar = await resolveOptiFineInstaller(mcVersion, gameDir, jarPath, explicitBuild);
  const javaPath = await resolveJavaPathForMc(mcVersion, javaPathHint || '', gameDir);

  await ensureVanillaInstalledBase(mcVersion, gameDir, javaPath);
  await runOptiFineInstallerMappedToGameDir(javaPath, installerJar, gameDir);

  const versionsDir = path.join(gameDir, 'versions');
  const dirs = fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir) : [];
  const found = dirs
    .filter(d => d.includes(mcVersion) && d.toLowerCase().includes('optifine'))
    .sort((a, b) => (fs.statSync(path.join(versionsDir, b)).mtimeMs - fs.statSync(path.join(versionsDir, a)).mtimeMs))[0];

  if (!found) throw new Error('OptiFine профиль не найден после установки');
  return { versionId: found };
}


ipcMain.handle('versions:list', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const mf = await getVersionManifest(settings, gameDir);

  const kind = String(payload?.kind || 'all'); // release/snapshot/all
  const q = String(payload?.q || '').toLowerCase().trim();
  let items = Array.isArray(mf.versions) ? mf.versions : [];

  if (kind === 'release') items = items.filter(v => v.type === 'release');
  if (kind === 'snapshot') items = items.filter(v => v.type === 'snapshot');
  if (q) items = items.filter(v => String(v.id).toLowerCase().includes(q));

  // return latest markers too
  return { ok: true, latest: mf.latest || {}, versions: items.slice(0, 5000) };
});

ipcMain.handle('forge:versions', async (_e, payload) => {
  try {
    const requested = payload?.mcVersion || store.get('lastVersion') || 'latest-release';
    const normalized = normalizeBaseMcVersion(requested);
    const resolved = await resolveVersion(normalized);
    const builds = await getForgeBuildsForMc(resolved.id);
    return { ok: true, mcVersion: resolved.id, builds };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), builds: [] };
  }
});

ipcMain.handle('neoforge:versions', async (_e, payload) => {
  try {
    const requested = payload?.mcVersion || store.get('lastVersion') || 'latest-release';
    const normalized = normalizeBaseMcVersion(requested);
    const resolved = await resolveVersion(normalized);
    const allowBetas = !!payload?.allowBetas;
    const builds = await getNeoForgeBuildsForMc(resolved.id, allowBetas);
    return { ok: true, mcVersion: resolved.id, builds };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), builds: [] };
  }
});


ipcMain.handle('fabric:versions', async (_e, payload) => {
  try {
    const requested = payload?.mcVersion || store.get('lastVersion') || 'latest-release';
    const normalized = normalizeBaseMcVersion(requested);
    const resolved = await resolveVersion(normalized);
    const v = await getFabricVersionsForMc(resolved.id);
    const installerVersion = await getFabricInstallerVersion();
    return { ok: true, mcVersion: resolved.id, ...v, installerVersion };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});



ipcMain.handle('optifine:versions', async (_e, payload) => {
  try {
    const requested = payload?.mcVersion || store.get('lastVersion') || 'latest-release';
    const normalized = normalizeBaseMcVersion(requested);
    const resolved = await resolveVersion(normalized);
    const builds = await getOptiFineBuildsForMc(resolved.id);
    return { ok: true, mcVersion: resolved.id, builds };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), builds: [] };
  }
});

ipcMain.handle('forge:install', async (_e, payload) => {
  try {
    const settings = store.store;
    const gameDir = resolveActiveGameDir(settings);
    const requested = payload?.mcVersion || settings.lastVersion || 'latest-release';
    const normalized = normalizeBaseMcVersion(requested);
    const resolved = await resolveVersion(normalized);
    const out = await installForgeForVersion(resolved.id, gameDir, settings.javaPath, payload?.forgeBuild || settings.selectedForgeBuild || '');
    return { ok: true, ...out, mcVersion: resolved.id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('neoforge:install', async (_e, payload) => {
  try {
    const settings = store.store;
    const gameDir = resolveActiveGameDir(settings);
    const requested = payload?.mcVersion || settings.lastVersion || 'latest-release';
    const normalized = normalizeBaseMcVersion(requested);
    const resolved = await resolveVersion(normalized);
    const allowBetas = !!payload?.allowBetas;
    const out = await installNeoForgeForVersion(
      resolved.id,
      gameDir,
      settings.javaPath,
      payload?.neoforgeVersion || settings.selectedNeoForgeVersion || '',
      allowBetas
    );
    return { ok: true, ...out, mcVersion: resolved.id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});


ipcMain.handle('fabric:install', async (_e, payload) => {
  try {
    const settings = store.store;
    const gameDir = resolveActiveGameDir(settings);
    const requested = payload?.mcVersion || settings.lastVersion || 'latest-release';
    const normalized = normalizeBaseMcVersion(requested);
    const resolved = await resolveVersion(normalized);
    const loaderVersion = payload?.loaderVersion || settings.selectedFabricLoader || '';
    const out = await installFabricForVersion(resolved.id, gameDir, settings.javaPath, loaderVersion);
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});



ipcMain.handle('optifine:install', async (_e, payload) => {
  try {
    const settings = store.store;
    const gameDir = resolveActiveGameDir(settings);
    const requested = payload?.mcVersion || settings.lastVersion || 'latest-release';
    const normalized = normalizeBaseMcVersion(requested);
    const resolved = await resolveVersion(normalized);
    const explicitBuild = payload?.optiFineBuild || settings.selectedOptiFineBuild || null;
    const out = await installOptiFineForVersion(resolved.id, gameDir, settings.javaPath, payload?.jarPath, explicitBuild);
    return { ok: true, ...out, mcVersion: resolved.id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('profiles:listInstalled', async () => {
  try {
    const settings = store.store;
    const gameDir = resolveActiveGameDir(settings);
    const versionsDir = path.join(gameDir, 'versions');
    if (!fs.existsSync(versionsDir)) return { ok: true, profiles: [] };
    const dirs = fs.readdirSync(versionsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

    const profiles = [];
    for (const v of dirs) {
      const base = path.join(versionsDir, v);
      const jsonPath = path.join(base, `${v}.json`);
      if (!fs.existsSync(jsonPath)) continue;

      let parsed = null;
      try { parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (_) {}

      // Detect loader type. IMPORTANT: check neoforge BEFORE forge ("neoforge" contains "forge").
      let kind = 'vanilla';
      const low = v.toLowerCase();
      if (low.includes('fabric-loader')) kind = 'fabric';
      else if (low.includes('neoforge')) kind = 'neoforge';
      else if (low.includes('optifine')) kind = 'optifine';
      else if (low.includes('forge')) kind = 'forge';

      // Determine base Minecraft version (for loader profiles it is usually inheritsFrom)
      const baseVersion = (parsed?.inheritsFrom && String(parsed.inheritsFrom)) ? String(parsed.inheritsFrom) : v;

      // Installed heuristic: jar exists OR json inheritsFrom (loader profile) OR vanilla json exists.
      let installed = fs.existsSync(path.join(base, `${v}.jar`));
      if (!installed) installed = !!parsed; // at least has json
      if (!installed) installed = !!parsed?.inheritsFrom;

      if (installed) profiles.push({ id: v, kind, baseVersion });
    }

    profiles.sort((a,b)=> a.id < b.id ? 1 : -1);
    return { ok: true, profiles };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), profiles: [] };
  }
});

ipcMain.handle('mc:stop', async () => {
  if (!launcherClient) return true;
  try {
    launcherClient.kill();
  } catch (e) {
    // ignore
  }
  launcherClient = null;
  return true;
});

// --- Auth: Official Microsoft (premium) login via prismarine-auth ---
ipcMain.handle('auth:status', async (_e, payload) => {
  const userId = (payload && payload.userId) ? String(payload.userId) : 'default'
  if (!pendingAuth || pendingAuth.userId !== userId) return { ok: true, status: 'idle' }
  return {
    ok: true,
    status: pendingAuth.state,
    userId,
    hasCode: false,
    userCode: null,
    verificationUri: null,
    error: pendingAuth.error || null
  }
})

ipcMain.handle('auth:begin', async (_e, payload) => {
  try {
    const userId = (payload && payload.userId) ? String(payload.userId) : 'default'
    const forceRefresh = !!(payload && payload.forceRefresh)

    // If there is an auth already running, return its current status without restarting it.
    if (pendingAuth && pendingAuth.userId === userId && pendingAuth.state === 'pending') {
      return { ok: true, status: 'pending', userId, hasCode: !!pendingAuth.code }
    }

    // Start an interactive (browser) auth flow in background.
    pendingAuthId = null
    pendingAuth = { userId, state: 'pending', startedAt: Date.now(), error: null, result: null }

    // Run login asynchronously, store result/error and notify renderer.
    pendingAuth.promise = (async () => authService.loginMicrosoftJava({
      app,
      userId,
      forceRefresh,
      openBrowser: async (url) => {
        if (url) await shell.openExternal(String(url));
        return true;
      }
    }))()

    pendingAuth.promise
      .then((res) => {
        if (!pendingAuth || pendingAuth.userId !== userId) return
        pendingAuth.state = 'done'
        pendingAuth.result = res
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth:done', { ok: true, userId, profile: (res && res.profile) ? res.profile : null })
        }
      })
      .catch((err) => {
        if (!pendingAuth || pendingAuth.userId !== userId) return
        pendingAuth.state = 'error'
        pendingAuth.error = (err && err.message) ? err.message : String(err)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth:error', { ok: false, userId, error: pendingAuth.error })
        }
      })

    return { ok: true, status: 'started', userId }
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) }
  }
})

ipcMain.handle('auth:complete', async (_e, payload) => {
  try {
    const userId = (payload && payload.userId) ? String(payload.userId) : 'default'
    const timeoutMs = (payload && payload.timeoutMs) ? Number(payload.timeoutMs) : 250

    if (!pendingAuth || pendingAuth.userId !== userId) {
      return { ok: false, error: 'no_pending' }
    }

    const packDone = (res) => ({
      ok: true,
      profile: (res && res.profile) ? res.profile : null,
      accessToken: (res && res.accessToken) ? res.accessToken : null,
      raw: res
    })

    if (pendingAuth.state === 'done') {
      const res = pendingAuth.result
      pendingAuth = null
      pendingAuthId = null
      return packDone(res)
    }
    if (pendingAuth.state === 'error') {
      const err = pendingAuth.error
      pendingAuth = null
      pendingAuthId = null
      return { ok: false, error: err || 'auth_error' }
    }

    const t = new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), timeoutMs))
    const out = await Promise.race([pendingAuth.promise, t])

    if (out && out.__timeout) {
      return { ok: false, error: 'pending', hasCode: false, userCode: null, verificationUri: null }
    }

    // resolved
    pendingAuth = null
    pendingAuthId = null
    return packDone(out)
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) }
  }
})

ipcMain.handle('auth:cancel', async () => {
  pendingAuth = null;
  pendingAuthId = null;
  return { ok: true };
});

ipcMain.handle('auth:logout', async (_e, payload) => {
  try {
    const userId = String(payload?.userId || 'default');
    await logoutMicrosoft({ app, userId });
  } catch (_) {}
  store.delete('account');
  return { ok: true };
});
ipcMain.handle('resources:list', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const kind = String(payload?.kind || 'resourcepacks');
  const dir = getResourceDir(gameDir, kind);
  return { ok: true, kind, dir, files: listResourceFiles(dir) };
});

ipcMain.handle('resources:openFolder', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const kind = String(payload?.kind || 'resourcepacks');
  const dir = getResourceDir(gameDir, kind);
  await shell.openPath(dir);
  return { ok: true, path: dir };
});

ipcMain.handle('resources:installFromFile', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const kind = String(payload?.kind || 'resourcepacks');
  const dir = getResourceDir(gameDir, kind);
  const res = await dialog.showOpenDialog({ properties:['openFile','multiSelections'], filters:[{name:'Pack (.zip)', extensions:['zip']},{name:'All', extensions:['*']}] });
  if (res.canceled) return { ok:false, canceled:true };
  let installed = 0;
  for (const f of res.filePaths || []) {
    try {
      const dest = path.join(dir, path.basename(f));
      fs.copyFileSync(f, dest);
      installed++;
    } catch {}
  }
  return { ok:true, installed };
});

ipcMain.handle('resources:remove', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const kind = String(payload?.kind || 'resourcepacks');
  const dir = getResourceDir(gameDir, kind);
  const fn = String(payload?.filename || '');
  if (!fn) return { ok:false, error:'filename required' };
  const fp = path.join(dir, fn);
  if (!fp.startsWith(dir)) return { ok:false, error:'bad path' };
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { return { ok:false, error:String(e.message||e) }; }
  return { ok:true };
});

// --- Modrinth search/install for resourcepacks & shaderpacks ---
function kindToModrinthProjectType(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'shaderpacks' || k === 'shaderpack' || k === 'shaders') return 'shader';
  if (k === 'resourcepacks' || k === 'resourcepack' || k === 'textures') return 'resourcepack';
  return 'resourcepack';
}

ipcMain.handle('resources:searchModrinth', async (_e, payload) => {
  try {
    const settings = loadSettings();
    const query = String(payload?.query || '').trim();
    if (!query) return { ok: true, hits: [] };

    const kind = String(payload?.kind || 'resourcepacks');
    const projectType = kindToModrinthProjectType(kind);

    const requestedMc = String(payload?.mcVersion || '').trim();
    const { gameVersion } = currentLoaderAndVersion(settings);
    const gv = requestedMc || gameVersion || '';

    const facets = [];
    facets.push([`project_type:${projectType}`]);
    if (gv) facets.push([`versions:${gv}`]);

    const url = 'https://api.modrinth.com/v2/search?query=' + encodeURIComponent(query) +
      '&limit=' + encodeURIComponent(25) +
      '&facets=' + encodeURIComponent(JSON.stringify(facets));

    const j = await modrinthFetchJson(url);
    const hits = (j?.hits || []).map(h => ({
      project_id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      downloads: h.downloads,
      icon_url: h.icon_url
    }));
    return { ok: true, hits };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('resources:installModrinth', async (_e, payload) => {
  try {
    const settings = loadSettings();
    const gameDir = resolveActiveGameDir(settings);

    const kind = String(payload?.kind || 'resourcepacks');
    const projectId = String(payload?.projectId || '');
    if (!projectId) return { ok: false, error: 'projectId required' };

    const requestedMc = String(payload?.mcVersion || '').trim();
    const { gameVersion } = currentLoaderAndVersion(settings);
    const gv = requestedMc || gameVersion || '';

    const qs = [];
    if (gv) qs.push('game_versions=' + encodeURIComponent(JSON.stringify([gv])));
    const url = 'https://api.modrinth.com/v2/project/' + encodeURIComponent(projectId) + '/version' + (qs.length ? '?' + qs.join('&') : '');
    const versions = await modrinthFetchJson(url);
    if (!Array.isArray(versions) || !versions.length) return { ok: false, error: 'NO_COMPATIBLE_VERSION' };
    versions.sort((a,b)=>String(b.date_published||'').localeCompare(String(a.date_published||'')));
    const ver = versions[0];
    const files = Array.isArray(ver?.files) ? ver.files : [];
    const primary = files.find(f => f.primary && String(f.filename||'').toLowerCase().endsWith('.zip'))
      || files.find(f => String(f.filename||'').toLowerCase().endsWith('.zip'))
      || files[0];
    if (!primary?.url || !primary?.filename) return { ok: false, error: 'NO_FILE' };

    const dir = getResourceDir(gameDir, kind);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, primary.filename);
    await downloadFileWithManager(primary.url, dest, settings, { label: `${primary.filename}` });
    return { ok: true, file: path.basename(dest) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

// --- Disk scan + safe cleanup ---
async function dirSizeBytes(root) {
  let total = 0;
  async function walk(d) {
    let ents = [];
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const pth = path.join(d, e.name);
      try {
        if (e.isDirectory()) await walk(pth);
        else if (e.isFile()) {
          const st = await fsp.stat(pth);
          total += st.size;
        }
      } catch {}
    }
  }
  await walk(root);
  return total;
}

ipcMain.handle('cleanup:scan', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const targets = [
    { key:'logs', path: path.join(gameDir, 'logs') },
    { key:'crash-reports', path: path.join(gameDir, 'crash-reports') },
    { key:'natives_runtime', path: path.join(gameDir, 'natives', '_runtime') },
    { key:'exports', path: path.join(gameDir, 'exports') }
  ];

  const downloads = [];
  try {
    // find partial downloads (.part) under gameDir
    const stack = [gameDir];
    while (stack.length) {
      const d = stack.pop();
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes:true }); } catch { continue; }
      for (const e of ents) {
        const pth = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === 'saves') continue;
          if (e.name === 'resourcepacks' || e.name === 'shaderpacks' || e.name === 'mods') continue;
          stack.push(pth);
        } else if (e.isFile() && (e.name.endsWith('.part') || e.name.endsWith('.tmp'))) {
          downloads.push(pth);
        }
      }
    }
  } catch {}

  const sizes = {};
  for (const t of targets) {
    if (fs.existsSync(t.path)) sizes[t.key] = await dirSizeBytes(t.path);
    else sizes[t.key] = 0;
  }
  let partialBytes = 0;
  for (const f of downloads) {
    try { partialBytes += fs.statSync(f).size; } catch {}
  }

  return {
    ok: true,
    gameDir,
    targets: targets.map(t => ({ key: t.key, path: t.path, bytes: sizes[t.key] || 0 })),
    partial: { count: downloads.length, bytes: partialBytes }
  };
});

ipcMain.handle('cleanup:run', async (_e, payload) => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const what = payload?.what || {};
  let removed = 0;

  async function rmDirIf(k, pth) {
    if (!what[k]) return;
    try { await fsp.rm(pth, { recursive:true, force:true }); removed++; } catch {}
  }

  await rmDirIf('logs', path.join(gameDir,'logs'));
  await rmDirIf('crash-reports', path.join(gameDir,'crash-reports'));
  await rmDirIf('natives_runtime', path.join(gameDir,'natives','_runtime'));
  await rmDirIf('exports', path.join(gameDir,'exports'));

  if (what.partial) {
    // remove .part/.tmp
    try {
      const stack = [gameDir];
      while (stack.length) {
        const d = stack.pop();
        let ents = [];
        try { ents = await fsp.readdir(d, { withFileTypes:true }); } catch { continue; }
        for (const e of ents) {
          const pth = path.join(d, e.name);
          if (e.isDirectory()) {
            if (e.name === 'saves') continue;
            stack.push(pth);
          } else if (e.isFile() && (e.name.endsWith('.part') || e.name.endsWith('.tmp'))) {
            try { await fsp.rm(pth, { force:true }); removed++; } catch {}
          }
        }
      }
    } catch {}
  }

  return { ok: true, removed };
});

// --- Settings sync (options/servers/keybinds) between instances ---
function getMcConfigFiles(gameDir) {
  return [
    { key:'options', src: path.join(gameDir, 'options.txt') },
    { key:'servers', src: path.join(gameDir, 'servers.dat') },
    { key:'keys', src: path.join(gameDir, 'optionsof.txt') } // optifine, if exists
  ];
}

ipcMain.handle('settingsSync:apply', async (_e, payload) => {
  const settings = loadSettings();
  const base = settings?.gameDir || path.join(os.homedir(), '.noclauncher');
  const fromId = String(payload?.fromId || getActiveInstanceId(settings));
  const toId = String(payload?.toId || getActiveInstanceId(settings));
  const fromDir = fromId === 'default' ? base : path.join(base, 'instances', fromId);
  const toDir = toId === 'default' ? base : path.join(base, 'instances', toId);

  const files = getMcConfigFiles(fromDir);
  let copied = 0;
  for (const f of files) {
    try {
      if (fs.existsSync(f.src)) {
        const dest = path.join(toDir, path.basename(f.src));
        fs.copyFileSync(f.src, dest);
        copied++;
      }
    } catch {}
  }
  return { ok: true, copied };
});

// --- Instance health indicator ---
ipcMain.handle('instance:health', async () => {
  const settings = loadSettings();
  const gameDir = resolveActiveGameDir(settings);
  const issues = [];

  // Java path
  const jp = String(settings.javaPath || '').trim();
  if (!jp || !fs.existsSync(jp)) issues.push({ key:'java', level:'warn', message:'Java не найден (укажи путь или включи автоустановку)' });

  // Mods quick scan
  try {
    const modsRes = analyzeInstalledMods(settings, gameDir);
    if (modsRes?.issues?.length) {
      issues.push({ key:'mods', level:'warn', message:`Есть проблемы с модами: ${modsRes.issues.length}` });
    }
  } catch {}

  // Disk space
  try {
    const st = fs.statSync(gameDir);
    if (!st) {}
  } catch {
    issues.push({ key:'gamedir', level:'error', message:'Папка игры недоступна' });
  }

  return { ok: true, issues, status: issues.some(i=>i.level==='error') ? 'error' : (issues.length ? 'warn' : 'ok') };
});



// --- Veloren: simple nightly installer + launcher (Windows) ---
function velorenBaseDir(settings) {
  // Keep it per-instance, like MC, inside gameDir
  const gameDir = resolveActiveGameDir(settings);
  const base = path.join(gameDir, 'veloren');
  ensureDir(base);
  return base;
}
function velorenInstallDir(settings) {
  return path.join(velorenBaseDir(settings), 'install');
}
function velorenMetaPath(settings) {
  return path.join(velorenBaseDir(settings), 'veloren.install.json');
}
function readVelorenMeta(settings) {
  try {
    const p = velorenMetaPath(settings);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}
function writeVelorenMeta(settings, meta) {
  try {
    fs.writeFileSync(velorenMetaPath(settings), JSON.stringify(meta, null, 2), 'utf8');
  } catch {}
}
function findVelorenExe(installDir) {
  // Common names: veloren-voxygen.exe or voxygen.exe
  const candidates = [
    path.join(installDir, 'veloren-voxygen.exe'),
    path.join(installDir, 'voxygen.exe'),
    // sometimes nested one level
    path.join(installDir, 'bin', 'veloren-voxygen.exe'),
    path.join(installDir, 'bin', 'voxygen.exe'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;

  // fallback: search shallow
  try {
    const entries = fs.readdirSync(installDir);
    for (const fn of entries) {
      if (/voxygen\.exe$/i.test(fn)) return path.join(installDir, fn);
      if (/veloren-voxygen\.exe$/i.test(fn)) return path.join(installDir, fn);
    }
  } catch {}
  return '';
}
async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'NocLauncher',
      'Accept': 'application/vnd.github+json',
      ...headers
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.json();
}
async function getLatestVelorenNightlyWindowsZip() {
  // GitHub mirror has a "nightly" release with assets including nightly-windows-x86_64-....zip
  const api = 'https://api.github.com/repos/veloren/veloren/releases/tags/nightly';
  const rel = await fetchJson(api);
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const win = assets
    .filter(a => a && typeof a.name === 'string' && /nightly-windows-x86_64-.*\.zip$/i.test(a.name) && a.browser_download_url)
    .sort((a,b) => String(b.name).localeCompare(String(a.name))); // newest usually sorts higher
  if (!win.length) throw new Error('veloren_nightly_windows_asset_not_found');
  return { name: win[0].name, url: win[0].browser_download_url, tag: rel.tag_name || 'nightly', published: rel.published_at || '' };
}
async function extractZipTo(zipPath, destDir) {
  const AdmZipLocal = require('adm-zip');
  ensureDir(destDir);
  const zip = new AdmZipLocal(zipPath);
  zip.extractAllTo(destDir, true);
}

async function installVelorenLatestInternal(e, settings) {
  const base = velorenBaseDir(settings);
  const dlDir = path.join(base, 'downloads');
  ensureDir(dlDir);

  const info = await getLatestVelorenNightlyWindowsZip();
  const zipDest = path.join(dlDir, info.name);

  const send = (payload) => {
    try { e.sender.send('veloren:progress', payload); } catch {}
  };

  send({ stage: 'download', text: `Veloren: скачиваю ${info.name}` });
  await downloadFile(info.url, zipDest, (received, total) => {
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    send({ stage: 'download', pct, received, total, text: `Veloren: скачивание ${pct}%` });
  }, { label: info.name, allowResume: true, timeoutMs: 60000, maxAttempts: 5 });

  const installRoot = velorenInstallDir(settings);
  ensureDir(installRoot);

  const folderName = info.name.replace(/\.zip$/i, '');
  const destDir = path.join(installRoot, folderName);

  try {
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
  } catch {}

  send({ stage: 'extract', text: 'Veloren: распаковываю…', pct: 0 });
  await extractZipTo(zipDest, destDir);
  send({ stage: 'extract', text: 'Veloren: распаковано', pct: 100 });

  const exe = findVelorenExe(destDir);
  if (!exe) {
    writeVelorenMeta(settings, { version: info.tag, asset: info.name, installDir: destDir, exePath: '' });
    throw new Error('veloren_exe_not_found_after_extract');
  }

  writeVelorenMeta(settings, { version: info.tag, asset: info.name, installDir: destDir, exePath: exe, installedAt: new Date().toISOString() });
  return { ok: true, version: info.tag, asset: info.name, installDir: destDir, exePath: exe };
}

ipcMain.handle('veloren:status', async () => {
  const settings = loadSettings();
  const meta = readVelorenMeta(settings);
  const base = velorenBaseDir(settings);
  const installDir = velorenInstallDir(settings);
  if (meta?.installDir && fs.existsSync(meta.installDir)) {
    const exe = meta.exePath && fs.existsSync(meta.exePath) ? meta.exePath : findVelorenExe(meta.installDir);
    return { ok: true, installed: !!exe, version: meta.version || meta.asset || 'nightly', path: meta.installDir, exe };
  }
  // fallback: if install dir exists, try detect
  if (fs.existsSync(installDir)) {
    const exe = findVelorenExe(installDir);
    return { ok: true, installed: !!exe, version: 'unknown', path: installDir, exe };
  }
  return { ok: true, installed: false, version: '', path: base };
});

ipcMain.handle('veloren:openDir', async () => {
  const settings = loadSettings();
  const base = velorenBaseDir(settings);
  await shell.openPath(base);
  return { ok: true, path: base };
});

ipcMain.handle('veloren:installLatest', async (e) => {
  const settings = loadSettings();
  return await installVelorenLatestInternal(e, settings);
});

// Ensure latest nightly is installed (download on demand) and then launch.
ipcMain.handle('veloren:ensureLatestAndLaunch', async (e) => {
  const settings = loadSettings();
  const meta = readVelorenMeta(settings);

  const send = (payload) => {
    try { e.sender.send('veloren:progress', payload); } catch {}
  };

  let latest;
  try {
    send({ stage: 'check', text: 'Veloren: проверяю последнюю версию…', pct: 0 });
    latest = await getLatestVelorenNightlyWindowsZip();
  } catch (err) {
    // If we can't check latest, still try to launch existing install.
    const installDir = meta?.installDir || velorenInstallDir(settings);
    const exe = (meta?.exePath && fs.existsSync(meta.exePath)) ? meta.exePath : findVelorenExe(installDir);
    if (exe) {
      send({ stage: 'check', text: 'Veloren: не удалось проверить обновления, запускаю установленную…', pct: 100 });
      try {
        const p = childProcess.spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
        p.unref();
        return { ok: true, launched: true, updated: false, fallback: true };
      } catch (e2) {
        return { ok: false, error: String(e2?.message || e2) };
      }
    }
    return { ok: false, error: String(err?.message || err) };
  }

  const installDir = meta?.installDir || velorenInstallDir(settings);
  const exeNow = (meta?.exePath && fs.existsSync(meta.exePath)) ? meta.exePath : findVelorenExe(installDir);
  const needInstall = !exeNow || !meta?.asset || meta.asset !== latest.name;

  if (needInstall) {
    send({ stage: 'check', text: `Veloren: обновление нужно (${meta?.asset || 'нет'} → ${latest.name})`, pct: 100 });
    await installVelorenLatestInternal(e, settings);
  }

  const meta2 = readVelorenMeta(loadSettings());
  const exe = (meta2?.exePath && fs.existsSync(meta2.exePath)) ? meta2.exePath : findVelorenExe(meta2?.installDir || installDir);
  if (!exe) return { ok: false, error: 'veloren_not_installed' };

  try {
    send({ stage: 'launch', text: 'Veloren: запускаю…', pct: 100 });
    const p = childProcess.spawn(exe, [], {
      cwd: path.dirname(exe),
      detached: true,
      stdio: 'ignore'
    });
    p.unref();
    return { ok: true, launched: true, updated: needInstall, version: meta2?.version || 'nightly', asset: meta2?.asset || '' };
  } catch (e3) {
    return { ok: false, error: String(e3?.message || e3) };
  }
});

ipcMain.handle('veloren:launch', async () => {
  const settings = loadSettings();
  const meta = readVelorenMeta(settings);
  const installDir = meta?.installDir || velorenInstallDir(settings);
  const exe = (meta?.exePath && fs.existsSync(meta.exePath)) ? meta.exePath : findVelorenExe(installDir);

  if (!exe) return { ok: false, error: 'veloren_not_installed' };

  try {
    const p = childProcess.spawn(exe, [], {
      cwd: path.dirname(exe),
      detached: true,
      stdio: 'ignore'
    });
    p.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});
