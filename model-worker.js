importScripts('libs/tf.min.js');

const ANOMALY_THRESHOLD = 0.5;

const Model = {
    model: null,
    trained: false,

    ipToFeatures(ip) {
        if (!this.isValidIP(ip)) {
            console.warn(`Invalid IP address: ${ip}`);
            return new Array(16).fill(0);
        }

        const parts = ip.split(':').map(part => parseInt(part || '0', 16));
        const validParts = parts.map(part => isNaN(part) ? 0 : part);
        const paddedParts = validParts.concat(new Array(8 - validParts.length).fill(0));
        const slicedParts = paddedParts.slice(0, 8);
        const normalizedParts = slicedParts.map(part => part / 65535);
        const features = normalizedParts;
        return features;
    },

    isValidIP(ip) {
        const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
      },

    async loadDataset() {
        console.log('Loading dataset...');
        try {
        const response = await fetch('dataset.json');
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        const data = await response.json();
        console.log('Dataset loaded:', data.length, 'entries');
        return data;
        } catch (e) {
        console.error('Failed to load dataset:', e);
        return [];
        }
    },

    async trainModel() {
        console.log('Training model...');
        const dataset = await this.loadDataset();
        if (dataset.length === 0) {
        console.error('Empty dataset, skipping training');
        return;
        }

        try {
        const xs = tf.tensor2d(dataset.map(d => this.ipToFeatures(d.ip)), [dataset.length, 8]);
        const ys = tf.tensor2d(dataset.map(d => [d.label]), [dataset.length, 1]);
        this.model = tf.sequential();
        this.model.add(tf.layers.conv1d({
            inputShape: [8, 1],
            kernelSize: 3,
            filters: 32,
            activation: 'relu',
            strides: 1,
            padding: 'same'
        }));
        this.model.add(tf.layers.flatten());
        this.model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
        this.model.add(tf.layers.dropout({ rate: 0.25 }));
        this.model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
        this.model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
        this.model.compile({
            optimizer: 'adam',
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
        });
        const reshapedXs = xs.reshape([xs.shape[0], xs.shape[1], 1]);
        await this.model.fit(reshapedXs, ys, { epochs: 10, batchSize: 32, validationSplit: 0.1 });
        this.trained = true;
        console.log('Model trained successfully');
        postMessage({ type: 'modelTrained', data: { success: true } });

        } catch (e) {
        console.error('Model training failed:', e);
        postMessage({ type: 'error', data: { message: 'Model training failed', error: e } });
        }
    },

    async predictIP(ip) {
        if (!this.trained || !this.model) {
          console.warn('Model not trained, returning false for IP:', ip);
          return false; // Or any default value
        }

        if (!this.isValidIP(ip)) {
            console.warn(`Invalid IP address for prediction: ${ip}`);
            return false;
        }
        try {
          const input = tf.tensor2d([this.ipToFeatures(ip)], [1, 8]);
          const reshapedInput = input.reshape([1, 8, 1]); // Reshape for conv1d
          const prediction = this.model.predict(reshapedInput).dataSync()[0];
          console.log('Prediction for IP', ip, ':', prediction);
          return prediction > ANOMALY_THRESHOLD;
        } catch (e) {
          console.error('Prediction failed for IP', ip, ':', e);
          postMessage({ type: 'error', data: { message: 'Prediction failed', error: e } });
          return false; // Return a default value in case of error
        }
    }
};

onmessage = async (event) => {
    const { type, data, ip } = event.data;

    if (type === 'load') {
        await Model.trainModel();  // Load and train on startup
    } else if (type === 'predict') {
      const isAnomaly = await Model.predictIP(ip);
      postMessage({ type: 'predictionResult', data: { isAnomaly } });
    }
};