/**
 * RDA Mobile Phone Service Center — Server v2.0
 * Persistent storage: MongoDB Atlas (free) with file fallback
 * Data NEVER lost on Render restart
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT    = process.env.PORT || 3000;
const APP_FILE = path.join(__dirname, 'app', 'index.html');

// ── MongoDB Atlas connection (set MONGODB_URI in Render env vars) ──
const MONGO_URI = process.env.MONGODB_URI || null;
let db_mongo = null;   // mongo collection reference
let _mongoReady = false;

async function initMongo() {
  if (!MONGO_URI) {
    console.log('[DB] No MONGODB_URI set — using file system storage');
    return false;
  }
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db_mongo = client.db('rda_service_center').collection('data');
    _mongoReady = true;
    console.log('[DB] ✅ MongoDB Atlas connected — data is permanently safe');
    return true;
  } catch (e) {
    console.error('[DB] MongoDB connect failed:', e.message);
    console.log('[DB] Falling back to file system');
    return false;
  }
}

// ── File system fallback ──
const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE    = path.join(DATA_DIR, 'rda_database.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function loadFile() {
  if (fs.existsSync(DB_FILE)) {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
    catch(e) { console.error('[File] Read error:', e.message); }
  }
  return { _meta: { created: new Date().toISOString() } };
}

function saveFile(data) {
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_FILE);
    return true;
  } catch(e) { console.error('[File] Save error:', e.message); return false; }
}

// ── Unified DB load/save ──
async function loadDB() {
  if (_mongoReady && db_mongo) {
    try {
      const doc = await db_mongo.findOne({ _id: 'rda_main' });
      if (doc) { delete doc._id; return doc; }
      return { _meta: { created: new Date().toISOString() } };
    } catch(e) {
      console.error('[Mongo] Load error:', e.message, '— using file');
    }
  }
  return loadFile();
}

async function saveDB(data) {
  // Always save to file as backup
  saveFile(data);
  // Also save to MongoDB if available
  if (_mongoReady && db_mongo) {
    try {
      await db_mongo.replaceOne(
        { _id: 'rda_main' },
        { ...data, _id: 'rda_main' },
        { upsert: true }
      );
      return true;
    } catch(e) {
      console.error('[Mongo] Save error:', e.message);
    }
  }
  return true;
}

// ── Auto backup every hour ──
async function autoBackup() {
  try {
    const data = await loadDB();
    const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const dest  = path.join(BACKUP_DIR, `rda_backup_${stamp}.json`);
    fs.writeFileSync(dest, JSON.stringify(data, null, 2));
    console.log(`[Backup] ${path.basename(dest)}`);
    // Keep last 168 backups (7 days)
    const files = fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith('rda_backup_')).sort();
    if (files.length > 168)
      files.slice(0, files.length - 168).forEach(f => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch(e) {}
      });
  } catch(e) { console.error('[Backup] Error:', e.message); }
}

// ── Smart merge ──
function mergeById(existArr, incomingArr, idField) {
  if (!existArr || !existArr.length) return incomingArr || [];
  if (!incomingArr || !incomingArr.length) return existArr || [];
  const toTS = s => { if (!s) return 0; const d = new Date(s); return isNaN(d) ? 0 : d.getTime(); };
  const getTS = item => toTS(item.updatedAt)||toTS(item.closedAt)||toTS(item.fulfillDate)||toTS(item.issuedAt)||toTS(item.createdAt)||toTS(item.date)||0;
  const map = new Map();
  existArr.forEach(item => { if (item && item[idField]) map.set(item[idField], item); });
  incomingArr.forEach(item => {
    if (!item || !item[idField]) return;
    const ex = map.get(item[idField]);
    if (!ex) { map.set(item[idField], item); }
    else if (getTS(item) >= getTS(ex)) { map.set(item[idField], item); }
  });
  return Array.from(map.values());
}

function doMerge(existing, incoming) {
  const merged = { ...existing, ...incoming };
  merged.jobs             = mergeById(existing.jobs,             incoming.jobs,             'id');
  merged.customers        = mergeById(existing.customers,        incoming.customers,        'id');
  merged.sales            = mergeById(existing.sales,            incoming.sales,            'orNumber');
  merged.inventory        = mergeById(existing.inventory,        incoming.inventory,        'code');
  merged.partRequests     = mergeById(existing.partRequests,     incoming.partRequests,     'id');
  merged.purchaseOrders   = mergeById(existing.purchaseOrders,   incoming.purchaseOrders,   'id');
  merged.employees        = mergeById(existing.employees,        incoming.employees,        'empId');
  merged.quotations       = mergeById(existing.quotations,       incoming.quotations,       'id');
  merged.cashierQueue     = mergeById(existing.cashierQueue,     incoming.cashierQueue,     'id');
  merged.imeiBypassRequests = mergeById(existing.imeiBypassRequests||[], incoming.imeiBypassRequests||[], 'id');
  merged.notifications    = mergeById(existing.notifications,    incoming.notifications,    'id');
  merged.dealers          = mergeById(existing.dealers,          incoming.dealers,          'id');
  merged.toolInventory    = mergeById(existing.toolInventory,    incoming.toolInventory,    'id');
  merged.toolRequests     = mergeById(existing.toolRequests,     incoming.toolRequests,     'id');
  merged.disciplinaryRecords = mergeById(existing.disciplinaryRecords||[], incoming.disciplinaryRecords||[], 'id');
  merged.cashierSessions  = mergeById(existing.cashierSessions||[], incoming.cashierSessions||[], 'id');
  merged.stickyNotes      = incoming.stickyNotes || existing.stickyNotes || [];

  // chatMessages — keep most messages
  const exChat = existing.chatMessages||[], inChat = incoming.chatMessages||[];
  if (inChat.length >= exChat.length) {
    merged.chatMessages = inChat;
  } else {
    const chatMap = new Map(exChat.map(m=>[m.id,m]));
    inChat.forEach(m=>{ if(!chatMap.has(m.id)) chatMap.set(m.id,m); });
    merged.chatMessages = Array.from(chatMap.values())
      .sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||'')).slice(-500);
  }

  // Statuses — most entries wins
  const exS = existing.statuses||[], inS = incoming.statuses||[];
  merged.statuses = inS.length >= exS.length ? inS : exS;

  // masterList — most brands/models wins
  const exM = existing.masterList||{}, inM = incoming.masterList||{};
  const exBC = (exM.brands||[]).reduce((t,b)=>t+1+(b.models||[]).length,0);
  const inBC = (inM.brands||[]).reduce((t,b)=>t+1+(b.models||[]).length,0);
  merged.masterList = inBC >= exBC ? inM : exM;

  // dailyReports — incoming wins (supports reopen/deletion)
  // If incoming has fewer reports than existing, it means one was deliberately removed (reopened)
  // We trust the client's version since only admin can reopen reports
  if ((incoming.dailyReports||[]).length <= (existing.dailyReports||[]).length) {
    // Client removed a report (reopen action) — use incoming directly
    merged.dailyReports = (incoming.dailyReports||[]).sort((a,b)=>a.date<b.date?-1:1);
  } else {
    // Client added reports — merge both (add new, keep existing)
    const drMap = new Map();
    (existing.dailyReports||[]).forEach(r=>{ if(r&&r.date) drMap.set(r.date,r); });
    (incoming.dailyReports||[]).forEach(r=>{ if(r&&r.date) drMap.set(r.date,r); });
    merged.dailyReports = Array.from(drMap.values()).sort((a,b)=>a.date<b.date?-1:1);
  }

  // Counters — always highest
  merged.orCounter = Math.max(existing.orCounter||0, incoming.orCounter||0);
  merged.poCounter = Math.max(existing.poCounter||0, incoming.poCounter||0);
  merged._meta = { ...existing._meta, lastSaved: new Date().toISOString() };

  return merged;
}

// ── Save queue ──
let _saveQueue = [], _saveProcessing = false;

function processSaveQueue() {
  if (_saveProcessing || _saveQueue.length === 0) return;
  _saveProcessing = true;
  const { incoming, res, tabId } = _saveQueue.shift();

  (async () => {
    try {
      const existing = await loadDB();
      const merged   = doMerge(existing, incoming);
      await saveDB(merged);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tab: tabId, queue: _saveQueue.length, mongo: _mongoReady }));
      console.log(`[Save] OK tab=${tabId||'?'} jobs=${merged.jobs?.length} sales=${merged.sales?.length} mongo=${_mongoReady}`);
    } catch(e) {
      console.error('[Save] Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    _saveProcessing = false;
    if (_saveQueue.length > 0) setImmediate(processSaveQueue);
  })();
}

// ── MIME types ──
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript',
  '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg',
  '.ico':'image/x-icon', '.svg':'image/svg+xml',
};

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/data
  if (req.method === 'GET' && url === '/api/data') {
    loadDB().then(db => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db));
    }).catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
    return;
  }

  // POST /api/save
  if (req.method === 'POST' && url === '/api/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        _saveQueue.push({ incoming, res, tabId: incoming._tabId || 'unknown' });
        processSaveQueue();
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // GET /api/status
  if (req.method === 'GET' && url === '/api/status') {
    loadDB().then(db => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'running', mongo: _mongoReady,
        jobs: (db.jobs||[]).length, customers: (db.customers||[]).length,
        sales: (db.sales||[]).length, inventory: (db.inventory||[]).length,
        lastSaved: db._meta?.lastSaved || 'Never',
        uptime: Math.floor(process.uptime()) + 's',
      }));
    }).catch(e => { res.writeHead(500); res.end('{}'); });
    return;
  }

  // GET /api/next-jo
  if (req.method === 'GET' && url === '/api/next-jo') {
    loadDB().then(db => {
      let max = db._joCounter || 0;
      (db.jobs||[]).forEach(j => {
        if (j.id && j.id.startsWith('JO-')) {
          const n = parseInt(j.id.replace('JO-',''),10);
          if (!isNaN(n) && n > max) max = n;
        }
      });
      const joNum = 'JO-' + String(max+1).padStart(4,'0');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ joNumber: joNum, counter: max+1 }));
    }).catch(e => { res.writeHead(500); res.end('{}'); });
    return;
  }

  // GET /api/backup — download current data as JSON
  if (req.method === 'GET' && url === '/api/backup') {
    loadDB().then(db => {
      const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="RDA_Backup_${stamp}.json"`,
      });
      res.end(JSON.stringify(db, null, 2));
    }).catch(e => { res.writeHead(500); res.end('{}'); });
    return;
  }

  // GET /api/backups — list available backups
  if (req.method === 'GET' && url === '/api/backups') {
    if (!fs.existsSync(BACKUP_DIR)) { res.writeHead(200,{'Content-Type':'application/json'}); res.end('[]'); return; }
    try {
      const files = fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith('rda_backup_')).sort().reverse().slice(0,20).map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR,f));
        try {
          const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR,f),'utf-8'));
          return { name:f, size:(stat.size/1024).toFixed(1)+' KB', jobs:(data.jobs||[]).length, sales:(data.sales||[]).length, lastSaved:data._meta?.lastSaved||f };
        } catch(e) { return { name:f, size:(stat.size/1024).toFixed(1)+' KB' }; }
      });
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(files));
    } catch(e) { res.writeHead(200,{'Content-Type':'application/json'}); res.end('[]'); }
    return;
  }

  // GET /api/backup/:filename — download specific backup
  if (req.method === 'GET' && url.startsWith('/api/backup/')) {
    const fname = path.basename(url.replace('/api/backup/',''));
    const fpath = path.join(BACKUP_DIR, fname);
    if (!fs.existsSync(fpath)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type':'application/json', 'Content-Disposition':`attachment; filename="${fname}"` });
    fs.createReadStream(fpath).pipe(res);
    return;
  }

  // POST /api/restore — restore from uploaded JSON body
  if (req.method === 'POST' && url === '/api/restore') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 50*1024*1024) { res.writeHead(413); res.end('Too large'); } });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        saveDB(data).then(() => {
          console.log(`[Restore] Restored — jobs:${(data.jobs||[]).length} customers:${(data.customers||[]).length}`);
          res.writeHead(200,{'Content-Type':'application/json'});
          res.end(JSON.stringify({ ok:true, jobs:(data.jobs||[]).length, customers:(data.customers||[]).length }));
        });
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ ok:false, error:e.message })); }
    });
    return;
  }

  // Serve static files
  let filePath = (url === '/' || url === '/index.html') ? APP_FILE : path.join(__dirname,'app',url);
  const appDir = path.join(__dirname,'app');
  if (!path.resolve(filePath).startsWith(appDir) && filePath !== APP_FILE) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else { res.writeHead(404); res.end('Not found'); }
});

// ── Start ──
(async () => {
  await initMongo();
  setInterval(autoBackup, 60*60*1000);
  autoBackup();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  RDA MOBILE PHONE SERVICE CENTER`);
    console.log(`  Port: ${PORT} | MongoDB: ${_mongoReady ? '✅ Connected' : '⚠️ File only'}`);
    console.log(`${'═'.repeat(55)}\n`);
  });
})();

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n❌ Port ${PORT} in use.\n`);
  else console.error('Server error:', e.message);
  process.exit(1);
});
