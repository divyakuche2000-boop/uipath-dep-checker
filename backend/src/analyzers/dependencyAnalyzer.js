'use strict';
const path = require('path');
const { parseProjectJson } = require('../parsers/projectJsonParser');
const { parseAllXamlFiles } = require('../parsers/xamlParser');
const { parseConfigXlsx } = require('../parsers/configXlsxParser');

// Known latest stable versions for common UiPath packages
const KNOWN_LATEST = {
  'UiPath.System.Activities': '24.10.0',
  'UiPath.UIAutomation.Activities': '24.10.0',
  'UiPath.Excel.Activities': '2.22.0',
  'UiPath.Mail.Activities': '1.23.0',
  'UiPath.Testing.Activities': '24.10.0',
  'UiPath.WebAPI.Activities': '1.13.0',
  'UiPath.Database.Activities': '1.8.0',
  'UiPath.Credentials.Activities': '1.4.0',
  'UiPath.PDF.Activities': '3.15.0',
  'UiPath.Word.Activities': '1.14.0',
  'UiPath.Salesforce.Activities': '2.6.0',
  'UiPath.GSuite.Activities': '2.6.0',
  'UiPath.ServiceNow.Activities': '2.4.0'
};

const EOL_PACKAGES = ['UiPath.System.Activities@19', 'UiPath.System.Activities@20', 'UiPath.UIAutomation.Activities@19'];

function semverMajor(v) { return parseInt((v || '0').split('.')[0], 10); }

function createFinding(category, name, location, status, issue, recommendation) {
  return { category, name, location, status, issue, recommendation };
}

// ── 1. Library / Package Analysis ──────────────────────────────────────────
function analyzePackages(projectData) {
  const findings = [];
  if (!projectData) {
    findings.push(createFinding('Library', 'project.json', 'Root', 'Fail',
      'project.json not found in project root.',
      'Ensure project.json exists at the root of the UiPath project.'));
    return findings;
  }
  if (projectData.error) {
    findings.push(createFinding('Library', 'project.json', 'Root', 'Fail', projectData.error,
      'Fix the JSON syntax in project.json.'));
    return findings;
  }

  const deps = projectData.dependencies || {};
  if (Object.keys(deps).length === 0) {
    findings.push(createFinding('Library', 'Dependencies', 'project.json', 'Warning',
      'No dependencies found in project.json.',
      'Verify the project.json is complete and contains the dependencies block.'));
  }

  Object.entries(deps).forEach(([pkg, versionRange]) => {
    const cleanVer = versionRange.replace(/[\[\]()>=<,\s]/g, '').split(' ')[0].trim();
    const latest = KNOWN_LATEST[pkg];

    if (EOL_PACKAGES.some(e => e.startsWith(pkg + '@' + semverMajor(cleanVer)))) {
      findings.push(createFinding('Library', pkg, 'project.json', 'Fail',
        `Package ${pkg}@${cleanVer} is End-of-Life.`,
        `Upgrade to the latest stable version (${latest || 'check UiPath marketplace'}).`));
    } else if (latest) {
      const latestMajor = semverMajor(latest);
      const currentMajor = semverMajor(cleanVer);
      if (currentMajor < latestMajor) {
        findings.push(createFinding('Library', pkg, 'project.json', 'Warning',
          `${pkg} version ${cleanVer} is outdated. Latest: ${latest}.`,
          `Update to ${latest} to get security patches and bug fixes.`));
      } else {
        findings.push(createFinding('Library', pkg, 'project.json', 'Pass',
          `${pkg}@${cleanVer} — version is current.`, ''));
      }
    } else {
      findings.push(createFinding('Library', pkg, 'project.json', 'Warning',
        `${pkg}@${cleanVer} — unable to verify against known latest (custom/internal package).`,
        'Confirm this package is available on the Dev NuGet feed and is actively maintained.'));
    }
  });

  // Target framework check
  const tf = (projectData.targetFramework || '').toLowerCase();
  if (!tf) {
    findings.push(createFinding('Library', 'targetFramework', 'project.json', 'Warning',
      'targetFramework is not specified.',
      'Specify targetFramework (Windows, Windows-Legacy, or Cross-platform) in project.json.'));
  } else {
    findings.push(createFinding('Library', 'targetFramework', 'project.json', 'Pass',
      `Target framework: ${projectData.targetFramework}`, ''));
  }

  return findings;
}

// ── 2. Orchestrator Dependency Analysis ─────────────────────────────────────
function analyzeOrchestratorDeps(xamlData) {
  const findings = [];
  const allQueues = new Set();
  const allAssets = new Set();
  const allCredentials = new Set();

  xamlData.forEach(xf => {
    if (xf.error) return;
    xf.queues.forEach(q => allQueues.add(JSON.stringify({ name: q, file: xf.fileName })));
    xf.assets.forEach(a => allAssets.add(JSON.stringify({ name: a, file: xf.fileName })));
    xf.credentials.forEach(c => allCredentials.add(JSON.stringify({ name: c, file: xf.fileName })));
  });

  if (allQueues.size === 0 && allAssets.size === 0 && allCredentials.size === 0) {
    findings.push(createFinding('Orchestrator', 'Orchestrator References', 'All .xaml files', 'Warning',
      'No Orchestrator queues, assets, or credentials detected in .xaml files.',
      'Verify manually if the project uses Orchestrator resources via Config.xlsx assets sheet.'));
  }

  allQueues.forEach(raw => {
    const { name, file } = JSON.parse(raw);
    findings.push(createFinding('Orchestrator', `Queue: ${name}`, file, 'Warning',
      `Queue "${name}" is referenced but cannot be verified without Orchestrator API access.`,
      `Confirm queue "${name}" exists in the Dev Orchestrator folder with matching schema (reference fields, max retries).`));
  });

  allAssets.forEach(raw => {
    const { name, file } = JSON.parse(raw);
    findings.push(createFinding('Orchestrator', `Asset: ${name}`, file, 'Warning',
      `Asset "${name}" is referenced. Dev environment value must be set.`,
      `Create asset "${name}" in the Dev Orchestrator folder with a Dev-specific value. Never share Prod asset values.`));
  });

  allCredentials.forEach(raw => {
    const { name, file } = JSON.parse(raw);
    findings.push(createFinding('Orchestrator', `Credential: ${name}`, file, 'Warning',
      `Credential asset "${name}" is referenced.`,
      `Store Dev service account credentials for "${name}" as an Orchestrator Credential Asset in the Dev folder. Ensure Prod credentials are NOT used in Dev.`));
  });

  return findings;
}

// ── 3. Data Dependency Analysis ──────────────────────────────────────────────
function analyzeDataDeps(xamlData, configData) {
  const findings = [];

  // Config.xlsx
  if (!configData.found) {
    findings.push(createFinding('Data', 'Config.xlsx', 'Data/', 'Fail',
      'Config.xlsx not found in project.',
      'Add Config.xlsx to the Data/ folder. This is required by REFramework for all settings and constants.'));
  } else if (configData.error) {
    findings.push(createFinding('Data', 'Config.xlsx', configData.filePath || 'Data/', 'Fail',
      configData.error, 'Fix the Excel file structure.'));
  } else {
    findings.push(createFinding('Data', 'Config.xlsx', configData.filePath, 'Pass',
      'Config.xlsx found and parsed successfully.', ''));

    // Check for blank/prod values in settings
    const allRows = [...(configData.settings || []), ...(configData.constants || [])];
    allRows.forEach((row, i) => {
      const val = String(row.Value || row.value || row.Setting || '').trim();
      const name = String(row.Name || row.Key || row.Setting || `Row ${i + 1}`).trim();
      if (!val || val === '' || val.toLowerCase() === 'tbd' || val.toLowerCase() === 'n/a') {
        findings.push(createFinding('Data', `Config: ${name}`, 'Config.xlsx › Settings', 'Fail',
          `Config key "${name}" has a blank or placeholder value.`,
          `Set a valid Dev value for "${name}" in Config.xlsx Settings sheet.`));
      } else if (val.toLowerCase().includes('prod') || val.toLowerCase().includes('production')) {
        findings.push(createFinding('Data', `Config: ${name}`, 'Config.xlsx › Settings', 'Fail',
          `Config key "${name}" appears to contain a PRODUCTION value: "${val}".`,
          `Replace with the Dev environment value. Production values must not appear in Dev configuration.`));
      } else if (val.startsWith('https://') || val.startsWith('http://')) {
        findings.push(createFinding('Data', `Config: ${name}`, 'Config.xlsx › Settings', 'Warning',
          `Config key "${name}" contains a URL: "${val}". Verify this is the Dev endpoint.`,
          'Confirm this URL points to the Dev environment, not production.'));
      }
    });
  }

  // Excel / file paths from XAML
  const seenPaths = new Set();
  xamlData.forEach(xf => {
    if (xf.error) return;

    xf.excelFiles.forEach(fp => {
      const key = `${fp}|${xf.fileName}`;
      if (seenPaths.has(key)) return;
      seenPaths.add(key);
      if (fp.match(/^[A-Za-z]:\\/)) {
        findings.push(createFinding('Data', `Excel File: ${path.basename(fp)}`, xf.fileName, 'Fail',
          `Hardcoded absolute Excel path found: "${fp}".`,
          'Move the file path to Config.xlsx Settings or an Orchestrator Asset. Hardcoded paths break on any machine other than the author\'s workstation.'));
      } else {
        findings.push(createFinding('Data', `Excel File: ${path.basename(fp)}`, xf.fileName, 'Warning',
          `Excel file reference: "${fp}". Verify file exists and Robot has read/write access.`,
          'Ensure the file is accessible to the Robot service account in the Dev environment.'));
      }
    });

    xf.filePaths.forEach(fp => {
      const key = `path|${fp}|${xf.fileName}`;
      if (seenPaths.has(key)) return;
      seenPaths.add(key);
      findings.push(createFinding('Data', `File Path: ${path.basename(fp)}`, xf.fileName, 'Fail',
        `Hardcoded file system path detected: "${fp}".`,
        'Move this path to Config.xlsx or an Orchestrator Asset and read it dynamically at runtime.'));
    });

    xf.dbConnections.forEach(conn => {
      const masked = conn.replace(/password=\S+/gi, 'password=***');
      findings.push(createFinding('Data', 'Database Connection', xf.fileName, 'Fail',
        `Hardcoded database connection string found: "${masked.substring(0, 80)}...".`,
        'Store connection strings in Orchestrator Credential Assets or IBM Key Protect. Never hardcode credentials in workflows.'));
    });
  });

  return findings;
}

// ── 4. Application & UI Selector Analysis ───────────────────────────────────
function analyzeAppDeps(xamlData) {
  const findings = [];
  const seenUrls = new Set();

  xamlData.forEach(xf => {
    if (xf.error) {
      findings.push(createFinding('Application', xf.fileName, xf.file || xf.fileName, 'Warning',
        `XAML parse error: ${xf.error}`, 'Fix the XAML file syntax and re-analyze.'));
      return;
    }

    // Selector issues
    xf.selectorIssues.forEach(si => {
      findings.push(createFinding('Application', `Selector [${si.attr}="${si.value}"]`, xf.fileName, 'Warning',
        `Hardcoded selector attribute ${si.attr}="${si.value}" may be environment-specific.`,
        `Parameterise the "${si.attr}" attribute using a variable from Config.xlsx. Use wildcards (*) for volatile segments.`));
    });

    // URLs
    xf.urls.forEach(url => {
      if (seenUrls.has(url + xf.fileName)) return;
      seenUrls.add(url + xf.fileName);
      if (url.toLowerCase().includes('prod') || url.toLowerCase().includes('production')) {
        findings.push(createFinding('Application', `URL: ${url.substring(0, 60)}`, xf.fileName, 'Fail',
          `Production URL detected: "${url}".`,
          'Replace with the Dev environment URL stored in Config.xlsx or an Orchestrator Asset.'));
      } else if (url.startsWith('http://')) {
        findings.push(createFinding('Application', `URL: ${url.substring(0, 60)}`, xf.fileName, 'Fail',
          `Insecure HTTP URL detected: "${url}". TLS is required.`,
          'Use HTTPS (TLS 1.2+) for all URLs. Update the application configuration if needed.'));
      } else {
        findings.push(createFinding('Application', `URL: ${url.substring(0, 60)}`, xf.fileName, 'Warning',
          `URL reference: "${url}". Confirm this is the Dev endpoint.`,
          'Verify URL points to Dev environment. Consider moving to Config.xlsx for environment portability.'));
      }
    });

    // Invoked workflows
    xf.invokedWorkflows.forEach(wf => {
      if (wf.startsWith('C:\\') || wf.startsWith('\\\\')) {
        findings.push(createFinding('Application', `Invoke: ${path.basename(wf)}`, xf.fileName, 'Fail',
          `Hardcoded absolute path for invoked workflow: "${wf}".`,
          'Use relative paths for Invoke Workflow File activities (e.g. "Workflows\\\\Process.xaml").'));
      }
    });
  });

  return findings;
}

// ── 5. Integration & Security Analysis ──────────────────────────────────────
function analyzeIntegrations(xamlData, configData) {
  const findings = [];

  // Check for hardcoded credentials in config
  if (configData.found && !configData.error) {
    const allRows = [...(configData.settings || []), ...(configData.constants || []), ...(configData.assets || [])];
    allRows.forEach((row, i) => {
      const name = String(row.Name || row.Key || row.Setting || `Row ${i + 1}`).toLowerCase();
      const val = String(row.Value || row.value || '');
      const isCredLike = ['password', 'secret', 'token', 'apikey', 'api_key', 'credential', 'pwd'].some(k => name.includes(k));
      if (isCredLike && val && val.trim() !== '' && !val.toLowerCase().startsWith('asset:') && !val.toLowerCase().startsWith('orchestrator')) {
        findings.push(createFinding('Integration', `Config: ${row.Name || name}`, 'Config.xlsx', 'Fail',
          `Potential hardcoded credential found in Config.xlsx for key "${row.Name || name}".`,
          'Remove the credential value from Config.xlsx. Store it as an Orchestrator Credential Asset and retrieve it at runtime using the Get Credential activity.'));
      }
    });
  }

  xamlData.forEach(xf => {
    if (xf.error) return;
    // Look for patterns that suggest inline API keys or tokens
    const CRED_INLINE = [
      /password\s*=\s*["'][^"']{4,}["']/gi,
      /apikey\s*=\s*["'][^"']{6,}["']/gi,
      /token\s*=\s*["'][^"']{8,}["']/gi,
      /secret\s*=\s*["'][^"']{6,}["']/gi
    ];
    // Re-read file to check
    try {
      const content = require('fs').readFileSync(xf.file, 'utf8');
      CRED_INLINE.forEach(rx => {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(content)) !== null) {
          findings.push(createFinding('Integration', 'Inline Credential', xf.fileName, 'Fail',
            `Potential hardcoded credential detected: "${m[0].substring(0, 60)}".`,
            'Remove hardcoded credentials from all XAML files immediately. Use Orchestrator Credential Assets or IBM Key Protect.'));
        }
      });
    } catch (_) {}
  });

  return findings;
}

// ── Master runner ────────────────────────────────────────────────────────────
async function runFullAnalysis(projectRoot) {
  const projectData = parseProjectJson(projectRoot);
  const xamlData = await parseAllXamlFiles(projectRoot);
  const configData = parseConfigXlsx(projectRoot);

  const packageFindings    = analyzePackages(projectData);
  const orchestratorFindings = analyzeOrchestratorDeps(xamlData);
  const dataFindings       = analyzeDataDeps(xamlData, configData);
  const appFindings        = analyzeAppDeps(xamlData);
  const integrationFindings = analyzeIntegrations(xamlData, configData);

  const allFindings = [
    ...packageFindings,
    ...orchestratorFindings,
    ...dataFindings,
    ...appFindings,
    ...integrationFindings
  ];

  const summary = {
    total: allFindings.length,
    pass: allFindings.filter(f => f.status === 'Pass').length,
    warning: allFindings.filter(f => f.status === 'Warning').length,
    fail: allFindings.filter(f => f.status === 'Fail').length,
    projectName: projectData?.name || 'Unknown',
    targetFramework: projectData?.targetFramework || 'Unknown',
    xamlFilesAnalyzed: xamlData.length,
    configFound: configData.found
  };

  return {
    summary,
    findings: allFindings,
    metadata: {
      analyzedAt: new Date().toISOString(),
      projectRoot
    }
  };
}

module.exports = { runFullAnalysis };
