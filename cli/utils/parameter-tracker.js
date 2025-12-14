/**
 * Parameter Tracker for HuginBot
 * 
 * This module implements tracking for SSM parameters created by HuginBot
 * to facilitate cleanup of obsolete parameters.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getConfig } = require('./config');

// Parameter tracking file location
const trackingDir = path.join(os.homedir(), '.huginbot');
const trackingFile = path.join(trackingDir, 'parameters.json');

// Ensure tracking directory exists
if (!fs.existsSync(trackingDir)) {
  fs.mkdirSync(trackingDir, { recursive: true });
}

// Initialize tracking file if it doesn't exist
if (!fs.existsSync(trackingFile)) {
  fs.writeFileSync(trackingFile, JSON.stringify({
    parameters: [],
    lastCleanup: null
  }));
}

/**
 * Read parameter tracking file
 * @returns {Object} Tracking data
 */
function getTracking() {
  try {
    const data = fs.readFileSync(trackingFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading parameter tracking file:', error);
    return { parameters: [], lastCleanup: null };
  }
}

/**
 * Save tracking file
 * @param {Object} tracking Tracking data to save
 */
function saveTracking(tracking) {
  try {
    fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
  } catch (error) {
    console.error('Error saving parameter tracking file:', error);
  }
}

/**
 * Track a parameter
 * @param {string} name Parameter name (SSM path)
 * @param {string} description Human-readable description of the parameter
 * @param {string} associatedResource Optional resource identifier (e.g. world:worldName)
 */
function trackParameter(name, description, associatedResource = null) {
  const tracking = getTracking();
  
  // Check if parameter already exists in tracking
  const existingIndex = tracking.parameters.findIndex(p => p.name === name);
  
  const parameterInfo = {
    name,
    description,
    associatedResource,
    updatedAt: new Date().toISOString()
  };
  
  if (existingIndex >= 0) {
    // Update existing parameter
    tracking.parameters[existingIndex] = {
      ...tracking.parameters[existingIndex],
      ...parameterInfo
    };
  } else {
    // Add new parameter
    parameterInfo.createdAt = new Date().toISOString();
    tracking.parameters.push(parameterInfo);
  }
  
  saveTracking(tracking);
  return parameterInfo;
}

/**
 * Mark a parameter as obsolete
 * @param {string} name Parameter name to mark as obsolete
 * @param {string} reason Reason for marking as obsolete
 * @returns {boolean} True if parameter was found and marked, false otherwise
 */
function markParameterObsolete(name, reason = 'Marked manually') {
  const tracking = getTracking();
  const param = tracking.parameters.find(p => p.name === name);
  
  if (param) {
    param.obsolete = true;
    param.obsoleteReason = reason;
    param.markedObsoleteAt = new Date().toISOString();
    saveTracking(tracking);
    return true;
  }
  
  return false;
}

/**
 * Get all tracked parameters
 * @returns {Array} All parameters
 */
function getAllParameters() {
  return getTracking().parameters;
}

/**
 * Get obsolete parameters
 * @returns {Array} Parameters marked as obsolete
 */
function getObsoleteParameters() {
  return getTracking().parameters.filter(p => p.obsolete);
}

/**
 * Get active parameters (not marked obsolete)
 * @returns {Array} Active parameters
 */
function getActiveParameters() {
  return getTracking().parameters.filter(p => !p.obsolete);
}

/**
 * Record a cleanup event
 * @param {Array} deletedParameters Array of deleted parameter objects
 */
function recordCleanup(deletedParameters) {
  const tracking = getTracking();
  
  tracking.lastCleanup = {
    timestamp: new Date().toISOString(),
    deletedCount: deletedParameters.length,
    parameters: deletedParameters
  };
  
  // Remove deleted parameters from tracking
  tracking.parameters = tracking.parameters.filter(
    p => !deletedParameters.some(dp => dp.name === p.name)
  );
  
  saveTracking(tracking);
  return tracking.lastCleanup;
}

module.exports = {
  trackParameter,
  markParameterObsolete,
  getAllParameters,
  getObsoleteParameters,
  getActiveParameters,
  recordCleanup
};