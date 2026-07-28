'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Environment sheet name patterns — used to classify sheets by environment
const ENV_SHEET_PATTERNS = [
  { env: 'Development', patterns: ['dev', 'development', 'local'] },
  { env: 'UAT',         patterns: ['uat', 'sit', 'test', 'staging', 'qa'] },
  { env: 'Production',  patterns: ['prod', 'production', 'prd', 'live'] }
];

/**
 * Find the most relevant Config.xlsx in the project.
 *
 * Strategy: collect ALL Config.xlsx files across the project tree, then
 * select the one with the most non-asset data rows — that file is the
 * real configuration source (e.g. root-level Config.xlsx with Dev/UAT/Prod
 * sheets) rather than a REFramework stub (Data/Config.xlsx with ~15 rows).
 *
 * Tie-break: prefer files higher in the directory tree (shorter relative path).
 */
function findConfigXlsx(projectRoot) {
  const candidates = [];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    entries.forEach(f => {
      const full = path.join(dir, f);
      let stat;
      try { stat = fs.statSync(full); } catch (_) { return; }
      if (stat.isDirectory()) walk(full);
      else if (f.toLowerCase() === 'config.xlsx') candidates.push(full);
    });
  }
  walk(projectRoot);

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Score each candidate: count non-asset data rows across all sheets.
  // More rows = richer / more authoritative configuration file.
  let best = candidates[0];
  let bestScore = -1;

  candidates.forEach(filePath => {
    try {
      const wb = XLSX.readFile(filePath);
      let dataRows = 0;
      wb.SheetNames.forEach(name => {
        if (name.toLowerCase().includes('asset')) return; // exclude asset-only sheets from scoring
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
        dataRows += rows.length;
      });
      // Tie-break: prefer shallower paths (fewer path separators = closer to root)
      const depth = filePath.split(path.sep).length;
      const score = dataRows * 1000 - depth; // large row-count weight, small depth penalty
      if (score > bestScore) {
        bestScore = score;
        best = filePath;
      }
    } catch (_) { /* skip unparseable files */ }
  });

  return best;
}

/**
 * Classify a sheet name into a known environment label or return null.
 */
function classifySheetEnv(sheetName) {
  const lower = sheetName.toLowerCase();
  for (const { env, patterns } of ENV_SHEET_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) return env;
  }
  return null;
}

/**
 * Parse Config.xlsx dynamically.
 *
 * - Reads ALL sheets without assuming fixed names.
 * - Classifies sheets as settings/constants/assets by name heuristics.
 * - Also exposes every sheet's raw rows under `sheets` keyed by the original sheet name,
 *   and groups environment-specific sheets under `envSheets`.
 * - Validation is value-based (blank / placeholder) rather than key-name based.
 */
function parseConfigXlsx(projectRoot) {
  const filePath = findConfigXlsx(projectRoot);
  if (!filePath) return { found: false, settings: [], constants: [], assets: [], sheets: {}, envSheets: {} };

  try {
    const wb = XLSX.readFile(filePath);
    const result = {
      found: true,
      filePath,
      sheetNames: wb.SheetNames,
      settings:   [],
      constants:  [],
      assets:     [],
      sheets:     {},   // all sheets keyed by name
      envSheets:  {}    // environment-classified sheets keyed by env label
    };

    wb.SheetNames.forEach(name => {
      const lower = name.toLowerCase();
      const ws    = wb.Sheets[name];
      const rows  = XLSX.utils.sheet_to_json(ws, { defval: '' });

      // Store raw sheet data
      result.sheets[name] = rows;

      // Classify by sheet name heuristic
      if (lower.includes('setting')) {
        result.settings = result.settings.concat(rows);
      } else if (lower.includes('constant')) {
        result.constants = result.constants.concat(rows);
      } else if (lower.includes('asset')) {
        result.assets = result.assets.concat(rows);
      }

      // Classify environment-specific sheets
      const envLabel = classifySheetEnv(name);
      if (envLabel) {
        if (!result.envSheets[envLabel]) result.envSheets[envLabel] = [];
        result.envSheets[envLabel] = result.envSheets[envLabel].concat(rows);
      }
    });

    // If no explicit settings/constants sheets were found, treat all non-asset sheets
    // as the generic configuration pool so validation still works.
    if (result.settings.length === 0 && result.constants.length === 0) {
      wb.SheetNames.forEach(name => {
        const lower = name.toLowerCase();
        if (!lower.includes('asset')) {
          result.settings = result.settings.concat(result.sheets[name]);
        }
      });
    }

    return result;
  } catch (e) {
    return { found: true, filePath, error: 'Failed to parse Config.xlsx: ' + e.message };
  }
}

module.exports = { parseConfigXlsx };
