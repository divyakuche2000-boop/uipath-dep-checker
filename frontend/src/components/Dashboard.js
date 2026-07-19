import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './Dashboard.css';

const CATEGORY_COLORS = {
  Library: '#3b82d4',
  Orchestrator: '#7c5cd8',
  Data: '#059669',
  Application: '#d97706',
  Integration: '#dc2626'
};

const STATUS_STYLES = {
  Pass:    { bg: '#f0fdf4', color: '#15803d', border: '#86efac' },
  Warning: { bg: '#fffbeb', color: '#92400e', border: '#fcd34d' },
  Fail:    { bg: '#fff0f0', color: '#b91c1c', border: '#f5c6c6' }
};

const PAGE_SIZE = 20;

export default function Dashboard({ report }) {
  const { summary, findings, metadata } = report;
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const categories = useMemo(() => {
    const cats = new Set(findings.map(f => f.category));
    return ['All', ...cats];
  }, [findings]);

  const filtered = useMemo(() => {
    return findings.filter(f => {
      const matchCat = categoryFilter === 'All' || f.category === categoryFilter;
      const matchStatus = statusFilter === 'All' || f.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch = !q || [f.name, f.location, f.issue, f.recommendation, f.category]
        .some(v => (v || '').toLowerCase().includes(q));
      return matchCat && matchStatus && matchSearch;
    });
  }, [findings, categoryFilter, statusFilter, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function resetPage() { setPage(1); }

  function exportExcel() {
    const data = filtered.map(f => ({
      Category: f.category,
      'Dependency Name': f.name,
      'Location': f.location,
      'Status': f.status,
      'Issue': f.issue,
      'Recommendation': f.recommendation
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Findings');
    // Summary sheet
    const sumData = [
      { Metric: 'Project', Value: summary.projectName },
      { Metric: 'Target Framework', Value: summary.targetFramework },
      { Metric: 'XAML Files Analyzed', Value: summary.xamlFilesAnalyzed },
      { Metric: 'Config.xlsx Found', Value: summary.configFound ? 'Yes' : 'No' },
      { Metric: 'Total Findings', Value: summary.total },
      { Metric: 'Pass', Value: summary.pass },
      { Metric: 'Warning', Value: summary.warning },
      { Metric: 'Fail', Value: summary.fail },
      { Metric: 'Analyzed At', Value: metadata.analyzedAt }
    ];
    const ws2 = XLSX.utils.json_to_sheet(sumData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
    XLSX.writeFile(wb, `UiPath_Dependency_Report_${Date.now()}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(16);
    doc.text('UiPath Dependency Verification Report', 14, 18);
    doc.setFontSize(10);
    doc.text(`Project: ${summary.projectName}  |  Framework: ${summary.targetFramework}  |  Analyzed: ${metadata.analyzedAt}`, 14, 26);
    doc.text(`Total: ${summary.total}  |  Pass: ${summary.pass}  |  Warning: ${summary.warning}  |  Fail: ${summary.fail}`, 14, 32);

    autoTable(doc, {
      startY: 38,
      head: [['Category', 'Dependency Name', 'Location', 'Status', 'Issue', 'Recommendation']],
      body: filtered.map(f => [f.category, f.name, f.location, f.status, f.issue, f.recommendation]),
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [31, 35, 40], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 45 },
        2: { cellWidth: 35 },
        3: { cellWidth: 18 },
        4: { cellWidth: 60 },
        5: { cellWidth: 60 }
      },
      didParseCell: (data) => {
        if (data.column.index === 3 && data.section === 'body') {
          const v = data.cell.raw;
          if (v === 'Fail') data.cell.styles.textColor = [185, 28, 28];
          else if (v === 'Warning') data.cell.styles.textColor = [146, 64, 14];
          else if (v === 'Pass') data.cell.styles.textColor = [21, 128, 61];
        }
      }
    });

    doc.save(`UiPath_Dependency_Report_${Date.now()}.pdf`);
  }

  return (
    <div className="dashboard">
      {/* Summary Cards */}
      <div className="summary-grid">
        <div className="sum-card">
          <div className="sum-value">{summary.total}</div>
          <div className="sum-label">Total Findings</div>
        </div>
        <div className="sum-card sum-pass">
          <div className="sum-value">{summary.pass}</div>
          <div className="sum-label">&#10003; Pass</div>
        </div>
        <div className="sum-card sum-warn">
          <div className="sum-value">{summary.warning}</div>
          <div className="sum-label">&#9888; Warning</div>
        </div>
        <div className="sum-card sum-fail">
          <div className="sum-value">{summary.fail}</div>
          <div className="sum-label">&#10007; Fail</div>
        </div>
      </div>

      {/* Project Metadata */}
      <div className="meta-bar">
        <div className="meta-item"><span className="meta-lbl">Project</span><span className="meta-val">{summary.projectName}</span></div>
        <div className="meta-item"><span className="meta-lbl">Framework</span><span className="meta-val">{summary.targetFramework}</span></div>
        <div className="meta-item"><span className="meta-lbl">XAML Files</span><span className="meta-val">{summary.xamlFilesAnalyzed}</span></div>
        <div className="meta-item">
          <span className="meta-lbl">Config.xlsx</span>
          <span className={`meta-val ${summary.configFound ? 'text-pass' : 'text-fail'}`}>
            {summary.configFound ? 'Found' : 'Missing'}
          </span>
        </div>
        <div className="meta-item"><span className="meta-lbl">Analyzed</span><span className="meta-val">{new Date(metadata.analyzedAt).toLocaleString()}</span></div>
      </div>

      {/* Controls */}
      <div className="controls-bar">
        <div className="category-tabs">
          {categories.map(c => (
            <button
              key={c}
              className={`tab-btn ${categoryFilter === c ? 'active' : ''}`}
              style={categoryFilter === c && c !== 'All' ? { borderBottomColor: CATEGORY_COLORS[c], color: CATEGORY_COLORS[c] } : {}}
              onClick={() => { setCategoryFilter(c); resetPage(); }}
            >
              {c}
              <span className="tab-count">
                {c === 'All' ? findings.length : findings.filter(f => f.category === c).length}
              </span>
            </button>
          ))}
        </div>

        <div className="controls-right">
          <div className="search-wrap">
            <span className="search-icon">&#128269;</span>
            <input
              type="text"
              className="search-input"
              placeholder="Search findings..."
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
            />
            {search && <button className="search-clear" onClick={() => { setSearch(''); resetPage(); }}>&#x2715;</button>}
          </div>

          <select
            className="status-select"
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); resetPage(); }}
          >
            <option value="All">All Statuses</option>
            <option value="Pass">Pass</option>
            <option value="Warning">Warning</option>
            <option value="Fail">Fail</option>
          </select>

          <button className="btn btn-success export-btn" onClick={exportExcel}>&#128196; Export Excel</button>
          <button className="btn btn-danger export-btn" onClick={exportPdf}>&#128196; Export PDF</button>
        </div>
      </div>

      {/* Results count */}
      <div className="results-bar">
        Showing <strong>{filtered.length}</strong> of <strong>{findings.length}</strong> findings
        {filtered.length > 0 && <> &nbsp;|&nbsp; Page <strong>{page}</strong> of <strong>{totalPages}</strong></>}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: 36 }}>&#128269;</span>
          <p>No findings match your current filters.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="findings-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Dependency Name</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Issue Description</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((f, i) => {
                  const st = STATUS_STYLES[f.status] || STATUS_STYLES['Warning'];
                  return (
                    <tr key={i} className="finding-row">
                      <td>
                        <span className="cat-badge" style={{ background: CATEGORY_COLORS[f.category] + '20', color: CATEGORY_COLORS[f.category], borderColor: CATEGORY_COLORS[f.category] + '60' }}>
                          {f.category}
                        </span>
                      </td>
                      <td className="td-name">{f.name}</td>
                      <td className="td-location"><code>{f.location}</code></td>
                      <td>
                        <span className="status-pill" style={{ background: st.bg, color: st.color, borderColor: st.border }}>
                          {f.status === 'Pass' ? '✓' : f.status === 'Fail' ? '✗' : '⚠'} {f.status}
                        </span>
                      </td>
                      <td className="td-issue">{f.issue}</td>
                      <td className="td-rec">{f.recommendation}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button className="pg-btn" disabled={page === 1} onClick={() => setPage(1)}>&#171;</button>
              <button className="pg-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>&#8249;</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, idx) => {
                let pg = idx + 1;
                if (totalPages > 7) {
                  if (page <= 4) pg = idx + 1;
                  else if (page >= totalPages - 3) pg = totalPages - 6 + idx;
                  else pg = page - 3 + idx;
                }
                return (
                  <button key={pg} className={`pg-btn ${page === pg ? 'active' : ''}`} onClick={() => setPage(pg)}>
                    {pg}
                  </button>
                );
              })}
              <button className="pg-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>&#8250;</button>
              <button className="pg-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>&#187;</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
