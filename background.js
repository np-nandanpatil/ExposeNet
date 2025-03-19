// background.js
let model = null;
let settings = {
  anomalyDetection: true,
  useMultipleAPIs: true,
  enableIPBlocking: true,
  enableRealTimeAlerts: true,
  predictionThreshold: 0.75
};

// Load settings on startup
chrome.storage.local.get(['settings'], (result) => {
  if (result.settings) {
    settings = result.settings;
  }
});

// Initialize blockchain
class Blockchain {
  constructor() {
    this.chain = [];
    this.initialize();
  }

  async initialize() {
    const result = await chrome.storage.local.get(['blockchain']);
    if (!result.blockchain || result.blockchain.length === 0) {
      const genesisBlock = {
        timestamp: Date.now(),
        data: { type: 'genesis', message: 'Initial block' },
        previousHash: '0',
        hash: await this.calculateHash({ type: 'genesis', message: 'Initial block' }, '0')
      };
      this.chain = [genesisBlock];
      await chrome.storage.local.set({ blockchain: this.chain });
    } else {
      this.chain = result.blockchain;
    }
  }

  async addBlock(newData) {
    const previousBlock = this.chain[this.chain.length - 1];
    const newBlock = {
      timestamp: Date.now(),
      data: newData,
      previousHash: previousBlock.hash,
      hash: await this.calculateHash(newData, previousBlock.hash)
    };
    this.chain.push(newBlock);
    await chrome.storage.local.set({ blockchain: this.chain });
    return newBlock;
  }

  async calculateHash(data, previousHash) {
    const str = JSON.stringify(data) + previousHash;
    const encoder = new TextEncoder();
    const buffer = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

const blockchain = new Blockchain();

// ML Model Management
async function loadModel() {
  try {
    await loadTensorFlow();
    model = await tf.loadLayersModel(chrome.runtime.getURL('model.json'));
    console.log('Model loaded successfully');
    return true;
  } catch (error) {
    console.error('Error loading model:', error);
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
    await loadModel();
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

// Geolocation APIs
const GEO_APIS = [
  {
    url: (ip) => `http://ip-api.com/json/${ip}`,
    parse: (data) => ({
      city: data.city,
      country: data.country,
      success: data.status === 'success'
    })
  },
  {
    url: (ip) => `https://ipapi.co/${ip}/json/`,
    parse: (data) => ({
      city: data.city,
      country: data.country_code,
      success: true
    })
  }
];

async function fetchGeoData(ip) {
  if (settings.useMultipleAPIs) {
    for (const api of GEO_APIS) {
      try {
        const response = await fetch(api.url(ip));
        const data = await response.json();
        const parsed = api.parse(data);
        if (parsed.success) return parsed;
      } catch (error) {
        console.error(`API error: ${error.message}`);
      }
    }
  }
  // Fallback to first API
  try {
    const response = await fetch(GEO_APIS[0].url(ip));
    const data = await response.json();
    return GEO_APIS[0].parse(data);
  } catch (error) {
    console.error('Error fetching geo data:', error);
    return null;
  }
}

// Web request monitoring
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.type === "main_frame") {
      const url = new URL(details.url);
      const ipAddress = details.ip;
      
      if (ipAddress) {
        const extractedIp = extractIpAddress(ipAddress);
        if (extractedIp) {
          await processConnection(extractedIp, details.tabId, details.url);
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

function extractIpAddress(ip) {
  if (!ip) return null;
  
  // IPv4 regex pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 regex pattern
  const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$|^([0-9a-fA-F]{1,4}:){1,7}:$|^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$|^:((:[0-9a-fA-F]{1,4}){1,7}|:)$/;

  // Check if it's a valid IPv4 or IPv6 address
  if (ipv4Pattern.test(ip) || ipv6Pattern.test(ip)) {
    return ip;
  }

  // Handle IP addresses with port numbers
  const ipWithPortMatch = ip.match(/^(.*?)(?::\d+)?$/);
  if (ipWithPortMatch && ipWithPortMatch[1]) {
    const ipWithoutPort = ipWithPortMatch[1];
    if (ipv4Pattern.test(ipWithoutPort) || ipv6Pattern.test(ipWithoutPort)) {
      return ipWithoutPort;
    }
  }

  return null;
}

async function processConnection(ipAddress, tabId, url) {
  try {
    const geoData = await fetchGeoData(ipAddress);
    let isAnomaly = false;
    let predictionScore = null;

    if (settings.anomalyDetection && model) {
      predictionScore = await predictIP(ipAddress);
      isAnomaly = predictionScore > settings.predictionThreshold;
    }

    if (geoData) {
      const data = {
        ip: ipAddress,
        city: geoData.city,
        country: geoData.country,
        timestamp: Date.now(),
        tabId: tabId,
        domain: new URL(url).hostname,
        anomaly: isAnomaly,
        predictionScore: predictionScore
      };

      await updateTabData(data);

      if (isAnomaly && settings.enableRealTimeAlerts) {
        chrome.runtime.sendMessage({
          type: 'ANOMALY_ALERT',
          data: data
        });
      }
    }
  } catch (error) {
    console.error('Error processing connection:', error);
  }
}

async function updateTabData(data) {
  // Store in local storage
  chrome.storage.local.get({ geoData: [] }, (result) => {
    const storedGeoData = result.geoData;
    storedGeoData.push(data);
    chrome.storage.local.set({ geoData: storedGeoData });
  });

  // Send to popup
  chrome.runtime.sendMessage({
    type: 'UPDATE_TAB_DATA',
    data: data
  });

  // If anomaly detected, add to blockchain
  if (data.anomaly) {
    await blockchain.addBlock(data);
  }
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'updateSettings':
      settings = request.settings;
      chrome.storage.local.set({ settings });
      break;
    case 'ADD_TO_BLOCKCHAIN':
      blockchain.addBlock(request.data).then(() => {
        sendResponse({success: true});
      });
      break;
    case 'GET_INITIAL_DATA':
      sendInitialData();
      break;
    case 'RETRAIN_MODEL':
      retrainModel().then(success => {
        sendResponse({success});
      });
      break;
  }
  return true;
});

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
    focused: true
  });
}

// Initial setup
async function initialize() {
  await loadModel();
  await blockchain.initialize();
}

initialize();