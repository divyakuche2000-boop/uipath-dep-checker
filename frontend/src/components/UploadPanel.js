import React, { useState, useRef } from 'react';
import './UploadPanel.css';

const PLATFORMS = [
  { value: '',                label: 'Auto Detect',         icon: '🔍' },
  { value: 'UiPath',          label: 'UiPath',              icon: '🤖' },
  { value: 'PowerAutomate',   label: 'Power Automate',      icon: '⚡' },
  { value: 'AutomationAnywhere', label: 'Automation Anywhere', icon: '🔄' },
  { value: 'BluePrism',       label: 'Blue Prism',          icon: '💎' },
  { value: 'Generic',         label: 'Generic Workflow',    icon: '📋' }
];

const ENVIRONMENTS = [
  { value: '',            label: 'Generic (No Environment)' },
  { value: 'Development', label: 'Development' },
  { value: 'Test',        label: 'Test' },
  { value: 'UAT',         label: 'UAT' },
  { value: 'Production',  label: 'Production' },
  { value: 'Custom',      label: 'Custom' }
];

const VALIDATION_CATEGORIES = [
  { icon: '📦', title: 'Project Structure',   desc: 'Package versions, target framework, entry points, and project metadata completeness.' },
  { icon: '🔗', title: 'Dependencies',         desc: 'Control plane queues, assets, credentials, and workflow invocation references.' },
  { icon: '⚙',  title: 'Configuration',        desc: 'Config file presence, placeholder values, and environment-specific settings.' },
  { icon: '🌍', title: 'Environment',          desc: 'URLs, UI selectors, and values that may vary across deployment environments.' },
  { icon: '🔒', title: 'Security',             desc: 'Inline credentials, insecure endpoints, hardcoded secrets, and TLS compliance.' },
  { icon: '🌐', title: 'Integrations',         desc: 'External file paths, database connections, API endpoints, and resource references.' },
  { icon: '📊', title: 'Deployment Readiness', desc: 'Aggregate pass/warn/fail score and a prioritised list of deployment blockers.' }
];

const FEATURE_HIGHLIGHTS = [
  { icon: '🔍', title: 'Auto Platform Detection',  desc: 'Identifies the automation platform from the project package automatically.' },
  { icon: '🌍', title: 'Multi-Environment',         desc: 'Validate against Development, Test, UAT, Production, or any custom environment.' },
  { icon: '🔒', title: 'Security Checks',           desc: 'Detects hardcoded credentials, insecure URLs, and inline secrets.' },
  { icon: '⚙',  title: 'Config Validation',         desc: 'Flags blank, placeholder, or environment-mismatched configuration values.' },
  { icon: '📄', title: 'Export Reports',            desc: 'Download full validation results as Excel or PDF with a single click.' },
  { icon: '🧩', title: 'Extensible Architecture',   desc: 'Add custom validation rules or new platform parsers without core changes.' }
];

export default function UploadPanel({ onUpload }) {
  const [dragging, setDragging]           = useState(false);
  const [selectedFile, setSelectedFile]   = useState(null);
  const [platform, setPlatform]           = useState('');
  const [targetEnvironment, setTargetEnvironment] = useState('');
  const inputRef = useRef();

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) setSelectedFile(file);
  }

  function handleSubmit() {
    if (selectedFile) onUpload(selectedFile, targetEnvironment, platform);
  }

  const selectedPlatform = PLATFORMS.find(p => p.value === platform) || PLATFORMS[0];

  return (
    <div className="up-page">

      {/* ── Hero Banner ─────────────────────────────────────────────────── */}
      <section className="up-hero">
        <div className="up-hero-inner">
          <div className="up-hero-text">
            <div className="up-hero-eyebrow">Enterprise Automation Governance</div>
            <h2 className="up-hero-title">Validate Before You Deploy</h2>
            <p className="up-hero-sub">
              Upload an automation project package&nbsp;
              <span className="up-hero-tag">.zip</span> and get an instant,
              structured report covering project structure, dependencies,
              configuration completeness, environment readiness, and security
              posture — across any automation platform.
            </p>
            <div className="up-hero-chips">
              <span className="up-chip">UiPath</span>
              <span className="up-chip">Power Automate</span>
              <span className="up-chip">Automation Anywhere</span>
              <span className="up-chip">Blue Prism</span>
              <span className="up-chip up-chip-more">+ more</span>
            </div>
          </div>
          <div className="up-hero-stat-group">
            <div className="up-hero-stat">
              <span className="up-hero-stat-num">7</span>
              <span className="up-hero-stat-lbl">Validation Categories</span>
            </div>
            <div className="up-hero-stat">
              <span className="up-hero-stat-num">5</span>
              <span className="up-hero-stat-lbl">Supported Platforms</span>
            </div>
            <div className="up-hero-stat">
              <span className="up-hero-stat-num">5</span>
              <span className="up-hero-stat-lbl">Target Environments</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Main Grid: Config + Upload ──────────────────────────────────── */}
      <section className="up-main-grid">

        {/* Left column: selectors */}
        <div className="up-config-col">

          {/* Platform selector */}
          <div className="up-field-card">
            <div className="up-field-header">
              <span className="up-field-icon">🖥</span>
              <div>
                <div className="up-field-title">Automation Platform</div>
                <div className="up-field-hint">Select the platform or let the validator detect it automatically from the uploaded package.</div>
              </div>
            </div>
            <div className="up-platform-grid">
              {PLATFORMS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  className={`up-platform-btn${platform === p.value ? ' selected' : ''}`}
                  onClick={() => setPlatform(p.value)}
                >
                  <span className="up-platform-icon">{p.icon}</span>
                  <span className="up-platform-label">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Environment selector */}
          <div className="up-field-card">
            <div className="up-field-header">
              <span className="up-field-icon">🌍</span>
              <div>
                <div className="up-field-title">Target Environment</div>
                <div className="up-field-hint">Validation messages will reference this environment. Leave as Generic for environment-agnostic validation.</div>
              </div>
            </div>
            <div className="up-env-grid">
              {ENVIRONMENTS.map(env => (
                <button
                  key={env.value}
                  type="button"
                  className={`up-env-btn${targetEnvironment === env.value ? ' selected' : ''}`}
                  onClick={() => setTargetEnvironment(env.value)}
                >
                  {env.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: upload zone */}
        <div className="up-upload-col">
          <div className="up-upload-card">
            <div className="up-upload-card-header">
              <span className="up-upload-card-title">Upload Project Package</span>
              <span className="up-format-badge">.zip</span>
            </div>

            {/* Active selections summary */}
            <div className="up-selection-row">
              <span className="up-sel-chip up-sel-chip-platform">
                {selectedPlatform.icon}&nbsp;{selectedPlatform.label}
              </span>
              <span className="up-sel-chip up-sel-chip-env">
                🌍&nbsp;{targetEnvironment || 'Generic'}
              </span>
            </div>

            {/* Drop zone */}
            <div
              className={`up-drop-zone${dragging ? ' dragging' : ''}${selectedFile ? ' has-file' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => !selectedFile && inputRef.current.click()}
            >
              {selectedFile ? (
                <div className="up-file-selected">
                  <div className="up-file-icon-wrap">📦</div>
                  <div className="up-file-info">
                    <p className="up-file-name">{selectedFile.name}</p>
                    <p className="up-file-meta">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      &nbsp;·&nbsp;Ready to validate
                    </p>
                  </div>
                  <button
                    className="up-remove-btn"
                    onClick={e => { e.stopPropagation(); setSelectedFile(null); }}
                    title="Remove file"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="up-drop-content">
                  <div className="up-drop-icon-wrap">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <rect width="48" height="48" rx="12" fill="#EFF6FF"/>
                      <path d="M24 14v14M24 14l-5 5M24 14l5 5" stroke="#3b82d4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M14 32h20" stroke="#3b82d4" strokeWidth="2.5" strokeLinecap="round"/>
                      <path d="M11 36h26" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <p className="up-drop-primary">Drag &amp; Drop Project Package</p>
                  <p className="up-drop-secondary">or</p>
                  <button
                    className="up-browse-btn"
                    onClick={e => { e.stopPropagation(); inputRef.current.click(); }}
                  >
                    Browse Files
                  </button>
                  <p className="up-drop-note">Supported format: <strong>.zip</strong> · Max 100 MB</p>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".zip"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            {/* Validate button */}
            {selectedFile ? (
              <button className="up-validate-btn" onClick={handleSubmit}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2"/>
                </svg>
                Validate Project
              </button>
            ) : (
              <button className="up-validate-btn" disabled>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2"/>
                </svg>
                Select a file to continue
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Validation Categories ────────────────────────────────────────── */}
      <section className="up-section">
        <h3 className="up-section-title">What Gets Validated</h3>
        <p className="up-section-sub">Each uploaded package is analysed across seven structured validation categories.</p>
        <div className="up-cat-grid">
          {VALIDATION_CATEGORIES.map(cat => (
            <div key={cat.title} className="up-cat-card">
              <span className="up-cat-icon">{cat.icon}</span>
              <div className="up-cat-title">{cat.title}</div>
              <div className="up-cat-desc">{cat.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature Highlights ───────────────────────────────────────────── */}
      <section className="up-section up-section-alt">
        <h3 className="up-section-title">Platform Capabilities</h3>
        <p className="up-section-sub">Built for enterprise automation governance at scale.</p>
        <div className="up-feat-grid">
          {FEATURE_HIGHLIGHTS.map(f => (
            <div key={f.title} className="up-feat-card">
              <span className="up-feat-icon">{f.icon}</span>
              <div className="up-feat-title">{f.title}</div>
              <div className="up-feat-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
