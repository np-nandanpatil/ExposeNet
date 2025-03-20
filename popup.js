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
          showStatus(`⚠️ Suspicious connection detected: ${message.data.ip}`, 'error');
        }
        sendResponse({ success: true });
        break;
      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  return true; // Keep the message channel open for async response
});

document.addEventListener('DOMContentLoaded', function() {
  initializeUI();
  setupEventListeners();
  initializeCharts();
  
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
  stats.totalConnections++;
  if (data.anomaly) stats.totalAnomalies++;
  stats.predictionCount++;

  // Calculate accuracy based on multiple factors
  const isHighRiskCountry = currentSettings.highRiskCountries.includes(data.country);
  const hasSuspiciousTLD = currentSettings.suspiciousTLDs.some(tld => data.domain.toLowerCase().endsWith(tld));
  const isPrivateIP = data.ip.startsWith('192.168.') || data.ip.startsWith('10.') || data.ip.startsWith('172.16.');
  
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
  if (predictionChart && data.anomalyScore !== undefined) {
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    predictionChart.data.labels.push(timestamp);
    predictionChart.data.datasets[0].data.push(data.anomalyScore);

    // Keep last 20 points
    if (predictionChart.data.labels.length > 20) {
      predictionChart.data.labels.shift();
      predictionChart.data.datasets[0].data.shift();
    }

    predictionChart.update();
  }
}

function updateGeoDataList(data) {
  const list = document.getElementById('geoDataList');
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
        <div>Location: ${data.city}, ${data.country}</div>
        <div>DNS IP: ${data.ip}</div>
        <div>Server IP: ${data.serverIP}</div>
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
        <div>Location: ${block.data.city}, ${block.data.country}</div>
        <div>DNS IP: ${block.data.ip}</div>
        <div>Server IP: ${block.data.serverIP}</div>
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
    const result = await chrome.storage.local.get(['settings', 'geoData', 'blockchain']);
    
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