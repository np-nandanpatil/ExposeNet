// background.js
let settings = {
  enableRealTimeAlerts: true,
  anomalyDetection: true,
  useMultipleAPIs: true,
  enableIPBlocking: true,
  predictionThreshold: 0.75,
  // List of known safe countries
  safeCountries: ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'SG', 'IN', 'NL'],
  // List of high-risk countries
  highRiskCountries: ['KP', 'IR', 'SY', 'CU'],
  // List of suspicious TLD domains
  suspiciousTLDs: ['.tk', '.ml', '.ga', '.cf']
};

// Training data for the ML model
let trainingData = {
  features: [],  // Will store IP features
  labels: [],    // Will store anomaly labels (0 or 1)
  lastUpdate: Date.now()
};

// Load settings and training data on startup
chrome.storage.local.get(['settings', 'trainingData'], (result) => {
  if (result.settings) {
    settings = { ...settings, ...result.settings };
  }
  if (result.trainingData) {
    trainingData = result.trainingData;
  }
});

// Process connection data
async function processConnection(ip, domain) {
  try {
    // Get geolocation data from ip-api
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,city,isp,org,query,regionName`);
    const geoData = await response.json();
    
    if (geoData.status === 'success') {
      // Calculate risk score based on multiple factors
      let riskScore = 0;
      let riskFactors = [];

      // 1. Country-based risk (40%)
      if (settings.highRiskCountries.includes(geoData.countryCode)) {
        riskScore += 0.4;
        riskFactors.push('High-risk country');
      } else if (!settings.safeCountries.includes(geoData.countryCode)) {
        riskScore += 0.2;
        riskFactors.push('Unknown country');
      }

      // 2. Domain analysis (30%)
      if (settings.suspiciousTLDs.some(tld => domain.toLowerCase().endsWith(tld))) {
        riskScore += 0.3;
        riskFactors.push('Suspicious domain TLD');
      }

      // 3. IP pattern analysis (30%)
      const ipParts = ip.split('.');
      const isPrivateIP = (
        ip.startsWith('192.168.') || 
        ip.startsWith('10.') || 
        (ip.startsWith('172.') && parseInt(ipParts[1]) >= 16 && parseInt(ipParts[1]) <= 31)
      );

      if (isPrivateIP) {
        // Don't mark private IPs as suspicious, just note them
        riskFactors.push('Private/Local IP');
      }

      // Additional IP pattern checks
      const hasUnusualPattern = ipParts.some(part => parseInt(part) > 250);
      if (hasUnusualPattern) {
        riskScore += 0.3;
        riskFactors.push('Unusual IP pattern');
      }

      // Create connection data
      const connectionData = {
        id: `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ip: ip,
        serverIP: geoData.query || ip, // Store the actual server IP
        domain: domain,
        country: geoData.countryCode,
        city: geoData.city,
        region: geoData.regionName,
        isp: geoData.isp || 'Unknown',
        org: geoData.org || 'Unknown',
        timestamp: Date.now(),
        riskScore: riskScore,
        riskFactors: riskFactors,
        anomaly: riskScore >= settings.predictionThreshold
      };

      // Update training data
      updateTrainingData(connectionData);

      // Store and update UI
      await updateTabData(connectionData);

      // Send alert if enabled and suspicious
      if (connectionData.anomaly && settings.enableRealTimeAlerts) {
        chrome.runtime.sendMessage({
          type: 'ANOMALY_ALERT',
          data: connectionData
        });
      }

      // Add to blockchain if anomaly detected
      if (connectionData.anomaly) {
        await addToBlockchain(connectionData);
      }
    }
  } catch (error) {
    console.error('Error processing connection:', error);
  }
}

// Update training data
function updateTrainingData(connectionData) {
  // Convert IP to features
  const features = ipToFeatures(connectionData.ip);
  
  // Add to training data
  trainingData.features.push(features);
  trainingData.labels.push(connectionData.anomaly ? 1 : 0);
  
  // Keep last 1000 data points
  if (trainingData.features.length > 1000) {
    trainingData.features.shift();
    trainingData.labels.shift();
  }
  
  // Update timestamp
  trainingData.lastUpdate = Date.now();
  
  // Save to storage
  chrome.storage.local.set({ trainingData });
}

// Convert IP to numerical features
function ipToFeatures(ip) {
  const parts = ip.split('.');
  return parts.map(part => parseInt(part) / 255); // Normalize to 0-1
}

// Add to blockchain
async function addToBlockchain(data) {
  try {
    const result = await chrome.storage.local.get(['blockchain']);
    let chain = result.blockchain || [{
      timestamp: Date.now(),
      data: { type: 'genesis' },
      hash: '0'
    }];
    
    const block = {
      timestamp: Date.now(),
      data: data,
      hash: calculateHash(chain[chain.length - 1].hash + JSON.stringify(data))
    };
    
    chain.push(block);
    
    // Keep last 100 blocks
    if (chain.length > 100) {
      chain = chain.slice(-100);
    }
    
    await chrome.storage.local.set({ blockchain: chain });
    
    // Notify UI
    chrome.runtime.sendMessage({
      type: 'UPDATE_BLOCKCHAIN',
      data: chain
    });
  } catch (error) {
    console.error('Error adding to blockchain:', error);
  }
}

// Calculate hash
function calculateHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// Update tab data
async function updateTabData(data) {
  // Store in local storage
  chrome.storage.local.get({ geoData: [] }, (result) => {
    const storedGeoData = result.geoData;
    storedGeoData.push(data);
    // Keep only last 100 connections
    if (storedGeoData.length > 100) {
      storedGeoData.shift();
    }
    chrome.storage.local.set({ geoData: storedGeoData });
  });

  // Send to popup
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_TAB_DATA',
      data: data
    });
  } catch (error) {
    console.log('Popup not ready, skipping message');
  }
}

// Send initial data to popup
async function sendInitialData() {
  try {
    const result = await chrome.storage.local.get(['geoData']);
    if (result.geoData) {
      for (const data of result.geoData) {
        try {
          await chrome.runtime.sendMessage({
            type: 'UPDATE_TAB_DATA',
            data: data
          });
        } catch (error) {
          console.log('Popup not ready, skipping message');
        }
      }
    }
  } catch (error) {
    console.error('Error sending initial data:', error);
    throw error;
  }
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'updateSettings':
      settings = { ...settings, ...request.settings };
      chrome.storage.local.set({ settings });
      sendResponse({ success: true });
      break;
    case 'GET_INITIAL_DATA':
      sendInitialData().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true; // Keep the message channel open for async response
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

// Monitor web requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.type === 'main_frame') {
      const url = new URL(details.url);
      processConnection(details.ip, url.hostname);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Window management
chrome.action.onClicked.addListener((tab) => {
  openMonitorWindow();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "_execute_action") {
    openMonitorWindow();
  }
});

function openMonitorWindow() {
  chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 800,
    height: 600,
    focused: true,
    left: 100,
    top: 100
  }, (window) => {
    if (chrome.runtime.lastError) {
      console.error('Error creating window:', chrome.runtime.lastError);
    } else {
      console.log('Window created successfully:', window);
    }
  });
}