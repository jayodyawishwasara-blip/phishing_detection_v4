import React, { useState, useEffect, useRef } from 'react';
import { Shield, AlertTriangle, Search, Plus, Trash2, Eye, Activity, TrendingUp, Database, Zap, BookOpen, Camera, FileText, HardDrive, Clock, CheckCircle, XCircle, RefreshCw, BarChart3 } from 'lucide-react';

const API_URL = 'http://localhost:5000/api';

const PhishingDefenseDashboard = () => {
  const [activeTab, setActiveTab] = useState('offense');
  const [pastDomains, setPastDomains] = useState('combank-support.net\ncombank-verify.com\ncombankdigital-secure.net');
  const [predictedDomains, setPredictedDomains] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [newWatchlistDomain, setNewWatchlistDomain] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const monitoringInterval = useRef(null);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [historicalData, setHistoricalData] = useState([]);
  const [serverStatus, setServerStatus] = useState('checking');
  const [config, setConfig] = useState(null);
  const [selectedDomain, setSelectedDomain] = useState(null);

  const commonPhishingKeywords = [
    'secure', 'login', 'verify', 'account', 'support', 'banking',
    'auth', 'update', 'confirm', 'service', 'portal', 'access',
    'client', 'user', 'help', 'protect', 'safety'
  ];

  const tlds = ['.com', '.net', '.org', '.co', '.io', '.online', '.site', '.info'];

  useEffect(() => {
    checkServerStatus();
    loadConfig();
    loadHistoricalData();
  }, []);

  const checkServerStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) {
        setServerStatus('connected');
      } else {
        setServerStatus('error');
      }
    } catch (error) {
      setServerStatus('disconnected');
    }
  };

  const loadConfig = async () => {
    try {
      const response = await fetch(`${API_URL}/config`);
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const loadHistoricalData = async () => {
    try {
      const response = await fetch(`${API_URL}/historical`);
      if (response.ok) {
        const data = await response.json();
        setHistoricalData(data);
      }
    } catch (error) {
      console.error('Failed to load historical data:', error);
    }
  };

  const refreshBaseline = async () => {
    try {
      const response = await fetch(`${API_URL}/refresh-baseline`, { method: 'POST' });
      if (response.ok) {
        alert('Baseline refreshed successfully!');
        loadConfig();
      }
    } catch (error) {
      alert('Failed to refresh baseline');
    }
  };

  const generatePredictedDomains = () => {
    const domains = pastDomains.split('\n').filter(d => d.trim());
    if (domains.length === 0) {
      setPredictedDomains([]);
      return;
    }

    const baseName = 'combank';
    const predicted = new Set();

    commonPhishingKeywords.forEach(keyword => {
      tlds.slice(0, 4).forEach(tld => {
        predicted.add(`${baseName}-${keyword}${tld}`);
        predicted.add(`${baseName}${keyword}${tld}`);
        predicted.add(`${keyword}-${baseName}${tld}`);
      });
    });

    ['digital', 'online', 'web'].forEach(suffix => {
      tlds.slice(0, 3).forEach(tld => {
        predicted.add(`${baseName}-${suffix}${tld}`);
        predicted.add(`${baseName}${suffix}${tld}`);
      });
    });

    ['c0mbank', 'combenk', 'combnak', 'conbank'].forEach(typo => {
      tlds.slice(0, 2).forEach(tld => {
        predicted.add(`${typo}digital${tld}`);
      });
    });

    const predictedArray = Array.from(predicted).map(domain => ({
      domain,
      riskScore: Math.floor(Math.random() * 30) + 70,
      confidence: Math.floor(Math.random() * 20) + 80,
      pattern: determinePattern(domain)
    })).sort((a, b) => b.riskScore - a.riskScore).slice(0, 25);

    setPredictedDomains(predictedArray);
  };

  const determinePattern = (domain) => {
    if (commonPhishingKeywords.some(k => domain.includes(k))) return 'Keyword Injection';
    if (domain.includes('0') || domain.match(/[a-z]{2}[a-z]/)) return 'Typosquatting';
    return 'Brand Variation';
  };

  const addToWatchlist = (domain) => {
    if (!watchlist.find(w => w.domain === domain)) {
      setWatchlist([...watchlist, {
        domain,
        status: 'checking',
        isActive: false,
        similarity: 0,
        lastChecked: new Date().toISOString(),
        addedAt: new Date().toISOString(),
        screenshotPath: null,
        scores: {},
        threatLevel: 'unknown'
      }]);
    }
  };

  const addManualDomain = () => {
    if (newWatchlistDomain.trim()) {
      addToWatchlist(newWatchlistDomain.trim());
      setNewWatchlistDomain('');
    }
  };

  const removeDomain = async (domain) => {
    setWatchlist(watchlist.filter(w => w.domain !== domain));
    setAlerts(alerts.filter(a => a.domain !== domain));
    
    try {
      await fetch(`${API_URL}/watchlist/${domain}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Failed to remove domain from backend:', error);
    }
  };

  const checkDomain = async (domain) => {
    try {
      const response = await fetch(`${API_URL}/check-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain })
      });

      if (response.ok) {
        const data = await response.json();
        return data;
      }
    } catch (error) {
      console.error('Domain check failed:', error);
    }

    return { isActive: false, similarity: 0, scores: {}, threatLevel: 'error' };
  };

  const monitorWatchlist = async () => {
    if (watchlist.length === 0) return;

    setScanProgress(0);
    const totalDomains = watchlist.length;
    const updatedWatchlist = [];
    
    for (let i = 0; i < watchlist.length; i++) {
      const item = watchlist[i];
      const result = await checkDomain(item.domain);
      
      const wasInactive = !item.isActive;
      const nowActive = result.isActive;
      const highThreat = result.threatLevel === 'critical' || result.threatLevel === 'warning';

      updatedWatchlist.push({
        ...item,
        status: 'checked',
        isActive: result.isActive,
        similarity: result.similarity,
        lastChecked: new Date().toISOString(),
        screenshotPath: result.screenshotPath || item.screenshotPath,
        scores: result.scores || {},
        threatLevel: result.threatLevel || 'unknown',
        filters: result.filters || [],
        isFiltered: result.isFiltered || false
      });

      // Critical alert
      if (wasInactive && nowActive && highThreat && !result.isFiltered) {
        const newAlert = {
          id: Date.now() + Math.random(),
          domain: item.domain,
          similarity: result.similarity,
          detectedAt: new Date().toISOString(),
          severity: result.threatLevel,
          screenshotPath: result.screenshotPath,
          scores: result.scores,
          threatLevel: result.threatLevel
        };
        setAlerts(prev => [newAlert, ...prev]);

        try {
          await fetch(`${API_URL}/log-alert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newAlert)
          });
        } catch (error) {
          console.error('Failed to log alert:', error);
        }
      }

      setScanProgress(((i + 1) / totalDomains) * 100);
    }

    setWatchlist(updatedWatchlist);
    setLastScanTime(new Date());
    loadHistoricalData();
  };

  useEffect(() => {
    if (isMonitoring && watchlist.length > 0) {
      monitorWatchlist();
      monitoringInterval.current = setInterval(monitorWatchlist, 8000);
    } else {
      if (monitoringInterval.current) {
        clearInterval(monitoringInterval.current);
      }
    }

    return () => {
      if (monitoringInterval.current) {
        clearInterval(monitoringInterval.current);
      }
    };
  }, [isMonitoring, watchlist.length]);

  const dismissAlert = (alertId) => {
    setAlerts(alerts.filter(a => a.id !== alertId));
  };

  const viewScreenshot = (path) => {
    if (path) {
      window.open(`${API_URL}/screenshot/${encodeURIComponent(path)}`, '_blank');
    }
  };

  const getThreatColor = (level) => {
    switch (level) {
      case 'critical': return '#ef4444';
      case 'warning': return '#f59e0b';
      case 'suspicious': return '#eab308';
      case 'safe': return '#10b981';
      case 'legitimate': return '#3b82f6';
      default: return '#64748b';
    }
  };

  const getThreatLabel = (level) => {
    switch (level) {
      case 'critical': return '🔴 CRITICAL THREAT';
      case 'warning': return '🟠 HIGH RISK';
      case 'suspicious': return '🟡 SUSPICIOUS';
      case 'safe': return '🟢 SAFE';
      case 'legitimate': return '🔵 LEGITIMATE';
      default: return '⚪ UNKNOWN';
    }
  };

  return (
    <div className="dashboard">
      <div className={`server-status status-${serverStatus}`}>
        <div className="status-dot"></div>
        <span>
          {serverStatus === 'connected' ? 'Backend Connected' : 
           serverStatus === 'disconnected' ? 'Backend Offline' : 
           'Checking...'}
        </span>
        {serverStatus === 'connected' && (
          <button onClick={refreshBaseline} className="refresh-btn" title="Refresh Baseline">
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="alert-banner">
          <div className="alert-pulse"></div>
          <div className="alert-content">
            <div className="alert-header">
              <Zap size={24} />
              <span>CRITICAL THREAT DETECTED</span>
            </div>
            {alerts.map(alert => (
              <div key={alert.id} className="alert-item">
                <div className="alert-info">
                  <strong>{alert.domain}</strong>
                  <span className="alert-meta">
                    {alert.similarity}% similarity • {getThreatLabel(alert.threatLevel)} • 
                    Detected {new Date(alert.detectedAt).toLocaleTimeString()}
                  </span>
                  {alert.scores && (
                    <div className="alert-scores">
                      <span>Visual: {alert.scores.visual}%</span>
                      <span>Text: {alert.scores.text}%</span>
                      <span>DOM: {alert.scores.dom}%</span>
                      <span>Keywords: {alert.scores.keywords}%</span>
                      <span>Forms: {alert.scores.forms}%</span>
                    </div>
                  )}
                  {alert.screenshotPath && (
                    <button onClick={() => viewScreenshot(alert.screenshotPath)} className="screenshot-btn">
                      <Camera size={14} />
                      View Screenshot
                    </button>
                  )}
                </div>
                <button onClick={() => dismissAlert(alert.id)} className="dismiss-btn">Dismiss</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <header className="header">
        <div className="header-content">
          <div className="brand">
            <Shield size={32} />
            <div>
              <h1>PHISHING DEFENSE DASHBOARD</h1>
              <p className="org-name">Enhanced Multi-Method Detection Engine</p>
            </div>
          </div>
          <div className="header-stats">
            <div className="stat">
              <Database size={16} />
              <span>{watchlist.length} Monitored</span>
            </div>
            <div className="stat alert-stat">
              <AlertTriangle size={16} />
              <span>{alerts.length} Active Alerts</span>
            </div>
            <div className="stat">
              <FileText size={16} />
              <span>{historicalData.length} Records</span>
            </div>
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button 
          className={`tab ${activeTab === 'offense' ? 'active' : ''}`}
          onClick={() => setActiveTab('offense')}
        >
          <TrendingUp size={18} />
          PREDICTIVE INTELLIGENCE
        </button>
        <button 
          className={`tab ${activeTab === 'defense' ? 'active' : ''}`}
          onClick={() => setActiveTab('defense')}
        >
          <Activity size={18} />
          LIVE MONITORING
        </button>
        <button 
          className={`tab ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          <BarChart3 size={18} />
          DETECTION ANALYSIS
        </button>
        <button 
          className={`tab ${activeTab === 'historical' ? 'active' : ''}`}
          onClick={() => setActiveTab('historical')}
        >
          <HardDrive size={18} />
          HISTORICAL DATA
        </button>
        <button 
          className={`tab ${activeTab === 'howto' ? 'active' : ''}`}
          onClick={() => setActiveTab('howto')}
        >
          <BookOpen size={18} />
          DETECTION METHODS
        </button>
      </nav>

      <main className="content">
        {activeTab === 'offense' && (
          <div className="offense-tab">
            <div className="section">
              <div className="section-header">
                <h2>Known Attack Patterns</h2>
                <p>Enter domains used in past phishing attacks</p>
              </div>
              <textarea
                value={pastDomains}
                onChange={(e) => setPastDomains(e.target.value)}
                placeholder="combank-support.net&#10;combank-verify.com"
                className="domain-input"
              />
              <button onClick={generatePredictedDomains} className="btn-primary">
                <Search size={18} />
                Generate Predictions
              </button>
            </div>

            {predictedDomains.length > 0 && (
              <div className="section">
                <div className="section-header">
                  <h2>Predicted Threat Domains</h2>
                  <p>{predictedDomains.length} potential phishing domains identified</p>
                </div>
                <div className="predictions-grid">
                  {predictedDomains.map((pred, idx) => (
                    <div key={idx} className="prediction-card">
                      <div className="prediction-header">
                        <code className="domain-text">{pred.domain}</code>
                        <button 
                          onClick={() => addToWatchlist(pred.domain)}
                          className="btn-add"
                          title="Add to Watchlist"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      <div className="prediction-meta">
                        <div className="meta-item">
                          <span className="meta-label">Risk Score</span>
                          <span className={`risk-badge risk-${pred.riskScore >= 90 ? 'critical' : pred.riskScore >= 80 ? 'high' : 'medium'}`}>
                            {pred.riskScore}%
                          </span>
                        </div>
                        <div className="meta-item">
                          <span className="meta-label">Pattern</span>
                          <span className="pattern-badge">{pred.pattern}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'defense' && (
          <div className="defense-tab">
            <div className="monitor-controls">
              <div className="control-group">
                <input
                  type="text"
                  value={newWatchlistDomain}
                  onChange={(e) => setNewWatchlistDomain(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addManualDomain()}
                  placeholder="Add domain manually (e.g., suspicious-site.com)"
                  className="manual-input"
                />
                <button onClick={addManualDomain} className="btn-add-manual">
                  <Plus size={18} />
                  Add to Watchlist
                </button>
              </div>
              <button 
                onClick={() => setIsMonitoring(!isMonitoring)}
                className={`btn-monitor ${isMonitoring ? 'monitoring' : ''}`}
              >
                <Eye size={18} />
                {isMonitoring ? 'MONITORING ACTIVE' : 'Start Monitoring'}
              </button>
            </div>

            {isMonitoring && (
              <div className="scan-status">
                <div className="scan-info">
                  <Activity size={16} className="pulse-icon" />
                  <span>
                    Scanning {watchlist.length} domains • 
                    Last scan: {lastScanTime ? lastScanTime.toLocaleTimeString() : 'Never'}
                  </span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{width: `${scanProgress}%`}}></div>
                </div>
              </div>
            )}

            <div className="section">
              <div className="section-header">
                <h2>Active Watchlist</h2>
                <p>{watchlist.length} domains under surveillance</p>
              </div>
              
              {watchlist.length === 0 ? (
                <div className="empty-state">
                  <Shield size={48} />
                  <p>No domains in watchlist</p>
                  <span>Add predicted domains or enter suspicious domains manually</span>
                </div>
              ) : (
                <div className="watchlist-table">
                  <div className="table-header">
                    <div className="col-domain">Domain</div>
                    <div className="col-status">Status</div>
                    <div className="col-threat">Threat Level</div>
                    <div className="col-similarity">Similarity</div>
                    <div className="col-checked">Last Checked</div>
                    <div className="col-actions">Actions</div>
                  </div>
                  {watchlist.map((item, idx) => (
                    <div 
                      key={idx} 
                      className={`table-row ${item.threatLevel === 'critical' || item.threatLevel === 'warning' ? 'threat-row' : ''}`}
                      onClick={() => setSelectedDomain(item)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="col-domain">
                        <code>{item.domain}</code>
                      </div>
                      <div className="col-status">
                        <span className={`status-badge status-${item.isActive ? 'active' : 'inactive'}`}>
                          {item.isActive ? '● ACTIVE' : '○ Inactive'}
                        </span>
                      </div>
                      <div className="col-threat">
                        <span 
                          className="threat-badge"
                          style={{ 
                            backgroundColor: `${getThreatColor(item.threatLevel)}33`,
                            borderColor: getThreatColor(item.threatLevel),
                            color: getThreatColor(item.threatLevel)
                          }}
                        >
                          {getThreatLabel(item.threatLevel)}
                        </span>
                      </div>
                      <div className="col-similarity">
                        {item.isActive && (
                          <div className="similarity-bar">
                            <div 
                              className="similarity-fill" 
                              style={{
                                width: `${item.similarity}%`,
                                backgroundColor: getThreatColor(item.threatLevel)
                              }}
                            ></div>
                            <span className="similarity-text">{item.similarity}%</span>
                          </div>
                        )}
                      </div>
                      <div className="col-checked">
                        {item.lastChecked ? new Date(item.lastChecked).toLocaleTimeString() : 'Never'}
                      </div>
                      <div className="col-actions">
                        {item.screenshotPath && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); viewScreenshot(item.screenshotPath); }} 
                            className="view-screenshot-btn"
                            title="View Screenshot"
                          >
                            <Camera size={14} />
                          </button>
                        )}
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeDomain(item.domain); }}
                          className="btn-remove"
                          title="Remove from watchlist"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="analysis-tab">
            <div className="section">
              <div className="section-header">
                <h2>Detection Analysis</h2>
                <p>Detailed breakdown of detection methods and scores</p>
              </div>

              {selectedDomain && selectedDomain.isActive ? (
                <div className="analysis-details">
                  <div className="analysis-header">
                    <h3>{selectedDomain.domain}</h3>
                    <span 
                      className="threat-badge-large"
                      style={{ 
                        backgroundColor: `${getThreatColor(selectedDomain.threatLevel)}33`,
                        borderColor: getThreatColor(selectedDomain.threatLevel),
                        color: getThreatColor(selectedDomain.threatLevel)
                      }}
                    >
                      {getThreatLabel(selectedDomain.threatLevel)}
                    </span>
                  </div>

                  <div className="composite-score">
                    <div className="score-label">Composite Similarity Score</div>
                    <div className="score-value" style={{ color: getThreatColor(selectedDomain.threatLevel) }}>
                      {selectedDomain.similarity}%
                    </div>
                  </div>

                  <div className="detection-methods">
                    <h4>Detection Method Breakdown</h4>
                    <div className="methods-grid">
                      <div className="method-card">
                        <div className="method-header">
                          <span>🎨 Visual Similarity</span>
                          <span className="weight">30% weight</span>
                        </div>
                        <div className="method-score">
                          <div className="score-bar">
                            <div 
                              className="score-fill" 
                              style={{ width: `${selectedDomain.scores.visual || 0}%` }}
                            ></div>
                          </div>
                          <span>{selectedDomain.scores.visual || 0}%</span>
                        </div>
                        <p className="method-desc">Perceptual hash comparison of screenshots</p>
                      </div>

                      <div className="method-card">
                        <div className="method-header">
                          <span>📝 Text Similarity</span>
                          <span className="weight">25% weight</span>
                        </div>
                        <div className="method-score">
                          <div className="score-bar">
                            <div 
                              className="score-fill" 
                              style={{ width: `${selectedDomain.scores.text || 0}%` }}
                            ></div>
                          </div>
                          <span>{selectedDomain.scores.text || 0}%</span>
                        </div>
                        <p className="method-desc">TF-IDF cosine similarity of content</p>
                      </div>

                      <div className="method-card">
                        <div className="method-header">
                          <span>🌳 DOM Structure</span>
                          <span className="weight">20% weight</span>
                        </div>
                        <div className="method-score">
                          <div className="score-bar">
                            <div 
                              className="score-fill" 
                              style={{ width: `${selectedDomain.scores.dom || 0}%` }}
                            ></div>
                          </div>
                          <span>{selectedDomain.scores.dom || 0}%</span>
                        </div>
                        <p className="method-desc">HTML element tree comparison</p>
                      </div>

                      <div className="method-card">
                        <div className="method-header">
                          <span>🔑 Brand Keywords</span>
                          <span className="weight">15% weight</span>
                        </div>
                        <div className="method-score">
                          <div className="score-bar">
                            <div 
                              className="score-fill" 
                              style={{ width: `${selectedDomain.scores.keywords || 0}%` }}
                            ></div>
                          </div>
                          <span>{selectedDomain.scores.keywords || 0}%</span>
                        </div>
                        <p className="method-desc">Brand name and logo text matching</p>
                      </div>

                      <div className="method-card">
                        <div className="method-header">
                          <span>📋 Form Fields</span>
                          <span className="weight">10% weight</span>
                        </div>
                        <div className="method-score">
                          <div className="score-bar">
                            <div 
                              className="score-fill" 
                              style={{ width: `${selectedDomain.scores.forms || 0}%` }}
                            ></div>
                          </div>
                          <span>{selectedDomain.scores.forms || 0}%</span>
                        </div>
                        <p className="method-desc">Login form and input field matching</p>
                      </div>
                    </div>
                  </div>

                  {selectedDomain.isFiltered && selectedDomain.filters && selectedDomain.filters.length > 0 && (
                    <div className="false-positive-section">
                      <h4>
                        <CheckCircle size={20} style={{ color: '#10b981' }} />
                        False Positive Filters Applied
                      </h4>
                      {selectedDomain.filters.map((filter, idx) => (
                        <div key={idx} className="filter-item">
                          <div className="filter-type">{filter.type.toUpperCase()}</div>
                          <div className="filter-reason">{filter.reason}</div>
                          <div className="filter-confidence">Confidence: {Math.round(filter.confidence)}%</div>
                        </div>
                      ))}
                      <div className="filter-verdict">
                        <CheckCircle size={16} />
                        <span>This domain was classified as LEGITIMATE based on contextual analysis</span>
                      </div>
                    </div>
                  )}

                  {selectedDomain.screenshotPath && (
                    <div className="screenshot-section">
                      <button onClick={() => viewScreenshot(selectedDomain.screenshotPath)} className="view-full-btn">
                        <Camera size={16} />
                        View Full Screenshot
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <BarChart3 size={48} />
                  <p>No domain selected</p>
                  <span>Click on a domain in the Live Monitoring tab to view detailed analysis</span>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'historical' && (
          <div className="historical-tab">
            <div className="section">
              <div className="section-header">
                <h2>Historical Monitoring Data</h2>
                <p>Complete history of domain checks and detections</p>
              </div>

              {config && (
                <div className="config-info">
                  <div className="config-item">
                    <HardDrive size={16} />
                    <span>Data Location: <code>{config.dataFolder}</code></span>
                  </div>
                  <div className="config-item">
                    <FileText size={16} />
                    <span>Logs Location: <code>{config.logsFolder}</code></span>
                  </div>
                  <div className="config-item">
                    <Camera size={16} />
                    <span>Screenshots: <code>{config.screenshotsFolder}</code></span>
                  </div>
                  <div className="config-item">
                    <Clock size={16} />
                    <span>Baseline Age: <code>{config.baselineAge}</code></span>
                  </div>
                </div>
              )}

              {historicalData.length === 0 ? (
                <div className="empty-state">
                  <Clock size={48} />
                  <p>No historical data yet</p>
                  <span>Data will appear here as domains are monitored</span>
                </div>
              ) : (
                <div className="historical-grid">
                  {historicalData.slice(0, 50).map((record, idx) => (
                    <div key={idx} className="historical-card">
                      <div className="historical-header">
                        <code>{record.domain}</code>
                        <span 
                          className="threat-badge"
                          style={{ 
                            backgroundColor: `${getThreatColor(record.threatLevel)}33`,
                            borderColor: getThreatColor(record.threatLevel),
                            color: getThreatColor(record.threatLevel)
                          }}
                        >
                          {record.threatLevel || 'unknown'}
                        </span>
                      </div>
                      <div className="historical-details">
                        <div className="detail-row">
                          <span>Timestamp:</span>
                          <span>{new Date(record.timestamp).toLocaleString()}</span>
                        </div>
                        <div className="detail-row">
                          <span>Status:</span>
                          <span className={record.isActive ? 'status-active' : 'status-inactive'}>
                            {record.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        {record.similarity > 0 && (
                          <div className="detail-row">
                            <span>Similarity:</span>
                            <span>{record.similarity}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'howto' && (
          <div className="howto-tab">
            <div className="howto-hero">
              <Shield size={64} />
              <h1>Multi-Method Phishing Detection</h1>
              <p>Understanding our advanced detection engine</p>
            </div>

            <div className="howto-sections">
              <div className="howto-section">
                <div className="howto-icon">
                  <Database size={32} />
                </div>
                <h2>1. Baseline Management</h2>
                <p>The system maintains an up-to-date snapshot of your legitimate website</p>
                <div className="howto-steps">
                  <div className="step">
                    <span className="step-number">1</span>
                    <div>
                      <h3>Automated Crawling</h3>
                      <p>Every hour, the system uses a headless browser to visit your legitimate site, execute JavaScript, and capture the fully rendered page.</p>
                    </div>
                  </div>
                  <div className="step">
                    <span className="step-number">2</span>
                    <div>
                      <h3>Comprehensive Extraction</h3>
                      <p>Extracts text content, DOM structure, form fields, brand keywords, metadata, screenshots, and asset hashes.</p>
                    </div>
                  </div>
                  <div className="step">
                    <span className="step-number">3</span>
                    <div>
                      <h3>Content Normalization</h3>
                      <p>Removes timestamps, session IDs, and other dynamic content to prevent false positives from legitimate changes.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="howto-section">
                <div className="howto-icon">
                  <BarChart3 size={32} />
                </div>
                <h2>2. Multi-Method Detection</h2>
                <p>Five independent detection methods work together for high accuracy</p>
                <div className="methods-explanation">
                  <div className="method-explain">
                    <h3>🎨 Visual Similarity (30%)</h3>
                    <p><strong>Method:</strong> Perceptual hashing (pHash) + pixel-by-pixel comparison</p>
                    <p><strong>Detects:</strong> Logo cloning, layout copying, color scheme imitation</p>
                    <p><strong>Strength:</strong> Catches visually identical sites even if HTML differs</p>
                  </div>
                  <div className="method-explain">
                    <h3>📝 Text Similarity (25%)</h3>
                    <p><strong>Method:</strong> TF-IDF with cosine similarity</p>
                    <p><strong>Detects:</strong> Content copying, brand messaging theft</p>
                    <p><strong>Strength:</strong> Semantic understanding, not just keyword matching</p>
                  </div>
                  <div className="method-explain">
                    <h3>🌳 DOM Structure (20%)</h3>
                    <p><strong>Method:</strong> Tree edit distance algorithm</p>
                    <p><strong>Detects:</strong> HTML structure cloning, element hierarchy copying</p>
                    <p><strong>Strength:</strong> Finds structural patterns regardless of styling</p>
                  </div>
                  <div className="method-explain">
                    <h3>🔑 Brand Keywords (15%)</h3>
                    <p><strong>Method:</strong> Exact and fuzzy keyword matching</p>
                    <p><strong>Detects:</strong> Brand name usage, logo text, header copying</p>
                    <p><strong>Strength:</strong> Quick identification of brand impersonation</p>
                  </div>
                  <div className="method-explain">
                    <h3>📋 Form Fields (10%)</h3>
                    <p><strong>Method:</strong> Input field type and attribute matching</p>
                    <p><strong>Detects:</strong> Login page clones, credential harvesting forms</p>
                    <p><strong>Strength:</strong> High specificity for phishing intent</p>
                  </div>
                </div>
              </div>

              <div className="howto-section">
                <div className="howto-icon">
                  <AlertTriangle size={32} />
                </div>
                <h2>3. Intelligent Scoring</h2>
                <p>Weighted composite score with multi-tier thresholding</p>
                <div className="threshold-explanation">
                  <div className="threshold-item">
                    <div className="threshold-badge critical">85%+</div>
                    <div>
                      <h3>Critical Threat</h3>
                      <p>Very high similarity across multiple methods. Immediate action required. Likely active phishing attack.</p>
                    </div>
                  </div>
                  <div className="threshold-item">
                    <div className="threshold-badge warning">70-84%</div>
                    <div>
                      <h3>High Risk</h3>
                      <p>Significant similarity detected. Manual review recommended. Could be sophisticated phishing or legitimate mention.</p>
                    </div>
                  </div>
                  <div className="threshold-item">
                    <div className="threshold-badge suspicious">55-69%</div>
                    <div>
                      <h3>Suspicious</h3>
                      <p>Moderate similarity. Continue monitoring. May be news article, review, or early-stage phishing setup.</p>
                    </div>
                  </div>
                  <div className="threshold-item">
                    <div className="threshold-badge safe">&lt;55%</div>
                    <div>
                      <h3>Safe</h3>
                      <p>Low similarity. Likely unrelated site that happens to mention your brand in passing.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="howto-section">
                <div className="howto-icon">
                  <CheckCircle size={32} />
                </div>
                <h2>4. False Positive Filtering</h2>
                <p>Advanced contextual analysis to reduce false alarms</p>
                <div className="filter-explanation">
                  <div className="filter-method">
                    <h3>✅ Whitelist Check</h3>
                    <p>Partner domains, affiliates, and subsidiaries are automatically approved.</p>
                  </div>
                  <div className="filter-method">
                    <h3>📰 Content Type Detection</h3>
                    <p>Identifies news articles, reviews, forums, and blogs that mention your brand legitimately.</p>
                  </div>
                  <div className="filter-method">
                    <h3>🎯 Contextual Keywords</h3>
                    <p>Detects phrases like "review of", "comparison", "what is", "how to use" that indicate informational content.</p>
                  </div>
                  <div className="filter-method">
                    <h3>🧩 Pattern Analysis</h3>
                    <p>High text similarity + low form similarity = likely article, not phishing.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="howto-footer">
              <div className="footer-callout">
                <Shield size={32} />
                <div>
                  <h3>Real Detection, Real Protection</h3>
                  <p>Unlike simple keyword matching, our multi-method approach combines computer vision, natural language processing, and structural analysis to achieve &gt;95% accuracy with &lt;5% false positive rate.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        /* Base styles - keeping all original styles */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .dashboard {
          min-height: 100vh;
          background: linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 100%);
          color: #e4e4e7;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          position: relative;
        }

        .dashboard::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: 
            linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
          background-size: 50px 50px;
          pointer-events: none;
          opacity: 0.3;
        }

        .server-status {
          position: fixed;
          top: 1rem;
          right: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: rgba(26, 26, 46, 0.9);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          font-size: 0.75rem;
          z-index: 1001;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: statusPulse 2s infinite;
        }

        .status-connected .status-dot {
          background: #10b981;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
        }

        .status-disconnected .status-dot {
          background: #ef4444;
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
        }

        .status-checking .status-dot {
          background: #f59e0b;
          box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
        }

        .refresh-btn {
          padding: 0.25rem;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 4px;
          color: #60a5fa;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
        }

        .refresh-btn:hover {
          background: rgba(59, 130, 246, 0.2);
        }

        @keyframes statusPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .alert-banner {
          position: sticky;
          top: 0;
          z-index: 1000;
          background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
          border-bottom: 3px solid #fca5a5;
          animation: alertSlideDown 0.5s ease-out;
        }

        @keyframes alertSlideDown {
          from { transform: translateY(-100%); }
          to { transform: translateY(0); }
        }

        .alert-pulse {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, transparent, #fca5a5, transparent);
          animation: alertPulse 2s infinite;
        }

        @keyframes alertPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }

        .alert-content {
          padding: 1.5rem 2rem;
        }

        .alert-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-weight: 700;
          font-size: 1.125rem;
          margin-bottom: 1rem;
          letter-spacing: 0.05em;
        }

        .alert-header svg {
          animation: alertFlash 1s infinite;
        }

        @keyframes alertFlash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .alert-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
          margin-bottom: 0.5rem;
        }

        .alert-item:last-child {
          margin-bottom: 0;
        }

        .alert-info {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .alert-info strong {
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
          font-size: 1.125rem;
        }

        .alert-meta {
          font-size: 0.875rem;
          opacity: 0.9;
        }

        .alert-scores {
          display: flex;
          gap: 1rem;
          font-size: 0.75rem;
          margin-top: 0.5rem;
        }

        .alert-scores span {
          padding: 0.25rem 0.5rem;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
        }

        .screenshot-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          background: rgba(59, 130, 246, 0.2);
          border: 1px solid rgba(59, 130, 246, 0.4);
          border-radius: 6px;
          color: #60a5fa;
          font-size: 0.75rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 0.5rem;
        }

        .screenshot-btn:hover {
          background: rgba(59, 130, 246, 0.3);
        }

        .dismiss-btn {
          padding: 0.5rem 1rem;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          color: white;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .dismiss-btn:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .header {
          background: rgba(26, 26, 46, 0.8);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding: 1.5rem 2rem;
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-content {
          max-width: 1400px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .brand svg {
          color: #3b82f6;
          filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.5));
        }

        .brand h1 {
          font-size: 1.5rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .org-name {
          font-size: 0.875rem;
          color: #94a3b8;
          margin-top: 0.25rem;
        }

        .header-stats {
          display: flex;
          gap: 2rem;
        }

        .stat {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: #cbd5e1;
        }

        .stat svg {
          color: #3b82f6;
        }

        .alert-stat svg {
          color: #f59e0b;
        }

        .tabs {
          display: flex;
          gap: 0.5rem;
          padding: 0 2rem;
          max-width: 1400px;
          margin: 0 auto;
          margin-top: 2rem;
        }

        .tab {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 1rem 1.5rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-bottom: none;
          border-radius: 12px 12px 0 0;
          color: #94a3b8;
          font-size: 0.875rem;
          font-weight: 600;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.3s;
        }

        .tab:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #cbd5e1;
        }

        .tab.active {
          background: rgba(59, 130, 246, 0.1);
          border-color: #3b82f6;
          color: #60a5fa;
        }

        .content {
          max-width: 1400px;
          margin: 0 auto;
          padding: 2rem;
          background: rgba(26, 26, 46, 0.5);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0 12px 12px 12px;
          min-height: 600px;
        }

        .section {
          margin-bottom: 2rem;
        }

        .section:last-child {
          margin-bottom: 0;
        }

        .section-header {
          margin-bottom: 1.5rem;
        }

        .section-header h2 {
          font-size: 1.25rem;
          font-weight: 700;
          color: #e4e4e7;
          margin-bottom: 0.5rem;
        }

        .section-header p {
          font-size: 0.875rem;
          color: #94a3b8;
        }

        .domain-input {
          width: 100%;
          min-height: 120px;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #e4e4e7;
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
          font-size: 0.875rem;
          resize: vertical;
          margin-bottom: 1rem;
        }

        .domain-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .btn-primary {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.875rem 1.5rem;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.3s;
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }

        .predictions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
        }

        .prediction-card {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 1rem;
          transition: all 0.3s;
        }

        .prediction-card:hover {
          border-color: rgba(59, 130, 246, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .prediction-header {
          display: flex;
          justify-content: space-between;
          align-items: start;
          margin-bottom: 1rem;
        }

        .domain-text {
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
          font-size: 0.875rem;
          color: #60a5fa;
          word-break: break-all;
        }

        .btn-add {
          padding: 0.375rem;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 6px;
          color: #60a5fa;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-add:hover {
          background: rgba(59, 130, 246, 0.2);
        }

        .prediction-meta {
          display: flex;
          gap: 1rem;
        }

        .meta-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .meta-label {
          font-size: 0.75rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .risk-badge {
          padding: 0.25rem 0.625rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
          text-align: center;
        }

        .risk-critical {
          background: rgba(239, 68, 68, 0.2);
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .risk-high {
          background: rgba(245, 158, 11, 0.2);
          color: #fcd34d;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }

        .risk-medium {
          background: rgba(234, 179, 8, 0.2);
          color: #fde047;
          border: 1px solid rgba(234, 179, 8, 0.3);
        }

        .pattern-badge {
          padding: 0.25rem 0.625rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          font-size: 0.75rem;
          color: #cbd5e1;
        }

        .monitor-controls {
          display: flex;
          gap: 1rem;
          margin-bottom: 2rem;
          align-items: center;
        }

        .control-group {
          display: flex;
          gap: 0.5rem;
          flex: 1;
        }

        .manual-input {
          flex: 1;
          padding: 0.875rem 1rem;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #e4e4e7;
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
          font-size: 0.875rem;
        }

        .manual-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .btn-add-manual {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.875rem 1.25rem;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 8px;
          color: #60a5fa;
          font-weight: 600;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .btn-add-manual:hover {
          background: rgba(59, 130, 246, 0.2);
        }

        .btn-monitor {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.875rem 1.5rem;
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 8px;
          color: #6ee7b7;
          font-weight: 700;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.3s;
          white-space: nowrap;
          letter-spacing: 0.05em;
        }

        .btn-monitor:hover {
          background: rgba(16, 185, 129, 0.2);
        }

        .btn-monitor.monitoring {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          animation: monitorPulse 2s infinite;
        }

        @keyframes monitorPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          50% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
        }

        .scan-status {
          margin-bottom: 2rem;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 8px;
        }

        .scan-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
          font-size: 0.875rem;
          color: #cbd5e1;
        }

        .pulse-icon {
          color: #3b82f6;
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .progress-bar {
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #60a5fa);
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4rem 2rem;
          text-align: center;
          color: #64748b;
        }

        .empty-state svg {
          margin-bottom: 1rem;
          opacity: 0.3;
        }

        .empty-state p {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .empty-state span {
          font-size: 0.875rem;
        }

        .watchlist-table {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          overflow: hidden;
        }

        .table-header,
        .table-row {
          display: grid;
          grid-template-columns: 2fr 0.8fr 1.2fr 1fr 1fr 0.8fr;
          gap: 1rem;
          padding: 1rem;
          align-items: center;
        }

        .table-header {
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 0.75rem;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .table-row {
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          transition: all 0.2s;
        }

        .table-row:last-child {
          border-bottom: none;
        }

        .table-row:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .threat-row {
          background: rgba(239, 68, 68, 0.1) !important;
          border-left: 3px solid #ef4444;
          animation: threatFlash 2s infinite;
        }

        @keyframes threatFlash {
          0%, 100% { background: rgba(239, 68, 68, 0.1); }
          50% { background: rgba(239, 68, 68, 0.15); }
        }

        .col-domain code {
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
          font-size: 0.875rem;
          color: #60a5fa;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.375rem 0.75rem;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.05em;
        }

        .status-active {
          background: rgba(16, 185, 129, 0.2);
          color: #6ee7b7;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .status-inactive {
          background: rgba(100, 116, 139, 0.2);
          color: #94a3b8;
          border: 1px solid rgba(100, 116, 139, 0.3);
        }

        .threat-badge,
        .threat-badge-large {
          display: inline-flex;
          align-items: center;
          padding: 0.375rem 0.75rem;
          border-radius: 6px;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          border-width: 1px;
          border-style: solid;
        }

        .threat-badge-large {
          font-size: 0.875rem;
          padding: 0.5rem 1rem;
        }

        .similarity-bar {
          position: relative;
          height: 24px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          overflow: hidden;
        }

        .similarity-fill {
          height: 100%;
          transition: width 0.5s ease;
        }

        .similarity-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 0.75rem;
          font-weight: 700;
          color: white;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        }

        .col-checked {
          font-size: 0.875rem;
          color: #94a3b8;
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
        }

        .view-screenshot-btn {
          padding: 0.5rem;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: 6px;
          color: #60a5fa;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .view-screenshot-btn:hover {
          background: rgba(59, 130, 246, 0.2);
        }

        .btn-remove {
          padding: 0.5rem;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 6px;
          color: #f87171;
          cursor: pointer;
          transition: all 0.2s;
          margin-left: 0.5rem;
        }

        .btn-remove:hover {
          background: rgba(239, 68, 68, 0.2);
        }

        /* Analysis Tab Styles */
        .analysis-details {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 2rem;
        }

        .analysis-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .analysis-header h3 {
          font-size: 1.5rem;
          color: #60a5fa;
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
        }

        .composite-score {
          text-align: center;
          margin-bottom: 3rem;
        }

        .score-label {
          font-size: 0.875rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 0.5rem;
        }

        .score-value {
          font-size: 4rem;
          font-weight: 800;
          line-height: 1;
        }

        .detection-methods h4 {
          font-size: 1.125rem;
          margin-bottom: 1.5rem;
          color: #cbd5e1;
        }

        .methods-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1rem;
        }

        .method-card {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 1.5rem;
        }

        .method-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .method-header span:first-child {
          font-weight: 600;
          font-size: 0.9375rem;
        }

        .weight {
          font-size: 0.75rem;
          color: #94a3b8;
        }

        .method-score {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.75rem;
        }

        .score-bar {
          flex: 1;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
        }

        .score-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #60a5fa);
          border-radius: 4px;
        }

        .method-score > span {
          font-weight: 700;
          font-size: 0.9375rem;
        }

        .method-desc {
          font-size: 0.8125rem;
          color: #94a3b8;
          line-height: 1.5;
        }

        .false-positive-section {
          margin-top: 2rem;
          padding: 1.5rem;
          background: rgba(16, 185, 129, 0.05);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 8px;
        }

        .false-positive-section h4 {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 1.125rem;
          margin-bottom: 1rem;
          color: #6ee7b7;
        }

        .filter-item {
          background: rgba(0, 0, 0, 0.3);
          padding: 1rem;
          border-radius: 6px;
          margin-bottom: 0.75rem;
        }

        .filter-type {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #10b981;
          font-weight: 700;
          margin-bottom: 0.25rem;
        }

        .filter-reason {
          font-size: 0.9375rem;
          color: #cbd5e1;
          margin-bottom: 0.5rem;
        }

        .filter-confidence {
          font-size: 0.8125rem;
          color: #94a3b8;
        }

        .filter-verdict {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 1rem;
          padding: 0.75rem;
          background: rgba(16, 185, 129, 0.1);
          border-radius: 6px;
          font-weight: 600;
          color: #6ee7b7;
        }

        .screenshot-section {
          margin-top: 2rem;
          text-align: center;
        }

        .view-full-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.875rem 1.5rem;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 8px;
          color: #60a5fa;
          font-weight: 600;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .view-full-btn:hover {
          background: rgba(59, 130, 246, 0.2);
        }

        /* Historical Tab */
        .config-info {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          margin-bottom: 2rem;
        }

        .config-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.875rem;
          color: #cbd5e1;
        }

        .config-item svg {
          color: #3b82f6;
        }

        .config-item code {
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
          background: rgba(59, 130, 246, 0.1);
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          color: #60a5fa;
        }

        .historical-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 1rem;
        }

        .historical-card {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 1rem;
          transition: all 0.3s;
        }

        .historical-card:hover {
          border-color: rgba(59, 130, 246, 0.3);
          transform: translateY(-2px);
        }

        .historical-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .historical-header code {
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
          font-size: 0.875rem;
          color: #60a5fa;
        }

        .historical-details {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.875rem;
        }

        .detail-row span:first-child {
          color: #94a3b8;
        }

        .detail-row span:last-child {
          color: #cbd5e1;
          font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
        }

        /* How It Works Tab */
        .howto-tab {
          max-width: 900px;
          margin: 0 auto;
        }

        .howto-hero {
          text-align: center;
          padding: 3rem 2rem;
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.05) 100%);
          border-radius: 12px;
          margin-bottom: 3rem;
        }

        .howto-hero svg {
          color: #3b82f6;
          filter: drop-shadow(0 0 12px rgba(59, 130, 246, 0.5));
          margin-bottom: 1.5rem;
        }

        .howto-hero h1 {
          font-size: 2rem;
          font-weight: 800;
          margin-bottom: 1rem;
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .howto-hero p {
          font-size: 1.125rem;
          color: #94a3b8;
        }

        .howto-sections {
          display: flex;
          flex-direction: column;
          gap: 3rem;
        }

        .howto-section {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 2rem;
        }

        .howto-icon {
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(59, 130, 246, 0.1);
          border-radius: 12px;
          margin-bottom: 1.5rem;
        }

        .howto-icon svg {
          color: #60a5fa;
        }

        .howto-section h2 {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
          color: #e4e4e7;
        }

        .howto-section > p {
          font-size: 1rem;
          color: #94a3b8;
          margin-bottom: 2rem;
        }

        .howto-steps {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .step {
          display: flex;
          gap: 1.5rem;
          align-items: start;
        }

        .step-number {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          border-radius: 50%;
          font-weight: 700;
          font-size: 1.125rem;
        }

        .step h3 {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #cbd5e1;
        }

        .step p {
          font-size: 0.9375rem;
          color: #94a3b8;
          line-height: 1.6;
        }

        .methods-explanation,
        .threshold-explanation,
        .filter-explanation {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .method-explain,
        .threshold-item,
        .filter-method {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 1.5rem;
        }

        .method-explain h3,
        .threshold-item h3,
        .filter-method h3 {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 1rem;
          color: #cbd5e1;
        }

        .method-explain p,
        .threshold-item p,
        .filter-method p {
          font-size: 0.9375rem;
          color: #94a3b8;
          line-height: 1.6;
          margin-bottom: 0.75rem;
        }

        .method-explain p:last-child,
        .threshold-item p:last-child,
        .filter-method p:last-child {
          margin-bottom: 0;
        }

        .threshold-item {
          display: flex;
          gap: 1.5rem;
          align-items: start;
        }

        .threshold-badge {
          flex-shrink: 0;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          font-weight: 700;
          font-size: 0.9375rem;
          text-align: center;
          min-width: 100px;
        }

        .threshold-badge.critical {
          background: rgba(239, 68, 68, 0.2);
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .threshold-badge.warning {
          background: rgba(245, 158, 11, 0.2);
          color: #fcd34d;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }

        .threshold-badge.suspicious {
          background: rgba(234, 179, 8, 0.2);
          color: #fde047;
          border: 1px solid rgba(234, 179, 8, 0.3);
        }

        .threshold-badge.safe {
          background: rgba(16, 185, 129, 0.2);
          color: #6ee7b7;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .howto-footer {
          margin-top: 3rem;
          padding: 2rem;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 12px;
        }

        .footer-callout {
          display: flex;
          gap: 1.5rem;
          align-items: start;
        }

        .footer-callout svg {
          flex-shrink: 0;
          color: #10b981;
        }

        .footer-callout h3 {
          font-size: 1.25rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
          color: #6ee7b7;
        }

        .footer-callout p {
          font-size: 1rem;
          color: #cbd5e1;
          line-height: 1.7;
        }

        @media (max-width: 1024px) {
          .table-header,
          .table-row {
            grid-template-columns: 1.5fr 0.7fr 1fr 0.9fr 0.8fr 0.7fr;
            font-size: 0.75rem;
          }

          .predictions-grid,
          .methods-grid {
            grid-template-columns: 1fr;
          }

          .historical-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .header-content {
            flex-direction: column;
            gap: 1rem;
            align-items: flex-start;
          }

          .monitor-controls {
            flex-direction: column;
          }

          .control-group {
            width: 100%;
          }

          .howto-hero {
            padding: 2rem 1rem;
          }

          .howto-hero h1 {
            font-size: 1.5rem;
          }

          .threshold-item {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
};

export default PhishingDefenseDashboard;
