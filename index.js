'use strict';

require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const cors         = require('cors');
const multer       = require('multer');
const cloudinary   = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const fs           = require('fs');
const path         = require('path');

// ─────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────
const PORT          = process.env.PORT || 3000;
const ADMIN_USER    = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS    = process.env.ADMIN_PASSWORD || 'biomedssa2025';
const STATE_FILE    = process.env.STATE_FILE_PATH || './data/state.json';
const CLD_FOLDER    = process.env.CLOUDINARY_FOLDER || 'muk-biomedssa';

// ─────────────────────────────────────────────────────────────
//  Cloudinary
// ─────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
});

// Multer storage – images go straight to Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    // Build a descriptive public_id from the upload context
    const context  = req.body.context || 'misc';          // e.g. logo, hero, product.0, highlight.2
    const ts       = Date.now();
    const publicId = `${CLD_FOLDER}/${context}_${ts}`;

    return {
      folder        : CLD_FOLDER,
      public_id     : publicId,
      resource_type : 'image',
      // Cloudinary will auto-detect format from the file
      format        : undefined,
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    };
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// ─────────────────────────────────────────────────────────────
//  State helpers  (JSON file on disk)
// ─────────────────────────────────────────────────────────────
function ensureDataDir() {
  const dir = path.dirname(path.resolve(STATE_FILE));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(data) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────
//  Express App
// ─────────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret           : process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave           : false,
  saveUninitialized: false,
  cookie           : {
    httpOnly: true,
    sameSite: 'lax',
    // Set secure:true in production (requires HTTPS)
    secure  : process.env.NODE_ENV === 'production',
    maxAge  : 8 * 60 * 60 * 1000,   // 8 hours
  },
}));

// Serve static HTML files
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

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/status
app.get('/api/auth/status', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ─────────────────────────────────────────────────────────────
//  State Routes  (text/JSON content)
// ─────────────────────────────────────────────────────────────

// GET /api/state  – public: main site reads this on load
app.get('/api/state', (_req, res) => {
  res.json(readState());
});

// PUT /api/state  – admin only: saves the full state object
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

// PATCH /api/state  – admin only: merge-update a subset of state keys
app.patch('/api/state', requireAdmin, (req, res) => {
  try {
    const current = readState();
    const patch    = req.body;
    const merged   = deepMerge(current, patch);
    writeState(merged);
    res.json({ ok: true, state: merged });
  } catch (err) {
    console.error('patchState error:', err);
    res.status(500).json({ error: 'Failed to patch state.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  Image Upload Routes  (Cloudinary)
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/upload
 * Field: image  (multipart/form-data)
 * Body:  context  – string describing where this image belongs
 *                   e.g. "logo", "hero.bg", "product.0", "product.0.pm.1",
 *                        "highlight.2", "mem.provider.0", "exec.3"
 *
 * Returns: { url, publicId, context }
 *   url      – the Cloudinary HTTPS URL to store in state
 *   publicId – Cloudinary public_id (needed for future deletion)
 */
app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file received.' });
  }
  res.json({
    ok      : true,
    url     : req.file.path,          // Cloudinary URL
    publicId: req.file.filename,      // Cloudinary public_id
    context : req.body.context || '',
  });
});

/**
 * DELETE /api/upload/:publicId
 * Removes an image from Cloudinary by its public_id.
 * Pass the publicId URL-encoded if it contains slashes.
 */
app.delete('/api/upload/:publicId(*)', requireAdmin, async (req, res) => {
  const publicId = req.params.publicId;
  if (!publicId) return res.status(400).json({ error: 'publicId is required.' });
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('Cloudinary delete error:', err);
    res.status(500).json({ error: 'Failed to delete image from Cloudinary.' });
  }
});

/**
 * GET /api/images
 * Returns all images in the Cloudinary folder (for admin gallery / cleanup).
 */
app.get('/api/images', requireAdmin, async (_req, res) => {
  try {
    const result = await cloudinary.api.resources({
      type      : 'upload',
      prefix    : CLD_FOLDER + '/',
      max_results: 200,
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

// POST /api/contact  – public: submitted by the contact form
app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email, and message are required.' });
  }
  try {
    const state = readState();
    if (!Array.isArray(state.submissions)) state.submissions = [];
    state.submissions.push({
      name,
      email,
      message,
      date: new Date().toISOString(),
    });
    writeState(state);
    res.json({ ok: true });
  } catch (err) {
    console.error('contact submission error:', err);
    res.status(500).json({ error: 'Failed to save submission.' });
  }
});

// GET /api/contact  – admin only: list all submissions
app.get('/api/contact', requireAdmin, (_req, res) => {
  const state = readState();
  res.json({ ok: true, submissions: state.submissions || [] });
});

// ─────────────────────────────────────────────────────────────
//  Health check
// ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// ─────────────────────────────────────────────────────────────
//  Fallback – serve index.html for client-side routing
// ─────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
function deepMerge(target, source) {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) output[key] = source[key];
        else output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    });
  }
  return output;
}
function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

// ─────────────────────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   MUK-BIOMEDSSA Server                  ║
  ║   http://localhost:${PORT}                  ║
  ╚══════════════════════════════════════════╝
  ENV   : ${process.env.NODE_ENV || 'development'}
  State : ${path.resolve(STATE_FILE)}
  CDN   : ${process.env.CLOUDINARY_CLOUD_NAME || '(not configured)'}
  `);
});

module.exports = app;
