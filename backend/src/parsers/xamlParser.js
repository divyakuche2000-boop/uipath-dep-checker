'use strict';
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

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

async function parseXamlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const result = {
    file: filePath,
    fileName,
    queues: extractMatches(content, QUEUE_PATTERNS),
    assets: extractMatches(content, ASSET_PATTERNS),
    credentials: extractMatches(content, CREDENTIAL_PATTERNS),
    urls: extractMatches(content, URL_PATTERNS),
    filePaths: extractMatches(content, FILE_PATH_PATTERNS),
    excelFiles: extractMatches(content, [EXCEL_PATTERN]),
    dbConnections: extractMatches(content, [DB_PATTERN]),
    invokedWorkflows: extractMatches(content, [INVOKE_PATTERN]),
    selectorIssues: []
  };

  // Analyze selectors
  let sm;
  SELECTOR_PATTERN.lastIndex = 0;
  while ((sm = SELECTOR_PATTERN.exec(content)) !== null) {
    const issues = analyzeSelector(sm[1], fileName);
    result.selectorIssues.push(...issues);
  }

  return result;
}

async function parseAllXamlFiles(projectRoot) {
  const results = [];
  function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.xaml')) results.push(full);
    });
  }
  walk(projectRoot);

  const parsed = [];
  for (const f of results) {
    try { parsed.push(await parseXamlFile(f)); }
    catch (e) { parsed.push({ file: f, fileName: path.basename(f), error: e.message }); }
  }
  return parsed;
}

module.exports = { parseAllXamlFiles };
