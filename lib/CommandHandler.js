// lib/CommandHandler.js - Discord command implementations (UPDATED)
// Added support for viewing other users' rosters with @mention
const { EmbedBuilder } = require('discord.js');

class CommandHandler {
  constructor(bot, database) {
    this.bot = bot;
    this.db = database;
  }

  /**
   * Show leaderboard for a league
   */
  async showLeaderboard(message, leagueId) {
    try {
      if (!leagueId) {
        await message.reply('❌ This channel is not configured for a league. Use `!setleague [name]` first.');
        return;
      }

      const leaderboard = await this.db.getLeaderboard(leagueId, 10);
      const league = await this.db.getLeagueById(leagueId);

      if (leaderboard.length === 0) {
        await message.reply(`📊 No players have scored points in **${league.name}** yet.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor('#f39c12')
        .setTitle(`🏆 Leaderboard - ${league.name}`)
        .setTimestamp();

      // Add top 10 players
      const leaderboardText = leaderboard.map((entry, index) => {
        let medal = '';
        if (index === 0) medal = '🥇';
        else if (index === 1) medal = '🥈';
        else if (index === 2) medal = '🥉';

        const city = entry.city ? ` (${entry.city})` : '';
        return `${medal} **#${entry.rank}** ${entry.first_name}${city} - **${entry.total_points}** pts`;
      }).join('\n');

      embed.setDescription(leaderboardText);

      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error showing leaderboard:', error);
      await message.reply('❌ Error loading leaderboard.');
    }
  }

  /**
   * Draft a pet to user's roster
   */
  async draftPet(message, args, leagueId, rosterLimit = 10) {
    try {
      if (!leagueId) {
        await message.reply('❌ This channel is not configured for a league. Use `!setleague [name]` first.');
        return;
      }

      if (args.length === 0) {
        await message.reply('Usage: `!addpet [pet_id]`\nExample: `!addpet A2043899`');
        return;
      }

      const petId = args[0].toUpperCase();
      const discordId = message.author.id;
      const discordUsername = message.author.username;

      // Get or create user
      let user = await this.db.getUserByDiscordId(discordId);
      if (!user) {
        user = await this.db.createUserWithDiscord(discordId, discordUsername);
        console.log(`Created new user for Discord user ${discordUsername}`);
      }

      // Check roster limit first
      const roster = await this.db.getUserRoster(user.id, leagueId);
      if (roster.length >= rosterLimit) {
        await message.reply(
          `❌ Your roster is full! You have **${roster.length}/${rosterLimit}** pets.\n` +
          `You must remove a pet before drafting another one.`
        );
        return;
      }

      // Get pet
      const pet = await this.db.getPetById(petId);
      if (!pet) {
        await message.reply(`❌ Pet with ID **${petId}** not found.`);
        return;
      }

      if (pet.status !== 'available') {
        await message.reply(`❌ **[${pet.name}](${pet.pet_url})** is no longer available (status: ${pet.status}).`);
        return;
      }

      // Check if already drafted in this league
      if (roster.some(r => r.pet_id === petId)) {
        await message.reply(`❌ You've already drafted **[${pet.name}](${pet.pet_url})** in this league.`);
        return;
      }

      // Draft the pet
      await this.db.draftPet(user.id, leagueId, pet.id);

      const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('✅ Pet Drafted!')
        .setDescription(`**[${pet.name}](${pet.pet_url})** has been added to your roster`)
        .addFields(
          { name: 'Pet ID', value: `[${pet.pet_id}](${pet.pet_url})`, inline: true },
          { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
          { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
          { name: 'Roster', value: `${roster.length + 1}/${rosterLimit}`, inline: true }
        )
        .setFooter({ text: 'You\'ll earn points if this pet gets adopted!' })
        .setTimestamp();

      // Add pet image if available
      if (pet.photo_url) {
        embed.setImage(pet.photo_url);
      }

      // Send confirmation to user
      await message.reply({ embeds: [embed] });

      // Also broadcast pet card to channel
      const petCard = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle(`✅ Pet Drafted: [${pet.name}](${pet.pet_url})`)
        .setDescription(`**${message.author.username}** drafted **[${pet.name}](${pet.pet_url})**`)
        .addFields(
          { name: 'Pet ID', value: `[${pet.pet_id}](${pet.pet_url})`, inline: true },
          { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
          { name: 'Type', value: pet.animal_type || 'Unknown', inline: true }
        )
        .setTimestamp();

      if (pet.photo_url) {
        petCard.setImage(pet.photo_url);
      }

      await message.channel.send({ embeds: [petCard] });
    } catch (error) {
      console.error('Error drafting pet:', error);
      await message.reply('❌ Error drafting pet. Please try again.');
    }
  }

  /**
   * Show user's roster with carousel navigation
   * Can view own roster or another user's roster if mentioned
   */
  async showRoster(message, leagueId, targetUser = null) {
    try {
      if (!leagueId) {
        await message.reply('❌ This channel is not configured for a league. Use `!setleague [name]` first.');
        return;
      }

      let discordId;
      let viewingOther = false;
      let targetUsername = '';
      
      // Determine whose roster to view
      if (targetUser) {
        discordId = targetUser.id;
        targetUsername = targetUser.username;
        viewingOther = true;
      } else {
        discordId = message.author.id;
        targetUsername = message.author.username;
      }
      
      // Get user
      let user = await this.db.getUserByDiscordId(discordId);
      if (!user) {
        if (viewingOther) {
          await message.reply(`❌ User **${targetUsername}** hasn't drafted any pets yet.`);
        } else {
          await message.reply('❌ You haven\'t drafted any pets yet. Use `!addpet [pet_id]` to get started.');
        }
        return;
      }

      const roster = await this.db.getUserRoster(user.id, leagueId);
      const league = await this.db.getLeagueById(leagueId);

      if (roster.length === 0) {
        if (viewingOther) {
          await message.reply(`📋 **${targetUsername}**'s roster in **${league.name}** is empty.`);
        } else {
          await message.reply(`📋 Your roster in **${league.name}** is empty. Use \`!addpet [pet_id]\` to draft pets.`);
        }
        return;
      }

      // Start at first pet
      let currentIndex = 0;

      // Function to create embed for current pet
      const createPetEmbed = (index) => {
        const pet = roster[index];
        const status = pet.status === 'available' ? '✅ Available' : '🏠 Adopted';
        const daysOnRoster = this.calculateDaysSince(pet.drafted_at);
        
        const titleSuffix = viewingOther ? ` - ${targetUsername}'s Roster` : '';

        const embed = new EmbedBuilder()
          .setColor('#9b59b6')
          .setTitle(`📋 ${league.name}${titleSuffix}`)
          .setDescription(`Showing: **${index + 1}** of **${roster.length}**`)
          .addFields({
            name: `[${pet.name}](${pet.pet_url}) ([${pet.pet_id}](${pet.pet_url}))`,
            value: `**Breed:** ${pet.breed || 'Unknown'}\n**Type:** ${pet.animal_type || 'Unknown'}\n**Status:** ${status}\n**On roster:** ${daysOnRoster} days`,
            inline: false
          })
          .setTimestamp();

        // Add image if available
        if (pet.photo_url) {
          embed.setImage(pet.photo_url);
        }

        return embed;
      };

      // Create buttons
      const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

      const createButtons = (index) => {
        const prevButton = new ButtonBuilder()
          .setCustomId(`roster_prev_${user.id}`)
          .setLabel('⬅️ Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(index === 0);

        const nextButton = new ButtonBuilder()
          .setCustomId(`roster_next_${user.id}`)
          .setLabel('Next ➡️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(index === roster.length - 1);

        return new ActionRowBuilder().addComponents(prevButton, nextButton);
      };

      // Send initial embed with buttons
      const reply = await message.reply({
        embeds: [createPetEmbed(currentIndex)],
        components: [createButtons(currentIndex)],
        fetchReply: true
      });

      // Set up button collector
      const filter = (interaction) => {
        return interaction.user.id === message.author.id && 
               (interaction.customId === `roster_prev_${user.id}` || interaction.customId === `roster_next_${user.id}`);
      };

      const collector = reply.createMessageComponentCollector({ filter, time: 300000 }); // 5 minute timeout

      collector.on('collect', async (interaction) => {
        if (interaction.customId === `roster_next_${user.id}`) {
          currentIndex = Math.min(currentIndex + 1, roster.length - 1);
        } else if (interaction.customId === `roster_prev_${user.id}`) {
          currentIndex = Math.max(currentIndex - 1, 0);
        }

        await interaction.update({
          embeds: [createPetEmbed(currentIndex)],
          components: [createButtons(currentIndex)]
        });
      });

      collector.on('end', async () => {
        // Disable buttons when timeout
        const disabledButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('roster_prev_disabled')
            .setLabel('⬅️ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('roster_next_disabled')
            .setLabel('Next ➡️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
        );

        try {
          await reply.edit({ components: [disabledButtons] });
        } catch (e) {
          // Message might be deleted, ignore
        }
      });

    } catch (error) {
      console.error('Error showing roster:', error);
      await message.reply('❌ Error loading roster.');
    }
  }

  /**
   * Show available pets
   */
  async showAvailablePets(message, leagueId) {
    try {
      if (!leagueId) {
        // Show general available pets
        const pets = await this.db.getAvailablePets(10);
        
        if (pets.length === 0) {
          await message.reply('📋 No pets are currently available.');
          return;
        }

        const embed = new EmbedBuilder()
          .setColor('#3498db')
          .setTitle('🐾 Available Pets')
          .setDescription(`Showing ${pets.length} available pets`)
          .setTimestamp();

        pets.forEach((pet, index) => {
          const daysInShelter = this.calculateDaysSince(pet.brought_to_shelter);
          embed.addFields({
            name: `[${pet.name}](${pet.pet_url}) ([${pet.pet_id}](${pet.pet_url}))`,
            value: `${pet.breed || 'Unknown'} • ${pet.animal_type || 'Unknown'}\n${pet.age || 'Age unknown'} • ${daysInShelter} days in shelter`,
            inline: true
          });
        });

        await message.reply({ embeds: [embed] });
      } else {
        // Show pets available for drafting in this league
        const pets = await this.db.getAvailablePetsForLeague(leagueId, 10);
        const league = await this.db.getLeagueById(leagueId);

        if (pets.length === 0) {
          await message.reply(`📋 No undrafted pets available in **${league.name}**.`);
          return;
        }

        const embed = new EmbedBuilder()
          .setColor('#3498db')
          .setTitle(`🐾 Available Pets - ${league.name}`)
          .setDescription(`Showing ${pets.length} undrafted pets`)
          .setFooter({ text: 'Use !addpet [pet_id] to draft a pet' })
          .setTimestamp();

        // Add thumbnail of first pet if available
        if (pets.length > 0 && pets[0].photo_url) {
          embed.setThumbnail(pets[0].photo_url);
        }

        pets.forEach((pet, index) => {
          const daysInShelter = this.calculateDaysSince(pet.brought_to_shelter);
          embed.addFields({
            name: `[${pet.name}](${pet.pet_url}) ([${pet.pet_id}](${pet.pet_url}))`,
            value: `${pet.breed || 'Unknown'} • ${pet.animal_type || 'Unknown'}\n${pet.age || 'Age unknown'} • ${daysInShelter} days in shelter`,
            inline: true
          });
        });

        await message.reply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Error showing available pets:', error);
      await message.reply('❌ Error loading available pets.');
    }
  }

  /**
   * Show statistics
   */
  async showStats(message) {
    try {
      const stats = await this.db.getStats();

      const embed = new EmbedBuilder()
        .setColor('#e67e22')
        .setTitle('📊 Fantasy Pet League Statistics')
        .addFields(
          { name: '🐕 Available Pets', value: stats.available_pets.toString(), inline: true },
          { name: '🏠 Adopted Pets', value: stats.adopted_pets.toString(), inline: true },
          { name: '👥 Total Players', value: stats.total_users.toString(), inline: true },
          { name: '🏆 Total Leagues', value: stats.total_leagues.toString(), inline: true },
          { name: '💰 Points Awarded', value: stats.total_points_awarded.toString(), inline: true },
          { name: '📋 Pets Drafted', value: stats.total_drafted.toString(), inline: true }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error showing stats:', error);
      await message.reply('❌ Error loading statistics.');
    }
  }

  /**
   * Show point history for user
   */
  async showPointHistory(message, leagueId) {
    try {
      if (!leagueId) {
        await message.reply('❌ This channel is not configured for a league. Use `!setleague [name]` first.');
        return;
      }

      const discordId = message.author.id;
      
      // Get user
      let user = await this.db.getUserByDiscordId(discordId);
      if (!user) {
        await message.reply('❌ You haven\'t earned any points yet. Use `!addpet [pet_id]` to start drafting!');
        return;
      }

      // Get league info
      const league = await this.db.getLeagueById(leagueId);

      // Get point history for this user in this league
      const history = await this.db.getPointHistory(user.id, leagueId, 25);

      if (history.length === 0) {
        await message.reply(`📊 You haven't earned any points in **${league.name}** yet.`);
        return;
      }

      // Calculate total points
      const totalPoints = history.reduce((sum, entry) => sum + entry.points_amount, 0);

      const embed = new EmbedBuilder()
        .setColor('#f39c12')
        .setTitle(`🏆 Your Points - ${league.name}`)
        .setDescription(`Total: **${totalPoints}** points from **${history.length}** adopted pet${history.length !== 1 ? 's' : ''}`)
        .setTimestamp();

      // Add each pet that earned points
      history.forEach((entry, index) => {
        const awardedDate = new Date(entry.awarded_at).toLocaleDateString();
        embed.addFields({
          name: `${index + 1}. [${entry.pet_name}](${entry.pet_url}) (${entry.breed})`,
          value: `**${entry.points_amount}** points • Adopted: ${awardedDate}`,
          inline: false
        });
      });

      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error showing point history:', error);
      await message.reply('❌ Error loading point history.');
    }
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
}

module.exports = CommandHandler;