// lib/StateManager.js - Manages bot state and persistence with queue timing
const fs = require('fs').promises;
const path = require('path');

class StateManager {
  constructor(stateFile = 'bot_state.json') {
    this.stateFile = path.join(__dirname, '..', stateFile);
    this.state = {
      pets: [],
      lastCheck: null,
      lastPetIds: new Set(),
      // Queue timing - tracks when each channel's queue was last processed
      queueTimings: {
        petQueues: {}, // channelId -> timestamp of last pet post
        adoptionQueueLastPost: null // global adoption queue last post time
      },
      statistics: {
        totalChecks: 0,
        totalAdoptions: 0,
        totalNewPets: 0,
        totalPointsAwarded: 0
      },
      initialized: false
    };
  }

  /**
   * Load state from file or database
   */
  async load() {
    try {
      // Try to load from file first
      const fileData = await this.loadFromFile();
      if (fileData) {
        this.state = fileData;
        console.log('📁 State loaded from file');
        return;
      }

      console.log('🆕 No previous state found, starting fresh');
      this.state.initialized = true;
    } catch (error) {
      console.error('Error loading state:', error);
      this.state.initialized = true;
    }
  }

  /**
   * Save state to file and/or database
   */
  async save() {
    try {
      await this.saveToFile();
      console.log('💾 State saved successfully');
    } catch (error) {
      console.error('Error saving state:', error);
    }
  }

  /**
   * Load state from JSON file
   */
  async loadFromFile() {
    try {
      const data = await fs.readFile(this.stateFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // Convert lastPetIds array back to Set
      if (parsed.lastPetIds && Array.isArray(parsed.lastPetIds)) {
        parsed.lastPetIds = new Set(parsed.lastPetIds);
      }
      
      return parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading state file:', error);
      }
      return null;
    }
  }

  /**
   * Save state to JSON file
   */
  async saveToFile() {
    const stateToSave = {
      ...this.state,
      // Convert Set to array for JSON serialization
      lastPetIds: Array.from(this.state.lastPetIds || new Set()),
      savedAt: new Date().toISOString()
    };
    
    await fs.writeFile(
      this.stateFile,
      JSON.stringify(stateToSave, null, 2),
      'utf8'
    );
  }

  /**
   * Update pets in state
   * @param {Array} pets - Current pets from database
   */
  updatePets(pets) {
    this.state.pets = pets;
    this.state.lastPetIds = new Set(pets.map(p => p.pet_id));
    this.state.statistics.totalChecks++;
  }

  /**
   * Get pets from state
   */
  getPets() {
    return this.state.pets || [];
  }

  /**
   * Set last check timestamp
   */
  setLastCheck(timestamp) {
    this.state.lastCheck = timestamp;
  }

  /**
   * Get last check timestamp
   */
  getLastCheck() {
    return this.state.lastCheck;
  }

  /**
   * Update statistics
   */
  updateStatistics(adoptions = 0, newPets = 0, pointsAwarded = 0) {
    this.state.statistics.totalAdoptions += adoptions;
    this.state.statistics.totalNewPets += newPets;
    this.state.statistics.totalPointsAwarded += pointsAwarded;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return this.state.statistics;
  }

  /**
   * Check if pet existed in last check
   */
  hadPet(petId) {
    return this.state.lastPetIds.has(petId);
  }

  /**
   * Get time since last check
   */
  getTimeSinceLastCheck() {
    if (!this.state.lastCheck) {
      return null;
    }
    
    const now = new Date();
    const last = new Date(this.state.lastCheck);
    const diff = now - last;
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return { hours, minutes, totalMinutes: Math.floor(diff / (1000 * 60)) };
  }

  // ============ QUEUE TIMING OPERATIONS ============

  /**
   * Record that a pet queue was just processed for a channel
   */
  recordPetQueuePost(channelId) {
    this.state.queueTimings.petQueues[channelId] = new Date();
  }

  /**
   * Record that adoption queue was just processed
   */
  recordAdoptionQueuePost() {
    this.state.queueTimings.adoptionQueueLastPost = new Date();
  }

  /**
   * Check if enough time has passed for next pet queue post (15 minutes)
   */
  isTimeForPetQueuePost(channelId, intervalMinutes = 15) {
    const lastPost = this.state.queueTimings.petQueues[channelId];
    
    if (!lastPost) {
      return true; // Never posted before
    }
    
    const now = new Date();
    const lastPostTime = new Date(lastPost);
    const diffMinutes = (now - lastPostTime) / (1000 * 60);
    
    return diffMinutes >= intervalMinutes;
  }

  /**
   * Check if enough time has passed for next adoption queue post (15 minutes)
   */
  isTimeForAdoptionQueuePost(intervalMinutes = 15) {
    const lastPost = this.state.queueTimings.adoptionQueueLastPost;
    
    if (!lastPost) {
      return true; // Never posted before
    }
    
    const now = new Date();
    const lastPostTime = new Date(lastPost);
    const diffMinutes = (now - lastPostTime) / (1000 * 60);
    
    return diffMinutes >= intervalMinutes;
  }

  /**
   * Get time remaining until next pet queue post
   */
  getTimeUntilNextPetPost(channelId, intervalMinutes = 15) {
    const lastPost = this.state.queueTimings.petQueues[channelId];
    
    if (!lastPost) {
      return 0; // Ready now
    }
    
    const now = new Date();
    const lastPostTime = new Date(lastPost);
    const diffMinutes = (now - lastPostTime) / (1000 * 60);
    const remainingMinutes = Math.max(0, intervalMinutes - diffMinutes);
    
    return Math.ceil(remainingMinutes);
  }

  /**
   * Get time remaining until next adoption queue post
   */
  getTimeUntilNextAdoptionPost(intervalMinutes = 15) {
    const lastPost = this.state.queueTimings.adoptionQueueLastPost;
    
    if (!lastPost) {
      return 0; // Ready now
    }
    
    const now = new Date();
    const lastPostTime = new Date(lastPost);
    const diffMinutes = (now - lastPostTime) / (1000 * 60);
    const remainingMinutes = Math.max(0, intervalMinutes - diffMinutes);
    
    return Math.ceil(remainingMinutes);
  }

  /**
   * Reset state (for testing or maintenance)
   */
  async reset() {
    this.state = {
      pets: [],
      lastCheck: null,
      lastPetIds: new Set(),
      queueTimings: {
        petQueues: {},
        adoptionQueueLastPost: null
      },
      statistics: {
        totalChecks: 0,
        totalAdoptions: 0,
        totalNewPets: 0,
        totalPointsAwarded: 0
      },
      initialized: true
    };
    await this.save();
    console.log('🔄 State reset complete');
  }

  /**
   * Export state for debugging
   */
  exportState() {
    return {
      ...this.state,
      lastPetIds: Array.from(this.state.lastPetIds || new Set()),
      petCount: this.state.pets.length,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import state (for restoration)
   */
  async importState(stateData) {
    if (stateData.lastPetIds && Array.isArray(stateData.lastPetIds)) {
      stateData.lastPetIds = new Set(stateData.lastPetIds);
    }
    
    this.state = {
      ...stateData,
      initialized: true
    };
    
    await this.save();
    console.log('📥 State imported successfully');
  }
}

module.exports = StateManager;