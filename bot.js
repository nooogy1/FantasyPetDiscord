// bot.js - Fantasy Pet League Discord Bot & Points Manager (UPDATED v5)
// This bot runs 24/7, checks for adopted pets hourly, and awards points
// UPDATED: Now detects when incomplete pets become "complete" (name + photo added)

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const PointsManager = require('./lib/PointsManager');
const Database = require('./lib/Database');
const StateManager = require('./lib/StateManager');
const CommandHandler = require('./lib/CommandHandler');
const FilterHandler = require('./lib/FilterHandler');
const QueueManager = require('./lib/QueueManager');
const PhotoCache = require('./lib/PhotoCache');
require('dotenv').config();

// ============ CONFIGURATION ============

const CHECK_INTERVAL = process.env.CHECK_INTERVAL || 60; // minutes
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DEFAULT_NOTIFICATION_CHANNEL = process.env.DEFAULT_CHANNEL_ID;
const DEBUG_CHANNEL_ID = process.env.DEBUG_CHANNEL_ID;
const PHOTO_CHANNEL_ID = process.env.PHOTO_CHANNEL_ID; // Private channel for photo caching
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
const queue = new QueueManager(bot, db, state);
const photoCache = new PhotoCache(bot, db, PHOTO_CHANNEL_ID);

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
  
  // Start the 15-minute queue cycle
  startQueueCycle();
  
  // Run initial check after 10 seconds
  setTimeout(runCheck, 10000);
  
  // Run initial queue processing after 20 seconds
  setTimeout(processQueues, 20000);
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
          
          // Get league for this channel
          const channelLeagueId = channelConfigs.get(message.channel.id)?.leagueId;
          
          // Calculate days on roster
          let daysOnRoster = 'N/A';
          if (pet.brought_to_shelter) {
            const now = new Date();
            const brought = new Date(pet.brought_to_shelter);
            const diff = now - brought;
            daysOnRoster = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
          }
          
          // Check if pet is drafted by ANYONE in this league
          let isDraftedByAnyone = false;
          let draftedByUser = null;
          if (channelLeagueId) {
            const query = `
              SELECT u.first_name
              FROM roster_entries re
              JOIN users u ON u.id = re.user_id
              WHERE re.pet_id = (SELECT id FROM pets WHERE pet_id = $1)
              AND re.league_id = $2
              LIMIT 1
            `;
            const result = await db.pool.query(query, [petId, channelLeagueId]);
            if (result.rows.length > 0) {
              isDraftedByAnyone = true;
              draftedByUser = result.rows[0].first_name;
            }
          }
          
          // Determine status emoji and text
          let statusEmoji = '✅';
          let statusText = 'Available';
          let cardColor = '#2ecc71';
          
          if (pet.status !== 'available') {
            statusEmoji = '🏠';
            statusText = 'Adopted';
            cardColor = '#95a5a6';
          } else if (isDraftedByAnyone) {
            statusEmoji = '📋';
            statusText = `Already Drafted by ${draftedByUser}`;
            cardColor = '#f39c12'; // Orange for drafted
          }
          
          // Create pet card embed with hyperlinked title and ID
          const petCard = new EmbedBuilder()
            .setColor(cardColor)
            .setTitle(`${pet.name}`)
            .setDescription(`${statusEmoji} ${statusText}`)
            .addFields(
              { name: 'ID', value: `[${pet.pet_id}](${pet.pet_url})`, inline: true },
              { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
              { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
              { name: 'Gender', value: pet.gender || 'Unknown', inline: true },
              { name: 'Age', value: pet.age || 'Unknown', inline: true },
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
          
          // Create buttons based on pet status
          let components = [];
          if (pet.status === 'available' && !isDraftedByAnyone) {
            // Available and not drafted - show active draft button
            const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
            const draftButton = new ButtonBuilder()
              .setCustomId(`draft_${petId}_${message.channel.id}`)
              .setLabel('🐾 Draft')
              .setStyle(ButtonStyle.Success);
            
            components = [new ActionRowBuilder().addComponents(draftButton)];
          } else if (isDraftedByAnyone || pet.status !== 'available') {
            // Already drafted or adopted - show greyed out button
            const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
            let buttonLabel = 'Already Drafted';
            if (pet.status !== 'available') {
              buttonLabel = '🏠 Already Adopted';
            }
            
            const disabledButton = new ButtonBuilder()
              .setCustomId('pet_unavailable')
              .setLabel(buttonLabel)
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true);
            
            components = [new ActionRowBuilder().addComponents(disabledButton)];
          }
          
          const reply = await message.reply({ embeds: [petCard], components, allowedMentions: { repliedUser: false }, fetchReply: true });
          
          // Set up button collector only if pet is available and not drafted
          if (pet.status === 'available' && !isDraftedByAnyone) {
            // Filter accepts ANY user clicking this button
            const buttonFilter = (interaction) => interaction.customId === `draft_${petId}_${message.channel.id}`;
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
                
                // Check if YOU already drafted this pet
                if (roster.some(r => r.pet_id === petId)) {
                  await interaction.reply({
                    content: `❌ You've already drafted **[${pet.name}](${pet.pet_url})** in this league.`,
                    ephemeral: true
                  });
                  return;
                }
                
                // BACKEND VALIDATION: Check if ANYONE has drafted this pet (catches button bypass attempts)
                const draftCheckQuery = `
                  SELECT COUNT(*) as count
                  FROM roster_entries re
                  WHERE re.pet_id = (SELECT id FROM pets WHERE pet_id = $1)
                  AND re.league_id = $2
                `;
                const draftCheckResult = await db.pool.query(draftCheckQuery, [petId, channelLeagueId]);
                if (draftCheckResult.rows[0].count > 0) {
                  await interaction.reply({
                    content: `❌ **[${pet.name}](${pet.pet_url})** has already been drafted by someone else in this league.`,
                    ephemeral: true
                  });
                  return;
                }
                
                // Draft the pet
                await db.draftPet(user.id, channelLeagueId, pet.id);
                
                // Send confirmation to the clicker
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
                  .setFooter({ text: 'You\'ll earn points when this pet gets adopted!' })
                  .setTimestamp();
                
                if (pet.photo_url) {
                  confirmEmbed.setImage(pet.photo_url);
                }
                
                await interaction.reply({ embeds: [confirmEmbed] });
                
                // UPDATE PET CARD FOR EVERYONE - grey out the button
                const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
                const draftedButton = new ButtonBuilder()
                  .setCustomId('pet_drafted')
                  .setLabel('Already Drafted')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true);
                
                const updatedComponents = [new ActionRowBuilder().addComponents(draftedButton)];
                
                const updatedPetCard = new EmbedBuilder()
                  .setColor('#f39c12')
                  .setTitle(`${pet.name}`)
                  .setDescription(`📋 Already Drafted by ${interaction.user.username}`)
                  .addFields(
                    { name: 'ID', value: `[${pet.pet_id}](${pet.pet_url})`, inline: true },
                    { name: 'Breed', value: pet.breed || 'Unknown', inline: true },
                    { name: 'Type', value: pet.animal_type || 'Unknown', inline: true },
                    { name: 'Gender', value: pet.gender || 'Unknown', inline: true },
                    { name: 'Age', value: pet.age || 'Unknown', inline: true },
                    { name: 'Days in Shelter', value: String(daysOnRoster), inline: true }
                  )
                  .setTimestamp();
                
                if (pet.photo_url) {
                  updatedPetCard.setImage(pet.photo_url);
                }
                
                if (pet.source) {
                  updatedPetCard.setFooter({ text: `Source: ${pet.source}` });
                }
                
                await reply.edit({ embeds: [updatedPetCard], components: updatedComponents });
                
                // Broadcast to channel that pet was drafted
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
                
                // Stop collecting after successful draft
                buttonCollector.stop();
                
              } catch (error) {
                console.error('Error in pet lookup draft:', error);
                await interaction.reply({
                  content: '❌ Error drafting pet. Please try again.',
                  ephemeral: true
                });
              }
            });
            
            buttonCollector.on('end', async () => {
              // Nothing to do - if draft was successful, already updated and stopped
              // If timeout, button will naturally expire
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
        const targetUser = message.mentions.first();
        await commands.showRoster(message, channelConfigs.get(message.channel.id)?.leagueId, targetUser);
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
        
      case 'queue':
        await showQueueStats(message);
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

// ============ QUEUE CYCLE ============

function startQueueCycle() {
  setInterval(async () => {
    console.log(`\n🎯 [${new Date().toISOString()}] Processing queues...`);
    await processQueues();
  }, 15 * 60 * 1000); // 15 minutes
}

async function processQueues() {
  try {
    console.log('📋 Processing Discord queues...');
    
    // Get all channel configs
    const configs = await db.getAllChannelConfigs();
    
    if (configs.length === 0) {
      console.log('   ℹ️  No channels configured');
      return;
    }
    
    // Process new pet queues (per-channel, 15 min interval per channel)
    await queue.processNewPetQueues(configs);
    
    // Process adoption queue (global, 15 min interval)
    await queue.processAdoptionQueue(configs);
    
    console.log('✅ Queue processing complete\n');
  } catch (error) {
    console.error('❌ Error processing queues:', error);
    await broadcastError('Queue Processing Error', error.message, error.stack);
  }
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
    
    // Detect changes - now includes completedPets
    const changes = detectChanges(previousPets, currentPets);
    
    if (changes.adopted.length === 0 && 
        changes.newPets.length === 0 && 
        changes.completedPets.length === 0) {
      console.log('✅ No changes detected');
      state.updatePets(currentPets);
      await state.save();
      
      // Silent - no Discord message when nothing changed
      return;
    }
    
    console.log(`📊 Changes detected:`);
    console.log(`   - ${changes.adopted.length} pets adopted`);
    console.log(`   - ${changes.newPets.length} new pets available`);
    console.log(`   - ${changes.completedPets.length} pets now complete`);
    
    // Process adoptions and award points
    if (changes.adopted.length > 0) {
      const adoptionResults = await points.processAdoptions(changes.adopted);
      
      // Queue adoptions for announcement (don't broadcast directly)
      await db.queueAdoptions();
      console.log(`✅ Queued ${changes.adopted.length} adoptions for announcement`);
    }
    
    // Queue new pets for announcement (per-channel)
    if (changes.newPets.length > 0) {
      const configs = await db.getAllChannelConfigs();
      for (const config of configs) {
        await db.queueNewPetsForChannel(config.channel_id, config.league_id);
      }
      console.log(`✅ Queued ${changes.newPets.length} new pets for announcement`);
      
      // Cache photos for new pets
      console.log(`📸 Caching photos for ${changes.newPets.length} new pets...`);
      for (const pet of changes.newPets) {
        await photoCache.cachePhotoIfNeeded(pet);
      }
    }
    
    // Queue completed pets for announcement (per-channel)
    if (changes.completedPets.length > 0) {
      const configs = await db.getAllChannelConfigs();
      for (const config of configs) {
        await db.queueCompletedPetsForChannel(config.channel_id, config.league_id);
      }
      console.log(`✅ Queued ${changes.completedPets.length} completed pets for announcement`);
    }
    
    // Update state
    state.updatePets(currentPets);
    state.setLastCheck(new Date());
    await state.save();
    
    console.log('✅ Check complete\n');
  } catch (error) {
    console.error('❌ Error during check:', error);
    await broadcastError('Adoption Check Error', error.message, error.stack);
  }
}

function detectChanges(previousPets, currentPets) {
  const prevMap = new Map(previousPets.map(p => [p.pet_id, p]));
  const currMap = new Map(currentPets.map(p => [p.pet_id, p]));
  
  const adopted = [];
  const newPets = [];
  const completedPets = [];  // NEW: Pets that just became complete
  
  const STOCK_PHOTO = 'https://24petconnect.com/Content/Images/No_pic_t.jpg';
  
  // Find adopted pets (was available, now removed)
  for (const [petId, prevPet] of prevMap) {
    const currPet = currMap.get(petId);
    if (prevPet.status === 'available' && currPet?.status === 'removed') {
      adopted.push(currPet);
    }
  }
  
  // Find new pets (never seen before)
  for (const [petId, currPet] of currMap) {
    if (!prevMap.has(petId) && currPet.status === 'available') {
      newPets.push(currPet);
    }
  }
  
  // Find pets that just became complete (were incomplete, now have name + photo)
  for (const [petId, prevPet] of prevMap) {
    const currPet = currMap.get(petId);
    
    if (!currPet) continue;  // Pet disappeared
    if (currPet.status !== 'available') continue;  // Only track available pets
    if (currPet.discord_available_posted) continue;  // Already posted once
    
    // Check if pet was INCOMPLETE before but is now COMPLETE
    const wasIncomplete = 
      (!prevPet.name || prevPet.name === '') &&
      (!prevPet.photo_url || prevPet.photo_url === '' || 
       prevPet.photo_url === STOCK_PHOTO);
    
    const isNowComplete = 
      (currPet.name && currPet.name !== '') &&
      (currPet.photo_url && currPet.photo_url !== '' &&
       currPet.photo_url !== STOCK_PHOTO);
    
    if (wasIncomplete && isNowComplete) {
      completedPets.push(currPet);
    }
  }
  
  return { adopted, newPets, completedPets };
}

// ============ DISCORD BROADCASTS ============

async function broadcastError(title, description, stack = '') {
  if (!DEBUG_CHANNEL_ID) {
    console.warn('⚠️  DEBUG_CHANNEL_ID not set, error not posted to Discord');
    return;
  }

  try {
    const embed = new EmbedBuilder()
      .setColor('#e74c3c')
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setTimestamp();

    if (stack) {
      // Truncate stack if too long (Discord has 1024 char limit per field)
      const truncatedStack = stack.length > 1000 ? stack.substring(0, 1000) + '...' : stack;
      embed.addFields({ name: 'Stack Trace', value: `\`\`\`${truncatedStack}\`\`\`` });
    }

    const channel = await bot.channels.fetch(DEBUG_CHANNEL_ID);
    if (channel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Failed to send error to debug channel:', error.message);
  }
}

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
      { name: '!queue', value: 'View queue statistics (how many pets pending broadcast)', inline: false },
      { name: '!help', value: 'Show this help message', inline: false }
    )
    .setFooter({ text: 'Points are awarded automatically when your drafted pets get adopted!' });
  
  await message.reply({ embeds: [embed] });
}

async function showQueueStats(message) {
  try {
    const stats = await queue.getQueueStats();
    const stateStats = state.getStatistics();
    
    // Find counts for each queue type
    const newPetCount = stats.find(s => s.queue_type === 'new_pet')?.pending_count || '0';
    const completedPetCount = stats.find(s => s.queue_type === 'completed_pet')?.pending_count || '0';
    const adoptionCount = stats.find(s => s.queue_type === 'adoption')?.pending_count || '0';
    
    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('📊 Queue Statistics')
      .setDescription('Current status of announcement queues')
      .addFields(
        { 
          name: '🆕 New Pet Queue', 
          value: `${newPetCount} pets pending broadcast`, 
          inline: true 
        },
        { 
          name: '✨ Completed Pet Queue', 
          value: `${completedPetCount} pets pending broadcast`, 
          inline: true 
        },
        { 
          name: '🎉 Adoption Queue', 
          value: `${adoptionCount} adoptions pending broadcast`, 
          inline: true 
        },
        {
          name: '\u200b',
          value: '\u200b',
          inline: false
        },
        {
          name: '⏱️ Queue Timing',
          value: 'Posts are staggered every 15 minutes to prevent spam',
          inline: false
        }
      )
      .setFooter({ text: 'Queues are processed automatically every 15 minutes' })
      .setTimestamp();
    
    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Error showing queue stats:', error);
    await message.reply('❌ Error fetching queue statistics.');
  }
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