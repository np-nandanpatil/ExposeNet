// popup.js

let model = null;
let currentSettings = {
  enableRealTimeAlerts: true,
  anomalyDetection: true,
  useMultipleAPIs: true,
  enableIPBlocking: true,
  predictionThreshold: 0.75,
  highRiskCountries: ['KP', 'IR', 'SY', 'CU'],
  suspiciousTLDs: ['.tk', '.ml', '.ga', '.cf']
};

let stats = {
  totalConnections: 0,
  totalAnomalies: 0,
  predictionCount: 0,
  modelAccuracy: 0
};

// Initialize Chart.js
let predictionChart = null;

// ML Model Management
async function loadModel() {
  try {
    // Check if TensorFlow.js is available
    if (typeof tf === 'undefined') {
      console.log('TensorFlow.js not available, using rule-based detection only');
      document.getElementById('modelStatus').textContent = 'Using rule-based detection';
      return false;
    }

    // Initialize TensorFlow
    await tf.setBackend('webgl');
    await tf.ready();
    
    // Load the model
    model = await tf.loadLayersModel(chrome.runtime.getURL('model.json'));
    console.log('Model loaded successfully');
    document.getElementById('modelStatus').textContent = 'Model loaded successfully';
    return true;
  } catch (error) {
    console.error('Error loading model:', error);
    document.getElementById('modelStatus').textContent = 'Using rule-based detection';
    return false;
  }
}

function ipToFeatures(ip) {
  // Convert IP to numerical features
  const parts = ip.split(/[:.]/);
  return parts.map(part => parseInt(part, 16) || parseInt(part, 10) || 0);
}

async function predictIP(ip) {
  if (!model) {
    const loaded = await loadModel();
    if (!loaded) {
      return null;
    }
  }
  try {
    const features = ipToFeatures(ip);
    const tensor = tf.tensor2d([features]);
    const prediction = await model.predict(tensor).data();
    tensor.dispose();
    return prediction[0];
  } catch (error) {
    console.error('Prediction error:', error);
    return null;
  }
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch (message.type) {
      case 'UPDATE_TAB_DATA':
        updateGeoDataList(message.data);
        sendResponse({ success: true });
        break;
      case 'UPDATE_BLOCKCHAIN':
        updateBlockchainList(message.data);
        sendResponse({ success: true });
        break;
      case 'ANOMALY_ALERT':
        if (currentSettings.enableRealTimeAlerts) {
          showStatus(`⚠️ Suspicious connection detected: ${message.data.serverIP}`, 'error');
        }
        sendResponse({ success: true });
        break;
      case 'UPDATE_STATS':
        updateStatsDisplay(message.data);
        sendResponse({ success: true });
        break;
      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  return true;
});

function updateStatsDisplay(data) {
  if (data.totalConnections !== undefined) {
    stats.totalConnections = data.totalConnections;
    document.getElementById('totalConnections').textContent = stats.totalConnections;
  }
  if (data.totalAnomalies !== undefined) {
    stats.totalAnomalies = data.totalAnomalies;
    document.getElementById('totalAnomalies').textContent = stats.totalAnomalies;
  }
  if (data.predictionCount !== undefined) {
    stats.predictionCount = data.predictionCount;
    document.getElementById('predictionCount').textContent = stats.predictionCount;
  }
  if (data.modelAccuracy !== undefined) {
    stats.modelAccuracy = data.modelAccuracy;
    document.getElementById('modelAccuracy').textContent = `${stats.modelAccuracy}%`;
  }
}

function renderData(data) {
  const container = document.getElementById("tabsContainer");
  container.innerHTML = "";

  if (!data || Object.keys(data).length === 0) {
    container.innerHTML = "<p>No data captured yet.</p>";
    return;
  }

  // Sort tabs by most recent activity
  const sortedTabs = Object.entries(data).sort((a, b) => {
    const aLatest = Math.max(...Object.values(a[1].results).map(r => r.timestamp));
    const bLatest = Math.max(...Object.values(b[1].results).map(r => r.timestamp));
    return bLatest - aLatest;
  });

  for (let [tabId, tabData] of sortedTabs) {
    const tabDiv = document.createElement("div");
    tabDiv.className = "tab-data";

    const heading = document.createElement("h2");
    heading.textContent = tabData.domain || "Unknown Domain";
    tabDiv.appendChild(heading);

    const list = document.createElement("ul");
    // Sort results by timestamp
    const sortedResults = Object.entries(tabData.results).sort((a, b) => b[1].timestamp - a[1].timestamp);
    
    for (let [ip, info] of sortedResults) {
      const li = document.createElement("li");
      if (info.isAnomaly) {
        li.className = "anomaly";
      }
      
      let text = `${info.city}, ${info.country} (IP: ${info.query})`;
      if (info.reroutedTo) {
        text += ` (Rerouted to: ${info.reroutedTo})`;
      }
      if (info.isAnomaly) {
        text += ` - ANOMALY`;
        if (info.riskFactors && info.riskFactors.length > 0) {
          text += ` (${info.riskFactors.join(', ')})`;
        }
      }
      li.textContent = text;
      list.appendChild(li);
    }
    tabDiv.appendChild(list);
    container.appendChild(tabDiv);
  }
}

function updateAnomalyAnalysis(data) {
  const container = document.getElementById('anomalyTabsContainer');
  container.innerHTML = '';
  
  let totalAnomalyIPs = 0;
  let anomalyTabCount = 0;
  
  // Group anomalies by tab
  const anomalyTabData = {};
  
  // Process each tab's data
  Object.entries(data).forEach(([tabId, tabData]) => {
    const anomalyIPs = Object.entries(tabData.results)
      .filter(([_, info]) => info.isAnomaly)
      .map(([ip, info]) => ({
        ip,
        ...info
      }));
    
    if (anomalyIPs.length > 0) {
      anomalyTabData[tabId] = {
        domain: tabData.domain,
        anomalies: anomalyIPs
      };
      totalAnomalyIPs += anomalyIPs.length;
      anomalyTabCount++;
    }
  });
  
  // Update stats
  document.getElementById('anomalyTabs').textContent = anomalyTabCount;
  document.getElementById('totalAnomalyIPs').textContent = totalAnomalyIPs;
  
  // Display anomaly tabs
  Object.entries(anomalyTabData).forEach(([tabId, tabData]) => {
    const tabDiv = document.createElement('div');
    tabDiv.className = 'anomaly-tab';
    
    const header = document.createElement('div');
    header.className = 'anomaly-tab-header';
    
    const title = document.createElement('div');
    title.className = 'anomaly-tab-title';
    title.textContent = tabData.domain || 'Unknown Domain';
    
    const count = document.createElement('div');
    count.className = 'anomaly-tab-count';
    count.textContent = `${tabData.anomalies.length} Anomalies`;
    
    header.appendChild(title);
    header.appendChild(count);
    
    const ipList = document.createElement('ul');
    ipList.className = 'anomaly-ip-list';
    
    tabData.anomalies.forEach(anomaly => {
      const li = document.createElement('li');
      li.className = 'anomaly-ip-item';
      
      const ipInfo = document.createElement('div');
      ipInfo.className = 'anomaly-ip-info';
      ipInfo.textContent = `${anomaly.ip} (${anomaly.city}, ${anomaly.country})`;
      
      const riskScore = document.createElement('div');
      riskScore.className = 'anomaly-ip-risk';
      riskScore.textContent = `${(anomaly.riskScore * 100).toFixed(1)}%`;
      
      li.appendChild(ipInfo);
      li.appendChild(riskScore);
      ipList.appendChild(li);
    });
    
    tabDiv.appendChild(header);
    tabDiv.appendChild(ipList);
    container.appendChild(tabDiv);
  });
}

function loadData() {
  chrome.storage.local.get({ tabGeoData: {}, connectionCount: 0, totalAnomalies: 0 }, (result) => {
    if (result.tabGeoData) {
      renderData(result.tabGeoData);
      updateAnomalyAnalysis(result.tabGeoData);
    }
    updateStatsDisplay({
      totalConnections: result.connectionCount,
      totalAnomalies: result.totalAnomalies
       });
     });
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
  initializeUI();
  setupEventListeners();
  initializeCharts();
  
  // Load initial data
  loadData();
  
  // Set up periodic refresh
  setInterval(loadData, 2000); // Refresh every 2 seconds
  
  // Request initial data with proper response handling
  chrome.runtime.sendMessage({ type: 'GET_INITIAL_DATA' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting initial data:', chrome.runtime.lastError);
    } else if (response && !response.success) {
      console.error('Failed to get initial data:', response.error);
    }
  });
});

function initializeCharts() {
  const ctx = document.getElementById('predictionChart').getContext('2d');
  predictionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Anomaly Scores',
        data: [],
        borderColor: '#007bff',
        backgroundColor: 'rgba(0, 123, 255, 0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 1,
          ticks: {
            callback: function(value) {
              return (value * 100) + '%';
            }
          }
        },
        x: {
          grid: {
            display: false
          }
        }
      },
      animation: {
        duration: 750,
        easing: 'easeInOutQuart'
      }
    }
  });
}

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');
      
      // Update active button
      document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update active content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        if (content.id === tabId) {
          content.classList.add('active');
        }
      });

      // Refresh chart if switching to ML tab
      if (tabId === 'ml' && predictionChart) {
        predictionChart.update();
      }
    });
  });

  // Settings changes
  document.getElementById('enableRealTimeAlerts').addEventListener('change', updateSettings);
  document.getElementById('anomalyDetection').addEventListener('change', updateSettings);
  document.getElementById('useMultipleAPIs').addEventListener('change', updateSettings);
  document.getElementById('enableIPBlocking').addEventListener('change', updateSettings);
  document.getElementById('predictionThreshold').addEventListener('input', (e) => {
    document.getElementById('thresholdValue').textContent = `${e.target.value}%`;
    updateSettings();
  });
}

function updateSettings() {
  currentSettings = {
    enableRealTimeAlerts: document.getElementById('enableRealTimeAlerts').checked,
    anomalyDetection: document.getElementById('anomalyDetection').checked,
    useMultipleAPIs: document.getElementById('useMultipleAPIs').checked,
    enableIPBlocking: document.getElementById('enableIPBlocking').checked,
    predictionThreshold: document.getElementById('predictionThreshold').value / 100,
    highRiskCountries: currentSettings.highRiskCountries,
    suspiciousTLDs: currentSettings.suspiciousTLDs
  };
  
  chrome.storage.local.set({ settings: currentSettings });
  chrome.runtime.sendMessage({
    type: 'updateSettings',
    settings: currentSettings
  });
}

function updateStats(data) {
  // Update basic stats
  stats.totalConnections++;
  if (data.anomaly) stats.totalAnomalies++;
  stats.predictionCount++;

  // Calculate accuracy based on multiple factors
  const isHighRiskCountry = data.serverLocation && 
    currentSettings.highRiskCountries.includes(data.serverLocation.country);
  
  const hasSuspiciousTLD = data.domain && 
    currentSettings.suspiciousTLDs.some(tld => data.domain.toLowerCase().endsWith(tld));
  
  const isPrivateIP = data.serverIP && (
    data.serverIP.startsWith('192.168.') || 
    data.serverIP.startsWith('10.') || 
    data.serverIP.startsWith('172.16.')
  );
  
  // A prediction is correct if:
  // 1. It's marked as anomaly when it's from a high-risk country or has suspicious TLD
  // 2. It's not marked as anomaly when it's from a safe country and has no suspicious indicators
  const shouldBeAnomalous = isHighRiskCountry || hasSuspiciousTLD || isPrivateIP;
  const correctPrediction = (shouldBeAnomalous === data.anomaly);
  
  // Update running accuracy
  const totalPredictions = stats.predictionCount;
  const previousCorrect = (stats.modelAccuracy / 100) * (totalPredictions - 1);
  const newCorrect = previousCorrect + (correctPrediction ? 1 : 0);
  stats.modelAccuracy = Math.round((newCorrect / totalPredictions) * 100);

  // Update UI
  document.getElementById('totalConnections').textContent = stats.totalConnections;
  document.getElementById('totalAnomalies').textContent = stats.totalAnomalies;
  document.getElementById('predictionCount').textContent = stats.predictionCount;
  document.getElementById('modelAccuracy').textContent = `${stats.modelAccuracy}%`;

  // Update chart
  if (predictionChart && data.riskScore !== undefined) {
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    predictionChart.data.labels.push(timestamp);
    predictionChart.data.datasets[0].data.push(data.riskScore);

    // Keep last 20 points
    if (predictionChart.data.labels.length > 20) {
      predictionChart.data.labels.shift();
      predictionChart.data.datasets[0].data.shift();
    }

    predictionChart.update();
  }
}

function updateGeoDataList(data) {
  // Create the list if it doesn't exist
  let list = document.getElementById('geoDataList');
  if (!list) {
    list = document.createElement('ul');
    list.id = 'geoDataList';
    list.className = 'data-list';
    const monitoringTab = document.getElementById('monitoring');
    monitoringTab.appendChild(list);
  }
  
  const item = document.createElement('li');
  
  // Check if the tab is still active
  chrome.tabs.query({}, function(tabs) {
    const isActive = tabs.some(tab => {
      try {
        const tabDomain = new URL(tab.url).hostname;
        return tabDomain === data.domain;
      } catch (e) {
        return false;
      }
    });
    
    item.className = `data-item ${data.anomaly ? 'suspicious' : ''}`;
    
    item.innerHTML = `
      <div class="data-domain">${data.domain}</div>
      <div class="data-location">
        <div>${data.serverLocation.city}, ${data.serverLocation.country} (IP: ${data.serverIP})</div>
        ${data.reroutedTo ? `<div>Rerouted to: ${data.reroutedTo}</div>` : ''}
        ${data.riskFactors && data.riskFactors.length > 0 ? 
          `<div>Risk Factors: ${data.riskFactors.join(', ')}</div>` : ''}
      </div>
    `;
    
    list.insertBefore(item, list.firstChild);
    updateStats(data);
  });
}

function updateBlockchainList(data) {
  const list = document.getElementById('blockchainList');
  list.innerHTML = '';
  
  let totalBlocks = 0;
  let lastBlockTime = '-';
  
  data.forEach(block => {
    if (block.data.type === 'genesis') return;
    
    totalBlocks++;
    lastBlockTime = new Date(block.timestamp).toLocaleString();
    
    const item = document.createElement('li');
    item.className = `blockchain-item ${block.data.anomaly ? 'suspicious' : ''}`;
    
    // Format risk factors
    const riskFactorsHtml = block.data.riskFactors.map(factor => 
      `<span class="risk-factor">${factor}</span>`
    ).join(', ');
    
    item.innerHTML = `
      <div class="data-domain">${block.data.domain}</div>
      <div class="data-location">
        <div>${block.data.serverLocation.city}, ${block.data.serverLocation.country} (IP: ${block.data.serverIP})</div>
      </div>
      <div class="risk-info">
        <span class="risk-score">Risk Score: ${(block.data.riskScore * 100).toFixed(1)}%</span>
        <span class="risk-factors">${riskFactorsHtml}</span>
      </div>
      <div class="blockchain-hash">Block Hash: ${block.hash}</div>
      <div class="data-timestamp">Time: ${new Date(block.timestamp).toLocaleString()}</div>
    `;
    list.appendChild(item);
  });
  
  document.getElementById('totalBlocks').textContent = totalBlocks;
  document.getElementById('lastBlockTime').textContent = lastBlockTime;
}

function showStatus(message, type) {
  const status = document.createElement('div');
  status.className = `status-message ${type}`;
  status.textContent = message;
  document.body.appendChild(status);
  
  setTimeout(() => {
    status.remove();
  }, 3000);
}

// Initialize UI
async function initializeUI() {
  try {
    const result = await chrome.storage.local.get(['settings', 'geoData', 'blockchain', 'connectionCount']);
    
    // Load settings
    if (result.settings) {
      currentSettings = { ...currentSettings, ...result.settings };
      document.getElementById('enableRealTimeAlerts').checked = currentSettings.enableRealTimeAlerts;
      document.getElementById('anomalyDetection').checked = currentSettings.anomalyDetection;
      document.getElementById('useMultipleAPIs').checked = currentSettings.useMultipleAPIs;
      document.getElementById('enableIPBlocking').checked = currentSettings.enableIPBlocking;
      document.getElementById('predictionThreshold').value = Math.round(currentSettings.predictionThreshold * 100);
      document.getElementById('thresholdValue').textContent = `${Math.round(currentSettings.predictionThreshold * 100)}%`;
    }

    // Load connection count
    if (result.connectionCount !== undefined) {
      stats.totalConnections = result.connectionCount;
      document.getElementById('totalConnections').textContent = stats.totalConnections;
    }

    // Load existing data
    if (result.geoData) {
      result.geoData.forEach(data => updateGeoDataList(data));
    }

    // Load blockchain data
    if (result.blockchain) {
      updateBlockchainList(result.blockchain);
    }
  } catch (error) {
    console.error('Error initializing UI:', error);
  }
}