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

  // Optional target environment label forwarded from the UI (e.g. "Development", "UAT", "Production")
  const targetEnvironment = (req.body && typeof req.body.targetEnvironment === 'string')
    ? req.body.targetEnvironment.trim()
    : '';

  try {
    // Resolve the real project root (handles both standard ZIP and nupkg layouts)
    const projectRoot = resolveProjectRoot(extractPath);
    const report = await runFullAnalysis(projectRoot, targetEnvironment);
    res.json(report);
  } catch (err) {
    console.error('[Analysis] Error:', err.message);
    res.status(500).json({ error: 'Validation failed: ' + err.message });
  }
});

/**
 * Resolve the automation project root inside an extracted directory.
 *
 * Lookup priority:
 *  1. content/project.json   — published .nupkg package layout
 *  2. <subdir>/project.json  — standard ZIP where the project lives in a named subdirectory
 *  3. project.json at root   — flat ZIP (less common but valid)
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

module.exports = router;
