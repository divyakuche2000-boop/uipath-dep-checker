'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { runFullAnalysis } = require('../analyzers/dependencyAnalyzer');

const router = express.Router();
const EXTRACT_DIR = path.join(__dirname, '../../extracted');

router.post('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const extractPath = path.join(EXTRACT_DIR, sessionId);

  if (!fs.existsSync(extractPath)) {
    return res.status(404).json({ error: 'Session not found. Please re-upload the project.' });
  }

  try {
    const report = await runFullAnalysis(extractPath);
    res.json(report);
  } catch (err) {
    console.error('[Analysis] Error:', err.message);
    res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
});

module.exports = router;
