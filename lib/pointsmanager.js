// lib/PointsManager.js - Points calculation and awarding
class PointsManager {
  constructor(database, stateManager) {
    this.db = database;
    this.state = stateManager;
  }

  /**
   * Process adopted pets and award points
   * @param {Array} adoptedPets - Array of adopted pet objects
   * @returns {Array} Results with points awarded details
   */
  async processAdoptions(adoptedPets) {
    const results = [];
    
    for (const pet of adoptedPets) {
      console.log(`\n🐾 Processing adoption: ${pet.name} (${pet.pet_id})`);
      
      // Start transaction for atomicity
      const client = await this.db.beginTransaction();
      
      try {
        // 1. Get all roster entries for this pet
        const rosterEntries = await this.db.getDraftedPetsForAdoption(pet.pet_id);
        
        if (rosterEntries.length === 0) {
          console.log(`   ℹ️ No users had drafted ${pet.name}`);
          await this.db.commitTransaction(client);
          results.push({
            pet,
            pointsAwarded: []
          });
          continue;
        }
        
        console.log(`   📋 Found ${rosterEntries.length} roster entries`);
        
        // 2. Get breed points
        const breedPoints = await this.db.getBreedPoints(pet.breed);
        console.log(`   🏷️ Breed: ${pet.breed} = ${breedPoints} points`);
        
        const pointsAwarded = [];
        
        // 3. Award points to each user who drafted this pet
        for (const entry of rosterEntries) {
          console.log(`   💰 Awarding ${breedPoints} points to ${entry.user_name} in ${entry.league_name}`);
          
          // Award points
          await this.db.awardPoints(
            entry.user_id,
            entry.league_id,
            entry.pet_uuid,
            breedPoints,
            client
          );
          
          // Update leaderboard cache
          await this.db.updateLeaderboardCache(entry.user_id, entry.league_id);
          
          pointsAwarded.push({
            userId: entry.user_id,
            userName: entry.user_name,
            discordId: entry.discord_id,
            leagueId: entry.league_id,
            leagueName: entry.league_name,
            petName: pet.name,
            points: breedPoints
          });
        }
        
        // 4. Remove pet from all rosters
        const removed = await this.db.removeFromRosters(pet.id);
        console.log(`   🗑️ Removed from ${removed.length} rosters`);
        
        // Commit transaction
        await this.db.commitTransaction(client);
        
        console.log(`   ✅ Adoption processing complete for ${pet.name}`);
        
        results.push({
          pet,
          pointsAwarded
        });
        
      } catch (error) {
        console.error(`   ❌ Error processing adoption for ${pet.name}:`, error);
        await this.db.rollbackTransaction(client);
        
        results.push({
          pet,
          pointsAwarded: [],
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Calculate total points for a user in a league
   * @param {string} userId - User ID
   * @param {string} leagueId - League ID
   * @returns {number} Total points
   */
  async getUserPoints(userId, leagueId) {
    const query = `
      SELECT COALESCE(SUM(points_amount), 0) as total
      FROM points
      WHERE user_id = $1 AND league_id = $2
    `;
    
    const result = await this.db.pool.query(query, [userId, leagueId]);
    return parseInt(result.rows[0].total);
  }

  /**
   * Get point history for a user
   * @param {string} userId - User ID
   * @param {string} leagueId - Optional league ID
   * @param {number} limit - Number of records to return
   */
  async getPointHistory(userId, leagueId = null, limit = 20) {
    let query = `
      SELECT 
        p.points_amount,
        p.awarded_at,
        pets.name as pet_name,
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
    
    const result = await this.db.pool.query(query, params);
    return result.rows;
  }

  /**
   * Recalculate all leaderboard caches
   * Used for maintenance or fixing inconsistencies
   */
  async recalculateAllLeaderboards() {
    console.log('🔄 Recalculating all leaderboards...');
    
    const query = `
      INSERT INTO leaderboard_cache (league_id, user_id, total_points, last_updated)
      SELECT 
        p.league_id,
        p.user_id,
        SUM(p.points_amount) as total_points,
        NOW()
      FROM points p
      GROUP BY p.league_id, p.user_id
      ON CONFLICT (league_id, user_id)
      DO UPDATE SET 
        total_points = EXCLUDED.total_points,
        last_updated = NOW()
    `;
    
    await this.db.pool.query(query);
    console.log('✅ Leaderboard recalculation complete');
  }

  /**
   * Get top performers across all time
   * @param {number} limit - Number of top performers to return
   */
  async getTopPerformers(limit = 10) {
    const query = `
      SELECT 
        u.first_name,
        u.discord_id,
        SUM(p.points_amount) as total_points,
        COUNT(DISTINCT p.league_id) as leagues_count,
        COUNT(DISTINCT p.pet_id) as pets_adopted
      FROM points p
      JOIN users u ON u.id = p.user_id
      GROUP BY u.id, u.first_name, u.discord_id
      ORDER BY total_points DESC
      LIMIT $1
    `;
    
    const result = await this.db.pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Get league statistics
   * @param {string} leagueId - League ID
   */
  async getLeagueStats(leagueId) {
    const stats = await Promise.all([
      // Total points in league
      this.db.pool.query(
        'SELECT SUM(points_amount) as total FROM points WHERE league_id = $1',
        [leagueId]
      ),
      // Active players
      this.db.pool.query(
        'SELECT COUNT(DISTINCT user_id) as count FROM roster_entries WHERE league_id = $1',
        [leagueId]
      ),
      // Total pets drafted
      this.db.pool.query(
        'SELECT COUNT(*) as count FROM roster_entries WHERE league_id = $1',
        [leagueId]
      ),
      // Pets adopted
      this.db.pool.query(
        'SELECT COUNT(DISTINCT pet_id) as count FROM points WHERE league_id = $1',
        [leagueId]
      ),
      // Average points per player
      this.db.pool.query(
        'SELECT AVG(total_points) as avg FROM leaderboard_cache WHERE league_id = $1',
        [leagueId]
      ),
    ]);
    
    return {
      total_points: parseInt(stats[0].rows[0].total || 0),
      active_players: parseInt(stats[1].rows[0].count),
      total_drafted: parseInt(stats[2].rows[0].count),
      pets_adopted: parseInt(stats[3].rows[0].count),
      avg_points_per_player: Math.round(stats[4].rows[0].avg || 0)
    };
  }

  /**
   * Get breed performance statistics
   */
  async getBreedStats() {
    const query = `
      SELECT 
        pets.breed,
        COUNT(*) as adoption_count,
        AVG(bp.points) as avg_points,
        SUM(p.points_amount) as total_points_awarded
      FROM points p
      JOIN pets ON pets.id = p.pet_id
      LEFT JOIN breed_points bp ON bp.breed = pets.breed
      WHERE pets.status = 'removed'
      GROUP BY pets.breed
      ORDER BY adoption_count DESC
      LIMIT 20
    `;
    
    const result = await this.db.pool.query(query);
    return result.rows;
  }
}

module.exports = PointsManager;