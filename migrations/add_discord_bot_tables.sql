-- migrations/add_discord_bot_tables.sql
-- Add tables needed for the Discord bot & points manager

-- Table to store Discord channel configurations
CREATE TABLE IF NOT EXISTS discord_channel_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id VARCHAR(255) UNIQUE NOT NULL,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  configured_at TIMESTAMP DEFAULT NOW(),
  configured_by VARCHAR(255)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_discord_channel_config_channel ON discord_channel_config(channel_id);

-- Table to store bot state (for persistence across restarts)
CREATE TABLE IF NOT EXISTS discord_bot_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  state_data JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ensure only one state record exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_bot_state_single ON discord_bot_state ((id));

-- Add discord_id to users table if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id VARCHAR(255) UNIQUE;

-- Index for Discord ID lookups
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);

-- Add notification preferences (optional)
CREATE TABLE IF NOT EXISTS discord_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  discord_user_id VARCHAR(255),
  notify_adoptions BOOLEAN DEFAULT true,
  notify_new_pets BOOLEAN DEFAULT true,
  notify_points BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Log table for bot activities (for debugging and auditing)
CREATE TABLE IF NOT EXISTS discord_bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL, -- 'adoption', 'new_pet', 'points_awarded', 'command', 'error'
  event_data JSONB,
  channel_id VARCHAR(255),
  user_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for log queries
CREATE INDEX IF NOT EXISTS idx_discord_bot_logs_created ON discord_bot_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discord_bot_logs_type ON discord_bot_logs(event_type);

-- Table to track points history with more detail
ALTER TABLE points ADD COLUMN IF NOT EXISTS awarded_by VARCHAR(50) DEFAULT 'system';
ALTER TABLE points ADD COLUMN IF NOT EXISTS notes TEXT;

-- View for quick league member counts
CREATE OR REPLACE VIEW league_member_counts AS
SELECT 
  l.id as league_id,
  l.name as league_name,
  COUNT(DISTINCT re.user_id) as member_count
FROM leagues l
LEFT JOIN roster_entries re ON re.league_id = l.id
GROUP BY l.id, l.name;

-- View for recent adoptions
CREATE OR REPLACE VIEW recent_adoptions AS
SELECT 
  p.pet_id,
  p.name as pet_name,
  p.breed,
  p.animal_type,
  p.last_seen as adopted_date,
  COUNT(DISTINCT pt.user_id) as users_who_drafted,
  SUM(pt.points_amount) as total_points_awarded
FROM pets p
LEFT JOIN points pt ON pt.pet_id = p.id
WHERE p.status = 'removed'
  AND p.last_seen > NOW() - INTERVAL '30 days'
GROUP BY p.id, p.pet_id, p.name, p.breed, p.animal_type, p.last_seen
ORDER BY p.last_seen DESC;

-- Function to get user stats
CREATE OR REPLACE FUNCTION get_user_stats(p_discord_id VARCHAR)
RETURNS TABLE (
  total_points INTEGER,
  leagues_count INTEGER,
  pets_drafted INTEGER,
  pets_adopted INTEGER,
  best_league_name VARCHAR,
  best_league_points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH user_info AS (
    SELECT id FROM users WHERE discord_id = p_discord_id
  ),
  user_stats AS (
    SELECT 
      COALESCE(SUM(p.points_amount), 0)::INTEGER as total_points,
      COUNT(DISTINCT re.league_id)::INTEGER as leagues_count,
      COUNT(DISTINCT re.pet_id)::INTEGER as pets_drafted,
      COUNT(DISTINCT CASE WHEN pts.status = 'removed' THEN re.pet_id END)::INTEGER as pets_adopted
    FROM user_info ui
    LEFT JOIN roster_entries re ON re.user_id = ui.id
    LEFT JOIN pets pts ON pts.id = re.pet_id
    LEFT JOIN points p ON p.user_id = ui.id
  ),
  best_league AS (
    SELECT 
      l.name as league_name,
      COALESCE(SUM(p.points_amount), 0)::INTEGER as points
    FROM user_info ui
    LEFT JOIN points p ON p.user_id = ui.id
    LEFT JOIN leagues l ON l.id = p.league_id
    GROUP BY l.id, l.name
    ORDER BY points DESC
    LIMIT 1
  )
  SELECT 
    us.total_points,
    us.leagues_count,
    us.pets_drafted,
    us.pets_adopted,
    bl.league_name::VARCHAR,
    bl.points
  FROM user_stats us
  CROSS JOIN best_league bl;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE discord_channel_config IS 'Stores Discord channel to league mappings';
COMMENT ON TABLE discord_bot_state IS 'Persistent state for Discord bot between restarts';
COMMENT ON TABLE discord_notification_preferences IS 'User notification preferences for Discord';
COMMENT ON TABLE discord_bot_logs IS 'Audit log for Discord bot activities';
COMMENT ON VIEW recent_adoptions IS 'Shows pets adopted in the last 30 days with points awarded';
COMMENT ON FUNCTION get_user_stats IS 'Returns comprehensive stats for a Discord user';