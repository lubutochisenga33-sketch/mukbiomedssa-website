'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'biomedssa2025';
const CLD_FOLDER = process.env.CLOUDINARY_FOLDER || 'muk-biomedssa';
const STATE_ID   = CLD_FOLDER + '/state-data'; // Cloudinary raw file public_id

// ─────────────────────────────────────────────────────────────
//  Cloudinary  (v2, same as eBudget pattern)
// ─────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
});

console.log('Cloudinary configured:', process.env.CLOUDINARY_CLOUD_NAME ? 'YES' : 'NO');

// ─────────────────────────────────────────────────────────────
//  In-memory state  (loaded from Cloudinary on boot)
// ─────────────────────────────────────────────────────────────
let siteState = {};

// ─────────────────────────────────────────────────────────────
//  Cloudinary JSON persistence  (same pattern as eBudget)
// ─────────────────────────────────────────────────────────────
async function loadStateFromCloudinary() {
  try {
    console.log('Loading state from Cloudinary...');
    const resource = await cloudinary.api.resource(STATE_ID, { resource_type: 'raw' });
    const https = require('https');
    // Add cache-buster query param so Cloudinary CDN always returns the latest version
    const urlWithBust = resource.secure_url + '?t=' + Date.now();
    const json = await new Promise((resolve, reject) => {
      https.get(urlWithBust, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    siteState = JSON.parse(json);
    const keys = Object.keys(siteState).length;
    console.log('✅ State loaded from Cloudinary –', keys, 'top-level keys');
  } catch (err) {
    if (err.http_code === 404) {
      console.log('ℹ️  No existing state in Cloudinary – starting fresh');
    } else {
      console.error('⚠️  Load error:', err.message, '– starting with empty state');
    }
    siteState = {};
  }
}

async function saveStateToCloudinary() {
  try {
    const json = JSON.stringify({ ...siteState, lastUpdated: new Date().toISOString() }, null, 2);
    await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          public_id     : STATE_ID,
          overwrite     : true,
          invalidate    : true,   // bust Cloudinary CDN cache immediately
        },
        (err, result) => { if (err) reject(err); else resolve(result); }
      ).end(Buffer.from(json));
    });
    console.log('✅ State saved to Cloudinary at', new Date().toLocaleTimeString());
    return true;
  } catch (err) {
    console.error('❌ Error saving state:', err.message);
    return false;
  }
}

// Auto-save every 10 seconds (same as eBudget)
// Auto-save every 30s as backup (PUT /api/state saves immediately)
setInterval(() => saveStateToCloudinary(), 30000);

// ─────────────────────────────────────────────────────────────
//  Multer – memory storage → Cloudinary upload_stream
// ─────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Unsupported file type'));
  },
});

function uploadImageToCloudinary(buffer, context) {
  return new Promise((resolve, reject) => {
    const publicId = `${CLD_FOLDER}/${context}_${Date.now()}`;
    cloudinary.uploader.upload_stream(
      { folder: CLD_FOLDER, public_id: publicId, resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
      (err, result) => { if (err) reject(err); else resolve({ url: result.secure_url, publicId: result.public_id }); }
    ).end(buffer);
  });
}

// ─────────────────────────────────────────────────────────────
//  Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://mukbiomedssa-website.onrender.com',
    'http://localhost:3000',
    'null',   // allows file:// origins (opening HTML directly)
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'admin-username', 'admin-password'],
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve HTML files
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
//  Auth helper  (header-based, same as eBudget – no sessions)
// ─────────────────────────────────────────────────────────────
function isAdmin(req) {
  return (
    req.headers['admin-username'] === ADMIN_USER &&
    req.headers['admin-password'] === ADMIN_PASS
  );
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Unauthorised. Invalid admin credentials.' });
}

// ─────────────────────────────────────────────────────────────
//  Auth Routes
// ─────────────────────────────────────────────────────────────

// POST /api/auth/login  – validate creds, return ok
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials.' });
  }
});

// GET /api/auth/status  – always returns not-authed (stateless)
app.get('/api/auth/status', (_req, res) => {
  res.json({ isAdmin: false }); // stateless – frontend checks via header
});

// ─────────────────────────────────────────────────────────────
//  State Routes
// ─────────────────────────────────────────────────────────────

// GET /api/state  – public
app.get('/api/state', (_req, res) => {
  res.json(siteState);
});

// PUT /api/state  – admin only
app.put('/api/state', requireAdmin, async (req, res) => {
  try {
    const incoming = req.body;
    if (typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Body must be a JSON object.' });
    }
    siteState = incoming;
    await saveStateToCloudinary();
    res.json({ ok: true });
  } catch (err) {
    console.error('saveState error:', err);
    res.status(500).json({ error: 'Failed to save state.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  Image Upload
// ─────────────────────────────────────────────────────────────
app.post('/api/upload', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });
  try {
    const context = (req.body.context || 'misc').replace(/[^a-zA-Z0-9._-]/g, '_');
    const result  = await uploadImageToCloudinary(req.file.buffer, context);
    res.json({ ok: true, url: result.url, publicId: result.publicId, context });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

app.delete('/api/upload/:publicId(*)', requireAdmin, async (req, res) => {
  try {
    const result = await cloudinary.uploader.destroy(req.params.publicId);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  Contact Submissions
// ─────────────────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email and message are required.' });
  }
  if (!Array.isArray(siteState.submissions)) siteState.submissions = [];
  siteState.submissions.push({
    name, email, message,
    date: new Date().toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' }),
  });
  await saveStateToCloudinary();
  res.json({ ok: true });
});

app.get('/api/contact', requireAdmin, (_req, res) => {
  res.json({ ok: true, submissions: siteState.submissions || [] });
});

// ─────────────────────────────────────────────────────────────
//  Health check
// ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME,
    stateKeys: Object.keys(siteState).length,
  });
});

// ─────────────────────────────────────────────────────────────
//  Fallback
// ─────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────
//  Save on shutdown (same as eBudget)
// ─────────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('Shutting down, saving state...');
  await saveStateToCloudinary();
  process.exit(0);
});

// ─────────────────────────────────────────────────────────────
//  Boot: load state then start server
// ─────────────────────────────────────────────────────────────
loadStateFromCloudinary().then(() => {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║   MUK-BIOMEDSSA Server                              ║
║   http://localhost:${PORT}                              ║
║   Storage: Cloudinary (JSON + Images)               ║
╚══════════════════════════════════════════════════════╝
  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME || '⚠ NOT CONFIGURED'}
    `);
  });
});

module.exports = app;
