// lib/FilterHandler.js - Multi-step emoji filtering system for pets
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class FilterHandler {
  constructor(bot, database, rosterLimit = 10) {
    this.bot = bot;
    this.db = database;
    this.rosterLimit = rosterLimit;
    this.activeFilters = new Map(); // userId -> filter state
  }

  /**
   * Start the filtering process
   */
  async startFiltering(message, leagueId = null) {
    try {
      const userId = message.author.id;
      
      // Initialize filter state
      this.activeFilters.set(userId, {
        animalType: null,
        gender: null,
        ageGroup: null,
        daysInShelter: null,
        leagueId: leagueId,
        currentStep: 'animal_type',
        results: [],
        currentPage: 0
      });

      // Show step 1: Animal Type
      await this.showAnimalTypeStep(message, userId);
    } catch (error) {
      console.error('Error starting filtering:', error);
      await message.reply('❌ Error starting pet filter.');
    }
  }

  /**
   * Step 1: Animal Type Selection
   */
  async showAnimalTypeStep(message, userId) {
    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('🐾 Filter Pets - Step 1/4')
      .setDescription('**Select Animal Type**')
      .addFields(
        { name: '🐕 Dogs', value: 'React with 🐕', inline: false },
        { name: '🐈 Cats', value: 'React with 🐈', inline: false },
        { name: '✨ All Animals', value: 'React with ✨', inline: false }
      )
      .setFooter({ text: 'React to select an option' })
      .setTimestamp();

    const reply = await message.reply({ embeds: [embed], fetchReply: true });

    // Add emoji reactions
    await reply.react('🐕');
    await reply.react('🐈');
    await reply.react('✨');

    // Set up collector
    const filter = (reaction, user) => {
      return user.id === userId && ['🐕', '🐈', '✨'].includes(reaction.emoji.toString());
    };

    const collector = reply.createReactionCollector({ filter, time: 300000, max: 1 });

    collector.on('collect', async (reaction) => {
      const filterData = this.activeFilters.get(userId);
      const emoji = reaction.emoji.toString();
      
      if (emoji === '🐕') {
        filterData.animalType = 'Dog';
      } else if (emoji === '🐈') {
        filterData.animalType = 'Cat';
      } else if (emoji === '✨') {
        filterData.animalType = null; // All animals
      }

      filterData.currentStep = 'gender';
      await this.showGenderStep(message, userId);
      
      // Clean up old message
      try {
        await reply.delete();
      } catch (e) {
        // Message might be deleted already
      }
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        message.reply('⏰ Filter selection timed out.').catch(() => {});
      }
    });
  }

  /**
   * Step 2: Gender Selection
   */
  async showGenderStep(message, userId) {
    const filterData = this.activeFilters.get(userId);
    
    const embed = new EmbedBuilder()
      .setColor('#9b59b6')
      .setTitle('🐾 Filter Pets - Step 2/4')
      .setDescription('**Select Gender**')
      .addFields(
        { name: '♂️ Male', value: 'React with ♂️', inline: false },
        { name: '♀️ Female', value: 'React with ♀️', inline: false },
        { name: '🔵 Spayed Female', value: 'React with 🔵', inline: false },
        { name: '🟢 Neutered Male', value: 'React with 🟢', inline: false },
        { name: '✨ All Genders', value: 'React with ✨', inline: false }
      )
      .addFields({ name: '\u200b', value: `Animal Type: **${filterData.animalType || 'All'}**` })
      .setFooter({ text: 'React to select an option' })
      .setTimestamp();

    const reply = await message.reply({ embeds: [embed], fetchReply: true });

    // Add emoji reactions
    await reply.react('♂️');
    await reply.react('♀️');
    await reply.react('🔵');
    await reply.react('🟢');
    await reply.react('✨');

    // Set up collector
    const reactionFilter = (reaction, user) => {
      return user.id === userId && ['♂️', '♀️', '🔵', '🟢', '✨'].includes(reaction.emoji.toString());
    };

    const collector = reply.createReactionCollector({ filter: reactionFilter, time: 300000, max: 1 });

    collector.on('collect', async (reaction) => {
      const fData = this.activeFilters.get(userId);
      const emoji = reaction.emoji.toString();
      
      if (emoji === '♂️') {
        fData.gender = 'Male';
      } else if (emoji === '♀️') {
        fData.gender = 'Female';
      } else if (emoji === '🔵') {
        fData.gender = 'Spayed Female';
      } else if (emoji === '🟢') {
        fData.gender = 'Neutered Male';
      } else if (emoji === '✨') {
        fData.gender = null; // All genders
      }

      fData.currentStep = 'age_group';
      await this.showAgeGroupStep(message, userId);
      
      try {
        await reply.delete();
      } catch (e) {}
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        message.reply('⏰ Filter selection timed out.').catch(() => {});
      }
    });
  }

  /**
   * Step 3: Age Group Selection
   */
  async showAgeGroupStep(message, userId) {
    const filterData = this.activeFilters.get(userId);
    
    const embed = new EmbedBuilder()
      .setColor('#e67e22')
      .setTitle('🐾 Filter Pets - Step 3/4')
      .setDescription('**Select Age Group**')
      .addFields(
        { name: '👶 Puppy/Kitten', value: 'React with 👶 (<1 year)', inline: false },
        { name: '🧒 Young', value: 'React with 🧒 (1-3 years)', inline: false },
        { name: '👨 Adult', value: 'React with 👨 (3-7 years)', inline: false },
        { name: '👴 Senior', value: 'React with 👴 (7+ years)', inline: false },
        { name: '✨ All Ages', value: 'React with ✨', inline: false }
      )
      .addFields(
        { name: '\u200b', value: `Animal Type: **${filterData.animalType || 'All'}** • Gender: **${filterData.gender || 'All'}**` }
      )
      .setFooter({ text: 'React to select an option' })
      .setTimestamp();

    const reply = await message.reply({ embeds: [embed], fetchReply: true });

    // Add emoji reactions
    await reply.react('👶');
    await reply.react('🧒');
    await reply.react('👨');
    await reply.react('👴');
    await reply.react('✨');

    // Set up collector
    const reactionFilter = (reaction, user) => {
      return user.id === userId && ['👶', '🧒', '👨', '👴', '✨'].includes(reaction.emoji.toString());
    };

    const collector = reply.createReactionCollector({ filter: reactionFilter, time: 300000, max: 1 });

    collector.on('collect', async (reaction) => {
      const fData = this.activeFilters.get(userId);
      const emoji = reaction.emoji.toString();
      
      if (emoji === '👶') {
        fData.ageGroup = 'puppy';
      } else if (emoji === '🧒') {
        fData.ageGroup = 'young';
      } else if (emoji === '👨') {
        fData.ageGroup = 'adult';
      } else if (emoji === '👴') {
        fData.ageGroup = 'senior';
      } else if (emoji === '✨') {
        fData.ageGroup = null; // All ages
      }

      fData.currentStep = 'days_in_shelter';
      await this.showDaysInShelterStep(message, userId);
      
      try {
        await reply.delete();
      } catch (e) {}
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        message.reply('⏰ Filter selection timed out.').catch(() => {});
      }
    });
  }

  /**
   * Step 4: Days in Shelter Selection
   */
  async showDaysInShelterStep(message, userId) {
    const filterData = this.activeFilters.get(userId);
    
    const embed = new EmbedBuilder()
      .setColor('#27ae60')
      .setTitle('🐾 Filter Pets - Step 4/4')
      .setDescription('**Select Days in Shelter**')
      .addFields(
        { name: '🔴 Recent', value: 'React with 🔴 (0-4 days)', inline: false },
        { name: '🟠 Moderate', value: 'React with 🟠 (4-8 days)', inline: false },
        { name: '🟡 Long', value: 'React with 🟡 (8-14 days)', inline: false },
        { name: '🔵 Very Long', value: 'React with 🔵 (14+ days)', inline: false },
        { name: '✨ All', value: 'React with ✨', inline: false }
      )
      .addFields(
        { name: '\u200b', value: `Animal: **${filterData.animalType || 'All'}** • Gender: **${filterData.gender || 'All'}** • Age: **${filterData.ageGroup ? this.formatAgeGroup(filterData.ageGroup) : 'All'}**` }
      )
      .setFooter({ text: 'React to select an option' })
      .setTimestamp();

    const reply = await message.reply({ embeds: [embed], fetchReply: true });

    // Add emoji reactions
    await reply.react('🔴');
    await reply.react('🟠');
    await reply.react('🟡');
    await reply.react('🔵');
    await reply.react('✨');

    // Set up collector
    const reactionFilter = (reaction, user) => {
      return user.id === userId && ['🔴', '🟠', '🟡', '🔵', '✨'].includes(reaction.emoji.toString());
    };

    const collector = reply.createReactionCollector({ filter: reactionFilter, time: 300000, max: 1 });

    collector.on('collect', async (reaction) => {
      const fData = this.activeFilters.get(userId);
      const emoji = reaction.emoji.toString();
      
      if (emoji === '🔴') {
        fData.daysInShelter = { min: 0, max: 4 };
      } else if (emoji === '🟠') {
        fData.daysInShelter = { min: 4, max: 8 };
      } else if (emoji === '🟡') {
        fData.daysInShelter = { min: 8, max: 14 };
      } else if (emoji === '🔵') {
        fData.daysInShelter = { min: 14, max: 999 };
      } else if (emoji === '✨') {
        fData.daysInShelter = null; // All days
      }

      // Now apply filters and show results
      await this.applyFiltersAndShowResults(message, userId);
      
      try {
        await reply.delete();
      } catch (e) {}
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        message.reply('⏰ Filter selection timed out.').catch(() => {});
      }
    });
  }

  /**
   * Apply filters to pets and show carousel
   */
  async applyFiltersAndShowResults(message, userId) {
    try {
      const filterData = this.activeFilters.get(userId);
      
      // Query pets with filters
      const pets = await this.getPetsWithFilters(filterData);
      
      if (pets.length === 0) {
        await message.reply('❌ No pets match your filters. Try adjusting them!');
        this.activeFilters.delete(userId);
        return;
      }

      filterData.results = pets;
      filterData.currentPage = 0;

      // Show first pet in carousel
      await this.showPetCarousel(message, userId);
    } catch (error) {
      console.error('Error applying filters:', error);
      await message.reply('❌ Error filtering pets.');
    }
  }

  /**
   * Query database with applied filters
   */
  async getPetsWithFilters(filterData) {
    let query = `
      SELECT 
        p.id,
        p.pet_id,
        p.name,
        p.breed,
        p.animal_type,
        p.gender,
        p.age,
        p.photo_url,
        p.status,
        p.brought_to_shelter,
        (CURRENT_DATE - p.brought_to_shelter::date) as days_in_shelter
      FROM pets p
      WHERE p.status = 'available'
    `;

    const params = [];
    let paramCount = 1;

    // Animal type filter
    if (filterData.animalType) {
      query += ` AND p.animal_type = $${paramCount}`;
      params.push(filterData.animalType);
      paramCount++;
    }

    // Gender filter
    if (filterData.gender) {
      query += ` AND p.gender = $${paramCount}`;
      params.push(filterData.gender);
      paramCount++;
    }

    // Age group filter
    if (filterData.ageGroup) {
      query += ` AND (
        CASE
          WHEN $${paramCount} = 'puppy' THEN EXTRACT(YEAR FROM age(NOW(), p.brought_to_shelter)) < 1
          WHEN $${paramCount} = 'young' THEN EXTRACT(YEAR FROM age(NOW(), p.brought_to_shelter)) >= 1 AND EXTRACT(YEAR FROM age(NOW(), p.brought_to_shelter)) < 3
          WHEN $${paramCount} = 'adult' THEN EXTRACT(YEAR FROM age(NOW(), p.brought_to_shelter)) >= 3 AND EXTRACT(YEAR FROM age(NOW(), p.brought_to_shelter)) < 7
          WHEN $${paramCount} = 'senior' THEN EXTRACT(YEAR FROM age(NOW(), p.brought_to_shelter)) >= 7
        END
      )`;
      params.push(filterData.ageGroup);
      paramCount++;
    }

    // Days in shelter filter
    if (filterData.daysInShelter) {
      query += ` AND (CURRENT_DATE - p.brought_to_shelter::date) BETWEEN $${paramCount} AND $${paramCount + 1}`;
      params.push(filterData.daysInShelter.min);
      params.push(filterData.daysInShelter.max);
      paramCount += 2;
    }

    // Exclude league pets if leagueId provided
    if (filterData.leagueId) {
      query += ` AND p.id NOT IN (
        SELECT pet_id FROM roster_entries WHERE league_id = $${paramCount}
      )`;
      params.push(filterData.leagueId);
      paramCount++;
    }

    query += ` ORDER BY p.first_seen DESC LIMIT 100`;

    const result = await this.db.pool.query(query, params);
    return result.rows;
  }

  /**
   * Show pet carousel
   */
  async showPetCarousel(message, userId) {
    const filterData = this.activeFilters.get(userId);
    const pet = filterData.results[filterData.currentPage];

    if (!pet) {
      await message.reply('❌ No more pets to display.');
      return;
    }

    const daysInShelter = this.calculateDaysSince(pet.brought_to_shelter);
    const statusEmoji = pet.status === 'available' ? '✅' : '🏠';

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(`${pet.name} (${pet.pet_id})`)
      .setDescription(`${statusEmoji} ${pet.status === 'available' ? 'Available' : 'Adopted'}`)
      .addFields(
        { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
        { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
        { name: 'Gender', value: pet.gender || 'Unknown', inline: true },
        { name: 'Age', value: pet.age || 'Unknown', inline: true },
        { name: 'Days in Shelter', value: daysInShelter.toString(), inline: true },
        { name: 'ID', value: pet.pet_id, inline: true }
      )
      .setFooter({ text: `Pet ${filterData.currentPage + 1} of ${filterData.results.length}` })
      .setTimestamp();

    // Add pet photo if available
    if (pet.photo_url) {
      embed.setImage(pet.photo_url);
    }

    // Create buttons
    const prevButton = new ButtonBuilder()
      .setCustomId(`pet_prev_${userId}`)
      .setLabel('⬅️ Previous')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(filterData.currentPage === 0);

    const adoptButton = new ButtonBuilder()
      .setCustomId(`pet_adopt_${userId}_${pet.pet_id}`)
      .setLabel('🐾 Adopt')
      .setStyle(ButtonStyle.Success);

    const nextButton = new ButtonBuilder()
      .setCustomId(`pet_next_${userId}`)
      .setLabel('Next ➡️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(filterData.currentPage === filterData.results.length - 1);

    const row = new ActionRowBuilder().addComponents(prevButton, adoptButton, nextButton);

    // Send or update message
    if (!filterData.carouselMessage) {
      filterData.carouselMessage = await message.reply({
        embeds: [embed],
        components: [row],
        fetchReply: true
      });
      
      // Set up button collector
      this.setupCarouselCollector(message, userId, filterData.carouselMessage);
    } else {
      await filterData.carouselMessage.edit({
        embeds: [embed],
        components: [row]
      });
    }
  }

  /**
   * Set up button collector for carousel navigation
   */
  setupCarouselCollector(message, userId, carouselMessage) {
    const filterData = this.activeFilters.get(userId);
    
    const filter = (interaction) => {
      return interaction.user.id === userId &&
             (interaction.customId.startsWith('pet_prev_') ||
              interaction.customId.startsWith('pet_next_') ||
              interaction.customId.startsWith('pet_adopt_'));
    };

    const collector = carouselMessage.createMessageComponentCollector({
      filter,
      time: 600000 // 10 minutes
    });

    collector.on('collect', async (interaction) => {
      if (interaction.customId === `pet_prev_${userId}`) {
        filterData.currentPage = Math.max(0, filterData.currentPage - 1);
        await interaction.deferUpdate();
        await this.showPetCarousel(message, userId);
      } else if (interaction.customId === `pet_next_${userId}`) {
        filterData.currentPage = Math.min(
          filterData.results.length - 1,
          filterData.currentPage + 1
        );
        await interaction.deferUpdate();
        await this.showPetCarousel(message, userId);
      } else if (interaction.customId.startsWith('pet_adopt_')) {
        const petId = interaction.customId.split('_')[3];
        await this.handleAdoptFlow(interaction, userId, petId);
      }
    });

    collector.on('end', async () => {
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('pet_prev_disabled')
            .setLabel('⬅️ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('pet_adopt_disabled')
            .setLabel('🐾 Adopt')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('pet_next_disabled')
            .setLabel('Next ➡️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
        );
        
        await carouselMessage.edit({ components: [disabledRow] });
      } catch (e) {
        // Message might be deleted
      }
    });
  }

  /**
   * Handle adopt button flow
   */
  async handleAdoptFlow(interaction, userId, petId) {
    try {
      const filterData = this.activeFilters.get(userId);

      if (!filterData.leagueId) {
        await interaction.reply({
          content: '❌ This channel is not configured for a league. Use `!setleague [name]` first.',
          ephemeral: true
        });
        return;
      }

      // Get or create user
      let user = await this.db.getUserByDiscordId(userId);
      if (!user) {
        user = await this.db.createUserWithDiscord(userId, interaction.user.username);
      }

      // Check roster limit first
      const roster = await this.db.getUserRoster(user.id, filterData.leagueId);
      if (roster.length >= this.rosterLimit) {
        await interaction.reply({
          content: `❌ Your roster is full! You have **${roster.length}/${this.rosterLimit}** pets.\nYou must remove a pet before drafting another one.`,
          ephemeral: true
        });
        return;
      }

      // Get pet details
      const pet = await this.db.getPetById(petId);
      if (!pet) {
        await interaction.reply({
          content: '❌ Pet not found.',
          ephemeral: true
        });
        return;
      }

      if (pet.status !== 'available') {
        await interaction.reply({
          content: `❌ **${pet.name}** is no longer available.`,
          ephemeral: true
        });
        return;
      }

      // Check if already drafted in this league
      if (roster.some(r => r.pet_id === petId)) {
        await interaction.reply({
          content: `❌ You've already drafted **${pet.name}** in this league.`,
          ephemeral: true
        });
        return;
      }

      // Draft the pet
      await this.db.draftPet(user.id, filterData.leagueId, pet.id);

      const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('✅ Pet Adopted!')
        .setDescription(`**${pet.name}** has been added to your roster`)
        .addFields(
          { name: 'Pet ID', value: pet.pet_id, inline: true },
          { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
          { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
          { name: 'Roster', value: `${roster.length + 1}/${this.rosterLimit}`, inline: true }
        )
        .setFooter({ text: 'You\'ll earn points if this pet gets adopted!' })
        .setTimestamp();

      if (pet.photo_url) {
        embed.setImage(pet.photo_url);
      }

      await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });

      // Move to next pet in carousel
      const filterData2 = this.activeFilters.get(userId);
      filterData2.currentPage = Math.min(
        filterData2.results.length - 1,
        filterData2.currentPage + 1
      );
      
      // Refresh carousel message
      if (filterData2.carouselMessage) {
        await this.showPetCarousel(interaction.message, userId);
      }
    } catch (error) {
      console.error('Error in adopt flow:', error);
      await interaction.reply({
        content: '❌ Error adopting pet. Please try again.',
        ephemeral: true
      });
    }
  }

  /**
   * Utility: Format age group for display
   */
  formatAgeGroup(ageGroup) {
    const map = {
      'puppy': 'Puppy/Kitten',
      'young': 'Young',
      'adult': 'Adult',
      'senior': 'Senior'
    };
    return map[ageGroup] || ageGroup;
  }

  /**
   * Utility: Calculate days since date
   */
  calculateDaysSince(date) {
    if (!date) return 0;
    const now = new Date();
    const then = new Date(date);
    const diff = now - then;
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }
}

module.exports = FilterHandler;