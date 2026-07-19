import React, { useState, useRef } from 'react';
import './UploadPanel.css';

export default function UploadPanel({ onUpload }) {
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const inputRef = useRef();

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.zip')) setSelectedFile(file);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) setSelectedFile(file);
  }

  function handleSubmit() {
    if (selectedFile) onUpload(selectedFile);
  }

  return (
    <div className="upload-panel">
      <div className="upload-card">
        <h2 className="upload-title">Upload UiPath Project</h2>
        <p className="upload-desc">
          Upload your UiPath project as a <strong>.zip</strong> file. The analyzer will extract
          and scan <code>project.json</code>, all <code>.xaml</code> workflow files, and
          <code> Config.xlsx</code> for dependency issues.
        </p>

        <div
          className={`drop-zone ${dragging ? 'dragging' : ''} ${selectedFile ? 'has-file' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !selectedFile && inputRef.current.click()}
        >
          {selectedFile ? (
            <div className="file-selected">
              <span className="file-icon">&#128196;</span>
              <div className="file-info">
                <p className="file-name">{selectedFile.name}</p>
                <p className="file-size">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <button className="btn btn-outline remove-btn" onClick={e => { e.stopPropagation(); setSelectedFile(null); }}>
                &#x2715; Remove
              </button>
            </div>
          ) : (
            <div className="drop-content">
              <span className="drop-icon">&#128229;</span>
              <p className="drop-title">Drag &amp; drop your project ZIP here</p>
              <p className="drop-or">or</p>
              <button className="btn btn-primary" onClick={e => { e.stopPropagation(); inputRef.current.click(); }}>
                Browse Files
              </button>
            </div>
          )}
          <input ref={inputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>

        {selectedFile && (
          <button className="btn btn-primary analyze-btn" onClick={handleSubmit}>
            &#9654; Run Dependency Analysis
          </button>
        )}

        <div className="upload-checklist">
          <h3>What gets analyzed</h3>
          <ul>
            <li>&#128214; <strong>project.json</strong> — Package versions, target framework</li>
            <li>&#128196; <strong>*.xaml files</strong> — Queues, assets, credentials, selectors, URLs, paths</li>
            <li>&#128202; <strong>Config.xlsx</strong> — Settings, constants, asset references</li>
            <li>&#128274; <strong>Security scan</strong> — Hardcoded credentials, insecure URLs, inline secrets</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
