'use strict';

/**
 * storage/cloudinary.js
 *
 * Cloudinary helpers for MUK-BIOMEDSSA.
 *
 * Handles:
 *   - Uploading images (logo, hero bg, product photos,
 *     payment method logos, membership provider logos,
 *     highlight photos, executive portraits)
 *   - Deleting images by publicId
 *   - Listing all images in the project folder
 *   - Generating optimised transformation URLs
 *
 * All image public_ids follow the pattern:
 *   muk-biomedssa/{context}_{timestamp}
 *
 * Context examples:
 *   logo              – site logo
 *   hero.bg           – hero background photo
 *   exec.{i}          – executive portrait
 *   highlight.{i}     – highlight event photo
 *   product.{i}       – product main photo
 *   product.{i}.pm.{mi} – product payment method logo
 *   mem.provider.{i}  – membership payment provider logo
 */

require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = process.env.CLOUDINARY_FOLDER || 'muk-biomedssa';

// ─────────────────────────────────────────────────────────────
//  Upload
// ─────────────────────────────────────────────────────────────

/**
 * uploadImage(filePathOrDataUrl, context)
 *
 * Uploads a file (local path or base64 data URL) to Cloudinary.
 *
 * @param {string} source   – local file path OR base64 data URL
 * @param {string} context  – descriptive key, e.g. "logo", "product.0"
 * @returns {Promise<{ url, publicId, width, height, format }>}
 */
async function uploadImage(source, context = 'misc') {
  const publicId = `${FOLDER}/${context}_${Date.now()}`;

  const result = await cloudinary.uploader.upload(source, {
    public_id     : publicId,
    folder        : FOLDER,
    resource_type : 'image',
    overwrite     : true,
    transformation: [
      { quality: 'auto', fetch_format: 'auto' },
    ],
  });

  return {
    url     : result.secure_url,
    publicId: result.public_id,
    width   : result.width,
    height  : result.height,
    format  : result.format,
  };
}

/**
 * uploadFromMulter(file, context)
 *
 * Uploads a file received via multer (req.file) to Cloudinary.
 * file.path is a temporary local path written by multer's diskStorage,
 * or file.buffer if using memoryStorage.
 *
 * @param {object} file     – multer file object
 * @param {string} context  – descriptive key
 * @returns {Promise<{ url, publicId }>}
 */
async function uploadFromMulter(file, context = 'misc') {
  // Support both diskStorage (path) and memoryStorage (buffer)
  const source = file.path
    ? file.path
    : `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

  return uploadImage(source, context);
}

// ─────────────────────────────────────────────────────────────
//  Delete
// ─────────────────────────────────────────────────────────────

/**
 * deleteImage(publicId)
 *
 * Removes an image from Cloudinary.
 *
 * @param {string} publicId  – Cloudinary public_id
 * @returns {Promise<{ result: 'ok' | 'not found' }>}
 */
async function deleteImage(publicId) {
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
  });
  return { result: result.result };
}

// ─────────────────────────────────────────────────────────────
//  List
// ─────────────────────────────────────────────────────────────

/**
 * listImages(prefix)
 *
 * Returns all images stored under the given prefix (defaults to the project folder).
 *
 * @param {string} [prefix]   – folder prefix, defaults to FOLDER
 * @param {number} [maxResults] – max images to return (default 200)
 * @returns {Promise<Array<{ publicId, url, width, height, format, createdAt }>>}
 */
async function listImages(prefix = FOLDER, maxResults = 200) {
  const result = await cloudinary.api.resources({
    type        : 'upload',
    prefix      : prefix.endsWith('/') ? prefix : prefix + '/',
    max_results : maxResults,
  });

  return result.resources.map(r => ({
    publicId : r.public_id,
    url      : r.secure_url,
    width    : r.width,
    height   : r.height,
    format   : r.format,
    createdAt: r.created_at,
  }));
}

// ─────────────────────────────────────────────────────────────
//  URL Transforms  (generate optimised variants on the fly)
// ─────────────────────────────────────────────────────────────

/**
 * thumbnailUrl(publicId, width, height)
 *
 * Returns a Cloudinary URL cropped and resized to the given dimensions.
 *
 * @param {string} publicId
 * @param {number} [width=400]
 * @param {number} [height=400]
 * @returns {string}
 */
function thumbnailUrl(publicId, width = 400, height = 400) {
  return cloudinary.url(publicId, {
    width,
    height,
    crop         : 'fill',
    gravity      : 'auto',
    quality      : 'auto',
    fetch_format : 'auto',
    secure       : true,
  });
}

/**
 * heroUrl(publicId)
 *
 * Returns a wide hero-sized (1600 × 900) URL.
 *
 * @param {string} publicId
 * @returns {string}
 */
function heroUrl(publicId) {
  return cloudinary.url(publicId, {
    width        : 1600,
    height       : 900,
    crop         : 'fill',
    gravity      : 'auto',
    quality      : 'auto',
    fetch_format : 'auto',
    secure       : true,
  });
}

/**
 * logoUrl(publicId)
 *
 * Returns a square logo URL (200 × 200, padded).
 *
 * @param {string} publicId
 * @returns {string}
 */
function logoUrl(publicId) {
  return cloudinary.url(publicId, {
    width        : 200,
    height       : 200,
    crop         : 'pad',
    background   : 'auto',
    quality      : 'auto',
    fetch_format : 'auto',
    secure       : true,
  });
}

// ─────────────────────────────────────────────────────────────
//  Context key mapping (matches what the HTML frontend uses)
// ─────────────────────────────────────────────────────────────

/**
 * contextKey(type, ...indices)
 *
 * Generates the context string used as the Cloudinary public_id segment
 * and also stored in state.json to identify which image belongs where.
 *
 * Usage:
 *   contextKey('logo')              → 'logo'
 *   contextKey('hero.bg')           → 'hero.bg'
 *   contextKey('exec', 0)           → 'exec.0'
 *   contextKey('highlight', 2)      → 'highlight.2'
 *   contextKey('product', 1)        → 'product.1'
 *   contextKey('product.pm', 1, 0)  → 'product.1.pm.0'
 *   contextKey('mem.provider', 3)   → 'mem.provider.3'
 */
function contextKey(type, ...indices) {
  if (!indices.length) return type;
  // For product.pm we need to interleave: product.{i}.pm.{mi}
  if (type === 'product.pm') {
    const [i, mi] = indices;
    return `product.${i}.pm.${mi}`;
  }
  return `${type}.${indices.join('.')}`;
}

// ─────────────────────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────────────────────
module.exports = {
  cloudinary,       // raw cloudinary instance if needed
  uploadImage,
  uploadFromMulter,
  deleteImage,
  listImages,
  thumbnailUrl,
  heroUrl,
  logoUrl,
  contextKey,
  FOLDER,
};
