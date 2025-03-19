// popup.js

let currentSettings = {
  anomalyDetection: true,
  useMultipleAPIs: true,
  enableIPBlocking: true,
  enableRealTimeAlerts: true,
  predictionThreshold: 0.75
};

let stats = {
  totalConnections: 0,
  totalAnomalies: 0,
  predictionCount: 0,
  modelAccuracy: 0
};

// Initialize Chart.js
let predictionChart = null;

document.addEventListener('DOMContentLoaded', function() {
    initializeCharts();
    initializeUI();
    setupEventListeners();
    loadInitialData();
});

function initializeCharts() {
    const ctx = document.getElementById('predictionChart').getContext('2d');
    predictionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Anomaly Predictions',
                data: [],
                borderColor: '#2196F3',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 1
                }
            }
        }
    });
}

function setupEventListeners() {
    // Tab switching
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === tabId) {
                    content.classList.add('active');
                }
            });
        });
    });

    // Settings
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    document.getElementById('retrainModel').addEventListener('click', retrainModel);
    document.getElementById('predictionThreshold').addEventListener('input', updateThresholdValue);

    // Blockchain
    document.getElementById('addToBlockchain').addEventListener('click', addToBlockchain);
}

function updateThresholdValue() {
    const value = document.getElementById('predictionThreshold').value;
    document.getElementById('thresholdValue').textContent = `${value}%`;
}

async function saveSettings() {
    const settings = {
        anomalyDetection: document.getElementById('anomalyDetection').checked,
        useMultipleAPIs: document.getElementById('useMultipleAPIs').checked,
        enableIPBlocking: document.getElementById('enableIPBlocking').checked,
        enableRealTimeAlerts: document.getElementById('enableRealTimeAlerts').checked,
        predictionThreshold: document.getElementById('predictionThreshold').value / 100
    };
    
    try {
        await chrome.storage.local.set({ settings });
        chrome.runtime.sendMessage({
            type: 'updateSettings',
            settings: settings
        });
        showStatus('Settings saved successfully!', 'success');
    } catch (error) {
        console.error('Error saving settings:', error);
        showStatus('Error saving settings', 'error');
    }
}

async function retrainModel() {
    try {
        document.getElementById('retrainModel').disabled = true;
        const response = await chrome.runtime.sendMessage({ type: 'RETRAIN_MODEL' });
        if (response.success) {
            showStatus('Model retrained successfully!', 'success');
        } else {
            showStatus('Error retraining model', 'error');
        }
    } catch (error) {
        console.error('Error retraining model:', error);
        showStatus('Error retraining model', 'error');
    } finally {
        document.getElementById('retrainModel').disabled = false;
    }
}

function updateStats(data) {
    stats.totalConnections++;
    if (data.anomaly) stats.totalAnomalies++;
    if (data.predictionScore !== null) stats.predictionCount++;

    document.getElementById('totalConnections').textContent = stats.totalConnections;
    document.getElementById('totalAnomalies').textContent = stats.totalAnomalies;
    document.getElementById('predictionCount').textContent = stats.predictionCount;

    // Update chart
    if (data.predictionScore !== null) {
        const timestamp = new Date(data.timestamp).toLocaleTimeString();
        predictionChart.data.labels.push(timestamp);
        predictionChart.data.datasets[0].data.push(data.predictionScore);

        // Keep last 20 points
        if (predictionChart.data.labels.length > 20) {
            predictionChart.data.labels.shift();
            predictionChart.data.datasets[0].data.shift();
        }

        predictionChart.update();
    }
}

function updateGeoDataList(data) {
    const container = document.getElementById('geoDataList');
    
    const div = document.createElement('div');
    div.className = 'list-item';
    if (data.anomaly) {
        div.classList.add('anomaly');
    }
    div.dataset.geoData = JSON.stringify(data);
    
    const timestamp = new Date(data.timestamp).toLocaleString();
    div.innerHTML = `
        <strong>${data.domain}</strong><br>
        IP: ${data.ip}<br>
        Location: ${data.country}, ${data.city}<br>
        Time: ${timestamp}<br>
        ${data.predictionScore !== null ? `Anomaly Score: ${(data.predictionScore * 100).toFixed(2)}%<br>` : ''}
        ${data.anomaly ? '<span style="color: red;">⚠️ Anomaly Detected</span>' : ''}
    `;
    
    div.addEventListener('click', () => {
        document.querySelectorAll('.list-item').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        document.getElementById('addToBlockchain').style.display = 'block';
    });
    
    container.insertBefore(div, container.firstChild);
    updateStats(data);
}

function updateBlockchainList(data) {
    const container = document.getElementById('blockchainList');
    container.innerHTML = '';

    let totalBlocks = 0;
    let lastBlockTime = '-';

    data.forEach(block => {
        if (block.data.type === 'genesis') return;
        
        totalBlocks++;
        lastBlockTime = new Date(block.timestamp).toLocaleString();
        
        const div = document.createElement('div');
        div.className = 'blockchain-item';
        div.innerHTML = `
            <strong>${block.data.domain}</strong><br>
            IP: ${block.data.ip}<br>
            Location: ${block.data.country}, ${block.data.city}<br>
            Time: ${new Date(block.timestamp).toLocaleString()}<br>
            ${block.data.predictionScore !== null ? `Anomaly Score: ${(block.data.predictionScore * 100).toFixed(2)}%<br>` : ''}
            <span class="blockchain-hash">Hash: ${block.hash}</span>
        `;
        container.appendChild(div);
    });

    document.getElementById('totalBlocks').textContent = totalBlocks;
    document.getElementById('lastBlockTime').textContent = lastBlockTime;
}

async function addToBlockchain() {
    const selectedItem = document.querySelector('.list-item.selected');
    if (!selectedItem) return;

    try {
        const data = JSON.parse(selectedItem.dataset.geoData);
        const response = await chrome.runtime.sendMessage({
            type: 'ADD_TO_BLOCKCHAIN',
            data: data
        });

        if (response.success) {
            showStatus('Added to blockchain successfully!', 'success');
        } else {
            showStatus('Failed to add to blockchain', 'error');
        }
    } catch (error) {
        console.error('Error adding to blockchain:', error);
        showStatus('Error adding to blockchain', 'error');
    }
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        switch (message.type) {
            case 'UPDATE_TAB_DATA':
                updateGeoDataList(message.data);
                break;
            case 'UPDATE_BLOCKCHAIN':
                updateBlockchainList(message.data);
                break;
            case 'ANOMALY_ALERT':
                if (currentSettings.enableRealTimeAlerts) {
                    showStatus(`⚠️ Anomaly detected: ${message.data.ip}`, 'error');
                }
                break;
        }
    } catch (error) {
        console.error('Error handling message:', error);
        showStatus('Error updating data', 'error');
    }
});

function showStatus(message, type) {
    const status = document.createElement('div');
    status.className = `status ${type}`;
    status.textContent = message;
    document.body.appendChild(status);
    
    setTimeout(() => {
        status.remove();
    }, 3000);
}

// Load initial data
function loadInitialData() {
    chrome.runtime.sendMessage({ type: 'GET_INITIAL_DATA' });
}

// Initialize UI
async function initializeUI() {
    try {
        const result = await chrome.storage.local.get(['settings', 'geoData', 'blockchain']);
        
        // Load settings
        if (result.settings) {
            currentSettings = result.settings;
            document.getElementById('anomalyDetection').checked = currentSettings.anomalyDetection;
            document.getElementById('useMultipleAPIs').checked = currentSettings.useMultipleAPIs;
            document.getElementById('enableIPBlocking').checked = currentSettings.enableIPBlocking;
            document.getElementById('enableRealTimeAlerts').checked = currentSettings.enableRealTimeAlerts;
            document.getElementById('predictionThreshold').value = Math.round(currentSettings.predictionThreshold * 100);
            updateThresholdValue();
        }

        // Set initial active tab
        document.getElementById("monitor").classList.add("active");
    } catch (error) {
        console.error('Error initializing UI:', error);
        showStatus('Error loading data', 'error');
    }
}