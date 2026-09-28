'use strict';
const fs = require('fs');
const path = require('path');
const { parseProjectJson } = require('../parsers/projectJsonParser');
const { parseAllXamlFiles } = require('../parsers/xamlParser');
const { parseConfigXlsx } = require('../parsers/configXlsxParser');

// Known latest stable versions for common automation platform packages
const KNOWN_LATEST = {
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

function envRef(targetEnvironment) {
  return targetEnvironment ? `the ${targetEnvironment} environment` : 'the target environment';
}

/**
 * Detect whether this project follows the REFramework pattern.
 */
function detectReFramework(projectRoot, projectData) {
  const frameworkDir = path.join(projectRoot, 'Framework');
  if (fs.existsSync(frameworkDir)) {
    const REF_FILES = [
      'GetTransactionData.xaml', 'Process.xaml', 'SetTransactionStatus.xaml',
      'InitAllApplications.xaml', 'CloseAllApplications.xaml', 'KillAllProcesses.xaml',
      'RetryCurrentTransaction.xaml', 'TakeScreenshot.xaml'
    ];
    try {
      const present = fs.readdirSync(frameworkDir).map(f => f.toLowerCase());
      if (REF_FILES.filter(rf => present.includes(rf.toLowerCase())).length >= 3) return true;
    } catch (_) {}
  }
  if (!projectData || projectData.error) return false;
  const desc = (projectData.description || '').toLowerCase();
  if (desc.includes('reframework') || desc.includes('re-framework') || desc.includes('robotic enterprise framework')) return true;
  const name = (projectData.name || '').toLowerCase();
  if (name.includes('dispatcher') || name.includes('performer')) return true;
  return false;
}

// ── 1. Project Summary (metadata only — no package findings here) ─────────────

function analyzeProjectSummary(projectData) {
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

  // Target framework
  const tf = (projectData.targetFramework || '').toLowerCase();
  if (!tf || tf === 'unknown') {
    findings.push(createFinding('Project Summary', 'Target Framework', 'project.json', 'Warning',
      'targetFramework is not specified.',
      'Specify targetFramework (Windows, Windows-Legacy, or Cross-platform) in project.json.'));
  } else {
    findings.push(createFinding('Project Summary', 'Target Framework', 'project.json', 'Pass',
      `Target framework: ${projectData.targetFramework}`, ''));
  }

  if (tf === 'windows-legacy') {
    findings.push(createFinding('Project Summary', 'Framework Compatibility', 'project.json', 'Warning',
      'Project targets Windows-Legacy (.NET Framework 4.6.1). This target is deprecated for new projects.',
      'Migrate to the Windows target (.NET 6/8) for long-term support.'));
  }

  // Output type
  const outputType = (projectData.outputType || 'Unknown');
  findings.push(createFinding('Project Summary', 'Output Type', 'project.json', 'Pass',
    `Output type: ${outputType}`, ''));

  return findings;
}

// ── Config-driven dependency signal extractor ─────────────────────────────────

/**
 * Keyword sets used to classify a config row's key name into a dependency type.
 * Each array is checked as a substring against the lowercased key name.
 */
/**
 * CONFIG_DEP_SIGNALS — keyword sets for key-name and description classification.
 *
 * Priority: top-to-bottom. First match wins.
 *
 * keyWords   : substrings checked against the lowercased config key name.
 * descWords  : substrings checked against the lowercased description column.
 *              Must be specific phrases that indicate the row *is* that resource,
 *              not just a row that mentions it in passing.
 * valWords   : substrings checked against the lowercased config VALUE.
 *              Used to catch rows whose key name is opaque (e.g. CyberArkFoo_Bar)
 *              but whose value reveals the dependency type.
 *
 * Note: URL / filePath detection is also done in classifyConfigRow via value
 * pattern inspection (any https?:// value → url; any absolute/UNC path value → filePath).
 * Those value-pattern checks happen independently of this table.
 */
const CONFIG_DEP_SIGNALS = [
  // ── Orchestrator resources ─────────────────────────────────────────────────
  { type: 'queue',
    keyWords:  ['queue'],
    descWords: ['the value must match with the queue', 'queue name defined on orchestrator',
                'queue name in orchestrator', 'queue folder', 'orchestrator queue name'],
    valWords:  [] },

  { type: 'asset',
    keyWords:  ['asset'],
    descWords: ['orchestrator asset', 'robot asset', 'get asset', 'asset name'],
    valWords:  [] },

  // ── APIs / REST endpoints ─────────────────────────────────────────────────
  // Placed BEFORE credentials/email/sharepoint so that keys explicitly named *API*
  // or *GraphAPI* (e.g. OutlookGraphAPI, SharepointGraphAPI) classify as API first.
  { type: 'api',
    keyWords:  ['graphapi', 'sharepointgraphapi', 'outlookgraphapi', '_graphapi',
                'apiurl', 'apiendpoint', 'serviceurl', 'baseurl', 'base_url',
                'apibase', 'restapi', 'webservice', 'apihost',
                '_api', 'api_'],
    descWords: ['api endpoint', 'rest api url', 'web service url',
                'service base url', 'api base url', 'graph api endpoint'],
    valWords:  [] },

  // ── Credentials / secrets / vault ─────────────────────────────────────────
  { type: 'credential',
    keyWords:  ['credential', 'credentials', '_cred', 'cred_',
                'password', 'passwd', 'pwd',
                'secret', 'secrets',
                'token', 'accesstoken', 'bearertoken',
                'apikey', 'api_key', 'apikeyid',
                'cyberark', 'vault', 'hashicorp',
                'account', 'serviceaccount'],
    descWords: ['credential asset', 'credential store', 'cyberark', 'vault secret',
                'api key', 'access token', 'service account', 'authentication'],
    valWords:  ['cyberark', 'vault://', 'secret://'] },

  // ── SharePoint ────────────────────────────────────────────────────────────
  { type: 'sharepoint',
    keyWords:  ['sharepoint', 'sharepointurl', 'spsite', 'siteurl', 'spfolder', 'splibrary',
                'sharepointfolder', 'sharepointsite', 'sp_', '_sp'],
    descWords: ['sharepoint site', 'sharepoint url', 'sharepoint folder', 'document library url',
                'sp site url', 'sharepoint library'],
    valWords:  ['.sharepoint.com'] },

  // ── Email / Microsoft Graph (mail-focused) ────────────────────────────────
  { type: 'email',
    keyWords:  ['email', 'mailbox', 'emailaddress', 'mail_', '_mail',
                'msgraph', 'microsoftgraph',
                'outlookgraph',
                'exchangeserver', 'smtpemail', 'emailfrom', 'emailto', 'emailsubject'],
    descWords: ['email address', 'mailbox address', 'microsoft graph api',
                'exchange server address', 'send mail to', 'email account'],
    valWords:  ['graph.microsoft.com', 'outlook.office.com', 'outlook.office365.com'] },

  // ── SMTP ──────────────────────────────────────────────────────────────────
  { type: 'smtp',
    keyWords:  ['smtp', 'smtpserver', 'smtpport', 'smtphost', 'smtpuser', 'smtppassword'],
    descWords: ['smtp server', 'smtp host', 'smtp port', 'smtp username', 'smtp password'],
    valWords:  [] },

  // ── Database / connection strings ─────────────────────────────────────────
  { type: 'database',
    keyWords:  ['connectionstring', 'dbconnection', 'db_', '_db',
                'sqlconn', 'odbcconn', 'sqltable', 'sqlserver', 'sqldb',
                'dbserver', 'dbname', 'dbuser', 'dbprovider', 'db_provider',
                'database', 'datasource', 'dbsource',
                'provider', 'databaseconnection'],
    descWords: ['database connection string', 'sql server name', 'db connection',
                'sql table name', 'database server', 'database name',
                'connection provider', 'oledb provider'],
    valWords:  ['server=', 'data source=', 'initial catalog=', 'provider=', 'dsn=',
                'jdbc:', 'sqlserver://', 'postgresql://', 'mysql://', 'oracle:'] },

  // ── URLs ──────────────────────────────────────────────────────────────────
  { type: 'url',
    keyWords:  ['url', 'uri', 'webaddress', 'siteaddress', 'portalurl', 'link'],
    descWords: ['site url', 'web address', 'portal url', 'application url'],
    valWords:  [] },

  // ── File paths ────────────────────────────────────────────────────────────
  { type: 'filePath',
    keyWords:  ['filepath', 'folderpath', 'outputpath', 'inputpath', 'destpath', 'sourcepath',
                'sharedrive', 'networkpath', 'uncpath', 'archivepath', 'droppath', 'pickuppath',
                'localpath', 'downloadpath', 'uploadpath', 'rootpath', 'workingpath'],
    descWords: ['file path', 'folder path', 'shared drive path', 'unc path', 'network share path',
                'input folder path', 'output folder path', 'archive folder path'],
    valWords:  [] },
];

/**
 * Classify a config row into a dependency type using four independent signals:
 *
 *  1. Key name substring match (keyWords)
 *  2. Description text phrase match (descWords — strict, must indicate the row IS that resource)
 *  3. Value substring match (valWords — catches opaque key names whose values reveal the type)
 *  4. Value pattern inspection:
 *       - Any value beginning with http:// or https:// → 'url' (unless already 'sharepoint'/'api')
 *       - Any value that is an absolute or UNC path → 'filePath'
 *       - Any value matching an ADO.NET connection string pattern → 'database'
 *
 * Returns an array of at most one matched type string (may be empty).
 * Priority is top-to-bottom through CONFIG_DEP_SIGNALS; value patterns run after that.
 */
function classifyConfigRow(keyName, description, value) {
  const lowerKey  = keyName.toLowerCase();
  const lowerDesc = (description || '').toLowerCase();
  const lowerVal  = (value || '').toLowerCase();

  // Signal-table pass
  for (const sig of CONFIG_DEP_SIGNALS) {
    const keyHit  = sig.keyWords.some(kw  => lowerKey.includes(kw));
    const descHit = sig.descWords.some(dw => lowerDesc.includes(dw));
    const valHit  = sig.valWords.length > 0 && sig.valWords.some(vw => lowerVal.includes(vw));
    if (keyHit || descHit || valHit) return [sig.type];
  }

  // Value-pattern fallbacks — catch anything the signal table missed
  if (value) {
    // Any https?:// value is a URL (could be API or SharePoint — report as url generically)
    if (/^https?:\/\//i.test(value)) return ['url'];

    // Absolute Windows paths or UNC paths
    if (/^[A-Za-z]:\\/.test(value) || /^\\\\/.test(value)) return ['filePath'];

    // ADO.NET / ODBC connection string heuristic: two or more key=value pairs separated by semicolons
    if (/\w+=\w+;/.test(value) && value.includes(';')) return ['database'];
  }

  return [];
}

/**
 * Extract all dependency signals from config rows across ALL sheets.
 *
 * Returns: depType → Array<{ key, value, sheet }>
 *
 * For 'queue' entries, pairs QueueName + QueueFolder into a single entry
 * (the folder is contextual metadata, not a separate queue resource).
 */
function extractConfigDeps(configData) {
  const result = {
    queue:      [],
    asset:      [],
    credential: [],
    database:   [],
    api:        [],
    url:        [],
    filePath:   [],
    sharepoint: [],
    email:      [],
    smtp:       [],
  };

  if (!configData.found || configData.error) return result;

  const allSheets = configData.sheets || {};

  // Two-level dedup:
  //   Level 1 — same key within the same sheet (exact match)
  //   Level 2 — same normalised key across ALL sheets (Dev+UAT+Prod same key → one entry)
  // The first sheet that provides a value wins; subsequent sheets with the same key
  // are merged so that the Dependencies section lists each dependency once.
  const seenInSheet  = new Set();   // `sheetName:key` — per-sheet exact dedup
  const seenGlobal   = new Map();   // normKey → entry index in result[type]

  // First pass: collect all classified entries
  const rawEntries = []; // { type, key, value, sheet, lowerKey, normKey }

  Object.entries(allSheets).forEach(([sheetName, rows]) => {
    rows.forEach(row => {
      const key  = extractRowKey(row);
      if (!key) return;

      // Skip rows that look like section headers / labels
      const val  = extractRowValue(row);
      if (shouldSkipRow(key, val)) return;

      const sheetDedup = `${sheetName}:${key}`;
      if (seenInSheet.has(sheetDedup)) return;
      seenInSheet.add(sheetDedup);

      const desc = String(row.Description || row.description || row.Notes || row.notes || '');
      const types = classifyConfigRow(key, desc, val);
      types.forEach(t => {
        rawEntries.push({
          type:    t,
          key,
          value:   val,
          sheet:   sheetName,
          lowerKey: key.toLowerCase(),
          normKey:  key.toLowerCase().replace(/[^a-z0-9]/g, '')
        });
      });
    });
  });

  // Second pass: suppress queue-folder entries that pair with a name entry
  const queueNames = new Set(
    rawEntries
      .filter(e => e.type === 'queue' && !e.lowerKey.includes('folder'))
      .map(e => e.key)
  );

  rawEntries.forEach(e => {
    if (!(e.type in result)) return;

    // Suppress folder-only queue entries when a name entry already exists
    if (e.type === 'queue' && e.lowerKey.includes('folder') && queueNames.size > 0) return;

    // Cross-sheet dedup: if the same normalised key was already emitted for this
    // dep type (e.g. Queue_Name in Dev, UAT, Prod), keep only the first (richest value).
    const globalKey = `${e.type}:${e.normKey}`;
    if (seenGlobal.has(globalKey)) {
      // If the existing entry has no value and this one does, upgrade the value
      const existing = seenGlobal.get(globalKey);
      if (!existing.value && e.value) {
        existing.value = e.value;
        existing.sheet = e.sheet;
      }
      return;
    }

    const entry = { key: e.key, value: e.value, sheet: e.sheet };
    seenGlobal.set(globalKey, entry);
    result[e.type].push(entry);
  });

  return result;
}

// ── Config row helpers (shared with analyzeDataDeps) ─────────────────────────

function extractRowKey(row) {
  const candidates = [
    row.Name, row.name,
    row.Key,  row.key,
    row.Label, row.label,
    row.Category, row.category
  ];
  for (const c of candidates) {
    const s = String(c ?? '').trim();
    if (s) return s;
  }
  if (row.Value === undefined && row.value === undefined) {
    const s = String(row.Setting ?? row.setting ?? '').trim();
    if (s) return s;
  }
  return null;
}

function extractRowValue(row) {
  const candidates = [row.Value, row.value, row.Setting, row.setting];
  for (const c of candidates) {
    if (c !== undefined && c !== null) return String(c).trim();
  }
  return '';
}

const PLACEHOLDER_TOKENS = new Set([
  'tbd', 'n/a', 'na', 'todo', 'fixme', 'placeholder',
  'example', 'sample', '<value>', 'none', 'null', 'undefined'
]);

function isPlaceholderValue(val, description) {
  if (!val || !val.trim()) {
    if (description) {
      const desc = description.toLowerCase();
      // Explicitly optional / intentionally blank rows should not be flagged
      if (desc.includes('leave') && (desc.includes('empty') || desc.includes('blank'))) return false;
      if (desc.includes('optional') || desc.includes('not required') || desc.includes('if applicable')) return false;
      // REFramework env-sheets often have category-header rows (e.g. ">> Orchestrator Settings")
      // whose value column is intentionally empty — skip them
      if (desc.startsWith('>>') || desc.startsWith('--')) return false;
    }
    return true;
  }
  return PLACEHOLDER_TOKENS.has(val.trim().toLowerCase());
}

// Values that look like category/section headers rather than real config keys
const HEADER_LIKE_PATTERNS = [/^>+/, /^-+/, /^={2,}/, /^\[.*\]$/, /^#/];

const KNOWN_HEADER_VALUES = new Set(['name', 'key', 'value', 'setting', 'description', 'label', 'category', 'notes']);

/**
 * Returns true when a config row looks like a section-header / grouping label
 * rather than a real configuration entry.
 *
 * Catches patterns like:
 *   - Key = "Constants"  with no value  (pure category label)
 *   - Key = "OutlookGraphAPI" with no value and no description  (section divider)
 *   - Key starts with >> / -- / === / # decorations
 *   - Key is a well-known Excel column header word with no value
 *
 * A row is NOT skipped when it has a non-blank value — that means it is a real
 * configuration entry even if the key name looks like a category label.
 */
function shouldSkipRow(name, val) {
  if (!name) return true;
  const trimmedName = name.trim();
  const hasValue    = val && val.trim().length > 0;

  // Always skip header-decoration rows regardless of value
  if (HEADER_LIKE_PATTERNS.some(rx => rx.test(trimmedName))) return true;

  // Skip well-known column-header words that appear when XLSX rows bleed in
  if (KNOWN_HEADER_VALUES.has(trimmedName.toLowerCase()) && !hasValue) return true;

  // Skip rows whose name has no associated value AND whose name itself classifies
  // as a dependency type signal (e.g. "OutlookGraphAPI", "SharepointGraphAPI",
  // "Constants", "Settings" used as divider rows with no value column populated).
  // These are organisational labels, not real config entries.
  if (!hasValue) {
    const [depType] = classifyConfigRow(trimmedName, '', '');
    // If the name itself is a dep signal keyword but has no value it's a section label
    if (depType) return true;

    // Single-word title-cased or ALL-CAPS names with no value are almost always labels
    // e.g. "Constants", "Settings", "Parameters", "Orchestrator"
    if (/^[A-Z][A-Za-z]+$/.test(trimmedName) || /^[A-Z_]+$/.test(trimmedName)) return true;
  }

  return false;
}

// ── Path classification helper ────────────────────────────────────────────────

/**
 * Classify a hardcoded absolute or UNC file/executable path into a severity tier.
 *
 * Returns one of:
 *   'pass'    — standard Windows system path; legitimate to use as-is
 *   'info'    — system executable or Windows utility; fixed path is normal practice
 *   'warning' — user-profile / machine-specific app path; needs verification on target
 *   'fail'    — arbitrary absolute data/script path that is environment-specific
 *
 * Rules:
 *   1. C:\Windows\System32\*, C:\Windows\SysWOW64\*, C:\Windows\*.exe  → 'info'
 *      Standard OS executables use fixed system paths by design.
 *   2. C:\Users\*, %AppData%, AppData\Local, AppData\Roaming,
 *      Desktop\*, Downloads\*, Temp\*, Temporary*                      → 'warning'
 *      These are user/machine-specific but may be intentional; flag for review.
 *   3. Everything else (data files, network shares, application data)   → 'fail'
 *      Arbitrary absolute paths break portability across environments.
 *
 * UNC paths (\\server\share\...) are always 'fail' — server name is environment-specific.
 */
function classifyHardcodedPath(fp) {
  const norm = fp.replace(/\//g, '\\');

  // UNC paths are always environment-specific
  if (norm.startsWith('\\\\')) return 'fail';

  const upper = norm.toUpperCase();

  // Standard Windows system directories — fixed paths are legitimate here
  if (upper.startsWith('C:\\WINDOWS\\SYSTEM32\\') ||
      upper.startsWith('C:\\WINDOWS\\SYSWOW64\\') ||
      upper.startsWith('C:\\WINDOWS\\') && upper.endsWith('.EXE')) {
    return 'info';
  }

  // User-profile and machine-specific application locations
  if (upper.startsWith('C:\\USERS\\') ||
      upper.includes('\\APPDATA\\LOCAL\\') ||
      upper.includes('\\APPDATA\\ROAMING\\') ||
      upper.includes('\\APPDATA\\') ||
      upper.includes('\\DESKTOP\\') ||
      upper.includes('\\DOWNLOADS\\') ||
      upper.includes('\\TEMP\\') ||
      upper.includes('\\TEMPORARY ') ||
      upper.startsWith('C:\\TEMP\\') ||
      upper.startsWith('C:\\TMP\\')) {
    return 'warning';
  }

  return 'fail';
}

// ── 2. Dependencies (packages + runtime resources) ────────────────────────────

/**
 * Analyze NuGet packages from project.json.
 * Now emits under the "Dependencies" category, not "Project Summary".
 */
function analyzePackages(projectData) {
  const findings = [];
  if (!projectData || projectData.error) return findings;

  const deps = projectData.dependencies || {};
  if (Object.keys(deps).length === 0) {
    findings.push(createFinding('Dependencies', 'Packages', 'project.json', 'Warning',
      'No dependencies found in project.json.',
      'Verify project.json is complete and contains the dependencies block.'));
    return findings;
  }

  Object.entries(deps).forEach(([pkg, versionRange]) => {
    const cleanVer = versionRange.replace(/[\[\]()>=<,\s]/g, '').split(' ')[0].trim();
    const latest   = KNOWN_LATEST[pkg];

    if (EOL_PACKAGES.some(e => e === pkg + '@' + semverMajor(cleanVer))) {
      findings.push(createFinding('Dependencies', `Package: ${pkg}`, 'project.json', 'Fail',
        `Package ${pkg}@${cleanVer} is End-of-Life.`,
        `Upgrade to the latest stable version (${latest || 'check the package marketplace'}).`));
    } else if (latest) {
      const latestMajor  = semverMajor(latest);
      const currentMajor = semverMajor(cleanVer);
      if (currentMajor < latestMajor) {
        findings.push(createFinding('Dependencies', `Package: ${pkg}`, 'project.json', 'Warning',
          `${pkg} version ${cleanVer} is outdated. Latest known: ${latest}.`,
          `Update to ${latest} to get security patches and bug fixes.`));
      } else {
        findings.push(createFinding('Dependencies', `Package: ${pkg}`, 'project.json', 'Pass',
          `${pkg}@${cleanVer} — version is current.`, ''));
      }
    } else {
      findings.push(createFinding('Dependencies', `Package: ${pkg}`, 'project.json', 'Pass',
        `${pkg}@${cleanVer} — custom/internal package. Cannot verify against public registry.`,
        'Confirm this package is available in the configured internal package feed and is actively maintained.'));
    }
  });

  return findings;
}

/**
 * Analyze runtime dependencies: queues, assets, credentials, databases, APIs,
 * file paths, and URLs.
 *
 * Sources:
 *   1. XAML workflow files (direct/hardcoded references)
 *   2. Config.xlsx rows (configuration-driven references)
 *
 * Logic:
 *   - Merge both sources per dependency type.
 *   - When a type is found in either source → report it with a verification reminder.
 *   - When a type is found in neither source → "Not Applicable" (Pass, no warning).
 *   - The "no deps detected" catch-all warning is removed; it is replaced by
 *     per-type Not Applicable findings so the report is explicit and actionable.
 */
function analyzeRuntimeDeps(xamlData, configData, targetEnvironment) {
  const findings = [];

  // ── Collect XAML-sourced resources ────────────────────────────────────────
  const xamlQueues      = new Map(); // name → Set<file>
  const xamlAssets      = new Map();
  const xamlCredentials = new Map();
  const xamlDatabases   = new Map();
  const xamlUrls        = new Map();
  const xamlFilePaths   = new Map();

  function addXaml(map, name, file) {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(file);
  }

  xamlData.forEach(xf => {
    if (xf.error) return;
    xf.queues.forEach(q        => addXaml(xamlQueues,      q, xf.fileName));
    xf.assets.forEach(a        => addXaml(xamlAssets,      a, xf.fileName));
    xf.credentials.forEach(c   => addXaml(xamlCredentials, c, xf.fileName));
    xf.dbConnections.forEach(d => addXaml(xamlDatabases,   d, xf.fileName));
    xf.urls.forEach(u           => addXaml(xamlUrls,        u, xf.fileName));
    xf.filePaths.forEach(p      => addXaml(xamlFilePaths,   p, xf.fileName));
  });

  // Integration types detected from XAML activity namespaces (e.g. sharepoint, email, smtp)
  const xamlIntegrations = new Set(xamlData.integrationTypes || []);

  // ── Collect config-sourced resources ─────────────────────────────────────
  const cfgDeps = extractConfigDeps(configData);

  // ── Emit helpers ──────────────────────────────────────────────────────────

  /**
   * Emit a finding for a resource detected by name in XAML (hardcoded literal).
   *
   * statusOverride: default 'Info' — the resource name is known and correctly
   *   referenced in the workflow; runtime existence requires environment access.
   *   Pass 'Fail' for genuinely bad patterns (hardcoded paths, insecure URLs).
   */
  function emitXamlResource(map, label, msgFn, recFn, statusOverride) {
    map.forEach((files, name) => {
      findings.push(createFinding('Dependencies', `${label}: ${name}`,
        [...files].join(', '), statusOverride || 'Info', msgFn(name), recFn(name)));
    });
  }

  /**
   * Emit a dependency finding for a config-sourced resource.
   *
   * statusOverride: default 'Info' — dependency is detected and configured.
   *   Runtime verification requires environment access; this is not a problem.
   *   Pass 'Fail' only for genuine misconfiguration (e.g. insecure HTTP URL).
   */
  function emitConfigResource(entries, label, msgFn, recFn, statusOverride) {
    // Deduplicate entries by normalised key so the same key from Dev+UAT+Prod
    // only produces one finding in the Dependencies section.
    const seen = new Set();
    entries.forEach(({ key, value, sheet }) => {
      const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(normKey)) return;
      seen.add(normKey);

      const dv     = value && !isPlaceholderValue(value) ? ` (${value})` : ' (value not set)';
      const status = statusOverride || 'Info';
      findings.push(createFinding('Dependencies', `${label}: ${key}`,
        `Config.xlsx › ${sheet}`, status, msgFn(key, value, dv), recFn(key)));
    });
  }

  function notApplicable(label) {
    findings.push(createFinding('Dependencies', label, 'Config.xlsx / Workflows', 'Pass',
      `No ${label.toLowerCase()} detected in workflow files or configuration. Not applicable for this project.`,
      ''));
  }

  // ── Queues ────────────────────────────────────────────────────────────────
  if (xamlQueues.size > 0 || cfgDeps.queue.length > 0) {
    // Build a set of queue values seen in XAML so we can suppress config duplicates
    const xamlQueueValues = new Set(
      [...xamlQueues.keys()].map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''))
    );

    emitXamlResource(xamlQueues, 'Queue',
      n => `Queue "${n}" is configured. Dependency detected — verify queue exists in ${envRef(targetEnvironment)}.`,
      n => `Confirm queue "${n}" exists in ${envRef(targetEnvironment)} with the correct reference fields and max-retry settings.`);

    // Only emit config-queue entries that aren't already covered by a XAML entry
    const dedupedQueueCfg = cfgDeps.queue.filter(({ value }) => {
      if (!value) return true; // keep if no value to compare
      const norm = value.toLowerCase().replace(/[^a-z0-9]/g, '');
      return !xamlQueueValues.has(norm);
    });
    emitConfigResource(dedupedQueueCfg, 'Queue (config)',
      (k, v, dv) => `Queue configured via key "${k}"${dv}. Dependency detected — verify queue exists in ${envRef(targetEnvironment)}.`,
      k => `Confirm the queue referenced by "${k}" exists in ${envRef(targetEnvironment)} with the correct schema.`);
  } else {
    notApplicable('Queues');
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  // Distinguish: "defined in config" (Assets sheet row) vs "used in workflow code".
  const hasCfgAssets  = cfgDeps.asset.length > 0;
  const hasXamlAssets = xamlAssets.size > 0;

  if (hasCfgAssets || hasXamlAssets) {
    // Config-defined assets
    if (hasCfgAssets) {
      emitConfigResource(cfgDeps.asset, 'Asset (defined in config)',
        (k, v, dv) => `Asset entry "${k}"${dv} is defined in configuration. Dependency detected — verify asset exists in ${envRef(targetEnvironment)}.`,
        k => `Confirm asset "${k}" is created in ${envRef(targetEnvironment)} with the correct value.`);
    }
    // Workflow-used assets not already covered by a config entry
    if (hasXamlAssets) {
      const configAssetNorms = new Set(cfgDeps.asset.map(e => e.key.toLowerCase().replace(/[^a-z0-9]/g, '')));
      xamlAssets.forEach((files, assetName) => {
        const norm = assetName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (configAssetNorms.has(norm)) return; // already reported via config
        findings.push(createFinding('Dependencies', `Asset (used in workflow): ${assetName}`,
          [...files].join(', '), 'Info',
          `Asset "${assetName}" is retrieved in workflow code. Dependency detected — verify it exists in ${envRef(targetEnvironment)}.`,
          `Confirm asset "${assetName}" is configured in ${envRef(targetEnvironment)} with an appropriate value.`));
      });
    }
    // Cross-check: assets used in workflows that are not declared in config → genuine Warning
    if (hasXamlAssets && hasCfgAssets) {
      const configAssetKeys = new Set(cfgDeps.asset.map(e => e.key.toLowerCase()));
      xamlAssets.forEach((_, assetName) => {
        const normalised = assetName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const declared = [...configAssetKeys].some(k => k.replace(/[^a-z0-9]/g, '').includes(normalised) ||
                                                        normalised.includes(k.replace(/[^a-z0-9]/g, '')));
        if (!declared) {
          findings.push(createFinding('Dependencies', `Asset (undeclared): ${assetName}`,
            'Config.xlsx / Workflows', 'Warning',
            `Asset "${assetName}" is used in workflow code but not declared in the Config.xlsx Assets/Settings sheet.`,
            `Add an entry for "${assetName}" to the Assets sheet in Config.xlsx and confirm it exists in ${envRef(targetEnvironment)}.`));
        }
      });
    }
  } else {
    notApplicable('Assets');
  }

  // ── Credentials ───────────────────────────────────────────────────────────
  if (xamlCredentials.size > 0 || cfgDeps.credential.length > 0) {
    emitXamlResource(xamlCredentials, 'Credential',
      n => `Credential "${n}" is referenced in workflow code. Dependency detected — verify it is provisioned in ${envRef(targetEnvironment)}.`,
      n => `Ensure credential "${n}" is stored as a Credential Asset in ${envRef(targetEnvironment)}.`);
    emitConfigResource(cfgDeps.credential, 'Credential (config)',
      (k, v, dv) => `Credential configured via key "${k}"${dv}. Dependency detected — confirm it resolves to a Credential Asset at runtime.`,
      k => `Confirm credential "${k}" is stored securely in ${envRef(targetEnvironment)}.`);
  } else {
    notApplicable('Credentials');
  }

  // ── Databases ─────────────────────────────────────────────────────────────
  // XAML database connections: hardcoded ConnectionString attributes
  // XAML integration type: UiPath.Database.Activities present in any workflow
  const hasXamlDbActivity = xamlIntegrations.has('database') ||
    xamlData.some(xf => !xf.error && xf.dbConnections.length > 0);

  if (xamlDatabases.size > 0 || cfgDeps.database.length > 0 || hasXamlDbActivity) {
    // Hardcoded connection strings in XAML = Fail (security issue, not just env verification)
    emitXamlResource(xamlDatabases, 'Database (hardcoded)',
      n => `Hardcoded database connection string detected: "${n.substring(0, 60)}".`,
      () => `Store connection strings in a Credential Asset or IBM Key Protect — never hardcode them in workflows.`,
      'Fail');
    // Config-driven database connection = Info (correctly configured)
    emitConfigResource(cfgDeps.database, 'Database (config)',
      (k, v, dv) => `Database connection configured via key "${k}"${dv}. Dependency detected — verify connection target for ${envRef(targetEnvironment)}.`,
      k => `Confirm "${k}" points to the correct database server/schema for ${envRef(targetEnvironment)}.`);
    if (hasXamlDbActivity && xamlDatabases.size === 0 && cfgDeps.database.length === 0) {
      // Activity present, connection is expression-driven — normal pattern
      findings.push(createFinding('Dependencies', 'Database (activity detected)', 'Workflow files', 'Info',
        'Database activity detected. Connection details are configuration-driven (no hardcoded strings found).',
        `Confirm the database connection string is stored securely and points to the correct server in ${envRef(targetEnvironment)}.`));
    }
  } else {
    notApplicable('Databases');
  }

  // ── SharePoint ────────────────────────────────────────────────────────────
  const hasXamlSP = xamlIntegrations.has('sharepoint');
  const hasCfgSP  = cfgDeps.sharepoint.length > 0;

  if (hasXamlSP || hasCfgSP) {
    if (hasXamlSP && !hasCfgSP) {
      findings.push(createFinding('Dependencies', 'SharePoint (activity detected)', 'Workflow files', 'Info',
        'SharePoint activities detected. Site URL and credentials are configuration-driven.',
        `Confirm SharePoint site URL and credentials are correctly configured in ${envRef(targetEnvironment)}.`));
    }
    emitConfigResource(cfgDeps.sharepoint, 'SharePoint (config)',
      (k, v, dv) => `SharePoint resource configured via key "${k}"${dv}. Dependency detected — verify site/library is accessible in ${envRef(targetEnvironment)}.`,
      k => `Confirm the SharePoint resource referenced by "${k}" is accessible in ${envRef(targetEnvironment)}.`);
  } else {
    notApplicable('SharePoint');
  }

  // ── Email / Microsoft Graph ───────────────────────────────────────────────
  const hasXamlEmail = xamlIntegrations.has('email');
  const hasCfgEmail  = cfgDeps.email.length > 0;

  if (hasXamlEmail || hasCfgEmail) {
    if (hasXamlEmail && !hasCfgEmail) {
      findings.push(createFinding('Dependencies', 'Email (activity detected)', 'Workflow files', 'Info',
        'Email/Microsoft Graph activities detected. Mailbox and credentials are configuration-driven.',
        `Confirm email account credentials and mailbox settings are correctly configured in ${envRef(targetEnvironment)}.`));
    }
    emitConfigResource(cfgDeps.email, 'Email (config)',
      (k, v, dv) => `Email resource configured via key "${k}"${dv}. Dependency detected — verify mailbox/account is accessible in ${envRef(targetEnvironment)}.`,
      k => `Confirm the email account referenced by "${k}" is accessible in ${envRef(targetEnvironment)}.`);
  } else {
    notApplicable('Email');
  }

  // ── SMTP ──────────────────────────────────────────────────────────────────
  const hasXamlSmtp = xamlIntegrations.has('smtp');
  const hasCfgSmtp  = cfgDeps.smtp.length > 0;

  if (hasXamlSmtp || hasCfgSmtp) {
    if (hasXamlSmtp && !hasCfgSmtp) {
      findings.push(createFinding('Dependencies', 'SMTP (activity detected)', 'Workflow files', 'Info',
        'SMTP mail activities detected. Server address and credentials are configuration-driven.',
        `Confirm SMTP server settings are correctly configured for ${envRef(targetEnvironment)}.`));
    }
    emitConfigResource(cfgDeps.smtp, 'SMTP (config)',
      (k, v, dv) => `SMTP setting configured via key "${k}"${dv}. Dependency detected — verify server is reachable in ${envRef(targetEnvironment)}.`,
      k => `Confirm SMTP setting "${k}" is correct for ${envRef(targetEnvironment)}.`);
  } else {
    notApplicable('SMTP');
  }

  // ── APIs ──────────────────────────────────────────────────────────────────
  if (cfgDeps.api.length > 0) {
    emitConfigResource(cfgDeps.api, 'API (config)',
      (k, v, dv) => `API endpoint configured via key "${k}"${dv}. Dependency detected — verify endpoint is reachable in ${envRef(targetEnvironment)}.`,
      k => `Confirm API endpoint "${k}" is reachable and correct in ${envRef(targetEnvironment)}.`);
  } else {
    notApplicable('APIs');
  }

  // ── File Paths ────────────────────────────────────────────────────────────
  // Only absolute/UNC paths are external dependencies; relative paths are local artefacts.
  const hasXamlPaths = xamlFilePaths.size > 0;
  const hasCfgPaths  = cfgDeps.filePath.length > 0;

  if (hasXamlPaths || hasCfgPaths) {
    // Hardcoded paths in XAML — classify per path type rather than blanket Fail
    xamlFilePaths.forEach((files, fp) => {
      const fileList = [...files].join(', ');
      const tier = classifyHardcodedPath(fp);
      if (tier === 'info') {
        // Standard system executable — fixed path is expected and legitimate
        findings.push(createFinding('Dependencies', `File Path: ${path.basename(fp)}`,
          fileList, 'Info',
          `Standard system executable path referenced: "${fp}". This is a fixed OS path and is expected to be available on Windows targets.`,
          `Verify the executable is present on the target machine and compatible with ${envRef(targetEnvironment)}.`));
      } else if (tier === 'warning') {
        // User-profile / machine-specific app — needs environment verification
        findings.push(createFinding('Dependencies', `File Path: ${path.basename(fp)}`,
          fileList, 'Warning',
          `Environment-specific application path detected: "${fp}". This path is user- or machine-specific and may not resolve on the target agent.`,
          `Verify the application is installed at this location on the target machine, or resolve the path through configuration.`));
      } else {
        // Arbitrary absolute data/script path — genuine portability risk
        findings.push(createFinding('Dependencies', `File Path: ${path.basename(fp)}`,
          fileList, 'Fail',
          `Hardcoded file system path detected: "${fp}". This path is environment-specific and will not resolve if it does not exist in ${envRef(targetEnvironment)}.`,
          'Move this path to the configuration source and resolve it dynamically at runtime.'));
      }
    });
    // Config-driven paths = Info (correctly externalised)
    emitConfigResource(cfgDeps.filePath, 'File Path (config)',
      (k, v, dv) => `File path configured via key "${k}"${dv}. Dependency detected — verify path is accessible in ${envRef(targetEnvironment)}.`,
      k => `Confirm path "${k}" is accessible to the automation agent in ${envRef(targetEnvironment)}.`);
  } else {
    notApplicable('File Paths');
  }

  // ── URLs ──────────────────────────────────────────────────────────────────
  const hasXamlUrls = xamlUrls.size > 0;
  const hasCfgUrls  = cfgDeps.url.length > 0;

  if (hasXamlUrls || hasCfgUrls) {
    xamlUrls.forEach((files, url) => {
      const fileList = [...files].join(', ');
      if (url.startsWith('http://')) {
        // Insecure protocol = confirmed security policy violation
        findings.push(createFinding('Dependencies', `URL: ${url.substring(0, 60)}`, fileList, 'Fail',
          `Insecure HTTP URL hardcoded in workflow: "${url}". TLS is required per security policy.`,
          'Use HTTPS (TLS 1.2+) for all URLs.'));
      } else {
        // Hardcoded HTTPS URL — informational: the URL is visible and should be
        // verified for the target environment, but its mere presence is not an error.
        findings.push(createFinding('Dependencies', `URL: ${url.substring(0, 60)}`, fileList, 'Info',
          `URL hardcoded in workflow: "${url}". Verify this is the correct endpoint for ${envRef(targetEnvironment)} and consider moving it to the configuration source.`,
          `Confirm the URL is correct for ${envRef(targetEnvironment)} and move to Config.xlsx if environment-specific.`));
      }
    });
    // Config-driven URLs = Info (correctly externalised)
    emitConfigResource(cfgDeps.url, 'URL (config)',
      (k, v, dv) => `URL configured via key "${k}"${dv}. Dependency detected — verify endpoint for ${envRef(targetEnvironment)}.`,
      k => `Confirm URL "${k}" is the correct endpoint for ${envRef(targetEnvironment)}.`);
  } else {
    notApplicable('URLs');
  }

  return findings;
}

// ── 3. Configuration Validation ───────────────────────────────────────────────

function analyzeDataDeps(xamlData, configData, targetEnvironment) {
  const findings = [];

  if (!configData.found) {
    findings.push(createFinding('Configuration Validation', 'Config.xlsx', 'Data/', 'Fail',
      'Config.xlsx not found in project.',
      'Add Config.xlsx to the Data/ folder. This file is required as the project configuration source.'));
  } else if (configData.error) {
    findings.push(createFinding('Configuration Validation', 'Config.xlsx', configData.filePath || 'Data/', 'Fail',
      configData.error, 'Fix the Excel file structure.'));
  } else {
    const sheetNames = (configData.sheetNames || []).join(', ') || '(none)';
    findings.push(createFinding('Configuration Validation', 'Config.xlsx', configData.filePath, 'Pass',
      `Config.xlsx found. Sheets detected: ${sheetNames}.`, ''));

    // Generic value-based validation across all settings / constants rows.
    // Does NOT require any specific key names — validates every row dynamically.
    //
    // Blank / placeholder values are NOT reported regardless of whether the key is
    // referenced in XAML. A XAML reference alone cannot distinguish whether the key
    // is used on the primary execution path or only inside conditional, exception,
    // notification, or logging branches. Without that evidence the validator must
    // not create a Critical or Warning finding.
    const allConfigRows = [...(configData.settings || []), ...(configData.constants || [])];

    // Track keys we've already checked to avoid duplicate findings when the same
    // key appears in both a Settings sheet and a Constants sheet.
    const checkedKeys = new Set();

    allConfigRows.forEach(row => {
      const name = extractRowKey(row);
      const val  = extractRowValue(row);
      const desc = String(row.Description || row.description || row.Notes || row.notes || '');

      if (shouldSkipRow(name, val)) return;
      if (checkedKeys.has((name || '').toLowerCase())) return;
      checkedKeys.add((name || '').toLowerCase());

      // Blank / placeholder: no finding — insufficient evidence of deployment risk.
      if (isPlaceholderValue(val, desc)) return;

      if (val.toLowerCase().includes('prod') || val.toLowerCase().includes('production')) {
        // A value containing "prod" is informational when a non-prod target is selected.
        // The word "prod" appearing in a value string is not strong evidence of an
        // environment mismatch — it may be part of a product name, path component, or
        // unrelated term. Surface it for human review rather than assuming it is wrong.
        const isDeployingToProd = !targetEnvironment ||
          targetEnvironment.toLowerCase().includes('prod');
        if (!isDeployingToProd) {
          findings.push(createFinding('Configuration Validation', `Config: ${name}`,
            'Config.xlsx › Settings/Constants', 'Info',
            `Configuration key "${name}" has a value that contains "prod" or "production": "${val}". Verify this is intended for ${envRef(targetEnvironment)}.`,
            `Review whether "${name}" should use a different value for ${envRef(targetEnvironment)}.`));
        }
      }
    });

    // Assets sheet — dynamic, no predefined names expected.
    // A blank asset alias/value is NOT flagged: the asset sheet is informational.
    // Its entries are already surfaced in the Dependencies section.
    const assetRows = configData.assets || [];
    if (assetRows.length > 0) {
      findings.push(createFinding('Configuration Validation', 'Assets Sheet', 'Config.xlsx › Assets', 'Pass',
        `Assets sheet found with ${assetRows.length} configured asset(s).`, ''));
    }

    // Environment-specific sheets (Dev / UAT / Prod)
    // Blank keys in env sheets are NOT reported. The validator cannot determine
    // from static analysis alone whether a blank env-sheet value is required for
    // the primary execution path or is only used conditionally/optionally.
    Object.entries(configData.envSheets || {}).forEach(([env, rows]) => {
      findings.push(createFinding('Configuration Validation', `Environment Sheet: ${env}`,
        'Config.xlsx', 'Pass',
        `${env} configuration sheet detected with ${rows.length} row(s).`, ''));
    });
  }

  // Excel paths referenced in workflow files (hardcoded) → External Resources
  const seenPaths = new Set();
  xamlData.forEach(xf => {
    if (xf.error) return;

    xf.excelFiles.forEach(fp => {
      const key = `${fp}|${xf.fileName}`;
      if (seenPaths.has(key)) return;
      seenPaths.add(key);
      if (fp.match(/^[A-Za-z]:\\/)) {
        // Absolute local path hardcoded in workflow — confirmed portability problem
        findings.push(createFinding('External Resources', `Excel File: ${path.basename(fp)}`, xf.fileName, 'Fail',
          `Hardcoded absolute Excel path found: "${fp}". This path is machine-specific and will not resolve in other environments.`,
          'Move the file path to the configuration source so it can be adjusted per environment.'));
      } else {
        // Relative or UNC path — the resource is external and cannot be verified from the
        // project package alone. Surface for human review, not as a confirmed problem.
        findings.push(createFinding('External Resources', `Excel File: ${path.basename(fp)}`, xf.fileName, 'Info',
          `External Excel file reference detected: "${fp}". The resource is outside the uploaded project and its availability in ${envRef(targetEnvironment)} cannot be verified from the project package.`,
          `Confirm the file is accessible to the automation agent in ${envRef(targetEnvironment)}.`));
      }
    });

    xf.dbConnections.forEach(conn => {
      const masked = conn.replace(/password=\S+/gi, 'password=***');
      findings.push(createFinding('External Resources', 'Database Connection', xf.fileName, 'Fail',
        `Hardcoded database connection string found: "${masked.substring(0, 80)}...".`,
        'Store connection strings in a Credential Asset or IBM Key Protect.'));
    });
  });

  return findings;
}

// ── 4. Environment Validation (selectors, invoked workflow paths) ─────────────

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
      // Selector portability — a real and specific structural concern: the selector
      // attribute is a literal that ties the automation to a specific environment/machine.
      findings.push(createFinding('Environment Validation', `Selector [${si.attr}="${si.value}"]`, xf.fileName, 'Warning',
        `Hardcoded selector attribute ${si.attr}="${si.value}" in "${xf.fileName}" may not match across environments or machines.`,
        `Parameterise the "${si.attr}" attribute using a wildcard or a variable read from the configuration source.`));
    });

    // Hardcoded absolute file paths in workflows — classify before reporting
    xf.filePaths.forEach(fp => {
      const key = `path|${fp}|${xf.fileName}`;
      if (seenUrls.has(key)) return;
      seenUrls.add(key);
      const tier = classifyHardcodedPath(fp);
      if (tier === 'info') {
        findings.push(createFinding('External Resources', `File Path: ${path.basename(fp)}`, xf.fileName, 'Info',
          `Standard system executable path referenced: "${fp}". This is a fixed OS path and is expected to be available on Windows targets.`,
          `Verify the executable is present on the target machine and compatible with ${envRef(targetEnvironment)}.`));
      } else if (tier === 'warning') {
        findings.push(createFinding('External Resources', `File Path: ${path.basename(fp)}`, xf.fileName, 'Warning',
          `Environment-specific application path detected: "${fp}". This path is user- or machine-specific and may not resolve on the target agent.`,
          `Verify the application is installed at this location on the target machine, or resolve the path through configuration.`));
      } else {
        findings.push(createFinding('External Resources', `File Path: ${path.basename(fp)}`, xf.fileName, 'Fail',
          `Hardcoded file system path detected: "${fp}". This path is environment-specific and will not resolve if it does not exist in ${envRef(targetEnvironment)}.`,
          'Move this path to the configuration source and resolve it dynamically at runtime.'));
      }
    });

    xf.invokedWorkflows.forEach(wf => {
      if (wf.startsWith('C:\\') || wf.startsWith('\\\\')) {
        findings.push(createFinding('Environment Validation', `Invoke: ${path.basename(wf)}`, xf.fileName, 'Fail',
          `Hardcoded absolute path for invoked workflow: "${wf}".`,
          'Use relative paths for workflow invocations (e.g. "Workflows\\\\Process.xaml").'));
      }
    });
  });

  return findings;
}

// ── 5. Security Checks ───────────────────────────────────────────────────────

/**
 * Returns true when a value string has characteristics of a real secret/credential:
 *  - High entropy (many unique characters relative to length)
 *  - Resembles a known token/key format (base64, hex, JWT segments)
 *  - Long enough to be a generated secret (>= 16 chars)
 *  - NOT a plain word, short ID, numeric count, URL, path, boolean, or email address
 */
function looksLikeSecret(val) {
  if (!val || val.trim().length < 16) return false;
  const v = val.trim();

  // Skip obvious non-secrets regardless of length
  if (/^https?:\/\//i.test(v)) return false;           // URL
  if (/^[A-Za-z]:\\/.test(v) || /^\\\\/.test(v)) return false; // file path
  if (/^\d+$/.test(v)) return false;                   // pure numeric (count/timeout)
  if (/^(true|false|yes|no)$/i.test(v)) return false;  // boolean
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(v)) return false; // email address

  // JWT: three base64url segments separated by dots
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) return true;

  // Base64-encoded block (no spaces, only base64 chars, length divisible by 4 or with padding)
  if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(v) && v.length % 4 === 0) return true;

  // Hex string (common for API keys, hashes)
  if (/^[0-9a-fA-F]{32,}$/.test(v)) return true;

  // High character entropy: >= 16 chars and unique-char ratio > 0.6
  const unique = new Set(v.split('')).size;
  if (v.length >= 16 && unique / v.length > 0.6) return true;

  return false;
}

function analyzeIntegrations(xamlData, configData) {
  const findings = [];

  if (configData.found && !configData.error) {
    const allRows = [
      ...(configData.settings  || []),
      ...(configData.constants || []),
      ...(configData.assets    || [])
    ];
    allRows.forEach(row => {
      const name = String(extractRowKey(row) || '').toLowerCase();
      const val  = extractRowValue(row);
      if (!val || !val.trim()) return; // blank — not a hardcoded credential

      // Key name must suggest a credential AND the actual value must look like a secret.
      // Key name alone is NOT sufficient — "token", "secret", "key" appear in many
      // non-credential config names (e.g. retry counts, interval flags, API endpoint names).
      const isCredLikeName = ['password', 'secret', 'token', 'apikey', 'api_key', 'credential', 'pwd'].some(k => name.includes(k));
      if (!isCredLikeName) return;

      // Explicitly safe value prefixes — asset/orchestrator references are not hardcoded
      if (val.toLowerCase().startsWith('asset:') || val.toLowerCase().startsWith('orchestrator')) return;

      if (looksLikeSecret(val)) {
        // Value has characteristics of a real secret — report as Fail
        findings.push(createFinding('Security Checks', `Config: ${name}`, 'Config.xlsx', 'Fail',
          `Potential hardcoded credential found in Config.xlsx for key "${name}". The value has characteristics of a secret or access token.`,
          'Remove the credential value from the configuration file and store it as a Credential Asset or in a secure vault.'));
      } else {
        // Name looks credential-related but value is not proven to be a secret —
        // informational only to avoid false positives on retry counts, intervals, etc.
        findings.push(createFinding('Security Checks', `Config: ${name}`, 'Config.xlsx', 'Info',
          `Configuration key "${name}" has a credential-like name. Review the value to confirm it does not contain a plaintext secret.`,
          'If this value is a secret or access token, store it as a Credential Asset rather than in Config.xlsx.'));
      }
    });
  }

  xamlData.forEach(xf => {
    if (xf.error) return;
    (xf.inlineCredentials || []).forEach(match => {
      // The XAML parser already filters non-literals ({x:Null}, [expr]). The match
      // contains the full attribute=value fragment. Apply the same value-content check
      // to avoid flagging attribute names that happen to contain "token"/"secret" but
      // whose values are non-secret literals (e.g. token="bearer_type_label").
      const valueMatch = match.match(/=\s*"([^"]+)"/);
      const rawVal = valueMatch ? valueMatch[1] : match;
      if (looksLikeSecret(rawVal)) {
        findings.push(createFinding('Security Checks', 'Inline Credential', xf.fileName, 'Fail',
          'Potential hardcoded credential detected in workflow file. The value has characteristics of a secret or access token.',
          'Remove hardcoded credentials from all workflow files. Use a Credential Asset or a secure vault.'));
      } else {
        findings.push(createFinding('Security Checks', 'Inline Credential (review)', xf.fileName, 'Info',
          `A credential-like attribute was detected in "${xf.fileName}". Review to confirm the value is not a plaintext secret.`,
          'If this value is a secret or access token, store it as a Credential Asset rather than hardcoding it in the workflow.'));
      }
    });
  });

  return findings;
}

// ── Master runner ─────────────────────────────────────────────────────────────

async function runFullAnalysis(projectRoot, targetEnvironment = '') {
  const projectData   = parseProjectJson(projectRoot);
  const xamlData      = await parseAllXamlFiles(projectRoot);
  const configData    = parseConfigXlsx(projectRoot);
  const isReFramework = detectReFramework(projectRoot, projectData);

  const skippedTestWorkflows = xamlData.skippedTestWorkflows || [];

  const summaryFindings  = analyzeProjectSummary(projectData);
  const packageFindings  = analyzePackages(projectData);
  const runtimeFindings  = analyzeRuntimeDeps(xamlData, configData, targetEnvironment);
  const dataFindings     = analyzeDataDeps(xamlData, configData, targetEnvironment);
  const appFindings      = analyzeAppDeps(xamlData, targetEnvironment);
  const securityFindings = analyzeIntegrations(xamlData, configData);

  const allFindings = [
    ...summaryFindings,
    ...packageFindings,
    ...runtimeFindings,
    ...dataFindings,
    ...appFindings,
    ...securityFindings
  ];

  const summary = {
    total:               allFindings.length,
    pass:                allFindings.filter(f => f.status === 'Pass').length,
    warning:             allFindings.filter(f => f.status === 'Warning').length,
    fail:                allFindings.filter(f => f.status === 'Fail').length,
    projectName:         projectData?.name              || 'Unknown',
    projectVersion:      projectData?.projectVersion    || '',
    studioVersion:       projectData?.studioVersion     || '',
    robotVersion:        projectData?.robotVersion      || '',
    targetFramework:     projectData?.targetFramework   || 'Unknown',
    expressionLanguage:  projectData?.expressionLanguage || 'Unknown',
    outputType:          projectData?.outputType        || 'Unknown',
    isReFramework,
    xamlFilesAnalyzed:   xamlData.length,
    skippedTestWorkflows,
    configFound:         configData.found,
    configSheets:        configData.sheetNames || []
  };

  return {
    summary,
    findings: allFindings,
    metadata: {
      analyzedAt:        new Date().toISOString(),
      projectRoot,
      targetEnvironment: targetEnvironment || null
    }
  };
}

module.exports = { runFullAnalysis, detectReFramework };
