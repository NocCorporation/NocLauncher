const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const argv = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  return String(argv[i + 1] || fallback);
}

const pmExe = arg('--pm');
const csvPath = arg('--csv');
if (!pmExe || !csvPath) {
  process.stdout.write(JSON.stringify({ type: 'error', message: 'args_missing' }) + '\n');
  process.exit(2);
}

let pmProc = null;
let pollTimer = null;
let header = null;
let msIdx = -1;
let procIdx = -1;

function emit(obj) {
  try { process.stdout.write(JSON.stringify(obj) + '\n'); } catch (_) {}
}

function parseHeader(line) {
  const cols = String(line || '').split(',').map(x => String(x || '').trim().toLowerCase().replace(/"/g, ''));
  const ms = cols.findIndex(h => h === 'msbetweenpresents' || h === 'ms between presents');
  if (ms < 0) return false;
  header = cols;
  msIdx = ms;
  procIdx = cols.findIndex(h => h === 'processname' || h === 'process_name' || h === 'exename' || h === 'application');
  emit({ type: 'debug', message: `header_ok msIdx=${msIdx} procIdx=${procIdx}` });
  return true;
}

function parseLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  if (!header) {
    if (!parseHeader(s)) return null;
    return null;
  }
  const parts = s.split(',').map(x => String(x || '').trim().replace(/^"|"$/g, ''));
  if (msIdx < 0 || msIdx >= parts.length) return null;
  const ms = Number(parts[msIdx]);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const fps = Math.max(1, Math.min(999, Math.round(1000 / ms)));
  const proc = (procIdx >= 0 && procIdx < parts.length) ? String(parts[procIdx] || '').toLowerCase() : '';
  return { fps, proc };
}

function pollCsv() {
  try {
    if (!fs.existsSync(csvPath)) return;
    const raw = fs.readFileSync(csvPath);
    let txt = String(raw || '');
    let lines = txt.split(/\r?\n/).filter(Boolean);
    const h0 = String(lines[0] || '').toLowerCase();
    if (!h0.includes('msbetweenpresents') && raw?.length > 2) {
      try {
        txt = raw.toString('utf16le');
        lines = txt.split(/\r?\n/).filter(Boolean);
      } catch (_) {}
    }
    if (!lines.length) return;
    if (!header) parseHeader(lines[0]);

    const tail = lines.slice(-220);
    let bestGame = null;
    let bestDwm = null;
    let bestAny = null;

    for (const ln of tail) {
      const p = parseLine(ln);
      if (!p) continue;
      bestAny = p;
      const pn = String(p.proc || '');
      const isGame = pn.includes('minecraft.windows.exe') || pn.includes('minecraftwindowsbeta.exe') || pn.includes('javaw.exe') || pn.includes('java.exe');
      const isDwm = pn.includes('dwm.exe') || !pn;
      if (isGame) bestGame = p;
      else if (isDwm) bestDwm = p;
    }

    const picked = bestGame || bestDwm || bestAny;
    if (!picked) return;
    emit({ type: 'fps', current: Number(picked.fps || 0), source: bestGame ? 'game' : (bestDwm ? 'dwm' : 'any') });
  } catch (e) {
    emit({ type: 'debug', message: `csv_err:${String(e?.message || e)}` });
  }
}

function stop() {
  try { if (pollTimer) clearInterval(pollTimer); } catch (_) {}
  pollTimer = null;
  try { if (pmProc && !pmProc.killed) pmProc.kill(); } catch (_) {}
  pmProc = null;
  try {
    if (fs.existsSync(pmExe)) execFileSync(pmExe, ['--session_name', 'NocFPS', '--terminate_existing_session'], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (_) {}
}

try {
  const dir = path.dirname(csvPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try { if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath); } catch (_) {}

  const args = [
    '--session_name','NocFPS','--stop_existing_session',
    '--output_file', csvPath,
    '--no_console_stats','--v1_metrics'
  ];
  pmProc = spawn(pmExe, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  pollTimer = setInterval(pollCsv, 700);
  setTimeout(pollCsv, 800);
  emit({ type: 'started' });

  pmProc.on('exit', () => {
    emit({ type: 'debug', message: 'presentmon_exited' });
  });
} catch (e) {
  emit({ type: 'error', message: String(e?.message || e) });
}

process.on('SIGTERM', () => { stop(); process.exit(0); });
process.on('SIGINT', () => { stop(); process.exit(0); });
