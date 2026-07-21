'use strict';
const fs = require('fs');
const path = require('path');
const { parseProjectJson } = require('../parsers/projectJsonParser');
const { parseAllXamlFiles } = require('../parsers/xamlParser');
const { parseConfigXlsx } = require('../parsers/configXlsxParser');

// Known latest stable versions for common automation platform packages
const KNOWN_LATEST = {
  // UiPath
  'UiPath.System.Activities':        '24.10.0',
  'UiPath.UIAutomation.Activities':  '24.10.0',
  'UiPath.Excel.Activities':         '2.22.0',
  'UiPath.Mail.Activities':          '1.23.0',
  'UiPath.Testing.Activities':       '24.10.0',
  'UiPath.WebAPI.Activities':        '1.13.0',
  'UiPath.Database.Activities':      '1.8.0',
  'UiPath.Credentials.Activities':   '1.4.0',
  'UiPath.PDF.Activities':           '3.15.0',
  'UiPath.Word.Activities':          '1.14.0',
  'UiPath.Salesforce.Activities':    '2.6.0',
  'UiPath.GSuite.Activities':        '2.6.0',
  'UiPath.ServiceNow.Activities':    '2.4.0'
};

const EOL_PACKAGES = [
  'UiPath.System.Activities@19',
  'UiPath.System.Activities@20',
  'UiPath.UIAutomation.Activities@19'
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function semverMajor(v) { return parseInt((v || '0').split('.')[0], 10); }

function createFinding(category, name, location, status, issue, recommendation) {
  return { category, name, location, status, issue, recommendation };
}

/**
 * Returns a short environment label for use in messages.
 * When a specific environment is provided it becomes the reference.
 * When blank, all messages are kept fully generic.
 */
function envRef(targetEnvironment) {
  return targetEnvironment ? `the ${targetEnvironment} environment` : 'the target environment';
}

/**
 * Detect whether this project follows the REFramework pattern.
 *
 * Signals (any one is sufficient):
 *  1. A `Framework/` subdirectory containing ≥ 3 of the canonical REF workflow
 *     files (GetTransactionData.xaml, Process.xaml, SetTransactionStatus.xaml,
 *     InitAllApplications.xaml / CloseAllApplications.xaml, etc.)
 *  2. project.json description mentions "REFramework" or "reframework"
 *  3. project.json name contains "Dispatcher" or "Performer" (common REF naming)
 */
function detectReFramework(projectRoot, projectData) {
  // 1. Check Framework/ folder contents
  const frameworkDir = path.join(projectRoot, 'Framework');
  if (fs.existsSync(frameworkDir)) {
    const REF_FILES = [
      'GetTransactionData.xaml',
      'Process.xaml',
      'SetTransactionStatus.xaml',
      'InitAllApplications.xaml',
      'CloseAllApplications.xaml',
      'KillAllProcesses.xaml',
      'RetryCurrentTransaction.xaml',
      'TakeScreenshot.xaml'
    ];
    try {
      const present = fs.readdirSync(frameworkDir).map(f => f.toLowerCase());
      const matches = REF_FILES.filter(rf => present.includes(rf.toLowerCase()));
      if (matches.length >= 3) return true;
    } catch (_) {}
  }

  if (!projectData || projectData.error) return false;

  // 2. Description mentions REFramework
  const desc = (projectData.description || '').toLowerCase();
  if (desc.includes('reframework') || desc.includes('re-framework') || desc.includes('robotic enterprise framework')) {
    return true;
  }

  // 3. Project name suggests REF pattern
  const name = (projectData.name || '').toLowerCase();
  if (name.includes('dispatcher') || name.includes('performer')) return true;

  return false;
}

// ── 1. Project Summary / Package Analysis ─────────────────────────────────────

function analyzePackages(projectData, targetEnvironment) {
  const findings = [];
  if (!projectData) {
    findings.push(createFinding('Project Summary', 'project.json', 'Root', 'Fail',
      'project.json not found in project root.',
      'Ensure project.json exists at the root of the automation project.'));
    return findings;
  }
  if (projectData.error) {
    findings.push(createFinding('Project Summary', 'project.json', 'Root', 'Fail', projectData.error,
      'Fix the JSON syntax in project.json.'));
    return findings;
  }

  const deps = projectData.dependencies || {};
  if (Object.keys(deps).length === 0) {
    findings.push(createFinding('Project Summary', 'Dependencies', 'project.json', 'Warning',
      'No dependencies found in project.json.',
      'Verify the project.json is complete and contains the dependencies block.'));
  }

  Object.entries(deps).forEach(([pkg, versionRange]) => {
    const cleanVer = versionRange.replace(/[\[\]()>=<,\s]/g, '').split(' ')[0].trim();
    const latest   = KNOWN_LATEST[pkg];

    if (EOL_PACKAGES.some(e => e === pkg + '@' + semverMajor(cleanVer))) {
      findings.push(createFinding('Project Summary', pkg, 'project.json', 'Fail',
        `Package ${pkg}@${cleanVer} is End-of-Life.`,
        `Upgrade to the latest stable version (${latest || 'check the package marketplace'}).`));
    } else if (latest) {
      const latestMajor  = semverMajor(latest);
      const currentMajor = semverMajor(cleanVer);
      if (currentMajor < latestMajor) {
        findings.push(createFinding('Project Summary', pkg, 'project.json', 'Warning',
          `${pkg} version ${cleanVer} is outdated. Latest: ${latest}.`,
          `Update to ${latest} to get security patches and bug fixes.`));
      } else {
        findings.push(createFinding('Project Summary', pkg, 'project.json', 'Pass',
          `${pkg}@${cleanVer} — version is current.`, ''));
      }
    } else {
      findings.push(createFinding('Project Summary', pkg, 'project.json', 'Warning',
        `${pkg}@${cleanVer} — unable to verify against known latest (custom/internal package).`,
        'Confirm this package is available in the configured package repository and is actively maintained.'));
    }
  });

  // Target framework check
  const tf = (projectData.targetFramework || '').toLowerCase();
  if (!tf || tf === 'unknown') {
    findings.push(createFinding('Project Summary', 'targetFramework', 'project.json', 'Warning',
      'targetFramework is not specified.',
      'Specify targetFramework (Windows, Windows-Legacy, or Cross-platform) in project.json.'));
  } else {
    findings.push(createFinding('Project Summary', 'targetFramework', 'project.json', 'Pass',
      `Target framework: ${projectData.targetFramework}`, ''));
  }

  // Compatibility: Windows-Legacy uses .NET Framework which is EOL for new projects
  const tfLower = (projectData.targetFramework || '').toLowerCase();
  if (tfLower === 'windows-legacy') {
    findings.push(createFinding('Project Summary', 'targetFramework compatibility', 'project.json', 'Warning',
      'Project targets Windows-Legacy (.NET Framework 4.6.1). This target is deprecated for new projects.',
      'Migrate to the Windows target (.NET 6/8) for long-term support.'));
  }

  return findings;
}

// ── 2. Dependency Analysis (Control Plane resources) ─────────────────────────

function analyzeOrchestratorDeps(xamlData, targetEnvironment) {
  const findings = [];
  const allQueues      = new Set();
  const allAssets      = new Set();
  const allCredentials = new Set();

  xamlData.forEach(xf => {
    if (xf.error) return;
    xf.queues.forEach(q       => allQueues.add(JSON.stringify({ name: q, file: xf.fileName })));
    xf.assets.forEach(a       => allAssets.add(JSON.stringify({ name: a, file: xf.fileName })));
    xf.credentials.forEach(c  => allCredentials.add(JSON.stringify({ name: c, file: xf.fileName })));
  });

  if (allQueues.size === 0 && allAssets.size === 0 && allCredentials.size === 0) {
    findings.push(createFinding('Dependencies', 'Control Plane References', 'All workflow files', 'Warning',
      'No control plane queues, assets, or credentials detected in workflow files.',
      'Verify manually if the project uses control plane resources via configuration assets.'));
  }

  allQueues.forEach(raw => {
    const { name, file } = JSON.parse(raw);
    findings.push(createFinding('Dependencies', `Queue: ${name}`, file, 'Warning',
      `Queue "${name}" is referenced but cannot be verified without control plane API access.`,
      `Confirm queue "${name}" exists in ${envRef(targetEnvironment)} with the correct schema (reference fields, max retries).`));
  });

  allAssets.forEach(raw => {
    const { name, file } = JSON.parse(raw);
    findings.push(createFinding('Dependencies', `Asset: ${name}`, file, 'Warning',
      `Asset "${name}" is referenced. Verify it is available in the target environment.`,
      `Confirm asset "${name}" is configured in ${envRef(targetEnvironment)} with an appropriate value. Avoid reusing configuration values across environments.`));
  });

  allCredentials.forEach(raw => {
    const { name, file } = JSON.parse(raw);
    findings.push(createFinding('Dependencies', `Credential: ${name}`, file, 'Warning',
      `Credential asset "${name}" is referenced. Verify it exists in the target environment.`,
      `Ensure the credential "${name}" is stored as a Credential Asset in ${envRef(targetEnvironment)}. Credentials must be environment-specific and must not be shared across environments.`));
  });

  return findings;
}

// ── 3. Configuration Validation ───────────────────────────────────────────────

function analyzeDataDeps(xamlData, configData, targetEnvironment) {
  const findings = [];

  // Config file
  if (!configData.found) {
    findings.push(createFinding('Configuration Validation', 'Config.xlsx', 'Data/', 'Fail',
      'Config.xlsx not found in project.',
      'Add Config.xlsx to the Data/ folder. This file is required as the project configuration source.'));
  } else if (configData.error) {
    findings.push(createFinding('Configuration Validation', 'Config.xlsx', configData.filePath || 'Data/', 'Fail',
      configData.error, 'Fix the Excel file structure.'));
  } else {
    findings.push(createFinding('Configuration Validation', 'Config.xlsx', configData.filePath, 'Pass',
      'Config.xlsx found and parsed successfully.', ''));

    const allRows = [...(configData.settings || []), ...(configData.constants || [])];
    allRows.forEach((row, i) => {
      const val  = String(row.Value || row.value || row.Setting || '').trim();
      const name = String(row.Name  || row.Key   || row.Setting || `Row ${i + 1}`).trim();
      if (!val || val.toLowerCase() === 'tbd' || val.toLowerCase() === 'n/a') {
        findings.push(createFinding('Configuration Validation', `Config: ${name}`, 'Config.xlsx › Settings', 'Fail',
          `Config key "${name}" has a blank or placeholder value.`,
          `Verify that "${name}" contains a valid configuration value in the project's configuration source for ${envRef(targetEnvironment)}.`));
      } else if (val.toLowerCase().includes('prod') || val.toLowerCase().includes('production')) {
        findings.push(createFinding('Configuration Validation', `Config: ${name}`, 'Config.xlsx › Settings', 'Warning',
          `Config key "${name}" appears to contain a production-specific value: "${val}".`,
          `Verify this value is appropriate for ${envRef(targetEnvironment)}. Configuration values must match the target environment and must not carry over from production.`));
      } else if (val.startsWith('https://') || val.startsWith('http://')) {
        findings.push(createFinding('Configuration Validation', `Config: ${name}`, 'Config.xlsx › Settings', 'Warning',
          `Config key "${name}" contains a URL: "${val}".`,
          `Verify that the configured URL matches ${envRef(targetEnvironment)}. Consider externalising this value to a centralised configuration management system.`));
      }
    });
  }

  // Excel / file paths from workflow files — classified as External Resources
  const seenPaths = new Set();
  xamlData.forEach(xf => {
    if (xf.error) return;

    xf.excelFiles.forEach(fp => {
      const key = `${fp}|${xf.fileName}`;
      if (seenPaths.has(key)) return;
      seenPaths.add(key);
      if (fp.match(/^[A-Za-z]:\\/)) {
        findings.push(createFinding('External Resources', `Excel File: ${path.basename(fp)}`, xf.fileName, 'Fail',
          `Hardcoded absolute Excel path found: "${fp}".`,
          'Move the file path to the project configuration source or a Credential Asset. Hardcoded paths are not portable across machines or environments.'));
      } else {
        findings.push(createFinding('External Resources', `Excel File: ${path.basename(fp)}`, xf.fileName, 'Warning',
          `Excel file reference: "${fp}". Verify the file is accessible in the target environment.`,
          `Ensure the automation agent has read/write access to this file in ${envRef(targetEnvironment)}.`));
      }
    });

    xf.filePaths.forEach(fp => {
      const key = `path|${fp}|${xf.fileName}`;
      if (seenPaths.has(key)) return;
      seenPaths.add(key);
      findings.push(createFinding('External Resources', `File Path: ${path.basename(fp)}`, xf.fileName, 'Fail',
        `Hardcoded file system path detected: "${fp}".`,
        'Move this path to the project configuration source or a Credential Asset and resolve it dynamically at runtime.'));
    });

    xf.dbConnections.forEach(conn => {
      const masked = conn.replace(/password=\S+/gi, 'password=***');
      findings.push(createFinding('External Resources', 'Database Connection', xf.fileName, 'Fail',
        `Hardcoded database connection string found: "${masked.substring(0, 80)}...".`,
        'Store connection strings in a Credential Asset or IBM Key Protect. Never hardcode credentials or connection details in workflow files.'));
    });
  });

  return findings;
}

// ── 4. Environment Validation (selectors, URLs, invoked paths) ───────────────

function analyzeAppDeps(xamlData, targetEnvironment) {
  const findings = [];
  const seenUrls = new Set();

  xamlData.forEach(xf => {
    if (xf.error) {
      findings.push(createFinding('Environment Validation', xf.fileName, xf.file || xf.fileName, 'Warning',
        `Workflow parse error: ${xf.error}`, 'Fix the workflow file syntax and re-analyze.'));
      return;
    }

    xf.selectorIssues.forEach(si => {
      findings.push(createFinding('Environment Validation', `Selector [${si.attr}="${si.value}"]`, xf.fileName, 'Warning',
        `Hardcoded selector attribute ${si.attr}="${si.value}" may not be portable across environments.`,
        `Parameterise the "${si.attr}" attribute using a variable from the configuration source. Use wildcards (*) for volatile or environment-specific segments.`));
    });

    xf.urls.forEach(url => {
      if (seenUrls.has(url + xf.fileName)) return;
      seenUrls.add(url + xf.fileName);
      if (url.toLowerCase().includes('prod') || url.toLowerCase().includes('production')) {
        findings.push(createFinding('Environment Validation', `URL: ${url.substring(0, 60)}`, xf.fileName, 'Fail',
          `Production-specific URL detected: "${url}".`,
          `Verify that the configured URL matches ${envRef(targetEnvironment)}. Store environment-specific URLs in the configuration source rather than hardcoding them in workflow files.`));
      } else if (url.startsWith('http://')) {
        findings.push(createFinding('Environment Validation', `URL: ${url.substring(0, 60)}`, xf.fileName, 'Fail',
          `Insecure HTTP URL detected: "${url}". TLS is required per security policy.`,
          'Use HTTPS (TLS 1.2+) for all URLs. Update the endpoint configuration accordingly.'));
      } else {
        findings.push(createFinding('Environment Validation', `URL: ${url.substring(0, 60)}`, xf.fileName, 'Warning',
          `URL reference detected: "${url}".`,
          `Verify that this URL is the correct endpoint for ${envRef(targetEnvironment)}. Consider externalising it to the project configuration source for environment portability.`));
      }
    });

    xf.invokedWorkflows.forEach(wf => {
      if (wf.startsWith('C:\\') || wf.startsWith('\\\\')) {
        findings.push(createFinding('Environment Validation', `Invoke: ${path.basename(wf)}`, xf.fileName, 'Fail',
          `Hardcoded absolute path for invoked workflow: "${wf}".`,
          'Use relative paths for workflow invocations (e.g. "Workflows\\\\Process.xaml"). Absolute paths are not portable across environments.'));
      }
    });
  });

  return findings;
}

// ── 5. Security Checks ───────────────────────────────────────────────────────

function analyzeIntegrations(xamlData, configData, targetEnvironment) {
  const findings = [];

  // Config file: flag credential-like keys with hardcoded values
  if (configData.found && !configData.error) {
    const allRows = [
      ...(configData.settings  || []),
      ...(configData.constants || []),
      ...(configData.assets    || [])
    ];
    allRows.forEach((row, i) => {
      const name = String(row.Name || row.Key || row.Setting || `Row ${i + 1}`).toLowerCase();
      const val  = String(row.Value || row.value || '');
      const isCredLike = ['password', 'secret', 'token', 'apikey', 'api_key', 'credential', 'pwd'].some(k => name.includes(k));
      if (isCredLike && val && val.trim() !== '' &&
          !val.toLowerCase().startsWith('asset:') &&
          !val.toLowerCase().startsWith('orchestrator')) {
        findings.push(createFinding('Security Checks', `Config: ${row.Name || name}`, 'Config.xlsx', 'Fail',
          `Potential hardcoded credential found in Config.xlsx for key "${row.Name || name}".`,
          'Remove the credential value from the configuration file. Store it as a Credential Asset in the centralised credential store and retrieve it at runtime.'));
      }
    });
  }

  // Workflow inline credentials — sourced from the pre-filtered inlineCredentials array
  xamlData.forEach(xf => {
    if (xf.error) return;
    (xf.inlineCredentials || []).forEach(match => {
      findings.push(createFinding('Security Checks', 'Inline Credential', xf.fileName, 'Fail',
        `Potential hardcoded credential detected: "${match}".`,
        'Remove hardcoded credentials from all workflow files immediately. Use a Credential Asset or IBM Key Protect for secrets management.'));
    });
  });

  return findings;
}

// ── Master runner ─────────────────────────────────────────────────────────────

async function runFullAnalysis(projectRoot, targetEnvironment = '') {
  const projectData = parseProjectJson(projectRoot);
  const xamlData    = await parseAllXamlFiles(projectRoot);
  const configData  = parseConfigXlsx(projectRoot);
  const isReFramework = detectReFramework(projectRoot, projectData);

  const packageFindings      = analyzePackages(projectData, targetEnvironment);
  const orchestratorFindings = analyzeOrchestratorDeps(xamlData, targetEnvironment);
  const dataFindings         = analyzeDataDeps(xamlData, configData, targetEnvironment);
  const appFindings          = analyzeAppDeps(xamlData, targetEnvironment);
  const integrationFindings  = analyzeIntegrations(xamlData, configData, targetEnvironment);

  const allFindings = [
    ...packageFindings,
    ...orchestratorFindings,
    ...dataFindings,
    ...appFindings,
    ...integrationFindings
  ];

  const summary = {
    total:              allFindings.length,
    pass:               allFindings.filter(f => f.status === 'Pass').length,
    warning:            allFindings.filter(f => f.status === 'Warning').length,
    fail:               allFindings.filter(f => f.status === 'Fail').length,
    // Project identity fields
    projectName:        projectData?.name          || 'Unknown',
    projectVersion:     projectData?.projectVersion || '',
    studioVersion:      projectData?.studioVersion  || '',
    robotVersion:       projectData?.robotVersion   || '',
    targetFramework:    projectData?.targetFramework || 'Unknown',
    expressionLanguage: projectData?.expressionLanguage || 'Unknown',
    outputType:         projectData?.outputType     || 'Unknown',
    isReFramework,
    xamlFilesAnalyzed:  xamlData.length,
    configFound:        configData.found
  };

  return {
    summary,
    findings: allFindings,
    metadata: {
      analyzedAt:       new Date().toISOString(),
      projectRoot,
      targetEnvironment: targetEnvironment || null
    }
  };
}

module.exports = { runFullAnalysis, detectReFramework };
