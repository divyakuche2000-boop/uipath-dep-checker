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
  if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
    cb(null, true);
  } else {
    cb(new Error('Only .zip files are allowed'), false);
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

    // Clean up zip
    fs.unlinkSync(req.file.path);

    const files = getAllFiles(extractPath);
    res.json({
      sessionId,
      originalName: req.file.originalname,
      extractedFiles: files.map(f => path.relative(extractPath, f)),
      extractPath
    });
  } catch (err) {
    console.error('[Upload] Extraction error:', err.message);
    res.status(500).json({ error: 'Failed to extract ZIP file.' });
  }
});

function getAllFiles(dir, result = []) {
  fs.readdirSync(dir).forEach(f => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) getAllFiles(full, result);
    else result.push(full);
  });
  return result;
}

module.exports = router;
