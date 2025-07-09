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
  features: [],  // to store IP features
  labels: [],    // to store anomaly labels (0 or 1)
  lastUpdate: Date.now()
};

let domainConnections = {};

chrome.storage.local.get(['settings', 'trainingData'], (result) => {
  if (result.settings) { settings = { ...settings, ...result.settings }; }
  if (result.trainingData) { trainingData = result.trainingData; }
});

async function processConnection(ip, domain, tabId, reroutedTo = null) {
  try {
    if (!ip || !domain || ip === 'undefined' || domain === 'undefined') {
      console.log('Skipping invalid connection:', { ip, domain, tabId });
      return;
    }

    if (!domainConnections[domain]) {
      domainConnections[domain] = {
        expectedIPs: new Set(),
        suspiciousIPs: new Set(),
        connectionCount: 0,
        lastCheck: Date.now()
      };
    }

    const domainData = domainConnections[domain];
    domainData.connectionCount++;

    if (Date.now() - domainData.lastCheck > 300000) {
      domainData.expectedIPs.clear();
      domainData.suspiciousIPs.clear();
      domainData.connectionCount = 1;
    }
    domainData.lastCheck = Date.now();

    // Determine if this IP is suspicious
    let isAnomaly = false;
    let riskScore = 0;
    let riskFactors = [];

    const isFirstParty = ip.includes(domain.split('.')[0]) || domain.includes(ip.split('.')[0]);

    if (isFirstParty) {
      domainData.expectedIPs.add(ip);
    } else {
      if (domainData.connectionCount > 10 && !domainData.expectedIPs.has(ip)) {
        domainData.suspiciousIPs.add(ip);
        isAnomaly = true;
        riskScore = 0.8;
        riskFactors.push('Multiple unexpected IPs');
      }

      if (domainData.suspiciousIPs.size > 5) {
        riskScore = 0.9;
        riskFactors.push('High number of suspicious connections');
      }
    }

    const connectionData = {
      id: `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      domain: domain,
      serverIP: ip,
      reroutedTo: reroutedTo,
      serverLocation: {
        city: 'Local Analysis',
        country: 'Local Analysis',
        region: 'Local Analysis',
        isp: isFirstParty ? 'Expected Connection' : 'Unknown Connection',
        org: isFirstParty ? domain : 'Unknown'
      },
      timestamp: Date.now(),
      riskScore: riskScore,
      riskFactors: riskFactors,
      anomaly: isAnomaly
    };

    if (isAnomaly && settings.enableIPBlocking) {
      console.log(`Blocking suspicious IP ${ip} for domain ${domain}`);
      // I want to implemetnt Ip blocking here
    }

    // updating connection count
    chrome.storage.local.get(['connectionCount'], (result) => {
      const count = (result.connectionCount || 0) + 1;
      chrome.storage.local.set({ connectionCount: count });
      chrome.runtime.sendMessage({
        type: 'UPDATE_STATS',
        data: {
          totalConnections: count,
          totalAnomalies: connectionData.anomaly ? (result.totalAnomalies || 0) + 1 : (result.totalAnomalies || 0)
        }
      });
    });

    chrome.storage.local.get({ tabGeoData: {} }, (result) => {
      const tabGeoData = result.tabGeoData;
      if (!tabGeoData[tabId]) { tabGeoData[tabId] = { domain: domain, results: {} }; }
      tabGeoData[tabId].results[ip] = {
        city: isFirstParty ? 'Expected Connection' : 'Unknown Connection',
        country: isFirstParty ? domain : 'Unknown',
        query: ip,
        isAnomaly: isAnomaly,
        riskScore: riskScore,
        riskFactors: riskFactors,
        reroutedTo: reroutedTo,
        timestamp: Date.now()
      };
      chrome.storage.local.set({ tabGeoData });
    });

    // updating training data
    updateTrainingData(connectionData);
    await updateTabData(connectionData);
    if (connectionData.anomaly && settings.enableRealTimeAlerts) {
      chrome.runtime.sendMessage({
        type: 'ANOMALY_ALERT',
        data: connectionData
      });
    }
    await addToBlockchain(connectionData);
  } catch (error) {
    console.error('Error processing connection:', error);
  }
}
function updateTrainingData(connectionData) {
  const features = ipToFeatures(connectionData.serverIP);

  trainingData.features.push(features);
  trainingData.labels.push(connectionData.anomaly ? 1 : 0);
  if (trainingData.features.length > 1000) {
    trainingData.features.shift();
    trainingData.labels.shift();
  }
  trainingData.lastUpdate = Date.now();
  chrome.storage.local.set({ trainingData });
}

function ipToFeatures(ip) {
  if (!ip) return [0, 0, 0, 0, 0, 0, 0, 0];
  const parts = ip.split(/[:.]/);
  return parts.map(part => parseInt(part, 16) || parseInt(part, 10) || 0);
}

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
      data: {
        type: 'connection',
        domain: data.domain,
        serverIP: data.serverIP,
        serverLocation: data.serverLocation,
        riskScore: data.riskScore,
        riskFactors: data.riskFactors,
        anomaly: data.anomaly
      },
      hash: calculateHash(chain[chain.length - 1].hash + JSON.stringify(data))
    };
    chain.push(block);
    if (chain.length > 100) {
      chain = chain.slice(-100);
    }
    await chrome.storage.local.set({ blockchain: chain });
    chrome.runtime.sendMessage({
      type: 'UPDATE_BLOCKCHAIN',
      data: chain
    });
    console.log('Block added to chain:', block);
  } catch (error) {
    console.error('Error adding to blockchain:', error);
  }
}

function calculateHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

async function updateTabData(data) {
  chrome.storage.local.get({ geoData: [] }, (result) => {
    const storedGeoData = result.geoData;
    storedGeoData.push(data);
    if (storedGeoData.length > 100) {
      storedGeoData.shift();
    }
    chrome.storage.local.set({ geoData: storedGeoData });
  });
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_TAB_DATA',
      data: data
    });
  } catch (error) {
    console.log('Popup not ready, skipping message');
  }
}

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
      return true;
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});
// Monitor web requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    try {
      const url = new URL(details.url);
      let serverIP = details.ip;
      let reroutedTo = null;

      if (details.responseHeaders) {
        const xForwardedFor = details.responseHeaders.find(h => h.name.toLowerCase() === 'x-forwarded-for');
        if (xForwardedFor) {
          serverIP = xForwardedFor.value.split(',')[0].trim();
        }

        const cfConnectingIp = details.responseHeaders.find(h => h.name.toLowerCase() === 'cf-connecting-ip');
        if (cfConnectingIp) {
          reroutedTo = serverIP;
          serverIP = cfConnectingIp.value;
        }
      }
      let mainDomain = url.hostname;
      const domainParts = url.hostname.split('.');
      if (domainParts.length > 2) {
        if (domainParts[domainParts.length - 2] === 'co' ||
          domainParts[domainParts.length - 2] === 'com' ||
          domainParts[domainParts.length - 2] === 'org') {
          mainDomain = domainParts.slice(-3).join('.');
        } else {
          mainDomain = domainParts.slice(-2).join('.');
        }
      }
      console.log(`Processing request for domain: ${mainDomain}, IP: ${serverIP}`);
      processConnection(serverIP, mainDomain, details.tabId, reroutedTo);
    } catch (error) {
      console.error('Error processing web request:', error);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      const url = new URL(tab.url);
      let mainDomain = url.hostname;
      const domainParts = url.hostname.split('.');
      if (domainParts.length > 2) {
        if (domainParts[domainParts.length - 2] === 'co' ||
          domainParts[domainParts.length - 2] === 'com' ||
          domainParts[domainParts.length - 2] === 'org') {
          mainDomain = domainParts.slice(-3).join('.');
        } else {
          mainDomain = domainParts.slice(-2).join('.');
        }
      }
      console.log(`Tab updated for domain: ${mainDomain}`);
      processConnection(tab.url, mainDomain, tabId);
    } catch (error) {
      console.error('Error processing tab update:', error);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get({ tabGeoData: {} }, (result) => {
    const tabGeoData = result.tabGeoData;
    if (tabGeoData[tabId]) {
      delete tabGeoData[tabId];
      chrome.storage.local.set({ tabGeoData });
    }
  });
});
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