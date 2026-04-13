'use strict';

require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const cors       = require('cors');
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const fs         = require('fs');
const path       = require('path');
const { Readable } = require('stream');

// ─────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'biomedssa2025';
const STATE_FILE = process.env.STATE_FILE_PATH || './data/state.json';
const CLD_FOLDER = process.env.CLOUDINARY_FOLDER || 'muk-biomedssa';

// ─────────────────────────────────────────────────────────────
//  Cloudinary v2  (no multer-storage-cloudinary needed)
// ─────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
});

// Upload a Buffer to Cloudinary using upload_stream
function uploadToCloudinary(buffer, context) {
  return new Promise((resolve, reject) => {
    const publicId = `${CLD_FOLDER}/${context}_${Date.now()}`;
    const stream = cloudinary.uploader.upload_stream(
      {
        folder        : CLD_FOLDER,
        public_id     : publicId,
        resource_type : 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

// ─────────────────────────────────────────────────────────────
//  Multer – memory storage, buffer sent to Cloudinary
// ─────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// ─────────────────────────────────────────────────────────────
//  State helpers (JSON file on disk)
// ─────────────────────────────────────────────────────────────
function ensureDataDir() {
  const dir = path.dirname(path.resolve(STATE_FILE));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function readState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}
function writeState(data) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────
//  Express App
// ─────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret           : process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave           : false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure  : process.env.NODE_ENV === 'production',
    maxAge  : 8 * 60 * 60 * 1000,
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
//  Auth middleware
// ─────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorised. Please log in.' });
}

// ─────────────────────────────────────────────────────────────
//  Auth Routes
// ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/status', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ─────────────────────────────────────────────────────────────
//  State Routes
// ─────────────────────────────────────────────────────────────
app.get('/api/state', (_req, res) => {
  res.json(readState());
});

app.put('/api/state', requireAdmin, (req, res) => {
  try {
    const incoming = req.body;
    if (typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Body must be a JSON object.' });
    }
    writeState(incoming);
    res.json({ ok: true });
  } catch (err) {
    console.error('writeState error:', err);
    res.status(500).json({ error: 'Failed to save state.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  Image Upload (Cloudinary v2 via upload_stream)
// ─────────────────────────────────────────────────────────────
app.post('/api/upload', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });
  try {
    const context = (req.body.context || 'misc').replace(/[^a-zA-Z0-9._-]/g, '_');
    const result  = await uploadToCloudinary(req.file.buffer, context);
    res.json({ ok: true, url: result.url, publicId: result.publicId, context });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ error: 'Image upload failed: ' + err.message });
  }
});

app.delete('/api/upload/:publicId(*)', requireAdmin, async (req, res) => {
  const publicId = req.params.publicId;
  if (!publicId) return res.status(400).json({ error: 'publicId is required.' });
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('Cloudinary delete error:', err);
    res.status(500).json({ error: 'Failed to delete image.' });
  }
});

app.get('/api/images', requireAdmin, async (_req, res) => {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload', prefix: CLD_FOLDER + '/', max_results: 200,
    });
    res.json({ ok: true, images: result.resources });
  } catch (err) {
    console.error('Cloudinary list error:', err);
    res.status(500).json({ error: 'Failed to list images.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  Contact Submissions
// ─────────────────────────────────────────────────────────────
app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email, and message are required.' });
  }
  try {
    const state = readState();
    if (!Array.isArray(state.submissions)) state.submissions = [];
    state.submissions.push({
      name, email, message,
      date: new Date().toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' }),
    });
    writeState(state);
    res.json({ ok: true });
  } catch (err) {
    console.error('contact error:', err);
    res.status(500).json({ error: 'Failed to save submission.' });
  }
});

app.get('/api/contact', requireAdmin, (_req, res) => {
  const state = readState();
  res.json({ ok: true, submissions: state.submissions || [] });
});

// ─────────────────────────────────────────────────────────────
//  Health check
// ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    ok        : true,
    env       : process.env.NODE_ENV || 'development',
    cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME,
  });
});

// ─────────────────────────────────────────────────────────────
//  Fallback – serve index.html
// ─────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   MUK-BIOMEDSSA Server                  ║
  ║   http://localhost:${PORT}                  ║
  ╚══════════════════════════════════════════╝
  ENV       : ${process.env.NODE_ENV || 'development'}
  State     : ${path.resolve(STATE_FILE)}
  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME || '⚠ NOT CONFIGURED'}
  `);
});

module.exports = app;
