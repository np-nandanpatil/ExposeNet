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

// Load settings
chrome.storage.local.get(['settings'], (result) => {
  if (result.settings) {
    currentSettings = result.settings;
    document.getElementById('anomalyDetection').checked = currentSettings.anomalyDetection;
    document.getElementById('useMultipleAPIs').checked = currentSettings.useMultipleAPIs;
  }
});

// Save settings
document.getElementById('saveSettings').addEventListener('click', () => {
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
});

// Train model button
document.getElementById('trainModel').addEventListener('click', () => {
  const button = document.getElementById('trainModel');
  button.disabled = true;
  chrome.runtime.sendMessage({ action: 'trainModel' });
});

// Add to blockchain button
document.getElementById('addToBlockchain').addEventListener('click', () => {
  const selectedData = document.querySelector('.list-item.selected');
  if (selectedData) {
    chrome.runtime.sendMessage({
      action: 'addToBlockchain',
      data: selectedData.dataset
    });
    showStatus('Added to blockchain!', 'success');
  }
});

// Handle messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
});

function displayGeoData(data) {
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
}

function updateModelStatus(status) {
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
}

function displayBlockchainLog(blockchain) {
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
}

function showStatus(message, type) {
  const status = document.createElement('div');
  status.className = `status ${type}`;
  status.textContent = message;
  document.body.appendChild(status);
  
  setTimeout(() => {
    status.remove();
  }, 3000);
}

// Load stored data on popup open
chrome.storage.local.get({ geoData: [], blockchain: [] }, (result) => {
  result.geoData.forEach((data) => {
    displayGeoData(data);
  });
  displayBlockchainLog(result.blockchain);
});