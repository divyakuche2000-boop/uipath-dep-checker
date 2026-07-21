import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './Dashboard.css';

// ── Constants ────────────────────────────────────────────────────────────────

const CAT_META = {
  'Project Summary':          { color: '#3b82d4', icon: '📦' },
  'Dependencies':             { color: '#7c5cd8', icon: '🔗' },
  'Configuration Validation': { color: '#059669', icon: '⚙' },
  'Environment Validation':   { color: '#d97706', icon: '🌍' },
  'External Resources':       { color: '#0891b2', icon: '🌐' },
  'Security Checks':          { color: '#dc2626', icon: '🔒' },
  // legacy
  Library:      { color: '#3b82d4', icon: '📦' },
  Orchestrator: { color: '#7c5cd8', icon: '🔗' },
  Data:         { color: '#059669', icon: '⚙' },
  Application:  { color: '#d97706', icon: '🌍' },
  Integration:  { color: '#dc2626', icon: '🔒' },
};

const STATUS_META = {
  Pass:    { bg: '#f0fdf4', color: '#15803d', border: '#86efac', icon: '✓', label: 'Passed'   },
  Warning: { bg: '#fffbeb', color: '#92400e', border: '#fcd34d', icon: '⚠', label: 'Warning'  },
  Fail:    { bg: '#fff1f2', color: '#be123c', border: '#fda4af', icon: '✕', label: 'Critical' },
};

const PAGE_SIZE = 20;

// ── Helpers ──────────────────────────────────────────────────────────────────

function catColor(cat)  { return (CAT_META[cat] || CAT_META['Project Summary']).color; }
function catIcon(cat)   { return (CAT_META[cat] || CAT_META['Project Summary']).icon; }
function statusMeta(s)  { return STATUS_META[s] || STATUS_META['Warning']; }

/** Deployment readiness score: weighted penalty per Fail (8pts) and Warning (2pts). */
function calcReadiness(summary) {
  if (!summary || summary.total === 0) return 100;
  const raw = 100 - (summary.fail * 8) - (summary.warning * 2);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function readinessLabel(score) {
  if (score >= 90) return { text: 'Ready',               sub: 'No critical issues', cls: 'rd-ready'    };
  if (score >= 70) return { text: 'Ready with Warnings', sub: 'Review warnings',    cls: 'rd-warn'     };
  if (score >= 40) return { text: 'At Risk',             sub: 'Fix critical issues', cls: 'rd-risk'    };
  return            { text: 'Not Ready',              sub: 'Blockers detected',  cls: 'rd-block'   };
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '< 1s';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Inline SVG doughnut — no external charting library needed. */
function DoughnutChart({ pass, warning, fail }) {
  const total = pass + warning + fail || 1;
  const R = 44, CX = 56, CY = 56, stroke = 14;
  const circ = 2 * Math.PI * R;

  function arc(value, offset) {
    const pct = value / total;
    return { dasharray: `${pct * circ} ${circ}`, offset: `${offset * circ}` };
  }
  const passOff  = 0;
  const warnOff  = pass / total;
  const failOff  = (pass + warning) / total;

  return (
    <svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label="Status distribution">
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
      {fail > 0 && (
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#ef4444" strokeWidth={stroke}
          strokeDasharray={arc(fail, failOff).dasharray}
          strokeDashoffset={`-${arc(fail, failOff).offset}`}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '56px 56px' }} />
      )}
      {warning > 0 && (
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f59e0b" strokeWidth={stroke}
          strokeDasharray={arc(warning, warnOff).dasharray}
          strokeDashoffset={`-${arc(warning, warnOff).offset}`}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '56px 56px' }} />
      )}
      {pass > 0 && (
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#22c55e" strokeWidth={stroke}
          strokeDasharray={arc(pass, passOff).dasharray}
          strokeDashoffset={`-${arc(pass, passOff).offset}`}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '56px 56px' }} />
      )}
      <text x={CX} y={CY - 5}  textAnchor="middle" fontSize="14" fontWeight="700" fill="#1f2328">{total}</text>
      <text x={CX} y={CY + 10} textAnchor="middle" fontSize="8"  fill="#57606a">checks</text>
    </svg>
  );
}

/** Inline horizontal bar chart per category. */
function CategoryBarChart({ findings }) {
  const cats = useMemo(() => {
    const map = {};
    findings.forEach(f => {
      if (!map[f.category]) map[f.category] = { pass: 0, warn: 0, fail: 0 };
      if (f.status === 'Pass')    map[f.category].pass++;
      else if (f.status === 'Warning') map[f.category].warn++;
      else                             map[f.category].fail++;
    });
    return Object.entries(map).map(([cat, v]) => ({ cat, ...v, total: v.pass + v.warn + v.fail }));
  }, [findings]);

  const max = Math.max(...cats.map(c => c.total), 1);
  return (
    <div className="db-bar-chart">
      {cats.map(({ cat, pass, warn, fail, total }) => (
        <div key={cat} className="db-bar-row">
          <div className="db-bar-label">
            <span className="db-bar-icon">{catIcon(cat)}</span>
            <span className="db-bar-cat">{cat}</span>
          </div>
          <div className="db-bar-track">
            {fail  > 0 && <div className="db-bar-seg db-bar-fail"  style={{ width: `${(fail  / max) * 100}%` }} title={`${fail} Critical`}  />}
            {warn  > 0 && <div className="db-bar-seg db-bar-warn"  style={{ width: `${(warn  / max) * 100}%` }} title={`${warn} Warning`}   />}
            {pass  > 0 && <div className="db-bar-seg db-bar-pass"  style={{ width: `${(pass  / max) * 100}%` }} title={`${pass} Passed`}    />}
          </div>
          <span className="db-bar-total">{total}</span>
        </div>
      ))}
    </div>
  );
}

/** Recommendations derived from findings — no hardcoded env/platform strings. */
function buildRecommendations(findings, targetEnvironment, platform) {
  const env = targetEnvironment || 'the target environment';
  const criticals = findings.filter(f => f.status === 'Fail');
  const warnings  = findings.filter(f => f.status === 'Warning');

  const critical = criticals.slice(0, 5).map(f => ({
    title: f.name,
    body:  f.recommendation || f.issue,
    cat:   f.category
  }));

  const high = warnings.slice(0, 5).map(f => ({
    title: f.name,
    body:  f.recommendation || f.issue,
    cat:   f.category
  }));

  const improvements = [];
  const cats = [...new Set(findings.map(f => f.category))];
  if (cats.includes('Security Checks') && criticals.some(f => f.category === 'Security Checks')) {
    improvements.push('Remove all hardcoded credentials and store them in a centralised credential store before proceeding to the next environment.');
  }
  if (cats.includes('Configuration Validation')) {
    improvements.push(`Ensure all configuration values in the project's configuration source are complete and appropriate for ${env}.`);
  }
  if (cats.includes('External Resources')) {
    improvements.push('Replace hardcoded file system paths and connection strings with parameterised values resolved at runtime.');
  }
  if (cats.includes('Environment Validation')) {
    improvements.push(`Verify all URLs and selectors are valid endpoints for ${env}. Externalise environment-specific values to the configuration source.`);
  }
  if (improvements.length === 0) {
    improvements.push('Continue regular validation checks as part of the deployment pipeline to maintain quality standards.');
  }

  const bestPractices = [
    'Store all credentials and secrets in a centralised secure credential store.',
    'Use parameterised configuration values instead of hardcoded paths or URLs.',
    'Validate the project package against each target environment before deployment.',
    'Keep all package dependencies up to date and monitor for end-of-life notices.',
    'Include automated validation as a gate in your CI/CD pipeline.'
  ];

  return { critical, high, improvements, bestPractices };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Dashboard({ report, targetEnvironment, platform }) {
  const { summary, findings, metadata } = report;
  const envLabel   = targetEnvironment || 'Generic';
  const platLabel  = platform          || 'Auto Detected';
  const score      = calcReadiness(summary);
  const readiness  = readinessLabel(score);
  const recs       = useMemo(() => buildRecommendations(findings, targetEnvironment, platform), [findings, targetEnvironment, platform]);
  const duration   = metadata.validationDurationMs ? formatDuration(metadata.validationDurationMs) : '—';
  const validatedAt = new Date(metadata.analyzedAt).toLocaleString();

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter,   setStatusFilter]   = useState('All');
  const [search,         setSearch]         = useState('');
  const [sortCol,        setSortCol]        = useState(null);
  const [sortDir,        setSortDir]        = useState('asc');
  const [page,           setPage]           = useState(1);
  const [expandedRow,    setExpandedRow]    = useState(null);
  const [activeSection,  setActiveSection]  = useState('overview');

  const categories = useMemo(() => {
    const cats = new Set(findings.map(f => f.category));
    return ['All', ...cats];
  }, [findings]);

  const filtered = useMemo(() => {
    let rows = findings.filter(f => {
      const matchCat    = categoryFilter === 'All' || f.category === categoryFilter;
      const matchStatus = statusFilter === 'All' || f.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch = !q || [f.name, f.location, f.issue, f.recommendation, f.category]
        .some(v => (v || '').toLowerCase().includes(q));
      return matchCat && matchStatus && matchSearch;
    });
    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        const av = (a[sortCol] || '').toString().toLowerCase();
        const bv = (b[sortCol] || '').toString().toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return rows;
  }, [findings, categoryFilter, statusFilter, search, sortCol, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function resetPage() { setPage(1); }
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    resetPage();
  }
  function sortIcon(col) {
    if (sortCol !== col) return <span className="db-th-sort">⇅</span>;
    return <span className="db-th-sort active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  function exportExcel() {
    const data = filtered.map(f => ({
      Category:       f.category,
      'Item':         f.name,
      Location:       f.location,
      Status:         f.status === 'Fail' ? 'Critical' : f.status,
      Description:    f.issue,
      Recommendation: f.recommendation
    }));
    const ws  = XLSX.utils.json_to_sheet(data);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Validation Results');
    const sumData = [
      { Metric: 'Project',              Value: summary.projectName },
      { Metric: 'Platform',             Value: platLabel },
      { Metric: 'Framework',            Value: summary.targetFramework },
      { Metric: 'Target Environment',   Value: envLabel },
      { Metric: 'Workflow Files',       Value: summary.xamlFilesAnalyzed },
      { Metric: 'Configuration File',   Value: summary.configFound ? 'Found' : 'Missing' },
      { Metric: 'Total Checks',         Value: summary.total },
      { Metric: 'Passed',              Value: summary.pass },
      { Metric: 'Warnings',            Value: summary.warning },
      { Metric: 'Critical Issues',     Value: summary.fail },
      { Metric: 'Readiness Score',     Value: `${score}%` },
      { Metric: 'Readiness Status',    Value: readiness.text },
      { Metric: 'Validated At',        Value: validatedAt }
    ];
    const ws2 = XLSX.utils.json_to_sheet(sumData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Executive Summary');
    XLSX.writeFile(wb, `Automation_Validation_Report_${Date.now()}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(16);
    doc.text('Automation Project Validation Report', 14, 16);
    doc.setFontSize(9);
    doc.text(`Project: ${summary.projectName}  |  Platform: ${platLabel}  |  Environment: ${envLabel}  |  Validated: ${validatedAt}`, 14, 24);
    doc.text(`Total: ${summary.total}  |  Passed: ${summary.pass}  |  Warnings: ${summary.warning}  |  Critical: ${summary.fail}  |  Readiness: ${score}% — ${readiness.text}`, 14, 30);
    autoTable(doc, {
      startY: 36,
      head: [['Category', 'Item', 'Location', 'Status', 'Description', 'Recommendation']],
      body: filtered.map(f => [
        f.category, f.name, f.location,
        f.status === 'Fail' ? 'Critical' : f.status,
        f.issue, f.recommendation
      ]),
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0:{cellWidth:28}, 1:{cellWidth:40}, 2:{cellWidth:30}, 3:{cellWidth:18}, 4:{cellWidth:62}, 5:{cellWidth:62} },
      didParseCell: (data) => {
        if (data.column.index === 3 && data.section === 'body') {
          const v = data.cell.raw;
          if (v === 'Critical') data.cell.styles.textColor = [190, 18, 60];
          else if (v === 'Warning') data.cell.styles.textColor = [146, 64, 14];
          else if (v === 'Pass')    data.cell.styles.textColor = [21, 128, 61];
        }
      }
    });
    doc.save(`Automation_Validation_Report_${Date.now()}.pdf`);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="db">

      {/* ── Section Nav ──────────────────────────────────────────────── */}
      <nav className="db-nav">
        {[
          { id: 'overview',  label: 'Overview'     },
          { id: 'project',   label: 'Project Info'  },
          { id: 'categories',label: 'Categories'    },
          { id: 'findings',  label: 'Findings'      },
          { id: 'recommendations', label: 'Recommendations' },
        ].map(s => (
          <button key={s.id}
            className={`db-nav-btn${activeSection === s.id ? ' active' : ''}`}
            onClick={() => setActiveSection(s.id)}>
            {s.label}
          </button>
        ))}
        <div className="db-nav-spacer" />
        <button className="db-export-btn db-export-xl" onClick={exportExcel}>
          <span>⬇</span> Excel
        </button>
        <button className="db-export-btn db-export-pdf" onClick={exportPdf}>
          <span>⬇</span> PDF
        </button>
      </nav>

      {/* ══════════════════════════════════ OVERVIEW ══════════════════════════════════ */}
      {activeSection === 'overview' && (
        <div className="db-section">

          {/* KPI Row */}
          <div className="db-kpi-grid">
            <div className="db-kpi">
              <div className="db-kpi-icon" style={{ background: '#eff6ff', color: '#3b82d4' }}>📋</div>
              <div className="db-kpi-body">
                <div className="db-kpi-val">{summary.total}</div>
                <div className="db-kpi-lbl">Total Checks</div>
              </div>
            </div>
            <div className="db-kpi db-kpi-pass">
              <div className="db-kpi-icon" style={{ background: '#f0fdf4', color: '#22c55e' }}>✓</div>
              <div className="db-kpi-body">
                <div className="db-kpi-val">{summary.pass}</div>
                <div className="db-kpi-lbl">Passed</div>
              </div>
            </div>
            <div className="db-kpi db-kpi-warn">
              <div className="db-kpi-icon" style={{ background: '#fffbeb', color: '#f59e0b' }}>⚠</div>
              <div className="db-kpi-body">
                <div className="db-kpi-val">{summary.warning}</div>
                <div className="db-kpi-lbl">Warnings</div>
              </div>
            </div>
            <div className="db-kpi db-kpi-fail">
              <div className="db-kpi-icon" style={{ background: '#fff1f2', color: '#ef4444' }}>✕</div>
              <div className="db-kpi-body">
                <div className="db-kpi-val">{summary.fail}</div>
                <div className="db-kpi-lbl">Critical Issues</div>
              </div>
            </div>
            <div className="db-kpi">
              <div className="db-kpi-icon" style={{ background: '#faf5ff', color: '#7c5cd8' }}>⏱</div>
              <div className="db-kpi-body">
                <div className="db-kpi-val db-kpi-val-sm">{duration}</div>
                <div className="db-kpi-lbl">Validation Duration</div>
              </div>
            </div>
            {/* Readiness score KPI */}
            <div className={`db-kpi db-kpi-readiness ${readiness.cls}`}>
              <div className="db-kpi-score-ring">
                <svg width="60" height="60" viewBox="0 0 60 60">
                  <circle cx="30" cy="30" r="24" fill="none" stroke="#e5e7eb" strokeWidth="6"/>
                  <circle cx="30" cy="30" r="24" fill="none"
                    stroke={score >= 90 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="6"
                    strokeDasharray={`${(score / 100) * 150.8} 150.8`}
                    strokeLinecap="round"
                    style={{ transform: 'rotate(-90deg)', transformOrigin: '30px 30px' }}/>
                  <text x="30" y="34" textAnchor="middle" fontSize="11" fontWeight="800" fill="#1f2328">{score}%</text>
                </svg>
              </div>
              <div className="db-kpi-body">
                <div className="db-kpi-val db-kpi-val-sm">Deployment Readiness</div>
                <div className={`db-kpi-badge ${readiness.cls}`}>{readiness.text}</div>
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="db-charts-row">
            {/* Doughnut */}
            <div className="db-chart-card">
              <div className="db-chart-title">Validation Status Distribution</div>
              <div className="db-donut-wrap">
                <DoughnutChart pass={summary.pass} warning={summary.warning} fail={summary.fail} />
                <div className="db-donut-legend">
                  <div className="db-legend-item"><span className="db-legend-dot" style={{ background: '#22c55e' }} />Passed <strong>{summary.pass}</strong></div>
                  <div className="db-legend-item"><span className="db-legend-dot" style={{ background: '#f59e0b' }} />Warnings <strong>{summary.warning}</strong></div>
                  <div className="db-legend-item"><span className="db-legend-dot" style={{ background: '#ef4444' }} />Critical <strong>{summary.fail}</strong></div>
                </div>
              </div>
            </div>

            {/* Bar chart */}
            <div className="db-chart-card db-chart-bar-card">
              <div className="db-chart-title">Issues by Category</div>
              <CategoryBarChart findings={findings} />
              <div className="db-bar-legend">
                <span><span className="db-legend-dot" style={{ background: '#ef4444' }} />Critical</span>
                <span><span className="db-legend-dot" style={{ background: '#f59e0b' }} />Warning</span>
                <span><span className="db-legend-dot" style={{ background: '#22c55e' }} />Passed</span>
              </div>
            </div>

            {/* Platform / Env summary */}
            <div className="db-chart-card db-chart-meta-card">
              <div className="db-chart-title">Validation Context</div>
              <div className="db-meta-table">
                <div className="db-meta-row">
                  <span className="db-meta-k">Platform</span>
                  <span className="db-meta-v">{platLabel}</span>
                </div>
                <div className="db-meta-row">
                  <span className="db-meta-k">Environment</span>
                  <span className="db-meta-v"><span className="db-env-badge">{envLabel}</span></span>
                </div>
                <div className="db-meta-row">
                  <span className="db-meta-k">Project</span>
                  <span className="db-meta-v">{summary.projectName}</span>
                </div>
                <div className="db-meta-row">
                  <span className="db-meta-k">Framework</span>
                  <span className="db-meta-v">{summary.targetFramework}</span>
                </div>
                <div className="db-meta-row">
                  <span className="db-meta-k">Workflow Files</span>
                  <span className="db-meta-v">{summary.xamlFilesAnalyzed}</span>
                </div>
                <div className="db-meta-row">
                  <span className="db-meta-k">Config File</span>
                  <span className={`db-meta-v ${summary.configFound ? 'db-text-pass' : 'db-text-fail'}`}>
                    {summary.configFound ? '✓ Found' : '✕ Missing'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Deployment Readiness Card */}
          <div className={`db-readiness-card ${readiness.cls}`}>
            <div className="db-readiness-left">
              <div className="db-readiness-score-wrap">
                <svg width="90" height="90" viewBox="0 0 90 90">
                  <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8"/>
                  <circle cx="45" cy="45" r="38" fill="none"
                    stroke="rgba(255,255,255,0.9)" strokeWidth="8"
                    strokeDasharray={`${(score / 100) * 238.8} 238.8`}
                    strokeLinecap="round"
                    style={{ transform: 'rotate(-90deg)', transformOrigin: '45px 45px' }}/>
                  <text x="45" y="49" textAnchor="middle" fontSize="18" fontWeight="800" fill="#fff">{score}%</text>
                </svg>
              </div>
              <div className="db-readiness-text">
                <div className="db-readiness-title">{readiness.text}</div>
                <div className="db-readiness-sub">Deployment Readiness Score</div>
              </div>
            </div>
            <div className="db-readiness-right">
              <div className="db-readiness-summary">
                {score >= 90 && `This project passed ${summary.pass} of ${summary.total} validation checks with ${summary.warning} warning(s) and no critical issues. It is ready for deployment to ${envLabel !== 'Generic' ? envLabel : 'the target environment'}.`}
                {score >= 70 && score < 90 && `This project has ${summary.warning} warning(s) and ${summary.fail} critical issue(s). Address the critical issues before deployment and review all warnings.`}
                {score >= 40 && score < 70 && `This project has ${summary.fail} critical issue(s) that must be resolved before it can be deployed. Review all findings in the Findings tab.`}
                {score < 40 && `This project has significant issues (${summary.fail} critical, ${summary.warning} warnings) and is not ready for deployment. All critical issues must be resolved.`}
              </div>
              <div className="db-readiness-stats">
                <div className="db-rs-item"><span className="db-rs-num">{summary.pass}</span><span className="db-rs-lbl">Passed</span></div>
                <div className="db-rs-item"><span className="db-rs-num">{summary.warning}</span><span className="db-rs-lbl">Warnings</span></div>
                <div className="db-rs-item"><span className="db-rs-num">{summary.fail}</span><span className="db-rs-lbl">Critical</span></div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════ PROJECT INFO ══════════════════════════════ */}
      {activeSection === 'project' && (
        <div className="db-section">
          <div className="db-proj-grid">

            {/* Project details */}
            <div className="db-info-card">
              <div className="db-info-card-title">📦 Project Information</div>
              <div className="db-info-table">
                {[
                  ['Project Name',      summary.projectName],
                  ['Platform',          platLabel],
                  ['Framework',         summary.targetFramework],
                  ['Project Version',   summary.projectVersion || '—'],
                  ['Studio Version',    summary.studioVersion  || '—'],
                  ['Robot Version',     summary.robotVersion   || '—'],
                  ['Language',          summary.expressionLanguage || '—'],
                  ['Output Type',       summary.outputType     || '—'],
                  ['REFramework',       summary.isReFramework  ? 'Yes' : 'No'],
                ].map(([k, v]) => (
                  <div key={k} className="db-info-row">
                    <span className="db-info-k">{k}</span>
                    <span className="db-info-v">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Validation context */}
            <div className="db-info-card">
              <div className="db-info-card-title">🌍 Validation Context</div>
              <div className="db-info-table">
                {[
                  ['Target Environment', envLabel],
                  ['Workflow Files',     summary.xamlFilesAnalyzed],
                  ['Configuration File', summary.configFound ? 'Found ✓' : 'Missing ✕'],
                  ['Validated At',       validatedAt],
                  ['Readiness Score',    `${score}%`],
                  ['Readiness Status',   readiness.text],
                  ['Total Checks',       summary.total],
                  ['Passed',            summary.pass],
                  ['Warnings',          summary.warning],
                  ['Critical Issues',   summary.fail],
                ].map(([k, v]) => (
                  <div key={k} className="db-info-row">
                    <span className="db-info-k">{k}</span>
                    <span className={`db-info-v ${k === 'Configuration File' && !summary.configFound ? 'db-text-fail' : ''}`}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Validation Progress Timeline */}
            <div className="db-info-card db-timeline-card">
              <div className="db-info-card-title">🕐 Validation Progress</div>
              <div className="db-timeline">
                {[
                  { label: 'Project Uploaded',          done: true  },
                  { label: 'Structure Validated',        done: true  },
                  { label: 'Dependencies Verified',      done: true  },
                  { label: 'Configuration Checked',      done: true  },
                  { label: 'Security Scan Completed',    done: true  },
                  { label: 'Report Generated',           done: true  },
                ].map((step, i) => (
                  <div key={i} className="db-timeline-item">
                    <div className={`db-timeline-dot${step.done ? ' done' : ''}`}>{step.done ? '✓' : '○'}</div>
                    <div className={`db-timeline-label${step.done ? ' done' : ''}`}>{step.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════ CATEGORIES ═══════════════════════════════ */}
      {activeSection === 'categories' && (
        <div className="db-section">
          <div className="db-cat-grid">
            {categories.filter(c => c !== 'All').map(cat => {
              const catFindings = findings.filter(f => f.category === cat);
              const cPass = catFindings.filter(f => f.status === 'Pass').length;
              const cWarn = catFindings.filter(f => f.status === 'Warning').length;
              const cFail = catFindings.filter(f => f.status === 'Fail').length;
              const color = catColor(cat);
              const icon  = catIcon(cat);
              const hasIssues = cFail > 0 || cWarn > 0;
              return (
                <div key={cat} className="db-cat-card"
                  style={{ borderTop: `3px solid ${color}` }}
                  onClick={() => { setCategoryFilter(cat); setActiveSection('findings'); resetPage(); }}>
                  <div className="db-cat-card-header">
                    <span className="db-cat-card-icon">{icon}</span>
                    <span className="db-cat-card-name">{cat}</span>
                    {hasIssues
                      ? <span className="db-cat-card-badge db-cat-badge-issue">{cFail > 0 ? `${cFail} critical` : `${cWarn} warnings`}</span>
                      : <span className="db-cat-card-badge db-cat-badge-ok">All passed</span>
                    }
                  </div>
                  <div className="db-cat-card-stats">
                    <span className="db-css pass">{cPass} passed</span>
                    <span className="db-css warn">{cWarn} warnings</span>
                    <span className="db-css fail">{cFail} critical</span>
                  </div>
                  <div className="db-cat-progress">
                    {catFindings.length > 0 && (
                      <div className="db-cat-bar">
                        {cFail > 0 && <div className="db-cat-bar-fail"  style={{ width: `${(cFail / catFindings.length) * 100}%` }} />}
                        {cWarn > 0 && <div className="db-cat-bar-warn"  style={{ width: `${(cWarn / catFindings.length) * 100}%` }} />}
                        {cPass > 0 && <div className="db-cat-bar-pass"  style={{ width: `${(cPass / catFindings.length) * 100}%` }} />}
                      </div>
                    )}
                  </div>
                  <div className="db-cat-card-cta">View findings →</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════ FINDINGS ═════════════════════════════════ */}
      {activeSection === 'findings' && (
        <div className="db-section">

          {/* Controls */}
          <div className="db-controls">
            <div className="db-controls-left">
              <div className="db-search-wrap">
                <span className="db-search-icon">🔍</span>
                <input type="text" className="db-search-input" placeholder="Search findings…"
                  value={search} onChange={e => { setSearch(e.target.value); resetPage(); }} />
                {search && <button className="db-search-clear" onClick={() => { setSearch(''); resetPage(); }}>✕</button>}
              </div>
              <select className="db-select" value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); resetPage(); }}>
                <option value="All">All Statuses</option>
                <option value="Pass">Passed</option>
                <option value="Warning">Warning</option>
                <option value="Fail">Critical</option>
              </select>
              <select className="db-select" value={categoryFilter}
                onChange={e => { setCategoryFilter(e.target.value); resetPage(); }}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="db-controls-right">
              <span className="db-results-count">
                <strong>{filtered.length}</strong> of <strong>{findings.length}</strong> results
              </span>
              <button className="db-export-btn db-export-xl" onClick={exportExcel}>⬇ Excel</button>
              <button className="db-export-btn db-export-pdf" onClick={exportPdf}>⬇ PDF</button>
            </div>
          </div>

          {/* Category tabs */}
          <div className="db-tabs">
            {categories.map(c => (
              <button key={c}
                className={`db-tab${categoryFilter === c ? ' active' : ''}`}
                style={categoryFilter === c && c !== 'All' ? { borderBottomColor: catColor(c), color: catColor(c) } : {}}
                onClick={() => { setCategoryFilter(c); resetPage(); }}>
                {catIcon(c !== 'All' ? c : '')} {c}
                <span className="db-tab-count">
                  {c === 'All' ? findings.length : findings.filter(f => f.category === c).length}
                </span>
              </button>
            ))}
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="db-empty">
              <span>🔍</span>
              <p>No results match your current filters.</p>
              <button className="db-clear-btn" onClick={() => { setSearch(''); setStatusFilter('All'); setCategoryFilter('All'); resetPage(); }}>
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="db-table-wrap">
                <table className="db-table">
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort('category')} className="db-th-sort-col">
                        Category {sortIcon('category')}
                      </th>
                      <th onClick={() => toggleSort('name')} className="db-th-sort-col">
                        Item {sortIcon('name')}
                      </th>
                      <th onClick={() => toggleSort('location')} className="db-th-sort-col">
                        Location {sortIcon('location')}
                      </th>
                      <th onClick={() => toggleSort('status')} className="db-th-sort-col">
                        Status {sortIcon('status')}
                      </th>
                      <th>Description</th>
                      <th>Recommendation</th>
                      <th style={{ width: 90 }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((f, i) => {
                      const sm  = statusMeta(f.status);
                      const idx = (page - 1) * PAGE_SIZE + i;
                      const isExpanded = expandedRow === idx;
                      return (
                        <React.Fragment key={idx}>
                          <tr className={`db-row${isExpanded ? ' expanded' : ''}`}>
                            <td>
                              <span className="db-cat-badge"
                                style={{ background: catColor(f.category) + '18', color: catColor(f.category), borderColor: catColor(f.category) + '50' }}>
                                {catIcon(f.category)} {f.category}
                              </span>
                            </td>
                            <td className="db-td-name">{f.name}</td>
                            <td className="db-td-loc"><code>{f.location}</code></td>
                            <td>
                              <span className="db-status-pill"
                                style={{ background: sm.bg, color: sm.color, borderColor: sm.border }}>
                                {sm.icon} {f.status === 'Fail' ? 'Critical' : sm.label}
                              </span>
                            </td>
                            <td className="db-td-issue">{f.issue}</td>
                            <td className="db-td-rec">{f.recommendation}</td>
                            <td>
                              <button className="db-detail-btn"
                                onClick={() => setExpandedRow(isExpanded ? null : idx)}>
                                {isExpanded ? 'Hide' : 'View'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="db-row-detail">
                              <td colSpan={7}>
                                <div className="db-detail-panel">
                                  <div className="db-detail-col">
                                    <div className="db-detail-head">Description</div>
                                    <p className="db-detail-body">{f.issue}</p>
                                  </div>
                                  <div className="db-detail-col">
                                    <div className="db-detail-head">Recommendation</div>
                                    <p className="db-detail-body">{f.recommendation}</p>
                                  </div>
                                  <div className="db-detail-col">
                                    <div className="db-detail-head">Details</div>
                                    <div className="db-detail-meta">
                                      <div><strong>Category:</strong> {f.category}</div>
                                      <div><strong>Location:</strong> {f.location}</div>
                                      <div><strong>Status:</strong> {f.status === 'Fail' ? 'Critical' : f.status}</div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="db-pagination">
                  <button className="db-pg-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
                  <button className="db-pg-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, idx) => {
                    let pg = idx + 1;
                    if (totalPages > 7) {
                      if (page <= 4) pg = idx + 1;
                      else if (page >= totalPages - 3) pg = totalPages - 6 + idx;
                      else pg = page - 3 + idx;
                    }
                    return (
                      <button key={pg} className={`db-pg-btn${page === pg ? ' active' : ''}`} onClick={() => setPage(pg)}>{pg}</button>
                    );
                  })}
                  <button className="db-pg-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
                  <button className="db-pg-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
                  <span className="db-pg-label">Page {page} of {totalPages}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════ RECOMMENDATIONS ══════════════════════════ */}
      {activeSection === 'recommendations' && (
        <div className="db-section">
          <div className="db-rec-grid">

            {/* Critical Issues */}
            <div className="db-rec-card db-rec-critical">
              <div className="db-rec-card-title">🚨 Critical Issues</div>
              {recs.critical.length === 0
                ? <p className="db-rec-none">No critical issues found.</p>
                : recs.critical.map((r, i) => (
                  <div key={i} className="db-rec-item">
                    <div className="db-rec-item-title">{r.title}</div>
                    <div className="db-rec-item-body">{r.body}</div>
                    <span className="db-rec-item-cat">{r.cat}</span>
                  </div>
                ))
              }
            </div>

            {/* High Priority */}
            <div className="db-rec-card db-rec-high">
              <div className="db-rec-card-title">⚠ High Priority Fixes</div>
              {recs.high.length === 0
                ? <p className="db-rec-none">No high priority warnings.</p>
                : recs.high.map((r, i) => (
                  <div key={i} className="db-rec-item">
                    <div className="db-rec-item-title">{r.title}</div>
                    <div className="db-rec-item-body">{r.body}</div>
                    <span className="db-rec-item-cat">{r.cat}</span>
                  </div>
                ))
              }
            </div>

            {/* Suggested Improvements */}
            <div className="db-rec-card db-rec-improve">
              <div className="db-rec-card-title">💡 Suggested Improvements</div>
              {recs.improvements.map((r, i) => (
                <div key={i} className="db-rec-item db-rec-item-plain">{r}</div>
              ))}
            </div>

            {/* Best Practices */}
            <div className="db-rec-card db-rec-best">
              <div className="db-rec-card-title">✅ Best Practices</div>
              {recs.bestPractices.map((r, i) => (
                <div key={i} className="db-rec-item db-rec-item-plain">{r}</div>
              ))}
            </div>
          </div>

          {/* Overall Deployment Recommendation */}
          <div className={`db-final-card ${readiness.cls}`}>
            <div className="db-final-left">
              <div className="db-final-icon">
                {score >= 90 ? '🟢' : score >= 70 ? '🟡' : score >= 40 ? '🟠' : '🔴'}
              </div>
              <div>
                <div className="db-final-title">Overall Deployment Recommendation</div>
                <div className="db-final-status">{readiness.text}</div>
              </div>
            </div>
            <div className="db-final-body">
              <p>
                <strong>Readiness Score: {score}%</strong>
                {' — '}
                {score >= 90 && `The project meets all critical validation checks and is ready for deployment to ${envLabel !== 'Generic' ? envLabel : 'the target environment'}. Review the ${summary.warning} warning(s) at your discretion.`}
                {score >= 70 && score < 90 && `The project may proceed to ${envLabel !== 'Generic' ? envLabel : 'the target environment'} once the ${summary.fail} critical issue(s) are resolved. The ${summary.warning} warning(s) should be reviewed and addressed in the next release cycle.`}
                {score >= 40 && score < 70 && `Deployment is not recommended until the ${summary.fail} critical issue(s) are resolved. These issues represent significant risks to the stability and security of the automation in ${envLabel !== 'Generic' ? envLabel : 'the target environment'}.`}
                {score < 40 && `Deployment must not proceed. The project has ${summary.fail} critical issues and ${summary.warning} warnings. A full remediation cycle is required before re-validation.`}
              </p>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
