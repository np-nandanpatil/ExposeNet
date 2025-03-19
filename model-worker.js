// model-worker.js
importScripts('tf.min.js');

let model = null;
const ANOMALY_THRESHOLD = 0.5;

// Load training data
async function loadTrainingData() {
  const response = await fetch('dataset.json');
  const data = await response.json();
  return data;
}

// Preprocess IP addresses
function preprocessIP(ip) {
  // Convert IPv6 to array of numbers
  const parts = ip.split(':');
  return parts.map(part => parseInt(part, 16));
}

// Create and train model
async function trainModel() {
  const data = await loadTrainingData();
  
  // Create model
  model = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [8], units: 16, activation: 'relu' }),
      tf.layers.dense({ units: 8, activation: 'relu' }),
      tf.layers.dense({ units: 1, activation: 'sigmoid' })
    ]
  });

  // Compile model
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });

  // Prepare training data
  const xs = tf.tensor2d(data.map(item => preprocessIP(item.ip)));
  const ys = tf.tensor2d(data.map(item => item.label), [data.length, 1]);

  // Train model
  await model.fit(xs, ys, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.2,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        self.postMessage({
          type: 'trainingProgress',
          epoch,
          logs
        });
      }
    }
  });

  // Save model
  await model.save('indexeddb://geo-track-model');

  self.postMessage({ type: 'modelTrained' });
}

// Load saved model
async function loadModel() {
  try {
    model = await tf.loadLayersModel('indexeddb://geo-track-model');
    self.postMessage({ type: 'modelLoaded' });
  } catch (error) {
    self.postMessage({ type: 'modelLoadError', error: error.message });
  }
}

// Make prediction
async function predict(ip) {
  if (!model) {
    await loadModel();
  }

  const input = tf.tensor2d([preprocessIP(ip)]);
  const prediction = await model.predict(input).data();
  const isAnomaly = prediction[0] > ANOMALY_THRESHOLD;

  self.postMessage({
    type: 'prediction',
    ip,
    prediction: prediction[0],
    isAnomaly
  });
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'train':
      await trainModel();
      break;
    case 'load':
      await loadModel();
      break;
    case 'predict':
      await predict(data.ip);
      break;
  }
}; 