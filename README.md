# Automation Project Validator

Automation Project Validator is a centralized platform that validates automation project packages by analyzing project structure, dependencies, configurations, external resources, environment-specific settings, and deployment readiness. The solution is designed to support multiple automation platforms and can be extended with additional validation rules.

Upload a project ZIP, get a categorized validation report — packages, control plane resources, configuration values, environment settings, external resources, and security findings.

---

## Table of Contents

1. [Solution Architecture](#solution-architecture)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [What Gets Validated](#what-gets-validated)
5. [Getting Started — Local Development](#getting-started--local-development)
6. [Getting Started — Docker](#getting-started--docker)
7. [API Reference](#api-reference)
8. [Dashboard Features](#dashboard-features)
9. [Adding Custom Rules](#adding-custom-rules)
10. [Security Notes](#security-notes)

---

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (React)                         │
│  UploadPanel → ZIP drag-and-drop → POST /api/upload             │
│  Dashboard   → Summary, Filter, Search, Table, Export           │
└───────────────────────┬────────────────────────────────────────-┘
                        │ HTTP (localhost only)
┌───────────────────────▼─────────────────────────────────────────┐
│                   Express Backend (Node.js)                     │
│                                                                 │
│  POST /api/upload/:sessionId                                    │
│    └─ multer → adm-zip → extract to /extracted/<uuid>/          │
│                                                                 │
│  POST /api/analysis/:sessionId                                  │
│    ├─ projectJsonParser   → parse project.json                  │
│    ├─ xamlParser          → regex scan all .xaml files          │
│    ├─ configXlsxParser    → parse Config.xlsx sheets            │
│    └─ dependencyAnalyzer  → 5 validation passes → JSON report   │
└─────────────────────────────────────────────────────────────────┘
```

### Validation Passes

| Pass | Category | Source Files |
|------|----------|-------------|
| 1 | **Project Summary** | `project.json` → `dependencies` block |
| 2 | **Dependencies** | All workflow files — queue/asset/credential references |
| 3 | **Configuration Validation** | `Config.xlsx` rows — settings and constants |
| 4 | **Environment Validation** | Selectors, URLs, invoked workflow paths in workflow files |
| 5a | **External Resources** | File paths, DB connections, Excel file references |
| 5b | **Security Checks** | Inline credential patterns in workflow files + `Config.xlsx` |

---

## Technology Stack

### Backend
| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.18.2 | HTTP server and routing |
| `multer` | ^1.4.5-lts.1 | Multipart file upload handling |
| `adm-zip` | ^0.5.10 | ZIP extraction |
| `xml2js` | ^0.6.2 | XAML (XML) parsing |
| `xlsx` | ^0.18.5 | Config.xlsx reading |
| `uuid` | ^9.0.0 | Session ID generation |
| `express-rate-limit` | ^7.1.5 | API rate limiting |
| `cors` | ^2.8.5 | CORS policy |

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^18.2.0 | UI framework |
| `react-dom` | ^18.2.0 | DOM rendering |
| `xlsx` | ^0.18.5 | Export to Excel |
| `jspdf` | ^2.5.1 | Export to PDF |
| `jspdf-autotable` | ^3.8.2 | Table layout in PDF |

### Infrastructure
| Component | Technology |
|-----------|-----------|
| Container base image | `registry.redhat.io/ubi9/nodejs-18-minimal` |
| Frontend serving | `registry.redhat.io/ubi9/nginx-120` |
| Orchestration | Docker Compose v3.9 |

---

## Project Structure

```
automation-project-validator/
├── .env.example                  # Environment variable template
├── .gitignore
├── docker-compose.yml            # Full-stack container orchestration
├── README.md
│
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js             # Express entry point
│       ├── routes/
│       │   ├── upload.js         # POST /api/upload
│       │   └── analysis.js       # POST /api/analysis/:sessionId
│       ├── parsers/
│       │   ├── projectJsonParser.js   # Reads project.json
│       │   ├── xamlParser.js          # Scans .xaml workflow files
│       │   └── configXlsxParser.js    # Reads Config.xlsx
│       └── analyzers/
│           └── dependencyAnalyzer.js  # Core 5-pass validation engine
│
└── frontend/
    ├── Dockerfile
    ├── nginx.conf                # Reverse proxy to backend
    ├── package.json
    ├── public/
    │   └── index.html
    └── src/
        ├── index.js
        ├── index.css
        ├── App.js                # Phase state machine (upload/validating/done)
        ├── App.css
        └── components/
            ├── UploadPanel.js    # Drag-and-drop ZIP uploader
            ├── UploadPanel.css
            ├── Dashboard.js      # Full validation dashboard + export
            └── Dashboard.css
```

---

## What Gets Validated

### 1. Project Summary (from `project.json`)
- All `dependencies` entries with their version ranges
- Version compared against known latest stable releases
- End-of-Life package detection (e.g. activities on v19/v20 major)
- `targetFramework` presence and value (Windows / Windows-Legacy / Cross-platform)
- Custom/internal packages flagged for manual package feed verification

### 2. Dependencies (from workflow files)
- **Queues** — all `QueueName` references extracted and listed for Dev verification
- **Assets** — all `AssetName` / `GetRobotAsset` references
- **Credentials** — all `CredentialName` / `GetCredential` references
- Each resource flagged as Warning: must be manually confirmed in Dev environment

### 3. Configuration Validation
- **Config.xlsx** — presence check; blank/placeholder/PROD values in Settings & Constants sheets
- URLs in Config.xlsx — flagged as Warning if they contain "prod" / "production"

### 4. Environment Validation (from workflow files)
- **Selector attributes** — `title`, `url`, `app`, `cls` values that appear hardcoded and environment-specific
- **HTTP URLs** — insecure `http://` usage flagged as Fail (TLS required)
- **Production URLs** — any URL containing "prod" or "production" flagged as Fail
- **Hardcoded invoked workflow paths** — absolute paths in Invoke Workflow File activities

### 5. External Resources (from workflow files)
- **Hardcoded absolute paths** (`C:\...`, `\\server\...`) in `WorkbookPath` and other attributes
- **Database connection strings** — detected and flagged as Fail (must use Credential Assets)

### 6. Security Checks (workflow files + `Config.xlsx`)
- **Inline credentials** — regex patterns for `password=`, `apikey=`, `token=`, `secret=` with values
- **Config.xlsx credential keys** — rows whose key name contains "password", "secret", "token", "apikey" with non-empty values
- All flagged as Fail per IBM P0 security policy

---

## Supported Automation Platforms

The validator is designed to support automation projects from multiple platforms:

| Platform | Project File | Workflow Format |
|----------|-------------|----------------|
| **UiPath** | `project.json` | `.xaml` |
| Power Automate | *(planned)* | `.json` flows |
| Automation Anywhere | *(planned)* | `.atmx` / `.json` |
| Blue Prism | *(planned)* | `.bprelease` |
| Other platforms | *(extensible)* | Custom parsers |

> The current release ships with full support for UiPath project packages. Support for additional platforms can be added by implementing new parsers and validation passes — see [Adding Custom Rules](#adding-custom-rules).

---

## Getting Started — Local Development

### Prerequisites
- Node.js >= 18.x
- npm >= 9.x

### 1. Backend

```bash
cd automation-project-validator/backend
npm install
npm run dev          # starts on http://127.0.0.1:5000 with nodemon
```

### 2. Frontend

```bash
cd automation-project-validator/frontend
npm install
npm start            # starts on http://localhost:3000
                     # proxies /api/* to http://127.0.0.1:5000
```

### 3. Open the dashboard

Navigate to `http://localhost:3000` in your browser.

---

## Getting Started — Docker

### Prerequisites
- Docker Engine >= 24.x
- Docker Compose >= 2.x
- Access to `registry.redhat.io` (Red Hat credentials required for base images)

```bash
# Log in to Red Hat registry first
docker login registry.redhat.io

# From the project root:
cp .env.example .env          # review and adjust if needed

docker compose up --build     # builds and starts both services
```

The dashboard will be available at **`http://127.0.0.1:3000`**.

> **Note:** The docker-compose binds only to `127.0.0.1:3000` — never `0.0.0.0` — per IBM network security policy.

---

## API Reference

### `GET /api/health`
Returns service health status.

**Response:**
```json
{ "status": "ok", "timestamp": "2025-01-15T10:00:00.000Z" }
```

---

### `POST /api/upload`
Upload an automation project ZIP file.

**Request:** `multipart/form-data`  
**Field:** `project` — `.zip` or `.nupkg` file, max 100 MB

**Response `200`:**
```json
{
  "sessionId": "a1b2c3d4-...",
  "originalName": "MyProject.zip",
  "extractedFiles": ["project.json", "Main.xaml", "Data/Config.xlsx", "..."],
  "extractPath": "/app/extracted/a1b2c3d4-..."
}
```

**Response `400`:** Invalid file type  
**Response `500`:** ZIP extraction failure

---

### `POST /api/analysis/:sessionId`
Run full validation on an uploaded project.

**Response `200`:**
```json
{
  "summary": {
    "total": 42,
    "pass": 18,
    "warning": 16,
    "fail": 8,
    "projectName": "InvoiceProcessing",
    "targetFramework": "Windows",
    "xamlFilesAnalyzed": 12,
    "configFound": true
  },
  "findings": [
    {
      "category": "Project Summary",
      "name": "UiPath.System.Activities",
      "location": "project.json",
      "status": "Pass",
      "issue": "UiPath.System.Activities@24.10.0 — version is current.",
      "recommendation": ""
    },
    {
      "category": "External Resources",
      "name": "File Path: input.xlsx",
      "location": "Process.xaml",
      "status": "Fail",
      "issue": "Hardcoded absolute Excel path found: \"C:\\RPA\\Input\\input.xlsx\".",
      "recommendation": "Move the file path to the configuration file or a Credential Asset."
    }
  ],
  "metadata": {
    "analyzedAt": "2025-01-15T10:05:00.000Z",
    "projectRoot": "/app/extracted/a1b2c3d4-..."
  }
}
```

**Response `404`:** Session not found  
**Response `500`:** Validation error

---

## Dashboard Features

| Feature | Description |
|---------|-------------|
| **Upload** | Drag-and-drop or browse — accepts `.zip` up to 100 MB |
| **Summary Cards** | Total / Pass / Warning / Fail counts at a glance |
| **Project Metadata** | Name, framework, workflow file count, config file status |
| **Category Tabs** | Filter by All / Project Summary / Dependencies / Configuration Validation / Environment Validation / External Resources / Security Checks |
| **Status Filter** | Dropdown to show only Pass, Warning, or Fail results |
| **Search** | Full-text search across name, location, issue, and recommendation columns |
| **Validation Results Table** | Paginated (20 rows/page) with color-coded category badges and status pills |
| **Export Excel** | Downloads all filtered results + summary sheet as `.xlsx` |
| **Export PDF** | Downloads all filtered results as A4 landscape PDF with auto-table |
| **Validate Another** | Reset button to upload a new project without page refresh |

---

## Adding Custom Rules

The validation engine is modular. Each validation pass is a standalone function in  
[`backend/src/analyzers/dependencyAnalyzer.js`](backend/src/analyzers/dependencyAnalyzer.js).

### Example: Add a custom package version rule

```js
// In dependencyAnalyzer.js → KNOWN_LATEST object
const KNOWN_LATEST = {
  // ... existing entries ...
  'MyCompany.CustomActivities': '3.2.0',   // add your internal package
};
```

### Example: Add a new workflow pattern (e.g. detect Storage Bucket references)

```js
// In xamlParser.js
const BUCKET_PATTERNS = [
  /BucketName\s*=\s*["']([^"']+)["']/g,
  /storageBucket\s*=\s*["']([^"']+)["']/g
];

// Inside parseXamlFile(), add:
result.storageBuckets = extractMatches(content, BUCKET_PATTERNS);
```

Then handle `xf.storageBuckets` in `analyzeOrchestratorDeps()` in `dependencyAnalyzer.js`.

### Example: Add a new validation pass

```js
// In dependencyAnalyzer.js
function analyzeCustomRules(xamlData) {
  const findings = [];
  // ... your logic ...
  return findings;
}

// In runFullAnalysis(), add to allFindings:
const customFindings = analyzeCustomRules(xamlData);
const allFindings = [ ...existing..., ...customFindings ];
```

### Example: Add support for a new automation platform

To validate projects from a different platform (e.g. Power Automate JSON flows):

1. Create a new parser under `backend/src/parsers/` (e.g. `powerAutomateParser.js`)
2. Call it in `runFullAnalysis()` in `dependencyAnalyzer.js`
3. Add platform-specific validation logic as new passes
4. Map the findings to the existing category schema

---

## Security Notes

This project follows IBM security standards throughout:

- **No secrets hardcoded** — all configuration via environment variables (`.env.example`)
- **Non-root containers** — all Docker images run as UID 1001
- **Red Hat UBI base images** — `registry.redhat.io/ubi9/nodejs-18-minimal` and `nginx-120`
- **Localhost binding only** — server binds to `127.0.0.1`, Docker exposes only `127.0.0.1:3000`
- **Rate limiting** — 100 requests per 15-minute window on all API endpoints
- **File type validation** — only `.zip` and `.nupkg` files accepted; MIME type and extension checked
- **No persistent storage of uploads** — extracted files are session-scoped scratch only
- **TLS** — use a TLS-terminating reverse proxy (e.g. nginx with cert) for any non-localhost deployment
- **Read-only container filesystem** — backend container runs with `read_only: true`; tmpfs for `/tmp`
