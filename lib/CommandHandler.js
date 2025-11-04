// lib/CommandHandler.js - Discord command implementations
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
  async draftPet(message, args, leagueId) {
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

      // Get pet
      const pet = await this.db.getPetById(petId);
      if (!pet) {
        await message.reply(`❌ Pet with ID **${petId}** not found.`);
        return;
      }

      if (pet.status !== 'available') {
        await message.reply(`❌ **${pet.name}** is no longer available (status: ${pet.status}).`);
        return;
      }

      // Check if already drafted in this league
      const roster = await this.db.getUserRoster(user.id, leagueId);
      if (roster.some(r => r.pet_id === petId)) {
        await message.reply(`❌ You've already drafted **${pet.name}** in this league.`);
        return;
      }

      // Draft the pet
      await this.db.draftPet(user.id, leagueId, pet.id);

      const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('✅ Pet Drafted!')
        .setDescription(`**${pet.name}** has been added to your roster`)
        .addFields(
          { name: 'Pet ID', value: pet.pet_id, inline: true },
          { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
          { name: 'Type', value: pet.animal_type || 'Unknown', inline: true }
        )
        .setFooter({ text: 'You\'ll earn points if this pet gets adopted!' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error drafting pet:', error);
      await message.reply('❌ Error drafting pet. Please try again.');
    }
  }

  /**
   * Show user's roster
   */
  async showRoster(message, leagueId) {
    try {
      if (!leagueId) {
        await message.reply('❌ This channel is not configured for a league. Use `!setleague [name]` first.');
        return;
      }

      const discordId = message.author.id;
      
      // Get user
      let user = await this.db.getUserByDiscordId(discordId);
      if (!user) {
        await message.reply('❌ You haven\'t drafted any pets yet. Use `!addpet [pet_id]` to get started.');
        return;
      }

      const roster = await this.db.getUserRoster(user.id, leagueId);
      const league = await this.db.getLeagueById(leagueId);

      if (roster.length === 0) {
        await message.reply(`📋 Your roster in **${league.name}** is empty. Use \`!addpet [pet_id]\` to draft pets.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor('#9b59b6')
        .setTitle(`📋 Your Roster - ${league.name}`)
        .setDescription(`You have **${roster.length}** pet${roster.length !== 1 ? 's' : ''} drafted`)
        .setTimestamp();

      // Add pets to embed
      roster.forEach((pet, index) => {
        if (index < 25) { // Discord embed field limit
          const status = pet.status === 'available' ? '✅ Available' : '🏠 Adopted';
          const daysOnRoster = this.calculateDaysSince(pet.drafted_at);
          
          embed.addFields({
            name: `${index + 1}. ${pet.name} (${pet.pet_id})`,
            value: `${pet.breed || 'Unknown'} • ${pet.animal_type || 'Unknown'}\n${status} • On roster ${daysOnRoster} days`,
            inline: true
          });
        }
      });

      if (roster.length > 25) {
        embed.addFields({
          name: '\u200b',
          value: `... and ${roster.length - 25} more`
        });
      }

      await message.reply({ embeds: [embed] });
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
            name: `${pet.name} (${pet.pet_id})`,
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

        pets.forEach((pet, index) => {
          const daysInShelter = this.calculateDaysSince(pet.brought_to_shelter);
          embed.addFields({
            name: `${pet.name} (${pet.pet_id})`,
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