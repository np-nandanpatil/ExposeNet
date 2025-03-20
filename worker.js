// ML Worker for handling predictions and model updates
let model = null;
let isModelReady = false;
let featureCache = new Map();

// Handle messages from the main script
self.onmessage = async function(e) {
  const { type, data } = e.data;
  
  switch (type) {
    case 'PROCESS_CONNECTION':
      const result = await processConnection(data);
      self.postMessage({
        type: 'PREDICTION_RESULT',
        data: {
          connectionId: data.id,
          ...result
        }
      });
      break;
      
    case 'UPDATE_MODEL':
      await updateModel(data);
      break;
      
    case 'CLEAR_CACHE':
      featureCache.clear();
      break;
  }
};

// Process a single connection
async function processConnection(connection) {
  try {
    // Extract features
    const features = await extractFeatures(connection);
    
    // Calculate base risk score
    const baseScore = calculateBaseRiskScore(features);
    
    // Add behavioral analysis
    const behavioralScore = calculateBehavioralScore(connection);
    
    // Combine scores with weights
    const finalScore = (baseScore * 0.7) + (behavioralScore * 0.3);
    
    // Determine if this is an anomaly
    const isAnomaly = finalScore > 0.75;
    
    return {
      riskScore: finalScore,
      isAnomaly: isAnomaly,
      features: features,
      baseScore: baseScore,
      behavioralScore: behavioralScore
    };
  } catch (error) {
    console.error('Error processing connection:', error);
    return {
      riskScore: 0,
      isAnomaly: false,
      error: error.message
    };
  }
}

// Extract features from connection data
async function extractFeatures(connection) {
  try {
    const features = {
      // IP-based features
      ipRisk: await calculateIPRisk(connection.ip),
      isPrivateIP: isPrivateIP(connection.ip),
      
      // Geographic features
      isHighRiskCountry: connection.isHighRiskCountry || false,
      hasMultipleCountries: connection.multipleCountries || false,
      
      // Domain features
      domainRisk: calculateDomainRisk(connection.domain),
      hasMultipleDomains: connection.multipleDomains || false,
      
      // Protocol features
      isSecure: connection.isSecure || false,
      
      // Time-based features
      hourOfDay: new Date(connection.timestamp).getHours() / 24,
      
      // Additional risk factors
      riskFactorCount: (connection.riskFactors || []).length / 5
    };
    
    return features;
  } catch (error) {
    console.error('Error extracting features:', error);
    return null;
  }
}

// Calculate IP-based risk score
async function calculateIPRisk(ip) {
  if (featureCache.has(ip)) {
    return featureCache.get(ip);
  }
  
  try {
    const parts = ip.split('.');
    if (parts.length !== 4) return 0;
    
    // Convert IP octets to normalized values
    const normalized = parts.map(p => parseInt(p) / 255);
    
    // Calculate basic risk based on IP patterns
    let risk = 0;
    
    // Check for unusual patterns
    if (normalized.some(n => n > 0.98)) risk += 0.2;
    if (normalized.every(n => n > 0.5)) risk += 0.1;
    
    // Cache the result
    featureCache.set(ip, risk);
    
    return risk;
  } catch (error) {
    console.error('Error calculating IP risk:', error);
    return 0;
  }
}

// Calculate domain-based risk score
function calculateDomainRisk(domain) {
  try {
    if (!domain) return 0;
    
    let risk = 0;
    const suspicious = ['.tk', '.ml', '.ga', '.cf', '.xyz', '.top', '.cc'];
    
    // Check TLD
    if (suspicious.some(tld => domain.toLowerCase().endsWith(tld))) {
      risk += 0.3;
    }
    
    // Check domain length
    if (domain.length > 30) risk += 0.1;
    if (domain.length > 50) risk += 0.2;
    
    // Check for numeric patterns
    const numCount = (domain.match(/\d/g) || []).length;
    if (numCount > 5) risk += 0.1;
    
    // Check for random-looking patterns
    if (/[0-9a-f]{8}/i.test(domain)) risk += 0.2;
    
    return Math.min(risk, 1);
  } catch (error) {
    console.error('Error calculating domain risk:', error);
    return 0;
  }
}

// Calculate behavioral risk score
function calculateBehavioralScore(connection) {
  try {
    let score = 0;
    
    // Multiple countries/domains
    if (connection.multipleCountries) score += 0.3;
    if (connection.multipleDomains) score += 0.2;
    
    // Risk factors
    if (connection.riskFactors) {
      score += 0.1 * Math.min(connection.riskFactors.length, 5);
    }
    
    return Math.min(score, 1);
  } catch (error) {
    console.error('Error calculating behavioral score:', error);
    return 0;
  }
}

// Calculate base risk score from features
function calculateBaseRiskScore(features) {
  if (!features) return 0;
  
  try {
    let score = 0;
    
    // IP-based risk (30%)
    score += features.ipRisk * 0.2;
    if (features.isPrivateIP) score += 0.1;
    
    // Geographic risk (25%)
    if (features.isHighRiskCountry) score += 0.15;
    if (features.hasMultipleCountries) score += 0.1;
    
    // Domain risk (25%)
    score += features.domainRisk * 0.15;
    if (features.hasMultipleDomains) score += 0.1;
    
    // Protocol risk (10%)
    if (!features.isSecure) score += 0.1;
    
    // Time-based risk (5%)
    const hourRisk = Math.sin(features.hourOfDay * Math.PI) * 0.05;
    score += Math.max(0, hourRisk);
    
    // Additional risk factors (5%)
    score += features.riskFactorCount * 0.05;
    
    return Math.min(score, 1);
  } catch (error) {
    console.error('Error calculating base risk score:', error);
    return 0;
  }
}

function isPrivateIP(ip) {
  return ip.startsWith('192.168.') || 
         ip.startsWith('10.') || 
         ip.startsWith('172.16.') ||
         ip.startsWith('127.') ||
         ip === '::1';
}

// Update the model with new data
async function updateModel(data) {
  try {
    // Process new data and update internal state
    if (data.connections) {
      // Extract features from new connections
      const newFeatures = await Promise.all(
        data.connections.map(conn => extractFeatures(conn))
      );
      
      // Update feature statistics
      updateFeatureStats(newFeatures);
    }
    
    isModelReady = true;
    self.postMessage({
      type: 'MODEL_UPDATED',
      data: { success: true }
    });
  } catch (error) {
    console.error('Error updating model:', error);
    self.postMessage({
      type: 'MODEL_ERROR',
      data: { error: error.message }
    });
  }
}

// Update feature statistics for better risk assessment
function updateFeatureStats(features) {
  // Implementation can be expanded based on needs
  // Currently using simple risk scoring
} 