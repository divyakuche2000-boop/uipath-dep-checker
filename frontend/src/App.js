import React, { useState } from 'react';
import UploadPanel from './components/UploadPanel';
import Dashboard from './components/Dashboard';
import './App.css';

export default function App() {
  const [report, setReport]                     = useState(null);
  const [sessionId, setSessionId]               = useState(null);
  const [phase, setPhase]                       = useState('upload'); // 'upload' | 'analyzing' | 'done'
  const [error, setError]                       = useState(null);
  const [targetEnvironment, setTargetEnvironment] = useState('');
  const [platform, setPlatform]                 = useState('');

  async function handleUpload(file, env, plat) {
    setError(null);
    setTargetEnvironment(env || '');
    setPlatform(plat || '');
    setPhase('analyzing');
    try {
      // Step 1: Upload ZIP
      const formData = new FormData();
      formData.append('project', file);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || 'Upload failed');
      }
      const uploadData = await uploadRes.json();
      setSessionId(uploadData.sessionId);

      // Step 2: Run validation, passing target environment and platform in body
      const analysisRes = await fetch(`/api/analysis/${uploadData.sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetEnvironment: env || '',
          platform: plat || ''
        })
      });
      if (!analysisRes.ok) {
        const err = await analysisRes.json();
        throw new Error(err.error || 'Validation failed');
      }
      const analysisData = await analysisRes.json();
      setReport(analysisData);
      setPhase('done');
    } catch (e) {
      setError(e.message);
      setPhase('upload');
    }
  }

  function handleReset() {
    setReport(null);
    setSessionId(null);
    setPhase('upload');
    setError(null);
    setTargetEnvironment('');
    setPlatform('');
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <span className="brand-icon">&#9989;</span>
            <div>
              <h1 className="header-title">Automation Project Validator</h1>
              <p className="header-sub">
                Validate automation projects for deployment by analyzing project structure,
                dependencies, configurations, integrations, security, and deployment readiness.
              </p>
            </div>
          </div>
          {phase === 'done' && (
            <button className="btn btn-outline" onClick={handleReset}>
              &#8617; Validate Another Project
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="alert alert-error">
            <strong>Error:</strong> {error}
          </div>
        )}
        {phase === 'upload' && <UploadPanel onUpload={handleUpload} />}
        {phase === 'analyzing' && (
          <div className="analyzing-state">
            <div className="spinner"></div>
            <h2>Validating Automation Project...</h2>
            <p>Parsing project structure, workflow files, and configuration — this may take a few seconds.</p>
          </div>
        )}
        {phase === 'done' && report && (
          <Dashboard
            report={report}
            targetEnvironment={targetEnvironment}
            platform={platform}
          />
        )}
      </main>
    </div>
  );
}
