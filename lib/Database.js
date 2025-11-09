// lib/Database.js - PostgreSQL Database Interface with Discord Queue Support
const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  async connect() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('✅ Database connection successful');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      throw error;
    }
  }

  async close() {
    await this.pool.end();
  }

  // ============ PET OPERATIONS ============

  async getAllPets() {
    const query = `
      SELECT 
        id, pet_id, name, breed, animal_type, 
        gender, age, brought_to_shelter, status,
        source, first_seen, last_seen, photo_url, pet_url,
        discord_available_posted, discord_adopted_posted
      FROM pets
      ORDER BY pet_id
    `;
    
    const result = await this.pool.query(query);
    return result.rows;
  }

  async getPetById(petId) {
    const query = `
      SELECT 
        id, pet_id, name, breed, animal_type, 
        gender, age, brought_to_shelter, status,
        photo_url, pet_url, source, first_seen, last_seen,
        discord_available_posted, discord_adopted_posted
      FROM pets 
      WHERE UPPER(pet_id) = UPPER($1)
      OR UPPER(pet_id) LIKE UPPER($2)
    `;
    const likePattern = `%${petId}%`;
    const result = await this.pool.query(query, [petId, likePattern]);
    return result.rows[0];
  }

  async getAvailablePets(limit = 50) {
    const query = `
      SELECT * FROM pets 
      WHERE status = 'available' 
      ORDER BY first_seen DESC 
      LIMIT $1
    `;
    const result = await this.pool.query(query, [limit]);
    return result.rows;
  }

  // ============ LEAGUE OPERATIONS ============

  async getLeagueByName(name) {
    const query = 'SELECT * FROM leagues WHERE LOWER(name) = LOWER($1)';
    const result = await this.pool.query(query, [name]);
    return result.rows[0];
  }

  async getLeagueById(leagueId) {
    const query = 'SELECT * FROM leagues WHERE id = $1';
    const result = await this.pool.query(query, [leagueId]);
    return result.rows[0];
  }

  async getAllLeagues() {
    const query = 'SELECT * FROM leagues ORDER BY name';
    const result = await this.pool.query(query);
    return result.rows;
  }

  // ============ USER OPERATIONS ============

  async getUserByDiscordId(discordId) {
    const query = 'SELECT * FROM users WHERE discord_id = $1';
    const result = await this.pool.query(query, [discordId]);
    return result.rows[0];
  }

  async getUserByFirstName(firstName) {
    const query = 'SELECT * FROM users WHERE LOWER(first_name) = LOWER($1)';
    const result = await this.pool.query(query, [firstName]);
    return result.rows[0];
  }

  async linkPlayerToDiscord(userId, discordId) {
    const query = `
      UPDATE users 
      SET discord_id = $2
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.pool.query(query, [userId, discordId]);
    return result.rows[0];
  }

  async createUserWithDiscord(discordId, discordUsername) {
    const query = `
      INSERT INTO users (discord_id, first_name, passphrase_hash, created_at)
      VALUES ($1, $2, 'discord-user', NOW())
      ON CONFLICT (discord_id) DO UPDATE
      SET first_name = $2
      RETURNING *
    `;
    const result = await this.pool.query(query, [discordId, discordUsername]);
    return result.rows[0];
  }

  // ============ ROSTER OPERATIONS ============

  async getDraftedPetsForAdoption(petId) {
    const query = `
      SELECT 
        re.id,
        re.user_id,
        re.league_id,
        re.pet_id as pet_uuid,
        u.first_name as user_name,
        u.discord_id,
        l.name as league_name,
        p.breed,
        p.name as pet_name
      FROM roster_entries re
      JOIN users u ON u.id = re.user_id
      JOIN leagues l ON l.id = re.league_id
      JOIN pets p ON p.id = re.pet_id
      WHERE p.pet_id = $1
    `;
    
    const result = await this.pool.query(query, [petId]);
    return result.rows;
  }

  async removeFromRosters(petUuid) {
    const query = 'DELETE FROM roster_entries WHERE pet_id = $1 RETURNING *';
    const result = await this.pool.query(query, [petUuid]);
    return result.rows;
  }

  async draftPet(userId, leagueId, petUuid) {
    const query = `
      INSERT INTO roster_entries (user_id, league_id, pet_id, drafted_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, league_id, pet_id) DO NOTHING
      RETURNING *
    `;
    const result = await this.pool.query(query, [userId, leagueId, petUuid]);
    return result.rows[0];
  }

  async getUserRoster(userId, leagueId) {
    const query = `
      SELECT 
        p.pet_id,
        p.name,
        p.breed,
        p.animal_type,
        p.gender,
        p.age,
        p.status,
        p.photo_url,
        p.pet_url,
        re.drafted_at
      FROM roster_entries re
      JOIN pets p ON p.id = re.pet_id
      WHERE re.user_id = $1 AND re.league_id = $2
      ORDER BY re.drafted_at DESC
    `;
    const result = await this.pool.query(query, [userId, leagueId]);
    return result.rows;
  }

  async getAvailablePetsForLeague(leagueId, limit = 20) {
    const query = `
      SELECT p.*, p.photo_url, p.pet_url FROM pets p
      WHERE p.status = 'available'
      AND p.id NOT IN (
        SELECT pet_id FROM roster_entries WHERE league_id = $1
      )
      ORDER BY p.first_seen DESC
      LIMIT $2
    `;
    const result = await this.pool.query(query, [leagueId, limit]);
    return result.rows;
  }

  // ============ POINTS OPERATIONS ============

  async getBreedPoints(breed) {
    const query = 'SELECT points FROM breed_points WHERE breed = $1';
    const result = await this.pool.query(query, [breed]);
    return result.rows[0]?.points || 1;
  }

  async awardPoints(userId, leagueId, petUuid, pointsAmount, transaction = null) {
    const client = transaction || this.pool;
    
    const query = `
      INSERT INTO points (user_id, league_id, pet_id, points_amount, awarded_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
    `;
    
    const result = await client.query(query, [userId, leagueId, petUuid, pointsAmount]);
    return result.rows[0];
  }

  async updateLeaderboardCache(userId, leagueId) {
    const query = `
      INSERT INTO leaderboard_cache (league_id, user_id, total_points, last_updated)
      SELECT 
        $2 as league_id,
        $1 as user_id,
        COALESCE(SUM(points_amount), 0) as total_points,
        NOW()
      FROM points
      WHERE user_id = $1 AND league_id = $2
      ON CONFLICT (league_id, user_id)
      DO UPDATE SET 
        total_points = EXCLUDED.total_points,
        last_updated = NOW()
    `;
    
    await this.pool.query(query, [userId, leagueId]);
  }

  async getLeaderboard(leagueId, limit = 10) {
    const query = `
      SELECT 
        u.id,
        u.first_name,
        u.city,
        lc.total_points,
        ROW_NUMBER() OVER (ORDER BY lc.total_points DESC) as rank
      FROM leaderboard_cache lc
      JOIN users u ON u.id = lc.user_id
      WHERE lc.league_id = $1
      ORDER BY lc.total_points DESC
      LIMIT $2
    `;
    
    const result = await this.pool.query(query, [leagueId, limit]);
    return result.rows;
  }

  async getGlobalLeaderboard(limit = 10) {
    const query = `
      SELECT 
        u.id,
        u.first_name,
        u.city,
        SUM(lc.total_points) as total_points,
        COUNT(DISTINCT lc.league_id) as leagues_count
      FROM leaderboard_cache lc
      JOIN users u ON u.id = lc.user_id
      GROUP BY u.id, u.first_name, u.city
      ORDER BY total_points DESC
      LIMIT $1
    `;
    
    const result = await this.pool.query(query, [limit]);
    return result.rows;
  }

  // ============ CHANNEL CONFIG OPERATIONS ============

  async setChannelLeague(channelId, leagueId) {
    const query = `
      INSERT INTO discord_channel_config (channel_id, league_id, configured_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (channel_id)
      DO UPDATE SET league_id = $2, configured_at = NOW()
    `;
    
    await this.pool.query(query, [channelId, leagueId]);
  }

  async getChannelConfigs() {
    const query = `
      SELECT 
        dcc.channel_id,
        dcc.league_id,
        l.name as league_name
      FROM discord_channel_config dcc
      JOIN leagues l ON l.id = dcc.league_id
    `;
    
    const result = await this.pool.query(query);
    return result.rows;
  }

  // ============ BOT STATE OPERATIONS ============

  async saveBotState(state) {
    const query = `
      INSERT INTO discord_bot_state (id, state_data, updated_at)
      VALUES (1, $1, NOW())
      ON CONFLICT (id)
      DO UPDATE SET state_data = $1, updated_at = NOW()
    `;
    
    await this.pool.query(query, [JSON.stringify(state)]);
  }

  async loadBotState() {
    const query = 'SELECT state_data FROM discord_bot_state WHERE id = 1';
    const result = await this.pool.query(query);
    
    if (result.rows.length > 0) {
      return JSON.parse(result.rows[0].state_data);
    }
    return null;
  }

  // ============ STATISTICS ============

  async getStats() {
    const stats = await Promise.all([
      this.pool.query('SELECT COUNT(*) as count FROM pets WHERE status = $1', ['available']),
      this.pool.query('SELECT COUNT(*) as count FROM pets WHERE status = $1', ['removed']),
      this.pool.query('SELECT COUNT(*) as count FROM users'),
      this.pool.query('SELECT COUNT(*) as count FROM leagues'),
      this.pool.query('SELECT SUM(points_amount) as total FROM points'),
      this.pool.query('SELECT COUNT(*) as count FROM roster_entries'),
    ]);
    
    return {
      available_pets: parseInt(stats[0].rows[0].count),
      adopted_pets: parseInt(stats[1].rows[0].count),
      total_users: parseInt(stats[2].rows[0].count),
      total_leagues: parseInt(stats[3].rows[0].count),
      total_points_awarded: parseInt(stats[4].rows[0].total || 0),
      total_drafted: parseInt(stats[5].rows[0].count),
    };
  }

  async getPointHistory(userId, leagueId = null, limit = 20) {
    let query = `
      SELECT 
        p.points_amount,
        p.awarded_at,
        pets.name as pet_name,
        pets.pet_url,
        pets.breed,
        l.name as league_name
      FROM points p
      JOIN pets ON pets.id = p.pet_id
      JOIN leagues l ON l.id = p.league_id
      WHERE p.user_id = $1
    `;
    
    const params = [userId];
    
    if (leagueId) {
      query += ' AND p.league_id = $2';
      params.push(leagueId);
    }
    
    query += ' ORDER BY p.awarded_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    
    const result = await this.pool.query(query, params);
    return result.rows;
  }

  // ============ DISCORD QUEUE OPERATIONS ============

  /**
   * Add eligible new pets to queue for a specific channel
   * FIXED: Added explicit type casting to resolve parameter type deduction error
   * The issue was comparing VARCHAR column directly with parameter without casting
   */
  async queueNewPetsForChannel(channelId, leagueId) {
    const STOCK_PHOTO = 'https://24petconnect.com/Content/Images/No_pic_t.jpg';
    
    const query = `
      INSERT INTO discord_queue_items (queue_type, pet_id, channel_id, league_id)
      SELECT 
        'new_pet'::text,
        p.id,
        $1::text,
        $2::uuid
      FROM pets p
      WHERE p.status = 'available'
        AND p.discord_available_posted = FALSE
        AND p.name IS NOT NULL
        AND COALESCE(p.photo_url, '') != $3::text
        AND NOT EXISTS (
          SELECT 1 FROM discord_queue_items dqi
          WHERE dqi.queue_type = 'new_pet'::text
            AND dqi.pet_id = p.id
            AND dqi.channel_id = $1::text
        )
      ON CONFLICT (queue_type, pet_id, channel_id) DO NOTHING
      RETURNING pet_id
    `;
    
    const result = await this.pool.query(query, [channelId, leagueId, STOCK_PHOTO]);
    return result.rows;
  }

  /**
   * Queue completed pets (pets that just became complete with name + photo)
   * One queue entry per channel per pet
   */
  async queueCompletedPetsForChannel(channelId, leagueId) {
    const STOCK_PHOTO = 'https://24petconnect.com/Content/Images/No_pic_t.jpg';
    
    const query = `
      INSERT INTO discord_queue_items (queue_type, pet_id, channel_id, league_id)
      SELECT 
        'completed_pet'::text,
        p.id,
        $1::text,
        $2::uuid
      FROM pets p
      WHERE p.status = 'available'
        AND p.discord_available_posted = FALSE
        AND p.name IS NOT NULL
        AND p.name != ''
        AND COALESCE(p.photo_url, '') != $3::text
        AND COALESCE(p.photo_url, '') != ''
        AND NOT EXISTS (
          SELECT 1 FROM discord_queue_items dqi
          WHERE dqi.queue_type = 'completed_pet'::text
            AND dqi.pet_id = p.id
            AND dqi.channel_id = $1::text
        )
      ON CONFLICT (queue_type, pet_id, channel_id) DO NOTHING
      RETURNING pet_id
    `;
    
    const result = await this.pool.query(query, [channelId, leagueId, STOCK_PHOTO]);
    return result.rows;
  }

  /**
   * Add eligible adoptions to global queue
   */
  async queueAdoptions() {
    const query = `
      INSERT INTO discord_queue_items (queue_type, pet_id, channel_id, league_id)
      SELECT 
        'adoption',
        p.id,
        NULL,
        NULL
      FROM pets p
      WHERE p.status = 'removed'
        AND p.discord_adopted_posted = FALSE
        AND (
          -- Condition 1: Has name AND real photo
          (p.name IS NOT NULL AND p.photo_url != 'https://24petconnect.com/Content/Images/No_pic_t.jpg')
          OR
          -- Condition 2: Was on someone's roster
          EXISTS (
            SELECT 1 FROM roster_entries re WHERE re.pet_id = p.id
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM discord_queue_items dqi
          WHERE dqi.queue_type = 'adoption'
            AND dqi.pet_id = p.id
        )
      ON CONFLICT (queue_type, pet_id, channel_id) DO NOTHING
      RETURNING pet_id
    `;
    
    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Get next pet to post from new pet queue for a specific channel
   */
  async getNextNewPetToPost(channelId) {
    const query = `
      SELECT 
        dqi.id as queue_id,
        dqi.pet_id,
        p.id,
        p.pet_id as pet_code,
        p.name,
        p.breed,
        p.animal_type,
        p.gender,
        p.age,
        p.photo_url,
        p.pet_url,
        p.brought_to_shelter,
        dqi.league_id
      FROM discord_queue_items dqi
      JOIN pets p ON p.id = dqi.pet_id
      WHERE dqi.queue_type = 'new_pet'
        AND dqi.channel_id = $1
        AND dqi.posted = FALSE
      ORDER BY dqi.queued_at ASC
      LIMIT 1
    `;
    
    const result = await this.pool.query(query, [channelId]);
    return result.rows[0];
  }

  /**
   * Get next pet to post from new/completed pet queue for a specific channel
   * Specify queue type: 'new_pet' or 'completed_pet'
   */
  async getNextPetToPostByType(channelId, queueType) {
    const query = `
      SELECT 
        dqi.id as queue_id,
        dqi.pet_id,
        p.id,
        p.pet_id as pet_code,
        p.name,
        p.breed,
        p.animal_type,
        p.gender,
        p.age,
        p.photo_url,
        p.pet_url,
        p.brought_to_shelter,
        dqi.league_id,
        dqi.queue_type
      FROM discord_queue_items dqi
      JOIN pets p ON p.id = dqi.pet_id
      WHERE dqi.queue_type = $1
        AND dqi.channel_id = $2
        AND dqi.posted = FALSE
      ORDER BY dqi.queued_at ASC
      LIMIT 1
    `;
    
    const result = await this.pool.query(query, [queueType, channelId]);
    return result.rows[0];
  }

  /**
   * Get next pet to post from global adoption queue
   */
  async getNextAdoptionToPost() {
    const query = `
      SELECT 
        dqi.id as queue_id,
        dqi.pet_id,
        p.id,
        p.pet_id as pet_code,
        p.name,
        p.breed,
        p.animal_type,
        p.photo_url,
        p.pet_url,
        p.brought_to_shelter,
        p.last_seen
      FROM discord_queue_items dqi
      JOIN pets p ON p.id = dqi.pet_id
      WHERE dqi.queue_type = 'adoption'
        AND dqi.posted = FALSE
      ORDER BY dqi.queued_at ASC
      LIMIT 1
    `;
    
    const result = await this.pool.query(query);
    return result.rows[0];
  }

  /**
   * Mark a queue item as posted
   */
  async markQueueItemPosted(queueId) {
    const query = `
      UPDATE discord_queue_items
      SET posted = TRUE, posted_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [queueId]);
    return result.rows[0];
  }

  /**
   * Mark a pet as discord_available_posted
   */
  async markPetAvailablePosted(petId) {
    const query = `
      UPDATE pets
      SET discord_available_posted = TRUE
      WHERE id = $1
      RETURNING pet_id
    `;
    
    const result = await this.pool.query(query, [petId]);
    return result.rows[0];
  }

  /**
   * Mark a pet as discord_adopted_posted
   */
  async markPetAdoptedPosted(petId) {
    const query = `
      UPDATE pets
      SET discord_adopted_posted = TRUE
      WHERE id = $1
      RETURNING pet_id
    `;
    
    const result = await this.pool.query(query, [petId]);
    return result.rows[0];
  }

  /**
   * Get all channel configurations for queue processing
   */
  async getAllChannelConfigs() {
    const query = `
      SELECT 
        dcc.channel_id,
        dcc.league_id,
        l.name as league_name
      FROM discord_channel_config dcc
      JOIN leagues l ON l.id = dcc.league_id
    `;
    
    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Get points awarded for an adopted pet in a specific league
   */
  async getAdoptionPointsForLeague(petId, leagueId) {
    const query = `
      SELECT 
        u.id as user_id,
        u.first_name,
        u.discord_id,
        p.points_amount,
        p.awarded_at
      FROM points p
      JOIN users u ON u.id = p.user_id
      JOIN pets pet ON pet.id = p.pet_id
      WHERE pet.pet_id = $1
        AND p.league_id = $2
      ORDER BY p.awarded_at DESC
    `;
    
    const result = await this.pool.query(query, [petId, leagueId]);
    return result.rows;
  }

  /**
   * Get all points awarded for an adopted pet (across all leagues)
   */
  async getAdoptionPointsGlobal(petId) {
    const query = `
      SELECT 
        u.id as user_id,
        u.first_name,
        u.discord_id,
        l.id as league_id,
        l.name as league_name,
        p.points_amount,
        p.awarded_at
      FROM points p
      JOIN users u ON u.id = p.user_id
      JOIN leagues l ON l.id = p.league_id
      JOIN pets pet ON pet.id = p.pet_id
      WHERE pet.pet_id = $1
      ORDER BY l.id, p.awarded_at DESC
    `;
    
    const result = await this.pool.query(query, [petId]);
    return result.rows;
  }

  /**
   * Get pending queue counts for monitoring
   */
  async getQueueStats() {
    const query = `
      SELECT 
        queue_type,
        COUNT(*) as pending_count
      FROM discord_queue_items
      WHERE posted = FALSE
      GROUP BY queue_type
    `;
    
    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Update pet's cached Discord photo URL
   */
  async updatePetDiscordPhotoUrl(petId, discordPhotoUrl) {
    const query = `
      UPDATE pets
      SET discord_photo_url = $2
      WHERE id = $1
      RETURNING pet_id
    `;
    
    const result = await this.pool.query(query, [petId, discordPhotoUrl]);
    return result.rows[0];
  }

  // ============ TRANSACTIONS ============

  async beginTransaction() {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return client;
  }

  async commitTransaction(client) {
    await client.query('COMMIT');
    client.release();
  }

  async rollbackTransaction(client) {
    await client.query('ROLLBACK');
    client.release();
  }
}

module.exports = Database;