// popup.js

let currentSettings = {
  anomalyDetection: true,
  useMultipleAPIs: true
};

// Tab switching
document.addEventListener('DOMContentLoaded', function() {
    // Tab switching
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            
            // Update active tab button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update active tab content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === tabId) {
                    content.classList.add('active');
                }
            });
        });
    });

    // Initialize settings
    chrome.storage.sync.get(['anomalyDetection', 'useMultipleAPIs'], function(result) {
        document.getElementById('anomalyDetection').checked = result.anomalyDetection !== false;
        document.getElementById('useMultipleAPIs').checked = result.useMultipleAPIs !== false;
    });

    // Save settings
    document.getElementById('saveSettings').addEventListener('click', function() {
        const settings = {
            anomalyDetection: document.getElementById('anomalyDetection').checked,
            useMultipleAPIs: document.getElementById('useMultipleAPIs').checked
        };
        
        chrome.storage.sync.set(settings, function() {
            const status = document.createElement('div');
            status.className = 'status success';
            status.textContent = 'Settings saved successfully!';
            document.getElementById('settings').appendChild(status);
            setTimeout(() => status.remove(), 2000);
        });
    });

    // Handle blockchain addition
    document.getElementById('addToBlockchain').addEventListener('click', function() {
        const selectedItem = document.querySelector('.list-item.selected');
        if (!selectedItem) return;

        const data = JSON.parse(selectedItem.dataset.geoData);
        chrome.runtime.sendMessage({
            type: 'ADD_TO_BLOCKCHAIN',
            data: data
        }, function(response) {
            if (response.success) {
                const status = document.createElement('div');
                status.className = 'status success';
                status.textContent = 'Added to blockchain successfully!';
                document.getElementById('monitor').appendChild(status);
                setTimeout(() => status.remove(), 2000);
            } else {
                const status = document.createElement('div');
                status.className = 'status error';
                status.textContent = 'Failed to add to blockchain: ' + response.error;
                document.getElementById('monitor').appendChild(status);
                setTimeout(() => status.remove(), 2000);
            }
        });
    });

    // Listen for updates from background script
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (message.type === 'UPDATE_TAB_DATA') {
            updateGeoDataList(message.data);
        } else if (message.type === 'UPDATE_BLOCKCHAIN') {
            updateBlockchainList(message.data);
        }
    });

    // Update geo data list
    function updateGeoDataList(data) {
        const container = document.getElementById('geoDataList');
        container.innerHTML = '';

        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'list-item';
            if (item.isAnomaly) {
                div.classList.add('anomaly');
            }
            div.dataset.geoData = JSON.stringify(item);
            
            const timestamp = new Date(item.timestamp).toLocaleString();
            div.innerHTML = `
                <strong>${item.domain}</strong><br>
                IP: ${item.ip}<br>
                Location: ${item.country}, ${item.city}<br>
                Time: ${timestamp}<br>
                ${item.isAnomaly ? '<span style="color: red;">⚠️ Anomaly Detected</span>' : ''}
            `;
            
            div.addEventListener('click', () => {
                document.querySelectorAll('.list-item').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
                document.getElementById('addToBlockchain').style.display = 'block';
            });
            
            container.appendChild(div);
        });
    }

    // Update blockchain list
    function updateBlockchainList(data) {
        const container = document.getElementById('blockchainList');
        container.innerHTML = '';

        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'blockchain-item';
            div.innerHTML = `
                <strong>${item.domain}</strong><br>
                IP: ${item.ip}<br>
                Location: ${item.country}, ${item.city}<br>
                Time: ${new Date(item.timestamp).toLocaleString()}<br>
                <span class="blockchain-hash">Hash: ${item.hash}</span>
            `;
            container.appendChild(div);
        });
    }

    // Request initial data
    chrome.runtime.sendMessage({ type: 'GET_INITIAL_DATA' });
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