// bot.js - Fantasy Pet League Discord Bot & Points Manager (UPDATED v2)
// This bot runs 24/7, checks for adopted pets hourly, and awards points
// UPDATED: Auto-displays pet cards for A2XXXXXX mentions
// UPDATED: Shows leaderboard after adoptions

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const PointsManager = require('./lib/PointsManager');
const Database = require('./lib/Database');
const StateManager = require('./lib/StateManager');
const CommandHandler = require('./lib/CommandHandler');
const FilterHandler = require('./lib/FilterHandler');
require('dotenv').config();

// ============ CONFIGURATION ============

const CHECK_INTERVAL = process.env.CHECK_INTERVAL || 60; // minutes
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DEFAULT_NOTIFICATION_CHANNEL = process.env.DEFAULT_CHANNEL_ID;
const ROSTER_LIMIT = parseInt(process.env.ROSTER_LIMIT || '10'); // max pets per roster

// ============ INITIALIZATION ============

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const db = new Database();
const state = new StateManager();
const points = new PointsManager(db, state);
const commands = new CommandHandler(bot, db);
const filter = new FilterHandler(bot, db, ROSTER_LIMIT);

// Channel configurations (which leagues to track per channel)
const channelConfigs = new Map(); // channelId -> { leagueId, leagueName }

// ============ BOT EVENTS ============

bot.on('clientReady', async () => {
  console.log(`✅ Bot logged in as ${bot.user.tag}`);
  console.log(`⏰ Check interval: ${CHECK_INTERVAL} minutes`);
  
  // Set bot status
  bot.user.setActivity('pets get adopted 🐾', { type: 'WATCHING' });
  
  // Initialize database connection
  await db.connect();
  console.log('✅ Database connected');
  
  // Load saved state
  await state.load();
  console.log('✅ State loaded');
  
  // Load channel configurations
  await loadChannelConfigs();
  
  // Start the hourly check cycle
  startCheckCycle();
  
  // Run initial check after 10 seconds
  setTimeout(runCheck, 10000);
});

bot.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // ============ PET ID LOOKUP FEATURE ============
  // Check for pet ID mentions (A1XXXXXX or A2XXXXXX format) anywhere in the message
  const petIdRegex = /A[12]\d{6}/g;
  const petIds = message.content.match(petIdRegex);
  
  if (petIds) {
    // Remove duplicates
    const uniquePetIds = [...new Set(petIds)];
    
    for (const petId of uniquePetIds) {
      try {
        console.log(`🔍 Pet lookup: ${petId}`);
        const pet = await db.getPetById(petId);
        
        if (pet) {
          console.log(`✅ Found pet: ${pet.name} (${petId})`);
          // Calculate days on roster
          let daysOnRoster = 'N/A';
          if (pet.brought_to_shelter) {
            const now = new Date();
            const brought = new Date(pet.brought_to_shelter);
            const diff = now - brought;
            daysOnRoster = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
          }
          
          // Determine status emoji
          const statusEmoji = pet.status === 'available' ? '✅' : '🏠';
          
          // Create pet card embed with hyperlinked title and ID
          const petCard = new EmbedBuilder()
            .setColor(pet.status === 'available' ? '#2ecc71' : '#95a5a6')
            .setTitle(`[${pet.name}](${pet.pet_url})`)
            .setDescription(`**ID:** [${pet.pet_id}](${pet.pet_url})`)
            .addFields(
              { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
              { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
              { name: 'Gender', value: pet.gender || 'Unknown', inline: true },
              { name: 'Age', value: pet.age || 'Unknown', inline: true },
              { name: 'Status', value: `${statusEmoji} ${pet.status}`, inline: true },
              { name: 'Days in Shelter', value: String(daysOnRoster), inline: true }
            )
            .setTimestamp();
          
          // Add image if available
          if (pet.photo_url) {
            petCard.setImage(pet.photo_url);
          }
          
          // Add footer with source
          if (pet.source) {
            petCard.setFooter({ text: `Source: ${pet.source}` });
          }
          
          // Create adopt button if pet is available
          let components = [];
          if (pet.status === 'available') {
            const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
            const adoptButton = new ButtonBuilder()
              .setCustomId(`adopt_${petId}_${message.channel.id}`)
              .setLabel('🐾 Adopt to Roster')
              .setStyle(ButtonStyle.Success);
            
            components = [new ActionRowBuilder().addComponents(adoptButton)];
          }
          
          const reply = await message.reply({ embeds: [petCard], components, allowedMentions: { repliedUser: false }, fetchReply: true });
          
          // Set up button collector if available
          if (pet.status === 'available') {
            const buttonFilter = (interaction) => interaction.customId === `adopt_${petId}_${message.channel.id}`;
            const buttonCollector = reply.createMessageComponentCollector({ filter: buttonFilter, time: 600000 }); // 10 minutes
            
            buttonCollector.on('collect', async (interaction) => {
              try {
                // Get user's league for this channel
                const channelLeagueId = channelConfigs.get(message.channel.id)?.leagueId;
                
                if (!channelLeagueId) {
                  await interaction.reply({
                    content: '❌ This channel is not configured for a league. Use `!setleague [name]` first.',
                    ephemeral: true
                  });
                  return;
                }
                
                // Get or create user
                let user = await db.getUserByDiscordId(interaction.user.id);
                if (!user) {
                  user = await db.createUserWithDiscord(interaction.user.id, interaction.user.username);
                }
                
                // Check roster limit
                const roster = await db.getUserRoster(user.id, channelLeagueId);
                if (roster.length >= ROSTER_LIMIT) {
                  await interaction.reply({
                    content: `❌ Your roster is full! You have **${roster.length}/${ROSTER_LIMIT}** pets.`,
                    ephemeral: true
                  });
                  return;
                }
                
                // Check if already drafted
                if (roster.some(r => r.pet_id === petId)) {
                  await interaction.reply({
                    content: `❌ You've already drafted **[${pet.name}](${pet.pet_url})** in this league.`,
                    ephemeral: true
                  });
                  return;
                }
                
                // Draft the pet
                await db.draftPet(user.id, channelLeagueId, pet.id);
                
                // Send confirmation
                const confirmEmbed = new EmbedBuilder()
                  .setColor('#2ecc71')
                  .setTitle('✅ Pet Drafted!')
                  .setDescription(`**[${pet.name}](${pet.pet_url})** has been added to your roster`)
                  .addFields(
                    { name: 'Pet ID', value: `[${pet.pet_id}](${pet.pet_url})`, inline: true },
                    { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
                    { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
                    { name: 'Roster', value: `${roster.length + 1}/${ROSTER_LIMIT}`, inline: true }
                  )
                  .setFooter({ text: 'You\'ll earn points if this pet gets adopted!' })
                  .setTimestamp();
                
                if (pet.photo_url) {
                  confirmEmbed.setImage(pet.photo_url);
                }
                
                await interaction.reply({ embeds: [confirmEmbed] });
                
                // Broadcast to channel
                const league = await db.getLeagueById(channelLeagueId);
                const petCard2 = new EmbedBuilder()
                  .setColor('#2ecc71')
                  .setTitle(`✅ Pet Drafted: [${pet.name}](${pet.pet_url})`)
                  .setDescription(`**${interaction.user.username}** drafted **[${pet.name}](${pet.pet_url})**`)
                  .addFields(
                    { name: 'Pet ID', value: `[${pet.pet_id}](${pet.pet_url})`, inline: true },
                    { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
                    { name: 'Type', value: pet.animal_type || 'Unknown', inline: true }
                  )
                  .setTimestamp();
                
                if (pet.photo_url) {
                  petCard2.setImage(pet.photo_url);
                }
                
                await message.channel.send({ embeds: [petCard2] });
              } catch (error) {
                console.error('Error in pet lookup adopt:', error);
                await interaction.reply({
                  content: '❌ Error adopting pet. Please try again.',
                  ephemeral: true
                });
              }
            });
            
            buttonCollector.on('end', async () => {
              try {
                const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
                const disabledButton = new ButtonBuilder()
                  .setCustomId('adopt_disabled')
                  .setLabel('🐾 Adopt to Roster')
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(true);
                
                await reply.edit({ components: [new ActionRowBuilder().addComponents(disabledButton)] });
              } catch (e) {
                // Message might be deleted
              }
            });
          }
        } else {
          console.log(`❌ Pet not found: ${petId}`);
          await message.reply(`❌ Pet **${petId}** not found in database.`, { allowedMentions: { repliedUser: false } });
        }
      } catch (error) {
        console.error(`Error looking up pet ${petId}:`, error);
        await message.reply(`❌ Error looking up pet **${petId}**: ${error.message}`, { allowedMentions: { repliedUser: false } });
      }
    }
  }
  
  // ============ COMMAND HANDLER ============
  if (!message.content.startsWith('!')) return;
  
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  
  try {
    switch(command) {
      case 'linkplayer':
        await handleLinkPlayer(message, args);
        break;

      case 'setleague':
        await handleSetLeague(message, args);
        break;
        
      case 'leaderboard':
        await commands.showLeaderboard(message, channelConfigs.get(message.channel.id)?.leagueId);
        break;
        
      case 'addpet':
        await commands.draftPet(message, args, channelConfigs.get(message.channel.id)?.leagueId, ROSTER_LIMIT);
        break;
        
      case 'roster':
      case 'myroster':
        await commands.showRoster(message, channelConfigs.get(message.channel.id)?.leagueId);
        break;
        
      case 'pets':
        // Use new filter system for league channels
        if (channelConfigs.get(message.channel.id)) {
          await filter.startFiltering(message, channelConfigs.get(message.channel.id)?.leagueId);
        } else {
          await message.reply('❌ This channel is not configured for a league. Use `!setleague [name]` first.');
        }
        break;
        
      case 'stats':
        await commands.showStats(message);
        break;

      case 'points':
        await commands.showPointHistory(message, channelConfigs.get(message.channel.id)?.leagueId);
        break;
        
      case 'forcecheck':
        if (message.member?.permissions.has('ADMINISTRATOR')) {
          await message.reply('🔄 Running manual check...');
          await runCheck();
        }
        break;
        
      case 'help':
        await showHelp(message);
        break;
    }
  } catch (error) {
    console.error(`Error handling command ${command}:`, error);
    await message.reply('❌ An error occurred processing your command.');
  }
});

bot.on('interactionCreate', async (interaction) => {
  // Handle button interactions from carousel
  if (!interaction.isButton()) return;
  
  try {
    // Buttons are handled by FilterHandler's collectors
    // This is just a catch-all for any missed interactions
  } catch (error) {
    console.error('Error handling interaction:', error);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Error processing interaction.', ephemeral: true });
    }
  }
});

bot.on('error', (error) => {
  console.error('Discord bot error:', error);
});

// ============ CHECK CYCLE ============

function startCheckCycle() {
  setInterval(async () => {
    console.log(`\n⏰ [${new Date().toISOString()}] Running scheduled check...`);
    await runCheck();
  }, CHECK_INTERVAL * 60 * 1000);
}

async function runCheck() {
  try {
    console.log('🔍 Checking for pet status changes...');
    
    // Get current state of all pets
    const currentPets = await db.getAllPets();
    const previousPets = state.getPets();
    
    // On first run (empty state), just initialize without broadcasting
    if (previousPets.length === 0 && state.getStatistics().totalChecks === 0) {
      console.log('🆕 First run detected - initializing state without broadcasting');
      state.updatePets(currentPets);
      await state.save();
      return;
    }
    
    // Detect changes
    const changes = detectChanges(previousPets, currentPets);
    
    if (changes.adopted.length === 0 && changes.newPets.length === 0) {
      console.log('✅ No changes detected');
      state.updatePets(currentPets);
      await state.save();
      
      // Silent - no Discord message when nothing changed
      return;
    }
    
    console.log(`📊 Changes detected:`);
    console.log(`   - ${changes.adopted.length} pets adopted`);
    console.log(`   - ${changes.newPets.length} new pets available`);
    
    // Process adoptions and award points
    if (changes.adopted.length > 0) {
      const adoptionResults = await points.processAdoptions(changes.adopted);
      await broadcastAdoptions(adoptionResults);
    }
    
    // Announce new pets
    if (changes.newPets.length > 0) {
      await broadcastNewPets(changes.newPets);
    }
    
    // Update state
    state.updatePets(currentPets);
    state.setLastCheck(new Date());
    await state.save();
    
    console.log('✅ Check complete\n');
  } catch (error) {
    console.error('❌ Error during check:', error);
    await broadcastCheckStatus('❌ Check Failed', error.message, '#e74c3c');
  }
}

function detectChanges(previousPets, currentPets) {
  const prevMap = new Map(previousPets.map(p => [p.pet_id, p]));
  const currMap = new Map(currentPets.map(p => [p.pet_id, p]));
  
  const adopted = [];
  const newPets = [];
  
  // Find adopted pets (was available, now removed)
  for (const [petId, prevPet] of prevMap) {
    const currPet = currMap.get(petId);
    if (prevPet.status === 'available' && currPet?.status === 'removed') {
      adopted.push(currPet);
    }
  }
  
  // Find new pets
  for (const [petId, currPet] of currMap) {
    if (!prevMap.has(petId) && currPet.status === 'available') {
      newPets.push(currPet);
    }
  }
  
  return { adopted, newPets };
}

// ============ DISCORD BROADCASTS ============

async function broadcastCheckStatus(title, description, color) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  
  // Send to all configured channels
  for (const [channelId, config] of channelConfigs) {
    try {
      const channel = await bot.channels.fetch(channelId);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`Failed to send status to channel ${channelId}:`, error.message);
    }
  }
  
  // Also send to default channel if configured
  if (DEFAULT_NOTIFICATION_CHANNEL && !channelConfigs.has(DEFAULT_NOTIFICATION_CHANNEL)) {
    try {
      const channel = await bot.channels.fetch(DEFAULT_NOTIFICATION_CHANNEL);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Failed to send status to default channel:', error.message);
    }
  }
}

async function broadcastAdoptions(adoptionResults) {
  const leaguesAffected = new Map(); // leagueId -> array of awards
  
  for (const result of adoptionResults) {
    const { pet, pointsAwarded } = result;
    
    // Create adoption embed
    const embed = new EmbedBuilder()
      .setColor('#e74c3c')
      .setTitle('🎉 Pet Adopted!')
      .setDescription(`**[${pet.name}](${pet.pet_url})** has been adopted!`)
      .addFields(
        { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
        { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
        { name: 'Days in Shelter', value: `${calculateDaysSince(pet.brought_to_shelter)}`, inline: true }
      );
    
    // Add pet image if available
    if (pet.photo_url) {
      embed.setImage(pet.photo_url);
    }
    
    // Add points awarded section
    if (pointsAwarded.length > 0) {
      const pointsText = pointsAwarded
        .slice(0, 10)
        .map(p => `• **${p.userName}** earned ${p.points} points in ${p.leagueName}`)
        .join('\n');
      
      embed.addFields({
        name: '🏆 Points Awarded',
        value: pointsText + (pointsAwarded.length > 10 ? `\n... and ${pointsAwarded.length - 10} more` : '')
      });
    }
    
    // Broadcast to relevant channels
    await broadcastToChannels(embed, pointsAwarded);
    
    // Track affected leagues for leaderboard updates
    for (const award of pointsAwarded) {
      if (!leaguesAffected.has(award.leagueId)) {
        leaguesAffected.set(award.leagueId, []);
      }
      leaguesAffected.get(award.leagueId).push(award);
    }
  }
  
  // After all adoptions broadcast, show updated leaderboards
  for (const [leagueId, awards] of leaguesAffected) {
    await showLeaderboardUpdate(leagueId);
  }
}

/**
 * Show updated leaderboard for a league after adoptions
 */
async function showLeaderboardUpdate(leagueId) {
  try {
    // Get league info
    const league = await db.getLeagueById(leagueId);
    if (!league) return;
    
    // Get leaderboard
    const leaderboard = await db.getLeaderboard(leagueId, 10);
    if (leaderboard.length === 0) return;
    
    // Create leaderboard embed
    const embed = new EmbedBuilder()
      .setColor('#f39c12')
      .setTitle(`📊 Updated Leaderboard - ${league.name}`)
      .setTimestamp();
    
    // Format leaderboard
    const leaderboardText = leaderboard.map((entry, index) => {
      let medal = '';
      if (index === 0) medal = '🥇';
      else if (index === 1) medal = '🥈';
      else if (index === 2) medal = '🥉';
      
      const city = entry.city ? ` (${entry.city})` : '';
      return `${medal} **#${entry.rank}** ${entry.first_name}${city} - **${entry.total_points}** pts`;
    }).join('\n');
    
    embed.setDescription(leaderboardText);
    
    // Find channels for this league
    for (const [channelId, config] of channelConfigs) {
      if (config.leagueId === leagueId) {
        try {
          const channel = await bot.channels.fetch(channelId);
          if (channel) {
            await channel.send({ embeds: [embed] });
          }
        } catch (error) {
          console.error(`Failed to send leaderboard to channel ${channelId}:`, error.message);
        }
      }
    }
    
    // Also send to default notification channel if configured
    if (DEFAULT_NOTIFICATION_CHANNEL && !channelConfigs.has(DEFAULT_NOTIFICATION_CHANNEL)) {
      try {
        const channel = await bot.channels.fetch(DEFAULT_NOTIFICATION_CHANNEL);
        if (channel) {
          await channel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('Failed to send leaderboard to default channel:', error.message);
      }
    }
  } catch (error) {
    console.error(`Error showing leaderboard update for league ${leagueId}:`, error);
  }
}

async function broadcastNewPets(newPets) {
  // Limit to 10 pets per message
  const petsToShow = newPets.slice(0, 10);
  
  const embed = new EmbedBuilder()
    .setColor('#2ecc71')
    .setTitle('🐾 New Pets Available!')
    .setDescription(`${newPets.length} new pet(s) just arrived at the shelter`)
    .setTimestamp();
  
  // Add pet fields
  for (const pet of petsToShow) {
    embed.addFields({
      name: `[${pet.name}](${pet.pet_url}) - ${pet.pet_id}`,
      value: `${pet.breed || 'Unknown breed'} • ${pet.animal_type || 'Unknown'} • ${pet.age || 'Unknown age'}`,
      inline: false
    });
  }
  
  if (newPets.length > 10) {
    embed.addFields({
      name: '\u200b',
      value: `... and ${newPets.length - 10} more`
    });
  }
  
  // Broadcast to all configured channels
  await broadcastToAllChannels(embed);
}

async function broadcastToChannels(embed, pointsAwarded) {
  // Get unique league IDs from points awarded
  const leagueIds = new Set(pointsAwarded.map(p => p.leagueId));
  
  // Find channels configured for these leagues
  for (const [channelId, config] of channelConfigs) {
    if (leagueIds.has(config.leagueId)) {
      try {
        const channel = await bot.channels.fetch(channelId);
        if (channel) {
          await channel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error(`Failed to send to channel ${channelId}:`, error.message);
      }
    }
  }
  
  // Also send to default notification channel if configured
  if (DEFAULT_NOTIFICATION_CHANNEL && !channelConfigs.has(DEFAULT_NOTIFICATION_CHANNEL)) {
    try {
      const channel = await bot.channels.fetch(DEFAULT_NOTIFICATION_CHANNEL);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Failed to send to default channel:', error.message);
    }
  }
}

async function broadcastToAllChannels(embed) {
  // Send to all configured channels
  const sentChannels = new Set();
  
  for (const [channelId, config] of channelConfigs) {
    if (!sentChannels.has(channelId)) {
      try {
        const channel = await bot.channels.fetch(channelId);
        if (channel) {
          await channel.send({ embeds: [embed] });
          sentChannels.add(channelId);
        }
      } catch (error) {
        console.error(`Failed to send to channel ${channelId}:`, error.message);
      }
    }
  }
  
  // Send to default channel if not already sent
  if (DEFAULT_NOTIFICATION_CHANNEL && !sentChannels.has(DEFAULT_NOTIFICATION_CHANNEL)) {
    try {
      const channel = await bot.channels.fetch(DEFAULT_NOTIFICATION_CHANNEL);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Failed to send to default channel:', error.message);
    }
  }
}

// ============ COMMAND HANDLERS ============

async function handleLinkPlayer(message, args) {
  if (args.length === 0) {
    await message.reply('Usage: `!linkplayer [first_name]`\nExample: `!linkplayer Paul Corgi`');
    return;
  }
  
  const firstName = args.join(' ');
  const discordId = message.author.id;
  const discordUsername = message.author.username;
  
  try {
    console.log(`🔗 Player linking requested: Discord user ${discordUsername} (${discordId}) → "${firstName}"`);
    
    // Step 1: Find user by first name in database
    const user = await db.getUserByFirstName(firstName);
    
    if (!user) {
      await message.reply(
        `❌ No player found named **"${firstName}"**.\n` +
        `Check your name spelling or contact league admin.`
      );
      return;
    }
    
    // Step 2: Check if this player is already linked to someone else
    if (user.discord_id && user.discord_id !== discordId) {
      await message.reply(
        `❌ Player **"${firstName}"** is already linked to another Discord account.\n` +
        `Contact league admin to unlink.`
      );
      return;
    }
    
    // Step 3: Check if this Discord ID is already linked to someone else
    const existingUser = await db.getUserByDiscordId(discordId);
    if (existingUser && existingUser.id !== user.id) {
      await message.reply(
        `❌ Your Discord account is already linked to **"${existingUser.first_name}"**.\n` +
        `Use a different Discord account or contact admin.`
      );
      return;
    }
    
    // Step 4: Link them!
    await db.linkPlayerToDiscord(user.id, discordId);
    console.log(`✅ Linked: ${firstName} (${user.id}) ← ${discordUsername} (${discordId})`);
    
    // Step 5: Confirm to user
    const embed = new EmbedBuilder()
      .setColor('#2ecc71')
      .setTitle('✅ Player Linked!')
      .setDescription(`Your Discord account is now linked to **${user.first_name}**`)
      .addFields(
        { name: 'Discord Username', value: discordUsername, inline: true },
        { name: 'Player Name', value: user.first_name, inline: true }
      )
      .setFooter({ text: 'You can now use all bot commands!' })
      .setTimestamp();
    
    await message.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Error linking player:', error);
    await message.reply('❌ Error linking player. Contact admin.');
  }
}

async function handleSetLeague(message, args) {
  if (args.length === 0) {
    await message.reply('Usage: `!setleague [league name]`');
    return;
  }
  
  const leagueName = args.join(' ');
  
  // Find league in database
  const league = await db.getLeagueByName(leagueName);
  
  if (!league) {
    await message.reply(`❌ League "${leagueName}" not found.`);
    return;
  }
  
  // Save channel configuration
  channelConfigs.set(message.channel.id, {
    leagueId: league.id,
    leagueName: league.name
  });
  
  // Persist to database
  await db.setChannelLeague(message.channel.id, league.id);
  
  await message.reply(`✅ This channel is now tracking **${league.name}**`);
}

async function showHelp(message) {
  const embed = new EmbedBuilder()
    .setColor('#3498db')
    .setTitle('🐾 Fantasy Pet League Bot Commands')
    .setDescription('Track pet adoptions and compete in leagues!')
    .addFields(
      { name: '🐶 Pet Lookup', value: 'Mention any pet ID (A2XXXXXX) in chat to see pet card', inline: false },
      { name: '!linkplayer [name]', value: 'Link your Discord account to your player profile', inline: false },
      { name: '!setleague [name]', value: 'Set this channel to track a specific league', inline: false },
      { name: '!leaderboard', value: 'Show current league standings', inline: false },
      { name: '!addpet [pet_id]', value: 'Draft a pet to your roster', inline: false },
      { name: '!roster', value: 'View your current roster', inline: false },
      { name: '!pets', value: 'Browse available pets with interactive filters', inline: false },
      { name: '!points', value: 'Show your points and which pets earned them', inline: false },
      { name: '!stats', value: 'View adoption statistics', inline: false },
      { name: '!help', value: 'Show this help message', inline: false }
    )
    .setFooter({ text: 'Points are awarded automatically when your drafted pets get adopted!' });
  
  await message.reply({ embeds: [embed] });
}

// ============ UTILITY FUNCTIONS ============

function calculateDaysSince(date) {
  if (!date) return 0;
  const now = new Date();
  const then = new Date(date);
  const diff = now - then;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

async function loadChannelConfigs() {
  try {
    const configs = await db.getChannelConfigs();
    for (const config of configs) {
      channelConfigs.set(config.channel_id, {
        leagueId: config.league_id,
        leagueName: config.league_name
      });
    }
    console.log(`✅ Loaded ${channelConfigs.size} channel configurations`);
  } catch (error) {
    console.error('Failed to load channel configs:', error);
  }
}

// ============ STARTUP ============

async function start() {
  try {
    console.log('🚀 Starting Fantasy Pet League Bot...');
    
    if (!DISCORD_TOKEN) {
      throw new Error('DISCORD_BOT_TOKEN not set in environment');
    }
    
    await bot.login(DISCORD_TOKEN);
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down gracefully...');
  await state.save();
  await db.close();
  bot.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Shutting down gracefully...');
  await state.save();
  await db.close();
  bot.destroy();
  process.exit(0);
});

// Start the bot
start();