// lib/PhotoCache.js - Cache pet photos to Discord for permanent storage
const fetch = require('node-fetch');
const { AttachmentBuilder } = require('discord.js');

class PhotoCache {
  constructor(bot, database, photoChannelId) {
    this.bot = bot;
    this.db = database;
    this.photoChannelId = photoChannelId;
  }

  /**
   * Cache a pet photo to Discord if not already cached
   * Attempts to download from photo_url, upload to Discord channel, and store URL
   */
  async cachePhotoIfNeeded(pet) {
    try {
      // Check if already cached
      if (pet.discord_photo_url) {
        console.log(`   ℹ️ Photo already cached for ${pet.name}`);
        return pet.discord_photo_url;
      }

      // Check if photo_url is valid/available
      if (!pet.photo_url || pet.photo_url === 'https://24petconnect.com/Content/Images/No_pic_t.jpg') {
        console.log(`   ⚠️ No valid photo for ${pet.name} (${pet.pet_id})`);
        return null;
      }

      console.log(`   📸 Attempting to cache photo for ${pet.name} (${pet.pet_id})`);

      // Download photo from shelter
      const photoBuffer = await this.downloadPhoto(pet.photo_url);
      if (!photoBuffer) {
        console.log(`   ❌ Failed to download photo for ${pet.name}`);
        return null;
      }

      // Upload to Discord channel
      const discordPhotoUrl = await this.uploadToDiscord(photoBuffer, pet.pet_id, pet.name);
      if (!discordPhotoUrl) {
        console.log(`   ❌ Failed to upload photo to Discord for ${pet.name}`);
        return null;
      }

      // Store Discord URL in database
      await this.db.updatePetDiscordPhotoUrl(pet.id, discordPhotoUrl);
      console.log(`   ✅ Cached photo for ${pet.name}: ${discordPhotoUrl}`);

      return discordPhotoUrl;

    } catch (error) {
      console.error(`   ❌ Error caching photo for ${pet.pet_id}:`, error.message);
      return null;
    }
  }

  /**
   * Download photo from shelter URL
   */
  async downloadPhoto(photoUrl) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };

      const response = await fetch(photoUrl, { headers, timeout: 15000 });

      if (!response.ok) {
        console.log(`   ⚠️ Photo URL returned ${response.status}`);
        return null;
      }

      const buffer = await response.buffer();
      return buffer;

    } catch (error) {
      console.error(`   ⚠️ Download error: ${error.message}`);
      return null;
    }
  }

  /**
   * Upload photo buffer to Discord channel
   */
  async uploadToDiscord(photoBuffer, petId, petName) {
    try {
      const channel = await this.bot.channels.fetch(this.photoChannelId);
      if (!channel) {
        console.error(`   ❌ Photo cache channel ${this.photoChannelId} not found`);
        return null;
      }

      // Create attachment from buffer
      const attachment = new AttachmentBuilder(photoBuffer, { name: `${petId}.jpg` });

      // Send message with attachment
      const message = await channel.send({
        content: `Photo for pet ${petId} (${petName})`,
        files: [attachment]
      });

      // Extract attachment URL from message
      if (message.attachments.size > 0) {
        const photoUrl = message.attachments.first().url;
        return photoUrl;
      }

      return null;

    } catch (error) {
      console.error(`   ⚠️ Discord upload error: ${error.message}`);
      return null;
    }
  }

  /**
   * Get cached photo URL (returns Discord URL if cached, shelter URL if not)
   */
  async getPhotoUrl(pet) {
    if (pet.discord_photo_url) {
      return pet.discord_photo_url;
    }
    return pet.photo_url;
  }
}

module.exports = PhotoCache;