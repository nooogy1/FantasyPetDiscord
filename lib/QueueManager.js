// lib/QueueManager.js - Handles Discord queue broadcasting for pets
// UPDATED: Pet announcements include draft button + simplified single pet queue
const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

class QueueManager {
  constructor(bot, database, stateManager) {
    this.bot = bot;
    this.db = database;
    this.state = stateManager;
  }

  /**
   * Process pet queues for all channels (every 15 minutes per channel)
   * Only announces pets that have COMPLETE info (name + photo)
   */
  async processPetQueues(channelConfigs) {
    console.log('🎯 Processing pet queues...');
    
    for (const config of channelConfigs) {
      const { channel_id: channelId, league_id: leagueId, league_name: leagueName } = config;
      
      // Check if it's time to post for this channel
      if (!this.state.isTimeForPetQueuePost(channelId)) {
        const timeRemaining = this.state.getTimeUntilNextPetPost(channelId);
        console.log(`   ⏳ Channel ${channelId}: ${timeRemaining} min until next pet post`);
        continue;
      }

      const petToPost = await this.db.getNextPetToPost(channelId);
      
      if (!petToPost) {
        console.log(`   ℹ️ Channel ${channelId}: No pets in queue`);
        continue;
      }

      try {
        // Get Discord channel
        const channel = await this.bot.channels.fetch(channelId);
        if (!channel) {
          console.error(`   ❌ Channel ${channelId} not found`);
          continue;
        }

        // Check if pet is on any roster
        const draftQuery = `
          SELECT COUNT(*) as count
          FROM roster_entries re
          WHERE re.pet_id = $1
        `;
        const draftResult = await this.db.pool.query(draftQuery, [petToPost.pet_id]);
        const isOnRoster = draftResult.rows[0].count > 0;

        // Create pet embed with draft button if available
        const { embed, components } = this.createPetEmbedWithButton(petToPost, leagueName, isOnRoster, channelId);
        
        const sentMessage = await channel.send({ embeds: [embed], components });

        console.log(`   ✅ Posted pet: ${petToPost.name} (${petToPost.pet_code}) to ${leagueName}`);

        // Set up button collector if pet is not on roster
        if (!isOnRoster) {
          this.setupPetDraftCollector(sentMessage, petToPost, channelId, leagueId);
        }

        // Mark as posted
        await this.db.markQueueItemPosted(petToPost.queue_id);
        await this.db.markPetAvailablePosted(petToPost.pet_id);

        // Record timing
        this.state.recordPetQueuePost(channelId);
        await this.state.save();

      } catch (error) {
        console.error(`   ❌ Error posting pet to channel ${channelId}:`, error.message);
      }
    }
  }

  /**
   * Create pet embed with draft button if applicable
   */
  createPetEmbedWithButton(pet, leagueName, isOnRoster, channelId) {
    const daysInShelter = this.calculateDaysSince(pet.brought_to_shelter);

    const embed = new EmbedBuilder()
      .setColor('#2ecc71')
      .setTitle(`🐾 New Pet Available!`)
      .setDescription(`**${pet.name}** is ready to be drafted!`)
      .addFields(
        { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
        { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
        { name: 'Gender', value: pet.gender || 'Unknown', inline: true },
        { name: 'Age', value: pet.age || 'Unknown', inline: true },
        { name: 'Days in Shelter', value: daysInShelter.toString(), inline: true },
        { name: 'ID', value: `[${pet.pet_code}](${pet.pet_url})`, inline: true },
        { name: 'League', value: leagueName, inline: true }
      )
      .setFooter({ text: isOnRoster ? 'This pet is already on a roster' : 'Use the draft button or !addpet [pet_id] to draft' })
      .setTimestamp();

    // Add pet photo if available
    if (pet.photo_url && pet.photo_url !== 'https://24petconnect.com/Content/Images/No_pic_t.jpg') {
      embed.setImage(pet.photo_url);
      embed.setThumbnail(pet.photo_url);
    }

    // Create components
    let components = [];
    if (!isOnRoster) {
      // Pet is available - show active draft button
      const draftButton = new ButtonBuilder()
        .setCustomId(`pet_queue_draft_${pet.pet_id}_${channelId}`)
        .setLabel('🐾 Draft')
        .setStyle(ButtonStyle.Success);
      
      components = [new ActionRowBuilder().addComponents(draftButton)];
    } else {
      // Pet is on roster - show disabled button
      const disabledButton = new ButtonBuilder()
        .setCustomId('pet_already_drafted')
        .setLabel('Already on a Roster')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
      
      components = [new ActionRowBuilder().addComponents(disabledButton)];
    }

    return { embed, components };
  }

  /**
   * Set up button collector for pet draft button
   */
  setupPetDraftCollector(message, pet, channelId, leagueId) {
    const filter = (interaction) => interaction.customId === `pet_queue_draft_${pet.pet_id}_${channelId}`;
    const collector = message.createMessageComponentCollector({ filter, time: 600000 }); // 10 minutes

    collector.on('collect', async (interaction) => {
      try {
        // Get or create user
        let user = await this.db.getUserByDiscordId(interaction.user.id);
        if (!user) {
          user = await this.db.createUserWithDiscord(interaction.user.id, interaction.user.username);
        }

        // Get user's roster
        const roster = await this.db.getUserRoster(user.id, leagueId);
        const ROSTER_LIMIT = parseInt(process.env.ROSTER_LIMIT || '10');

        // Check roster limit
        if (roster.length >= ROSTER_LIMIT) {
          await interaction.reply({
            content: `❌ Your roster is full! You have **${roster.length}/${ROSTER_LIMIT}** pets.`,
            ephemeral: true
          });
          return;
        }

        // Check if already drafted
        if (roster.some(r => r.pet_id === pet.pet_code)) {
          await interaction.reply({
            content: `❌ You've already drafted **[${pet.name}](${pet.pet_url})** in this league.`,
            ephemeral: true
          });
          return;
        }

        // BACKEND VALIDATION: Check if ANYONE has drafted this pet
        const draftCheckQuery = `
          SELECT COUNT(*) as count
          FROM roster_entries re
          WHERE re.pet_id = $1
          AND re.league_id = $2
        `;
        const draftCheckResult = await this.db.pool.query(draftCheckQuery, [pet.pet_id, leagueId]);
        if (draftCheckResult.rows[0].count > 0) {
          await interaction.reply({
            content: `❌ **[${pet.name}](${pet.pet_url})** has already been drafted by someone else.`,
            ephemeral: true
          });
          return;
        }

        // Draft the pet
        await this.db.draftPet(user.id, leagueId, pet.pet_id);

        // Confirm to clicker
        const confirmEmbed = new EmbedBuilder()
          .setColor('#2ecc71')
          .setTitle('✅ Pet Drafted!')
          .setDescription(`**[${pet.name}](${pet.pet_url})** has been added to your roster`)
          .addFields(
            { name: 'Pet ID', value: `[${pet.pet_code}](${pet.pet_url})`, inline: true },
            { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
            { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
            { name: 'Roster', value: `${roster.length + 1}/${ROSTER_LIMIT}`, inline: true }
          )
          .setFooter({ text: 'You\'ll earn points when this pet gets adopted!' })
          .setTimestamp();

        if (pet.photo_url) {
          confirmEmbed.setImage(pet.photo_url);
        }

        await interaction.reply({ embeds: [confirmEmbed] });

        // Update message - grey out button for everyone
        const disabledButton = new ButtonBuilder()
          .setCustomId('pet_drafted')
          .setLabel('Already Drafted')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);

        const updatedComponents = [new ActionRowBuilder().addComponents(disabledButton)];

        const updatedEmbed = new EmbedBuilder()
          .setColor('#f39c12')
          .setTitle(`${pet.name}`)
          .setDescription(`📋 Already Drafted by ${interaction.user.username}`)
          .addFields(
            { name: 'ID', value: `[${pet.pet_code}](${pet.pet_url})`, inline: true },
            { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
            { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
            { name: 'Gender', value: pet.gender || 'Unknown', inline: true },
            { name: 'Age', value: pet.age || 'Unknown', inline: true },
            { name: 'Days in Shelter', value: String(this.calculateDaysSince(pet.brought_to_shelter)), inline: true }
          )
          .setTimestamp();

        if (pet.photo_url) {
          updatedEmbed.setImage(pet.photo_url);
        }

        await message.edit({ embeds: [updatedEmbed], components: updatedComponents });

        // Stop collector
        collector.stop();

      } catch (error) {
        console.error('Error in pet queue draft:', error);
        await interaction.reply({
          content: '❌ Error drafting pet. Please try again.',
          ephemeral: true
        });
      }
    });

    collector.on('end', async () => {
      try {
        const disabledButton = new ButtonBuilder()
          .setCustomId('pet_draft_expired')
          .setLabel('🐾 Draft')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true);

        const expiredComponents = [new ActionRowBuilder().addComponents(disabledButton)];
        await message.edit({ components: expiredComponents });
      } catch (e) {
        // Message might be deleted
      }
    });
  }

  /**
   * Process adoption queue (global, every 15 minutes)
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
   * Create embed for adoption message
   * Uses discord_photo_url if available (cached), falls back to photo_url
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