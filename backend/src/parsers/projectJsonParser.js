'use strict';
const fs = require('fs');
const path = require('path');

function parseProjectJson(projectRoot) {
  const filePath = path.join(projectRoot, 'project.json');
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      name: raw.name || 'Unknown',
      description: raw.description || '',
      projectVersion: raw.projectVersion || '',
      studioVersion: raw.studioVersion || '',
      targetFramework: raw.targetFramework || raw.runtimeOptions || 'Unknown',
      dependencies: raw.dependencies || {},
      designOptions: raw.designOptions || {},
      entryPoints: raw.entryPoints || [],
      raw
    };
  } catch (e) {
    return { error: 'Failed to parse project.json: ' + e.message };
  }
}

module.exports = { parseProjectJson };
