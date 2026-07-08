/**
 * RDA Mobile Phone Service Center — Server
 * Works on: Local laptop AND Railway/cloud hosting
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

// Railway uses PORT env variable, local uses 3000
const PORT     = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'rda_database.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const APP_FILE = path.join(__dirname, 'app', 'index.html');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── Database functions ───────────────────────────────────────
function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
    catch (e) { console.error('[DB] Read error:', e.message); }
  }
  return { _meta: { created: new Date().toISOString(), version: '1.0' } };
}

function saveDB(data) {
  try {
    const json = JSON.stringify(data, null, 2);
    const tmp  = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, json, 'utf-8');
    fs.renameSync(tmp, DB_FILE);
    return true;
  } catch (e) {
    console.error('[DB] Save error:', e.message);
    return false;
  }
}

// ── Auto backup every hour ───────────────────────────────────
function autoBackup() {
  if (!fs.existsSync(DB_FILE)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest  = path.join(BACKUP_DIR, `rda_backup_${stamp}.json`);
  try {
    fs.copyFileSync(DB_FILE, dest);
    console.log(`[Backup] ${path.basename(dest)}`);
    // Keep only last 168 (7 days x 24)
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('rda_backup_')).sort();
    if (files.length > 168)
      files.slice(0, files.length - 168)
           .forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch (e) { console.error('[Backup]', e.message); }
}
setInterval(autoBackup, 60 * 60 * 1000);
autoBackup();

// ── MIME types ───────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ── HTTP Server ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API: GET /api/data ──
  if (req.method === 'GET' && url === '/api/data') {
    const db = loadDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db));
    return;
  }

// ── Save queue — serialize concurrent saves so no two run at the same time ──
let _saveQueue = [];
let _saveProcessing = false;

function processSaveQueue() {
  if (_saveProcessing || _saveQueue.length === 0) return;
  _saveProcessing = true;
  const { incoming, res, tabId } = _saveQueue.shift();

  try {
    const existing = loadDB();
    const merged = doMerge(existing, incoming);
    saveDB(merged);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tab: tabId, queued: _saveQueue.length }));
    console.log(`[Save] OK tab=${tabId || '?'} jobs=${merged.jobs?.length} sales=${merged.sales?.length} queue=${_saveQueue.length}`);
  } catch(e) {
    console.error('[Save] Error:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }

  _saveProcessing = false;
  // Process next in queue
  if (_saveQueue.length > 0) setImmediate(processSaveQueue);
}

  // ── API: POST /api/save ──
  if (req.method === 'POST' && url === '/api/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        const tabId = incoming._tabId || 'unknown';
        // Queue this save — prevents concurrent writes corrupting the database
        _saveQueue.push({ incoming, res, tabId });
        console.log(`[Queue] tab=${tabId} queued (${_saveQueue.length} in queue)`);
        processSaveQueue();
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

function doMerge(existing, incoming) {
        // ── SMART MERGE: take the UNION of arrays, most-recently-updated record wins ──
        function mergeById(existArr, incomingArr, idField) {
          if (!existArr || !existArr.length) return incomingArr || [];
          if (!incomingArr || !incomingArr.length) return existArr || [];
          const toTS = (str) => { if (!str) return 0; const d = new Date(str); return isNaN(d) ? 0 : d.getTime(); };
          const getTS = (item) => toTS(item.updatedAt)||toTS(item.closedAt)||toTS(item.fulfillDate)||toTS(item.issuedAt)||toTS(item.createdAt)||toTS(item.date)||0;
          const map = new Map();
          existArr.forEach(item => { if (item && item[idField]) map.set(item[idField], item); });
          incomingArr.forEach(item => {
            if (!item || !item[idField]) return;
            const ex = map.get(item[idField]);
            if (!ex) { map.set(item[idField], item); }
            else {
              const existTS = getTS(ex), incomTS = getTS(item);
              if (incomTS >= existTS) { map.set(item[idField], item); }
              else { console.log(`[Merge] Kept newer existing ${idField}=${item[idField]} (exist:${existTS} > incoming:${incomTS})`); }
            }
          });
          return Array.from(map.values());
        }

        const merged = { ...existing, ...incoming };
        merged.jobs             = mergeById(existing.jobs,             incoming.jobs,             'id');
        merged.customers        = mergeById(existing.customers,        incoming.customers,        'id');
        merged.sales            = mergeById(existing.sales,            incoming.sales,            'orNumber');
        merged.inventory        = mergeById(existing.inventory,        incoming.inventory,        'code');
        merged.partRequests     = mergeById(existing.partRequests,     incoming.partRequests,     'id');
        merged.purchaseOrders   = mergeById(existing.purchaseOrders,   incoming.purchaseOrders,   'id');
        merged.employees        = mergeById(existing.employees,        incoming.employees,        'id');
        merged.quotations       = mergeById(existing.quotations,       incoming.quotations,       'id');
        merged.cashierQueue     = mergeById(existing.cashierQueue,     incoming.cashierQueue,     'id');
        merged.imeiBypassRequests = mergeById(existing.imeiBypassRequests||[], incoming.imeiBypassRequests||[], 'id');
        merged.notifications    = mergeById(existing.notifications,    incoming.notifications,    'id');
        merged.dealers          = mergeById(existing.dealers,          incoming.dealers,          'id');
        merged.toolInventory    = mergeById(existing.toolInventory,    incoming.toolInventory,    'id');
        merged.toolRequests     = mergeById(existing.toolRequests,     incoming.toolRequests,     'id');
        merged.stickyNotes      = mergeById(existing.stickyNotes||[], incoming.stickyNotes||[], 'id');
        merged.disciplinaryRecords = mergeById(existing.disciplinaryRecords||[], incoming.disciplinaryRecords||[], 'id');

        // Statuses — keep whichever has more entries
        const exStatuses = existing.statuses || [], inStatuses = incoming.statuses || [];
        merged.statuses = inStatuses.length >= exStatuses.length ? inStatuses : exStatuses;

        // masterList — keep whichever has more brands/models
        const exMaster = existing.masterList || {}, inMaster = incoming.masterList || {};
        const exBC = (exMaster.brands||[]).reduce((t,b)=>t+1+(b.models||[]).length, 0);
        const inBC = (inMaster.brands||[]).reduce((t,b)=>t+1+(b.models||[]).length, 0);
        merged.masterList = inBC >= exBC ? inMaster : exMaster;
        if (inBC < exBC) console.log(`[Merge] Kept existing masterList (${exBC} vs ${inBC})`);

        // dailyReports — merge by date, neither wins over the other
        function mergeDailyReports(existArr, incomingArr) {
          if (!existArr||!existArr.length) return incomingArr||[];
          if (!incomingArr||!incomingArr.length) return existArr||[];
          const map = new Map();
          existArr.forEach(r => { if (r&&r.date) map.set(r.date, r); });
          incomingArr.forEach(r => { if (r&&r.date) map.set(r.date, r); });
          return Array.from(map.values()).sort((a,b)=>a.date<b.date?-1:1);
        }
        merged.dailyReports = mergeDailyReports(existing.dailyReports, incoming.dailyReports);

        // Counters — always take the highest
        merged.orCounter = Math.max(existing.orCounter||0, incoming.orCounter||0);
        merged.poCounter = Math.max(existing.poCounter||0, incoming.poCounter||0);

        // Metadata
        merged._meta = merged._meta || {};
        merged._meta.lastSaved = new Date().toISOString();

        return merged;
}

  // ── API: GET /api/next-jo ── returns next available JO number WITHOUT consuming it
  // The counter is only advanced when the job is actually saved via /api/save
  if (req.method === 'GET' && url === '/api/next-jo') {
    const db = loadDB();
    // Find highest existing JO number from jobs array
    const existingJobs = db.jobs || [];
    let maxNum = db._joCounter || 0;
    existingJobs.forEach(j => {
      if (j.id && j.id.startsWith('JO-')) {
        const n = parseInt(j.id.replace('JO-', ''), 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    });
    // Return next number but do NOT save/commit — counter advances only on real save
    const nextNum = maxNum + 1;
    const joNum = 'JO-' + String(nextNum).padStart(4, '0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ joNumber: joNum, counter: nextNum }));
    console.log('[JO] Preview next JO:', joNum, '(max existing:', maxNum, ') — NOT committed');
    return;
  }


  if (req.method === 'GET' && url === '/api/backups') {
    if (!fs.existsSync(BACKUP_DIR)) { res.writeHead(200, {'Content-Type':'application/json'}); res.end('[]'); return; }
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('rda_backup_'))
      .sort().reverse() // newest first
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf-8'));
        return {
          name: f,
          size: (stat.size / 1024).toFixed(1) + ' KB',
          jobs: (data.jobs || []).length,
          customers: (data.customers || []).length,
          sales: (data.sales || []).length,
          lastSaved: data._meta?.lastSaved || f
        };
      });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
    return;
  }

  // ── API: GET /api/backup/:filename ── download specific backup
  if (req.method === 'GET' && url.startsWith('/api/backup/')) {
    const fname = path.basename(url.replace('/api/backup/', ''));
    const fpath = path.join(BACKUP_DIR, fname);
    if (!fs.existsSync(fpath)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${fname}"`,
    });
    fs.createReadStream(fpath).pipe(res);
    return;
  }

  // ── API: POST /api/restore/:filename ── restore a backup as current DB
  if (req.method === 'POST' && url.startsWith('/api/restore/')) {
    const fname = path.basename(url.replace('/api/restore/', ''));
    const fpath = path.join(BACKUP_DIR, fname);
    if (!fs.existsSync(fpath)) { res.writeHead(404); res.end('Not found'); return; }
    try {
      fs.copyFileSync(fpath, DB_FILE);
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      console.log(`[Restore] Restored from ${fname} — jobs: ${(data.jobs||[]).length}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, jobs: (data.jobs||[]).length, customers: (data.customers||[]).length }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === 'GET' && url === '/api/backup') {
    if (!fs.existsSync(DB_FILE)) { res.writeHead(404); res.end('No data yet.'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="RDA_Backup_${stamp}.json"`,
    });
    fs.createReadStream(DB_FILE).pipe(res);
    return;
  }

  // ── API: GET /api/status ──
  if (req.method === 'GET' && url === '/api/status') {
    const db   = loadDB();
    const dbSz = fs.existsSync(DB_FILE)
      ? (fs.statSync(DB_FILE).size / 1024).toFixed(1) + ' KB' : '0 KB';
    const bkCnt = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('rda_backup_')).length : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status:    'running',
      server:    'RDA Mobile Phone Service Center',
      version:   '1.0',
      env:       process.env.RAILWAY_ENVIRONMENT || 'local',
      uptime:    Math.floor(process.uptime()) + 's',
      dbSize:    dbSz,
      backups:   bkCnt,
      jobs:      (db.jobs || []).length,
      customers: (db.customers || []).length,
      inventory: (db.inventory || []).length,
      lastSaved: db._meta?.lastSaved || 'Never',
      port:      PORT,
    }));
    return;
  }

  // ── Serve static files ──
  let filePath;
  if (url === '/' || url === '/index.html') {
    filePath = APP_FILE;
  } else {
    filePath = path.join(__dirname, 'app', url);
  }

  const appDir = path.join(__dirname, 'app');
  if (!path.resolve(filePath).startsWith(appDir) && filePath !== APP_FILE) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const isCloud = process.env.RAILWAY_ENVIRONMENT || process.env.RENDER;
  if (isCloud) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  RDA SERVICE CENTER — RUNNING ON CLOUD`);
    console.log(`  Port: ${PORT}`);
    console.log(`  Environment: ${process.env.RAILWAY_ENVIRONMENT || 'cloud'}`);
    console.log(`${'═'.repeat(50)}\n`);
  } else {
    // Local mode — show network IPs
    const nets = os.networkInterfaces();
    const ips  = [];
    for (const n of Object.values(nets))
      for (const i of n)
        if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  RDA MOBILE PHONE SERVICE CENTER — SERVER RUNNING`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`\n  Local (this laptop):  http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`  Network (other devices): http://${ip}:${PORT}`));
    console.log(`\n  ✅ Data saves to: data/rda_database.json`);
    console.log(`  ✅ Auto-backup every hour to: data/backups/`);
    console.log(`\n  Press Ctrl+C to stop\n`);
    console.log(`${'═'.repeat(60)}\n`);
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use. Close other programs and try again.\n`);
  } else {
    console.error('Server error:', e.message);
  }
  process.exit(1);
});
