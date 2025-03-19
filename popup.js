// popup.js

let currentSettings = {
  anomalyDetection: true,
  useMultipleAPIs: true
};

// Tab switching
document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    // Update active tab button
    document.querySelectorAll(".tab-button").forEach(btn => {
      btn.classList.remove("active");
    });
    button.classList.add("active");

    // Show active tab content
    const tab = button.dataset.tab;
    document.querySelectorAll(".tab-content").forEach((content) => {
      content.classList.remove("active");
    });
    document.getElementById(tab).classList.add("active");
  });
});

// Load settings and initialize UI
async function initializeUI() {
  try {
    const result = await chrome.storage.local.get(['settings', 'geoData', 'blockchain']);
    
    // Load settings
    if (result.settings) {
      currentSettings = result.settings;
      document.getElementById('anomalyDetection').checked = currentSettings.anomalyDetection;
      document.getElementById('useMultipleAPIs').checked = currentSettings.useMultipleAPIs;
    }

    // Load stored data
    if (result.geoData) {
      result.geoData.forEach(displayGeoData);
    }
    if (result.blockchain) {
      displayBlockchainLog(result.blockchain);
    }

    // Set initial active tab
    document.getElementById("monitor").classList.add("active");
  } catch (error) {
    console.error('Error initializing UI:', error);
    showStatus('Error loading data', 'error');
  }
}

// Initialize UI when popup opens
initializeUI();

// Save settings
document.getElementById('saveSettings').addEventListener('click', () => {
  try {
    currentSettings = {
      anomalyDetection: document.getElementById('anomalyDetection').checked,
      useMultipleAPIs: document.getElementById('useMultipleAPIs').checked
    };
    chrome.storage.local.set({ settings: currentSettings });
    chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: currentSettings
    });
    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
  }
});

// Train model button
document.getElementById('trainModel').addEventListener('click', () => {
  try {
    const button = document.getElementById('trainModel');
    button.disabled = true;
    chrome.runtime.sendMessage({ action: 'trainModel' });
  } catch (error) {
    console.error('Error training model:', error);
    showStatus('Error training model', 'error');
    document.getElementById('trainModel').disabled = false;
  }
});

// Add to blockchain button
document.getElementById('addToBlockchain').addEventListener('click', () => {
  try {
    const selectedData = document.querySelector('.list-item.selected');
    if (selectedData) {
      chrome.runtime.sendMessage({
        action: 'addToBlockchain',
        data: selectedData.dataset
      });
      showStatus('Added to blockchain!', 'success');
    }
  } catch (error) {
    console.error('Error adding to blockchain:', error);
    showStatus('Error adding to blockchain', 'error');
  }
});

// Handle messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.action) {
      case "geoDataUpdate":
        displayGeoData(request.data);
        break;
      case "modelStatusUpdate":
        updateModelStatus(request.data);
        break;
      case "blockchainUpdate":
        displayBlockchainLog(request.data);
        break;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    showStatus('Error updating data', 'error');
  }
});

function displayGeoData(data) {
  try {
    const list = document.getElementById("geoDataList");
    const listItem = document.createElement("div");
    listItem.className = `list-item ${data.anomaly ? 'anomaly' : ''}`;
    
    // Store data for blockchain
    listItem.dataset.ip = data.ip;
    listItem.dataset.domain = data.domain;
    listItem.dataset.city = data.city;
    listItem.dataset.country = data.country;
    listItem.dataset.timestamp = data.timestamp;
    
    listItem.innerHTML = `
      <strong>${data.domain}</strong><br>
      IP: ${data.ip}<br>
      Location: ${data.city}, ${data.country}<br>
      Time: ${new Date(data.timestamp).toLocaleString()}
      ${data.anomaly ? '<br><span style="color: #c62828;">ANOMALY DETECTED</span>' : ''}
    `;

    // Add click handler for blockchain
    listItem.addEventListener('click', () => {
      document.querySelectorAll('.list-item').forEach(item => {
        item.classList.remove('selected');
      });
      listItem.classList.add('selected');
      document.getElementById('addToBlockchain').style.display = 'block';
    });

    list.appendChild(listItem);
  } catch (error) {
    console.error('Error displaying geo data:', error);
  }
}

function updateModelStatus(status) {
  try {
    const modelStatus = document.getElementById("modelStatus");
    const trainButton = document.getElementById('trainModel');
    
    if (status.includes('Error')) {
      modelStatus.className = 'status error';
      trainButton.disabled = false;
    } else if (status.includes('successfully')) {
      modelStatus.className = 'status success';
      trainButton.disabled = false;
    } else {
      modelStatus.className = 'status';
    }
    
    modelStatus.textContent = status;
  } catch (error) {
    console.error('Error updating model status:', error);
  }
}

function displayBlockchainLog(blockchain) {
  try {
    const list = document.getElementById("blockchainList");
    list.innerHTML = ""; // Clear the list
    
    blockchain.forEach((block) => {
      if (block.data.type === 'genesis') return; // Skip genesis block
      
      const listItem = document.createElement("div");
      listItem.className = "blockchain-item";
      listItem.innerHTML = `
        <strong>${new Date(block.timestamp).toLocaleString()}</strong><br>
        IP: ${block.data.ip}<br>
        ${block.data.domain ? `Domain: ${block.data.domain}<br>` : ''}
        ${block.data.city ? `Location: ${block.data.city}, ${block.data.country}<br>` : ''}
        ${block.data.prediction ? `Confidence: ${(block.data.prediction * 100).toFixed(2)}%<br>` : ''}
        <span class="blockchain-hash">Hash: ${block.hash}</span>
      `;
      list.appendChild(listItem);
    });
  } catch (error) {
    console.error('Error displaying blockchain log:', error);
  }
}

function showStatus(message, type) {
  try {
    const status = document.createElement('div');
    status.className = `status ${type}`;
    status.textContent = message;
    document.body.appendChild(status);
    
    setTimeout(() => {
      status.remove();
    }, 3000);
  } catch (error) {
    console.error('Error showing status:', error);
  }
}