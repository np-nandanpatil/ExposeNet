// Service worker for Geo-Track Browser Extension
console.log('Service worker starting...');

// Global state storage
let tabGeoData = {};
let geoDataCache = {};
let anomalyDetectionEnabled = true;
let multiApiEnabled = true;

// Load stored state on startup
chrome.storage.local.get(['tabGeoData', 'geoDataCache', 'anomalyDetectionEnabled', 'multiApiEnabled'], (result) => {
  tabGeoData = result.tabGeoData || {};
  geoDataCache = result.geoDataCache || {};
  anomalyDetectionEnabled = result.anomalyDetectionEnabled !== undefined ? result.anomalyDetectionEnabled : true;
  multiApiEnabled = result.multiApiEnabled !== undefined ? result.multiApiEnabled : true;
  console.log('State loaded from storage:', Object.keys(tabGeoData).length, 'tabs');
});

// Web request listener for IP tracking
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    console.log('Web request completed:', details.url);
    if (details.tabId < 0) {
      console.log('Skipping negative tabId:', details.tabId);
      return;
    }

    const ip = details.ip;
    if (!ip) {
      console.log('No IP in details, skipping:', details.url);
      return;
    }

    // Get domain from tab
    const domain = await getDomainFromTab(details.tabId);
    if (!domain) {
      console.log('Could not determine domain for tabId:', details.tabId);
      return;
    }

    // Fetch geolocation data
    const geoInfo = await fetchGeoData(ip);
    if (!geoInfo) {
      console.log('Failed to fetch geo data for IP:', ip);
      return;
    }

    // Check if this is a new connection for this tab/domain
    if (shouldTrackConnection(details.tabId, ip)) {
      // Send data to monitor for anomaly detection
      await chrome.runtime.sendMessage({
        action: 'checkAnomaly',
        data: { ip, domain }
      }).catch(e => console.log('Monitor not open, storing data without check'));

      // Check blockchain for known bad IPs
      let isAnomaly = false;
      let reroutedTo = null;

      try {
        const blockchainData = await chrome.storage.local.get({ blockchain: [] });
        const blockchain = blockchainData.blockchain || [];
        isAnomaly = blockchain.some(block => 
          typeof block.data === 'object' && 
          block.data.ip === ip
        );
      } catch (e) {
        console.error('Error checking blockchain:', e);
      }

      // Update tab data with the connection info
      updateTabData(details.tabId, ip, domain, geoInfo, isAnomaly, reroutedTo);
    }
  },
  { urls: ["<all_urls>"] }
);

// Message listener for communication with monitor.html
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getTabData') {
    // Send current tab data to the monitor
    sendResponse({ tabGeoData });
    return true;
  } 
  else if (message.action === 'anomalyDetected') {
    // Update state with anomaly info from monitor
    const { ip, domain, isAnomaly, reroutedTo } = message.data;
    
    // Update all affected tab entries
    for (const tabId in tabGeoData) {
      if (tabGeoData[tabId].domain === domain && 
          tabGeoData[tabId].results && 
          tabGeoData[tabId].results[ip]) {
        
        tabGeoData[tabId].results[ip].isAnomaly = isAnomaly;
        if (reroutedTo) {
          tabGeoData[tabId].results[ip].reroutedTo = reroutedTo;
        }
      }
    }
    
    // Save updated state
    chrome.storage.local.set({ tabGeoData });
    sendResponse({ success: true });
    return true;
  }
  else if (message.action === 'setSettings') {
    // Update settings
    if (message.data.anomalyDetectionEnabled !== undefined) {
      anomalyDetectionEnabled = message.data.anomalyDetectionEnabled;
    }
    if (message.data.multiApiEnabled !== undefined) {
      multiApiEnabled = message.data.multiApiEnabled;
    }
    
    // Save to storage
    chrome.storage.local.set({ 
      anomalyDetectionEnabled, 
      multiApiEnabled 
    });
    
    sendResponse({ success: true });
    return true;
  }
  else if (message.action === 'getSettings') {
    // Return current settings
    sendResponse({ 
      anomalyDetectionEnabled, 
      multiApiEnabled 
    });
    return true;
  }
});

// Tab event listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tabGeoData[tabId]) {
    try {
      const domain = new URL(tab.url).hostname;
      tabGeoData[tabId].domain = domain;
      chrome.storage.local.set({ tabGeoData });
    } catch (e) {
      console.error('Error updating tab domain:', e);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabGeoData[tabId]) {
    delete tabGeoData[tabId];
    chrome.storage.local.set({ tabGeoData });
  }
});

// Extension action opens the monitor
chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: "monitor.html",
    type: "popup",
    width: 800,
    height: 600
  });
});

// Helper functions
async function getDomainFromTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      const url = new URL(tab.url);
      return url.hostname;
    }
  } catch (e) {
    console.error('Error getting domain from tab:', e);
  }
  return null;
}

async function fetchGeoData(ip) {
  // Return cached data if available
  if (geoDataCache[ip]) {
    return geoDataCache[ip];
  }
  
  const apis = [
    {
      url: `http://ip-api.com/json/${ip}`,
      process: (data) => {
        if (data.status === "success") {
          return {
            city: data.city || 'Unknown',
            country: data.country || 'Unknown',
            query: ip,
            source: 'ip-api.com'
          };
        }
        return null;
      }
    }
  ];
  
  // Add a second API if multi-API is enabled
  if (multiApiEnabled) {
    apis.push({
      url: `https://ipapi.co/${ip}/json/`,
      process: (data) => {
        if (data && !data.error) {
          return {
            city: data.city || 'Unknown',
            country: data.country_name || 'Unknown',
            query: ip,
            source: 'ipapi.co'
          };
        }
        return null;
      }
    });
  }
  
  // Try each API in sequence with retry logic
  for (const api of apis) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(api.url);
        const data = await response.json();
        const result = api.process(data);
        
        if (result) {
          // Cache the result
          geoDataCache[ip] = result;
          
          // Save cache periodically (don't await)
          chrome.storage.local.set({ geoDataCache });
          
          return result;
        }
      } catch (error) {
        console.error(`Error fetching geo data from ${api.url} (attempt ${attempt}):`, error);
      }
      
      // Wait before retrying
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  // If all APIs fail, return a basic result
  const fallbackResult = {
    city: 'Unknown',
    country: 'Unknown',
    query: ip,
    source: 'fallback'
  };
  
  // Cache the fallback result
  geoDataCache[ip] = fallbackResult;
  return fallbackResult;
}

function shouldTrackConnection(tabId, ip) {
  // Check if we've already tracked this IP for this tab
  return !tabGeoData[tabId] || 
         !tabGeoData[tabId].results || 
         !tabGeoData[tabId].results[ip];
}

function updateTabData(tabId, ip, domain, geoInfo, isAnomaly, reroutedTo) {
  // Initialize tab data if needed
  if (!tabGeoData[tabId]) {
    tabGeoData[tabId] = {
      domain: domain,
      results: {}
    };
  }
  
  // Add the IP data
  tabGeoData[tabId].results[ip] = {
    ...geoInfo,
    isAnomaly: isAnomaly,
    reroutedTo: reroutedTo,
    timestamp: Date.now()
  };
  
  // Save to storage
  chrome.storage.local.set({ tabGeoData }, () => {
    console.log('Updated tabGeoData for tabId:', tabId);
  });
}

console.log('Service worker setup complete');