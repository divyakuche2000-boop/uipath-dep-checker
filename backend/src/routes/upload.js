'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const EXTRACT_DIR = path.join(__dirname, '../../extracted');

// Ensure directories exist
[UPLOAD_DIR, EXTRACT_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});

const fileFilter = (_req, file, cb) => {
  const name = file.originalname.toLowerCase();
  // Accept standard automation project ZIPs and published .nupkg packages
  if (
    file.mimetype === 'application/zip' ||
    file.mimetype === 'application/x-zip-compressed' ||
    file.mimetype === 'application/octet-stream' ||
    name.endsWith('.zip') ||
    name.endsWith('.nupkg')
  ) {
    cb(null, true);
  } else {
    cb(new Error('Only .zip and .nupkg files are allowed'), false);
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/', upload.single('project'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded or invalid file type.' });

  const sessionId = uuidv4();
  const extractPath = path.join(EXTRACT_DIR, sessionId);

  try {
    fs.mkdirSync(extractPath, { recursive: true });
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(extractPath, true);

    // Clean up uploaded archive
    fs.unlinkSync(req.file.path);

    // Resolve the actual project root (handles both ZIP and nupkg layouts)
    const projectRoot = resolveProjectRoot(extractPath);

    const files = getAllFiles(extractPath);
    res.json({
      sessionId,
      originalName: req.file.originalname,
      extractedFiles: files.map(f => path.relative(extractPath, f)),
      extractPath,
      // Expose resolved project root relative to extraction path (for diagnostics)
      projectRoot: path.relative(extractPath, projectRoot)
    });
  } catch (err) {
    console.error('[Upload] Extraction error:', err.message);
    res.status(500).json({ error: 'Failed to extract ZIP file.' });
  }
});

/**
 * Resolve the automation project root inside an extracted directory.
 *
 * Lookup priority:
 *  1. content/project.json   — published .nupkg package layout
 *  2. <subdir>/project.json  — standard ZIP where the project lives in a named subdirectory
 *  3. project.json at root   — flat ZIP (less common but valid)
 *
 * Returns `extractPath` unchanged when no project.json can be found at all
 * (the analyzer will then produce a "not found" finding).
 */
function resolveProjectRoot(extractPath) {
  // 1. nupkg: content/ subfolder
  const contentRoot = path.join(extractPath, 'content');
  if (fs.existsSync(path.join(contentRoot, 'project.json'))) return contentRoot;

  // 2. project.json at root
  if (fs.existsSync(path.join(extractPath, 'project.json'))) return extractPath;

  // 3. Single named sub-directory (standard automation project ZIP)
  try {
    const entries = fs.readdirSync(extractPath).filter(f =>
      fs.statSync(path.join(extractPath, f)).isDirectory()
    );
    for (const entry of entries) {
      const candidate = path.join(extractPath, entry);
      if (fs.existsSync(path.join(candidate, 'project.json'))) return candidate;
    }
  } catch (_) {}

  return extractPath;
}

function getAllFiles(dir, result = []) {
  fs.readdirSync(dir).forEach(f => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) getAllFiles(full, result);
    else result.push(full);
  });
  return result;
}

module.exports = router;
