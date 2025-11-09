// lib/QueueManager.js - Handles Discord queue broadcasting for pets
// UPDATED: Now uses discord_photo_url for adoption embeds
const { EmbedBuilder } = require('discord.js');

class QueueManager {
  constructor(bot, database, stateManager) {
    this.bot = bot;
    this.db = database;
    this.state = stateManager;
  }

  /**
   * Process new pet and completed pet queues for all channels (every 15 minutes per channel)
   * Handles both 'new_pet' (complete from arrival) and 'completed_pet' (just became complete)
   */
  async processNewPetQueues(channelConfigs) {
    console.log('🎯 Processing new/completed pet queues...');
    
    for (const config of channelConfigs) {
      const { channel_id: channelId, league_id: leagueId, league_name: leagueName } = config;
      
      // Check if it's time to post for this channel
      if (!this.state.isTimeForNewPetQueuePost(channelId)) {
        const timeRemaining = this.state.getTimeUntilNextNewPetPost(channelId);
        console.log(`   ⏳ Channel ${channelId}: ${timeRemaining} min until next post`);
        continue;
      }

      // Process both 'new_pet' and 'completed_pet' types
      for (const queueType of ['new_pet', 'completed_pet']) {
        const petToPost = await this.db.getNextPetToPostByType(channelId, queueType);
        
        if (!petToPost) {
          console.log(`   ℹ️ Channel ${channelId}: No ${queueType}s in queue`);
          continue;
        }

        try {
          // Get Discord channel
          const channel = await this.bot.channels.fetch(channelId);
          if (!channel) {
            console.error(`   ❌ Channel ${channelId} not found`);
            continue;
          }

          // Create appropriate embed based on type
          let embed;
          if (queueType === 'completed_pet') {
            embed = this.createCompletedPetEmbed(petToPost, leagueName);
          } else {
            embed = this.createNewPetEmbed(petToPost, leagueName);
          }
          
          await channel.send({ embeds: [embed] });

          const typeLabel = queueType === 'completed_pet' ? 'completed' : 'new';
          console.log(`   ✅ Posted ${typeLabel} pet: ${petToPost.name} (${petToPost.pet_code}) to ${leagueName}`);

          // Mark as posted
          await this.db.markQueueItemPosted(petToPost.queue_id);
          await this.db.markPetAvailablePosted(petToPost.pet_id);

          // Record timing
          this.state.recordNewPetQueuePost(channelId);
          await this.state.save();

        } catch (error) {
          console.error(`   ❌ Error posting ${queueType} to channel ${channelId}:`, error.message);
        }
      }
    }
  }

  /**
   * Process adoption queue (global, every 15 minutes)
   * UPDATED: Now fetches discord_photo_url from database for embeds
   */
  async processAdoptionQueue(channelConfigs) {
    console.log('🎯 Processing adoption queue...');
    
    // Check if it's time to post
    if (!this.state.isTimeForAdoptionQueuePost()) {
      const timeRemaining = this.state.getTimeUntilNextAdoptionPost();
      console.log(`   ⏳ Adoption queue: ${timeRemaining} min until next post`);
      return;
    }

    // Get next pet to post
    const petToPost = await this.db.getNextAdoptionToPost();
    
    if (!petToPost) {
      console.log(`   ℹ️ No pets in adoption queue`);
      return;
    }

    try {
      // Get all points for this adoption (across all leagues)
      const pointsAwarded = await this.db.getAdoptionPointsGlobal(petToPost.pet_code);

      // Group points by league for customized messages
      const pointsByLeague = {};
      for (const point of pointsAwarded) {
        if (!pointsByLeague[point.league_id]) {
          pointsByLeague[point.league_id] = {
            leagueName: point.league_name,
            points: []
          };
        }
        pointsByLeague[point.league_id].points.push(point);
      }

      // Post to each channel that tracks leagues with points
      const postedChannels = new Set();
      for (const config of channelConfigs) {
        const { channel_id: channelId, league_id: leagueId } = config;
        
        // Skip if already posted to this channel
        if (postedChannels.has(channelId)) {
          continue;
        }

        // Check if this league has points for this adoption
        const leaguePoints = pointsByLeague[leagueId];

        try {
          const channel = await this.bot.channels.fetch(channelId);
          if (!channel) {
            console.error(`   ❌ Channel ${channelId} not found`);
            continue;
          }

          // Create adoption embed (league-specific)
          // Pass the full petToPost object so it includes discord_photo_url
          const embed = this.createAdoptionEmbed(petToPost, leaguePoints);
          await channel.send({ embeds: [embed] });

          postedChannels.add(channelId);
          console.log(`   ✅ Posted adoption: ${petToPost.name} (${petToPost.pet_code}) to channel ${channelId}`);

        } catch (error) {
          console.error(`   ❌ Error posting adoption to channel ${channelId}:`, error.message);
        }
      }

      // Mark as posted in database
      await this.db.markQueueItemPosted(petToPost.queue_id);
      await this.db.markPetAdoptedPosted(petToPost.pet_id);

      // Record timing
      this.state.recordAdoptionQueuePost();
      await this.state.save();

    } catch (error) {
      console.error(`   ❌ Error processing adoption queue:`, error.message);
    }
  }

  /**
   * Create embed for new pet message
   */
  createNewPetEmbed(pet, leagueName) {
    const daysInShelter = this.calculateDaysSince(pet.brought_to_shelter);

    const embed = new EmbedBuilder()
      .setColor('#2ecc71')
      .setTitle(`🐾 New Pet Arrival!`)
      .setDescription(`**${pet.name}** just arrived at the shelter!`)
      .addFields(
        { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
        { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
        { name: 'Gender', value: pet.gender || 'Unknown', inline: true },
        { name: 'Age', value: pet.age || 'Unknown', inline: true },
        { name: 'Days in Shelter', value: daysInShelter.toString(), inline: true },
        { name: 'ID', value: `[${pet.pet_code}](${pet.pet_url})`, inline: true },
        { name: 'League', value: leagueName, inline: true }
      )
      .setFooter({ text: 'Fresh arrival at the shelter - be the first to draft!' })
      .setTimestamp();

    // Add pet photo if available
    if (pet.photo_url && pet.photo_url !== 'https://24petconnect.com/Content/Images/No_pic_t.jpg') {
      embed.setImage(pet.photo_url);
      embed.setThumbnail(pet.photo_url);
    }

    return embed;
  }

  /**
   * Create embed for completed pet message
   * Shows when a pet just got all its info filled out (name + photo)
   */
  createCompletedPetEmbed(pet, leagueName) {
    const daysInShelter = this.calculateDaysSince(pet.brought_to_shelter);

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(`🆕 Pet Profile Complete!`)
      .setDescription(`**${pet.name}** just got all their info - now ready to draft!`)
      .addFields(
        { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
        { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
        { name: 'Gender', value: pet.gender || 'Unknown', inline: true },
        { name: 'Age', value: pet.age || 'Unknown', inline: true },
        { name: 'Days in Shelter', value: daysInShelter.toString(), inline: true },
        { name: 'ID', value: `[${pet.pet_code}](${pet.pet_url})`, inline: true },
        { name: 'League', value: leagueName, inline: true }
      )
      .setFooter({ text: 'Profile was waiting for photo/name - now you can draft!' })
      .setTimestamp();

    // Add pet photo if available
    if (pet.photo_url && pet.photo_url !== 'https://24petconnect.com/Content/Images/No_pic_t.jpg') {
      embed.setImage(pet.photo_url);
      embed.setThumbnail(pet.photo_url);
    }

    return embed;
  }

  /**
   * Create embed for adoption message
   * UPDATED: Uses discord_photo_url if available (cached), falls back to photo_url
   */
  createAdoptionEmbed(pet, leaguePoints) {
    const daysInShelter = this.calculateDaysSince(pet.brought_to_shelter);

    const embed = new EmbedBuilder()
      .setColor('#e74c3c')
      .setTitle(`🎉 Pet Adopted!`)
      .setDescription(`**${pet.name}** found their forever home!`)
      .addFields(
        { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
        { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
        { name: 'Days in Shelter', value: daysInShelter.toString(), inline: true },
        { name: 'ID', value: `[${pet.pet_code}](${pet.pet_url})`, inline: true }
      )
      .setTimestamp();

    // Add pet image - prefer cached Discord URL over original
    // This is critical because by adoption time, the shelter's photo_url will be dead/removed
    const photoUrl = pet.discord_photo_url || pet.photo_url;
    if (photoUrl && photoUrl !== 'https://24petconnect.com/Content/Images/No_pic_t.jpg') {
      embed.setImage(photoUrl);
    }

    // Add points section if there are points for this league
    if (leaguePoints && leaguePoints.points.length > 0) {
      const pointsText = leaguePoints.points
        .slice(0, 10)
        .map(p => `• **${p.first_name}** earned **${p.points_amount}** points`)
        .join('\n');

      embed.addFields({
        name: `🏆 Points Awarded in ${leaguePoints.leagueName}`,
        value: pointsText + (leaguePoints.points.length > 10 ? `\n... and ${leaguePoints.points.length - 10} more` : ''),
        inline: false
      });
    } else {
      embed.addFields({
        name: '📊 No one had drafted this pet',
        value: 'But it found a home! 🏡',
        inline: false
      });
    }

    return embed;
  }

  /**
   * Calculate days since a date
   */
  calculateDaysSince(date) {
    if (!date) return 0;
    const now = new Date();
    const then = new Date(date);
    const diff = now - then;
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    return await this.db.getQueueStats();
  }
}

module.exports = QueueManager;