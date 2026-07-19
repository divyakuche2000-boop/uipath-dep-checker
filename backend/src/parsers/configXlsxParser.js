'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function findConfigXlsx(projectRoot) {
  const candidates = ['Data/Config.xlsx', 'config/Config.xlsx', 'Config.xlsx', 'Data/config.xlsx'];
  for (const c of candidates) {
    const full = path.join(projectRoot, c);
    if (fs.existsSync(full)) return full;
  }
  // Search recursively
  let found = null;
  function walk(dir) {
    if (found) return;
    fs.readdirSync(dir).forEach(f => {
      if (found) return;
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.toLowerCase() === 'config.xlsx') found = full;
    });
  }
  walk(projectRoot);
  return found;
}

function parseConfigXlsx(projectRoot) {
  const filePath = findConfigXlsx(projectRoot);
  if (!filePath) return { found: false, settings: [], constants: [], assets: [] };

  try {
    const wb = XLSX.readFile(filePath);
    const result = { found: true, filePath, settings: [], constants: [], assets: [] };

    const sheetMap = { settings: 'settings', constants: 'constants', assets: 'assets' };
    wb.SheetNames.forEach(name => {
      const lower = name.toLowerCase();
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (lower.includes('setting')) result.settings = rows;
      else if (lower.includes('constant')) result.constants = rows;
      else if (lower.includes('asset')) result.assets = rows;
    });

    return result;
  } catch (e) {
    return { found: true, filePath, error: 'Failed to parse Config.xlsx: ' + e.message };
  }
}

module.exports = { parseConfigXlsx };
