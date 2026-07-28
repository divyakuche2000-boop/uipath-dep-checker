'use strict';
const fs = require('fs');
const path = require('path');

// ── Value-filter helpers ─────────────────────────────────────────────────────

/**
 * Returns true when a captured attribute value is a non-literal that should be
 * excluded from findings (variable expression, XAML null, markup extension, etc.)
 *
 * Examples that are NOT real credentials / resource names:
 *   {x:Null}            — XAML null markup extension
 *   [sstr_SecretToken]  — VB/C# variable expression
 *   [in_config("key")]  — dictionary look-up
 *   {Binding ...}       — data-binding
 *   {x:Static ...}      — static member reference
 */
function isNonLiteralValue(val) {
  if (!val || !val.trim()) return true;
  const v = val.trim();
  // XAML markup extensions: {x:Null}, {Binding ...}, {StaticResource ...}, etc.
  if (v.startsWith('{') && v.endsWith('}')) return true;
  // VB / C# workflow expressions wrapped in [ ]
  if (v.startsWith('[') && v.endsWith(']')) return true;
  return false;
}

/**
 * Post-filter: remove items from an extractMatches result that are non-literal.
 */
function filterLiterals(values) {
  return values.filter(v => !isNonLiteralValue(v));
}

// ── Pattern definitions ──────────────────────────────────────────────────────

const QUEUE_PATTERNS = [
  /QueueName\s*=\s*["']([^"']+)["']/g,
  /queueName\s*=\s*["']([^"']+)["']/g,
  /"QueueName"[^>]*>([^<]+)</g
];

const ASSET_PATTERNS = [
  /AssetName\s*=\s*["']([^"']+)["']/g,
  /assetName\s*=\s*["']([^"']+)["']/g,
  /GetRobotAsset[^>]*Name\s*=\s*["']([^"']+)["']/g,
  /<InArgument[^>]*>\s*([A-Za-z][A-Za-z0-9_]+Asset[A-Za-z0-9_]*)\s*<\/InArgument>/g
];

const CREDENTIAL_PATTERNS = [
  /CredentialName\s*=\s*["']([^"']+)["']/g,
  /credentialName\s*=\s*["']([^"']+)["']/g,
  /GetCredential[^>]*Asset\s*=\s*["']([^"']+)["']/g
];

/**
 * Integration activity detectors.
 *
 * Each entry maps a dependency type to one or more patterns that, when matched
 * anywhere in the XAML content, confirm the workflow uses that integration.
 * Patterns match activity type names, assembly references, or namespace imports.
 */
const INTEGRATION_ACTIVITY_PATTERNS = {
  sharepoint: [
    /UiPath\.MicrosoftOffice365\.Activities\.Sharepoint/i,
    /UiPath\.Sharepoint\.Activities/i,
    /SharePointScope/i,
    /GetListItems|UploadDocument|DownloadDocument|CreateListItem|UpdateListItem/i
  ],
  email: [
    /UiPath\.Mail\.(?:IMAP|POP3|Exchange|Graph)\.Activities/i,
    /Office365ApplicationScope/i,
    /MicrosoftGraphAPI|GraphAPI/i,
    /GetMail|SendMail|MoveMailMessage|MarkMailAsRead/i,
    /uma:Office365/i
  ],
  smtp: [
    /UiPath\.Mail\.SMTP\.Activities/i,
    /SmtpClient|SendSMTP|ui:SendMail/i
  ],
  database: [
    /UiPath\.Database\.Activities/i,
    /DatabaseActivity|ExecuteQuery|ExecuteNonQuery|BulkInsert/i,
    /System\.Data\.SqlClient/i
  ],
  sap: [
    /UiPath\.UIAutomation\.Activities.*sap/i,
    /SAPGuiSession|sapLogon/i
  ],
  ftp: [
    /UiPath\.FTP\.Activities/i,
    /FtpScope|SftpScope|UploadFiles|DownloadFiles/i
  ]
};

// Known XAML namespace base URIs that should never be treated as runtime URLs
const XAML_NAMESPACE_PREFIXES = [
  'http://schemas.microsoft.com/',
  'http://schemas.openxmlformats.org/',
  'http://schemas.uipath.com/',
  'http://schemas.w3.org/',
  'http://www.w3.org/',
  'http://www.omg.org/'
];

function isXamlNamespaceUrl(url) {
  return XAML_NAMESPACE_PREFIXES.some(prefix => url.startsWith(prefix));
}

const URL_PATTERNS = [
  /(?:url|Url|URL|navigate|Navigate)\s*=\s*["'](https?:\/\/[^"']+)["']/g,
  /["'](https?:\/\/[a-zA-Z0-9._\-\/]+)["']/g
];

const FILE_PATH_PATTERNS = [
  /["']([A-Za-z]:\\[^"'<>|?*\n]+)["']/g,
  /["'](\\\\[^"'<>|?*\n]+)["']/g
];

const SELECTOR_PATTERN = /<(?:ui:)?Selector[^>]*>([\s\S]*?)<\/(?:ui:)?Selector>/g;
const HARDCODED_SELECTOR_ATTRS = ['title', 'url', 'app', 'cls'];

const INVOKE_PATTERN = /InvokeWorkflowFile[^>]*FileName\s*=\s*["']([^"']+)["']/g;
const EXCEL_PATTERN  = /WorkbookPath\s*=\s*["']([^"']+)["']/g;
const DB_PATTERN     = /ConnectionString\s*=\s*["']([^"']+)["']/g;

/**
 * Inline-credential detection patterns.
 *
 * Each regex matches an attribute assignment whose value is a real literal:
 *  - NOT {x:Null}  (null markup extension — parameter exists but is intentionally empty)
 *  - NOT [{expr}]  (VB/C# expression — value is resolved at runtime)
 *  - NOT {Binding} (data-binding)
 *
 * We look for a quote-delimited value of sufficient length that does NOT start
 * with { or [ (which would indicate a non-literal).
 */
const CRED_INLINE_PATTERNS = [
  // password="literal"  — min 4 chars, not a markup/expression value
  /password\s*=\s*"(?!\{)(?!\[)([^"]{4,})"/gi,
  /apikey\s*=\s*"(?!\{)(?!\[)([^"]{6,})"/gi,
  /token\s*=\s*"(?!\{)(?!\[)([^"]{8,})"/gi,
  /secret\s*=\s*"(?!\{)(?!\[)([^"]{6,})"/gi
];

// ── Extraction helpers ───────────────────────────────────────────────────────

function extractMatches(text, patterns) {
  const results = new Set();
  patterns.forEach(re => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1] && m[1].trim()) results.add(m[1].trim());
    }
  });
  return [...results];
}

function analyzeSelector(selectorXml, fileName) {
  const issues = [];
  HARDCODED_SELECTOR_ATTRS.forEach(attr => {
    const rx = new RegExp(`${attr}=['"]([^'"]+)['"]`, 'gi');
    let m;
    while ((m = rx.exec(selectorXml)) !== null) {
      const val = m[1];
      if (!val.includes('*') && (val.toLowerCase().includes('prod') || val.includes('http') || val.length > 5)) {
        issues.push({ attr, value: val, file: fileName, type: 'hardcoded_selector' });
      }
    }
  });
  return issues;
}

// ── Main parser ──────────────────────────────────────────────────────────────

async function parseXamlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);

  // Raw extraction (may contain non-literal values for some pattern sets)
  const rawQueues      = extractMatches(content, QUEUE_PATTERNS);
  const rawAssets      = extractMatches(content, ASSET_PATTERNS);
  const rawCredentials = extractMatches(content, CREDENTIAL_PATTERNS);
  const rawFilePaths   = extractMatches(content, FILE_PATH_PATTERNS);
  const rawExcelFiles  = extractMatches(content, [EXCEL_PATTERN]);
  const rawDbConns     = extractMatches(content, [DB_PATTERN]);
  const rawInvoked     = extractMatches(content, [INVOKE_PATTERN]);

  // URLs: filter out non-literals AND well-known XAML namespace URIs
  const rawUrls = extractMatches(content, URL_PATTERNS)
    .filter(url => !isNonLiteralValue(url) && !isXamlNamespaceUrl(url));

  // Filter non-literals from sets where expressions are commonly used as values
  const result = {
    file: filePath,
    fileName,
    queues:           filterLiterals(rawQueues),
    assets:           filterLiterals(rawAssets),
    credentials:      filterLiterals(rawCredentials),
    urls:             rawUrls,
    filePaths:        filterLiterals(rawFilePaths),
    excelFiles:       filterLiterals(rawExcelFiles),
    dbConnections:    filterLiterals(rawDbConns),
    invokedWorkflows: filterLiterals(rawInvoked),
    inlineCredentials: [],
    selectorIssues: [],
    // Integration types detected from activity namespaces / imports in this file
    integrationTypes: []
  };

  // Detect integration activity types by matching known patterns against the full XAML content
  for (const [intType, patterns] of Object.entries(INTEGRATION_ACTIVITY_PATTERNS)) {
    if (patterns.some(rx => { rx.lastIndex = 0; return rx.test(content); })) {
      result.integrationTypes.push(intType);
    }
  }

  // Inline credential scan — patterns already exclude {x:Null} and [expr] via look-ahead
  CRED_INLINE_PATTERNS.forEach(rx => {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(content)) !== null) {
      const fullMatch = m[0];
      // Extra guard: skip if the matched value is a non-literal (safety net)
      if (!isNonLiteralValue(m[1])) {
        result.inlineCredentials.push(fullMatch.substring(0, 80));
      }
    }
  });

  // Selector analysis
  SELECTOR_PATTERN.lastIndex = 0;
  let sm;
  while ((sm = SELECTOR_PATTERN.exec(content)) !== null) {
    const issues = analyzeSelector(sm[1], fileName);
    result.selectorIssues.push(...issues);
  }

  return result;
}

/**
 * Patterns for workflow files that are used only during development or testing
 * and should be excluded from deployment readiness validation.
 *
 * Rules (matched against the base filename, case-insensitive):
 *  - Exact names: Test.xaml, Debug.xaml, Sample.xaml
 *  - Wildcard prefixes: Test_*.xaml, Debug_*.xaml, Sample_*.xaml
 */
const TEST_WORKFLOW_PATTERNS = [
  /^test\.xaml$/i,
  /^test_.+\.xaml$/i,
  /^debug\.xaml$/i,
  /^debug_.+\.xaml$/i,
  /^sample\.xaml$/i,
  /^sample_.+\.xaml$/i
];

function isTestWorkflow(fileName) {
  return TEST_WORKFLOW_PATTERNS.some(rx => rx.test(fileName));
}

async function parseAllXamlFiles(projectRoot) {
  const results = [];
  const skipped = [];

  function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.xaml')) {
        if (isTestWorkflow(f)) {
          skipped.push(f);
        } else {
          results.push(full);
        }
      }
    });
  }
  walk(projectRoot);

  const parsed = [];
  for (const f of results) {
    try { parsed.push(await parseXamlFile(f)); }
    catch (e) { parsed.push({ file: f, fileName: path.basename(f), error: e.message,
                              queues: [], assets: [], credentials: [], urls: [],
                              filePaths: [], excelFiles: [], dbConnections: [],
                              invokedWorkflows: [], inlineCredentials: [], selectorIssues: [],
                              integrationTypes: [] }); }
  }

  // Aggregate all integration types detected across every workflow file
  const allIntegrationTypes = new Set();
  parsed.forEach(xf => (xf.integrationTypes || []).forEach(t => allIntegrationTypes.add(t)));

  // Attach metadata to the array itself so the analyzer can consume it
  parsed.skippedTestWorkflows = skipped;
  parsed.integrationTypes     = [...allIntegrationTypes];
  return parsed;
}

module.exports = { parseAllXamlFiles };
