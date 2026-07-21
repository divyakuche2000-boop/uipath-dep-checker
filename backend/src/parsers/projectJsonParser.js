'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Normalise the targetFramework value from project.json.
 *
 * UiPath stores the framework in two ways depending on the schema version:
 *   - New (schema ≥ 4): `"targetFramework": "Windows"` / `"Cross-Platform"` / `"Windows-Legacy"`
 *   - Old (schema < 4): `"runtimeOptions": { "netFrameworkLazyLoading": true }` — no explicit key
 *
 * We inspect `runtimeOptions.netFrameworkLazyLoading` as a fallback:
 *   true  → Windows-Legacy (.NET Framework)
 *   false → Windows (.NET)
 */
function resolveTargetFramework(raw) {
  if (raw.targetFramework && typeof raw.targetFramework === 'string') {
    return raw.targetFramework;
  }
  if (raw.runtimeOptions && typeof raw.runtimeOptions === 'object') {
    return raw.runtimeOptions.netFrameworkLazyLoading ? 'Windows-Legacy' : 'Windows';
  }
  return 'Unknown';
}

function parseProjectJson(projectRoot) {
  const filePath = path.join(projectRoot, 'project.json');
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const targetFramework = resolveTargetFramework(raw);
    const runtimeOptions  = raw.runtimeOptions || {};
    const designOptions   = raw.designOptions  || {};

    return {
      name:               raw.name               || 'Unknown',
      description:        raw.description        || '',
      projectVersion:     raw.projectVersion      || '',
      studioVersion:      raw.studioVersion       || '',
      // robotVersion lives inside runtimeOptions in newer schema versions
      robotVersion:       runtimeOptions.robotVersion || '',
      targetFramework,
      // expressionLanguage: VisualBasic | CSharp
      expressionLanguage: raw.expressionLanguage  || 'Unknown',
      // outputType: Process | Library | Test | etc.
      outputType:         designOptions.outputType || raw.outputType || 'Unknown',
      dependencies:       raw.dependencies        || {},
      entryPoints:        raw.entryPoints         || [],
      // Process arguments defined at project level
      arguments:          raw.arguments           || null,
      designOptions,
      runtimeOptions,
      raw
    };
  } catch (e) {
    return { error: 'Failed to parse project.json: ' + e.message };
  }
}

module.exports = { parseProjectJson };
