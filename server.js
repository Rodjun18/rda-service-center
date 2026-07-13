/**
 * RDA Mobile Phone Service Center — Server v3.0
 * Storage: GitHub (permanent, free) + file fallback
 * Data survives Render restarts forever
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = process.env.PORT || 3000;
const APP_FILE = path.join(__dirname, 'app', 'index.html');

// ── GitHub Storage Config ──
// Set these in Render → Environment Variables:
//   GH_TOKEN  = your GitHub Personal Access Token
//   GH_REPO   = Rodjun18/rda-service-center
//   GH_FILE   = data/rda_database.json
const GH_TOKEN = process.env.GH_TOKEN || null;
const GH_REPO  = process.env.GH_REPO  || 'Rodjun18/rda-service-center';
const GH_FILE  = process.env.GH_FILE  || 'data/rda_database.json';
let _ghSha = null;      // current file SHA (needed for updates)
let _ghReady = false;

// ── MongoDB Atlas (optional, set MONGODB_URI) ──
const MONGO_URI = process.env.MONGODB_URI || null;
let db_mongo = null;
let _mongoReady = false;

async function initMongo() {
  if (!MONGO_URI) return false;
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db_mongo = client.db('rda_service_center').collection('data');
    _mongoReady = true;
    console.log('[DB] ✅ MongoDB connected');
    return true;
  } catch(e) {
    console.error('[DB] MongoDB failed:', e.message);
    return false;
  }
}

// ── File system fallback ──
const DATA_DIR   = path.join(__dirname, 'data');
const DB_FILE    = path.join(DATA_DIR, 'rda_database.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
try { if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true }); } catch(e) {}
try { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch(e) {}

function loadFile() {
  if (fs.existsSync(DB_FILE)) {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch(e) {}
  }
  return { _meta: { created: new Date().toISOString() } };
}

function saveFile(data) {
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_FILE);
    return true;
  } catch(e) { return false; }
}

// ── GitHub Storage ──
function ghRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'User-Agent': 'RDA-Service-Center',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      }
    };
    const https = require('https');
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function ghLoad() {
  if (!GH_TOKEN) return null;
  try {
    const r = await ghRequest('GET', `/repos/${GH_REPO}/contents/${GH_FILE}`);
    if (r.status === 200 && r.body.content) {
      _ghSha = r.body.sha;
      _ghReady = true;
      const content = Buffer.from(r.body.content, 'base64').toString('utf-8');
      console.log('[GitHub] ✅ Data loaded from GitHub');
      return JSON.parse(content);
    }
    if (r.status === 404) {
      _ghReady = true; // file doesn't exist yet — will create on first save
      console.log('[GitHub] No data file yet — will create on first save');
      return null;
    }
  } catch(e) {
    console.error('[GitHub] Load error:', e.message);
  }
  return null;
}

async function ghSave(data) {
  if (!GH_TOKEN || !_ghReady) return false;
  try {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    const body = {
      message: `RDA data update ${new Date().toISOString()}`,
      content,
      ..._ghSha ? { sha: _ghSha } : {},
    };
    const r = await ghRequest('PUT', `/repos/${GH_REPO}/contents/${GH_FILE}`, body);
    if (r.status === 200 || r.status === 201) {
      _ghSha = r.body.content?.sha || _ghSha;
      console.log('[GitHub] ✅ Data saved to GitHub');
      return true;
    }
    console.error('[GitHub] Save failed:', r.status, JSON.stringify(r.body).slice(0,200));
  } catch(e) {
    console.error('[GitHub] Save error:', e.message);
  }
  return false;
}

// ── Unified Load/Save ──
async function loadDB() {
  // 1. Try MongoDB
  if (_mongoReady && db_mongo) {
    try {
      const doc = await db_mongo.findOne({ _id: 'rda_main' });
      if (doc) { const d={...doc}; delete d._id; return d; }
    } catch(e) { console.error('[Mongo] Load error:', e.message); }
  }
  // 2. Try GitHub
  const ghData = await ghLoad();
  if (ghData) { saveFile(ghData); return ghData; }  // cache locally
  // 3. Local file fallback
  return loadFile();
}

async function saveDB(data) {
  // Save to file immediately (fast)
  saveFile(data);
  // Save to MongoDB if available
  if (_mongoReady && db_mongo) {
    try {
      await db_mongo.replaceOne({ _id: 'rda_main' }, { ...data, _id: 'rda_main' }, { upsert: true });
    } catch(e) { console.error('[Mongo] Save error:', e.message); }
  }
  // Save to GitHub (async, don't wait)
  if (_ghReady) {
    ghSave(data).catch(e => console.error('[GitHub] Async save error:', e.message));
  }
  return true;
}

// ── Auto backup hourly ──
async function autoBackup() {
  try {
    const data = await loadDB();
    const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    fs.writeFileSync(path.join(BACKUP_DIR, `rda_backup_${stamp}.json`), JSON.stringify(data, null, 2));
    const files = fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith('rda_backup_')).sort();
    if (files.length > 168) files.slice(0, files.length-168).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch(e) {}
    });
    console.log(`[Backup] Saved ${stamp}`);
  } catch(e) { console.error('[Backup] Error:', e.message); }
}

// ── Smart Merge ──
function mergeById(existArr, incomingArr, idField) {
  if (!existArr?.length) return incomingArr||[];
  if (!incomingArr?.length) return existArr||[];
  const toTS = s => { const d=new Date(s); return isNaN(d)?0:d.getTime(); };
  const getTS = i => toTS(i.updatedAt)||toTS(i.closedAt)||toTS(i.createdAt)||toTS(i.date)||0;
  const map = new Map();
  existArr.forEach(i => { if(i?.[idField]) map.set(i[idField], i); });
  incomingArr.forEach(i => {
    if(!i?.[idField]) return;
    const ex = map.get(i[idField]);
    if(!ex || getTS(i) >= getTS(ex)) map.set(i[idField], i);
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
  merged.notifications    = mergeById(existing.notifications,    incoming.notifications,    'id');
  merged.dealers          = mergeById(existing.dealers,          incoming.dealers,          'id');
  merged.toolInventory    = mergeById(existing.toolInventory,    incoming.toolInventory,    'id');
  merged.toolRequests     = mergeById(existing.toolRequests,     incoming.toolRequests,     'id');
  merged.imeiBypassRequests = mergeById(existing.imeiBypassRequests||[], incoming.imeiBypassRequests||[], 'id');
  merged.disciplinaryRecords = mergeById(existing.disciplinaryRecords||[], incoming.disciplinaryRecords||[], 'id');
  merged.cashierSessions  = mergeById(existing.cashierSessions||[], incoming.cashierSessions||[], 'id');

  // Sticky notes — incoming wins (supports deletion)
  merged.stickyNotes = incoming.stickyNotes || existing.stickyNotes || [];

  // Daily reports — incoming wins when count decreases (supports reopen)
  if ((incoming.dailyReports||[]).length <= (existing.dailyReports||[]).length) {
    merged.dailyReports = (incoming.dailyReports||[]).sort((a,b)=>a.date<b.date?-1:1);
  } else {
    const drMap = new Map();
    (existing.dailyReports||[]).forEach(r=>{ if(r?.date) drMap.set(r.date,r); });
    (incoming.dailyReports||[]).forEach(r=>{ if(r?.date) drMap.set(r.date,r); });
    merged.dailyReports = Array.from(drMap.values()).sort((a,b)=>a.date<b.date?-1:1);
  }

  // Chat messages — keep most
  const exChat=existing.chatMessages||[], inChat=incoming.chatMessages||[];
  if (inChat.length >= exChat.length) {
    merged.chatMessages = inChat;
  } else {
    const chatMap = new Map(exChat.map(m=>[m.id,m]));
    inChat.forEach(m=>{ if(!chatMap.has(m.id)) chatMap.set(m.id,m); });
    merged.chatMessages = Array.from(chatMap.values())
      .sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||'')).slice(-500);
  }

  // Statuses and masterList — most entries wins
  const exS=existing.statuses||[], inS=incoming.statuses||[];
  merged.statuses = inS.length >= exS.length ? inS : exS;
  const exM=existing.masterList||{}, inM=incoming.masterList||{};
  const exBC=(exM.brands||[]).reduce((t,b)=>t+1+(b.models||[]).length,0);
  const inBC=(inM.brands||[]).reduce((t,b)=>t+1+(b.models||[]).length,0);
  merged.masterList = inBC >= exBC ? inM : exM;

  merged.orCounter = Math.max(existing.orCounter||0, incoming.orCounter||0);
  merged.poCounter = Math.max(existing.poCounter||0, incoming.poCounter||0);
  merged._meta = { ...existing._meta, lastSaved: new Date().toISOString() };
  return merged;
}

// ── Save Queue ──
let _saveQueue=[], _saveProcessing=false;
function processSaveQueue() {
  if (_saveProcessing || !_saveQueue.length) return;
  _saveProcessing = true;
  const { incoming, res, tabId } = _saveQueue.shift();
  (async () => {
    try {
      const existing = await loadDB();
      const merged   = doMerge(existing, incoming);
      await saveDB(merged);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:true, tab:tabId, mongo:_mongoReady, github:_ghReady }));
      console.log(`[Save] OK tab=${tabId||'?'} jobs=${merged.jobs?.length} sales=${merged.sales?.length}`);
    } catch(e) {
      console.error('[Save] Error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ ok:false, error:e.message }));
    }
    _saveProcessing = false;
    if (_saveQueue.length) setImmediate(processSaveQueue);
  })();
}

// ── MIME types ──
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript',
  '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon',
};

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && url === '/api/data') {
    loadDB().then(db => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(db));
    }).catch(e => { res.writeHead(500); res.end('{}'); });
    return;
  }

  if (req.method === 'POST' && url === '/api/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; if(body.length>50*1024*1024){res.writeHead(413);res.end();} });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        _saveQueue.push({ incoming, res, tabId: incoming._tabId||'unknown' });
        processSaveQueue();
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ ok:false, error:'Invalid JSON' })); }
    });
    return;
  }

  if (req.method === 'GET' && url === '/api/status') {
    loadDB().then(db => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status:'running', mongo:_mongoReady, github:_ghReady,
        jobs:(db.jobs||[]).length, customers:(db.customers||[]).length,
        sales:(db.sales||[]).length, lastSaved:db._meta?.lastSaved||'Never',
        uptime:Math.floor(process.uptime())+'s',
      }));
    }).catch(() => { res.writeHead(200); res.end('{}'); });
    return;
  }

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

  if (req.method === 'POST' && url === '/api/restore') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        saveDB(data).then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok:true, jobs:(data.jobs||[]).length }));
        });
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ ok:false, error:e.message })); }
    });
    return;
  }

  // Serve static files
  let filePath = (url==='/'||url==='/index.html') ? APP_FILE : path.join(__dirname,'app',url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()]||'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else { res.writeHead(404); res.end('Not found'); }
});

// ── Start ──
(async () => {
  await initMongo();

  // Load from GitHub on startup (restores data after Render restart)
  if (GH_TOKEN) {
    console.log('[GitHub] Loading data from GitHub...');
    const ghData = await ghLoad();
    if (ghData) {
      saveFile(ghData);
      console.log(`[GitHub] ✅ Restored ${(ghData.jobs||[]).length} jobs, ${(ghData.customers||[]).length} customers from GitHub`);
    }
  }

  setInterval(autoBackup, 60*60*1000);
  autoBackup();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  RDA MOBILE PHONE SERVICE CENTER v3.0`);
    console.log(`  Port: ${PORT}`);
    console.log(`  MongoDB: ${_mongoReady ? '✅ Connected' : '⚠️ Not configured'}`);
    console.log(`  GitHub:  ${_ghReady   ? '✅ Connected' : GH_TOKEN ? '⚠️ Check token' : '⚠️ Not configured'}`);
    console.log(`${'═'.repeat(55)}\n`);
  });
})();

server.on('error', e => { console.error('Server error:', e.message); process.exit(1); });
