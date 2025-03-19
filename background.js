// background.js

let settings = {
  anomalyDetection: true,
  useMultipleAPIs: true
};

// Load settings on startup
chrome.storage.local.get(['settings'], (result) => {
  if (result.settings) {
    settings = result.settings;
  }
});

// Initialize blockchain with genesis block
chrome.storage.local.get(['blockchain'], (result) => {
  if (!result.blockchain || result.blockchain.length === 0) {
    const genesisBlock = {
      timestamp: Date.now(),
      data: { type: 'genesis', message: 'Initial block' },
      previousHash: '0',
      hash: calculateHash({ type: 'genesis', message: 'Initial block' }, '0')
    };
    chrome.storage.local.set({ blockchain: [genesisBlock] });
  }
});

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

// Web request listener
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.type === "main_frame") {
      const ipAddress = extractIpAddress(details.ip);
      if (ipAddress) {
        await processConnection(ipAddress, details.tabId, details.url);
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

async function processConnection(ipAddress, tabId, url) {
  try {
    // Try multiple APIs if enabled
    let geoData = null;
    if (settings.useMultipleAPIs) {
      for (const api of GEO_APIS) {
        try {
          const response = await fetch(api.url(ipAddress));
          const data = await response.json();
          geoData = api.parse(data);
          if (geoData.success) break;
        } catch (error) {
          console.error(`API error: ${error.message}`);
        }
      }
    } else {
      // Use default API
      const response = await fetch(GEO_APIS[0].url(ipAddress));
      const data = await response.json();
      geoData = GEO_APIS[0].parse(data);
    }

    if (geoData && geoData.success) {
      // Check for anomalies if enabled
      if (settings.anomalyDetection) {
        const isAnomaly = await checkForAnomaly(ipAddress);
        geoData.anomaly = isAnomaly;
      }

      updateTabData(geoData, tabId, url, ipAddress);
    }
  } catch (error) {
    console.error('Error processing connection:', error);
  }
}

async function checkForAnomaly(ip) {
  // Simple rule-based anomaly detection
  const allowedCountries = ["US", "CA", "GB", "DE", "FR", "IT", "ES"];
  try {
    const response = await fetch(GEO_APIS[0].url(ip));
    const data = await response.json();
    return !allowedCountries.includes(data.country);
  } catch (error) {
    console.error('Error checking anomaly:', error);
    return false;
  }
}

function updateTabData(geoData, tabId, url, ipAddress) {
  const domain = new URL(url).hostname;
  const data = {
    ip: ipAddress,
    city: geoData.city,
    country: geoData.country,
    timestamp: Date.now(),
    tabId: tabId,
    domain: domain,
    anomaly: geoData.anomaly || false
  };

  storeGeoData(data);
  sendGeoDataToPopup(data);
}

function extractIpAddress(ip) {
  if (!ip) return null;
  // Handle both IPv4 and IPv6
  return ip.includes(':') ? ip : null; // Currently only handling IPv6
}

function calculateHash(data, previousHash) {
  const str = JSON.stringify(data) + previousHash;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function storeGeoData(geoData) {
  chrome.storage.local.get({ geoData: [] }, (result) => {
    const storedGeoData = result.geoData;
    storedGeoData.push(geoData);
    chrome.storage.local.set({ geoData: storedGeoData });
  });
}

function sendGeoDataToPopup(geoData) {
  chrome.runtime.sendMessage({
    action: "geoDataUpdate",
    data: geoData,
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'updateSettings':
      settings = request.settings;
      chrome.storage.local.set({ settings });
      break;
    case 'addToBlockchain':
      addBlockToBlockchain(request.data);
      break;
    case 'GET_INITIAL_DATA':
      sendInitialData();
      break;
  }
});

function addBlockToBlockchain(data) {
  chrome.storage.local.get({ blockchain: [] }, (result) => {
    const blockchain = result.blockchain;
    const previousBlock = blockchain[blockchain.length - 1];
    const previousHash = previousBlock ? previousBlock.hash : '0';
    const newBlock = {
      timestamp: Date.now(),
      data: data,
      previousHash: previousHash,
      hash: calculateHash(data, previousHash)
    };
    blockchain.push(newBlock);
    chrome.storage.local.set({ blockchain: blockchain });
    sendBlockchainToPopup(blockchain);
  });
}

function sendBlockchainToPopup(blockchain) {
  chrome.runtime.sendMessage({
    action: "blockchainUpdate",
    data: blockchain,
  });
}

function sendModelStatusToPopup(status) {
  chrome.runtime.sendMessage({
    action: "modelStatusUpdate",
    data: status,
  });
}

// Handle extension icon click
chrome.browserAction.onClicked.addListener((tab) => {
  openMonitorWindow();
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === "_execute_action") {
    openMonitorWindow();
  }
});

// Function to open the monitor window
function openMonitorWindow() {
  chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 800,
    height: 600,
    focused: true
  });
}

// Function to send initial data to the window
function sendInitialData() {
  chrome.storage.local.get(['geoData', 'blockchain'], (result) => {
    if (result.geoData) {
      chrome.runtime.sendMessage({
        action: "UPDATE_TAB_DATA",
        data: result.geoData
      });
    }
    if (result.blockchain) {
      chrome.runtime.sendMessage({
        action: "UPDATE_BLOCKCHAIN",
        data: result.blockchain
      });
    }
  });
}