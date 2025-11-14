# FantasyPetDiscord - Comprehensive Codebase Analysis

## 1. PROJECT OVERVIEW

**Project Name:** Fantasy Pet League Discord Bot & Points Manager
**Type:** Discord Bot + Points Management System
**Language:** Node.js (JavaScript)
**Database:** PostgreSQL
**Version:** 7 (Latest with queue system)
**Purpose:** 24/7 bot that monitors pet adoptions, awards points, and manages Discord interactions

### Core Responsibility
The bot serves as the **single source of truth for points** in the Fantasy Pet League ecosystem, running continuously to detect adoptions and award points automatically.

---

## 2. PROJECT STRUCTURE

```
FantasyPetDiscord/
├── bot.js                              (1,109 lines) - Main entry point & core bot logic
├── package.json                         - Dependencies & scripts
├── Dockerfile                          - Docker configuration
├── test.js                             (180 lines) - Test suite
├── migrations/
│   └── add_discord_bot_tables.sql      - Database schema additions
├── lib/
│   ├── Database.js                     (681 lines) - PostgreSQL interface
│   ├── PointsManager.js               (366 lines) - Points logic & awarding
│   ├── StateManager.js                (326 lines) - State persistence
│   ├── CommandHandler.js              (470 lines) - Discord commands
│   ├── FilterHandler.js               (916 lines) - Pet filtering system
│   ├── QueueManager.js                (488 lines) - Queue broadcasting
│   └── PhotoCache.js                  (130 lines) - Photo caching system
├── readme.md                           - Comprehensive documentation
├── complete_summary.md                 - Feature summary
└── project_overview_md                 - Architecture overview
```

**Total JavaScript Lines:** 4,666 lines
**Total Library Code:** 3,557 lines
**Core Bot Logic:** 1,109 lines

---

## 3. KEY DEPENDENCIES

### Production Dependencies
- **discord.js** v14.14.0 - Discord bot framework
- **pg** v8.11.3 - PostgreSQL client
- **dotenv** v16.3.1 - Environment variable management

### Development Dependencies
- **nodemon** v3.0.2 - Auto-restart on changes

### System Requirements
- Node.js >= 18.0.0
- PostgreSQL database
- Discord bot token

---

## 4. MAIN ENTRY POINT: bot.js

### Core Functionality (1,109 lines)
The bot.js file orchestrates the entire system with the following key responsibilities:

#### 4.1 Bot Initialization
```javascript
- Discord.js Client setup with specific intents
- Database connection management
- State loading from persistence
- Module initialization (PointsManager, CommandHandler, etc.)
- Channel configuration loading
```

#### 4.2 Event Handlers
1. **clientReady** - Bot login, initialization, cycle startup
2. **messageCreate** - Main command processing & pet ID lookups
3. **interactionCreate** - Button interaction handling
4. **error** - Global error handling

#### 4.3 Check Cycle (Hourly)
```
startCheckCycle() → runs every 60 minutes (configurable via CHECK_INTERVAL)
  └─ runCheck()
      ├─ Fetch all current pets from database
      ├─ Compare with previous state
      ├─ Detect changes:
      │   ├─ Adopted pets (available → removed)
      │   └─ New/complete pets (never seen + has name + photo)
      ├─ processAdoptions() → Award points
      ├─ Queue new pets for announcement
      ├─ Cache photos to Discord
      ├─ Update state in memory & persistence
      └─ Send Discord notifications
```

#### 4.4 Queue Cycle (Every 15 minutes)
```
startQueueCycle() → runs every 15 minutes
  └─ processQueues()
      ├─ Process pet queues (per-channel)
      └─ Process adoption queue (global)
```

#### 4.5 Pet Lookup Feature
- **Trigger:** Any message containing pet ID (A1XXXXXX or A2XXXXXX format)
- **Response:** Embeds with pet info, status, buttons for drafting
- **Features:**
  - Shows pet details (name, breed, type, gender, age, days in shelter)
  - Displays status (available, adopted, or drafted by user)
  - Draft button for available pets
  - Hyperlinked pet IDs

#### 4.6 Channel Configuration
- Maps Discord channels to leagues
- Loads on startup
- Persists to database

#### 4.7 Configuration Variables
```javascript
CHECK_INTERVAL        = 60 minutes (default)
DISCORD_TOKEN        = Discord bot token (required)
DEFAULT_CHANNEL_ID   = Notification channel
DEBUG_CHANNEL_ID     = Error/debug channel
PHOTO_CHANNEL_ID     = Photo cache channel
ROSTER_LIMIT         = 10 (max pets per roster)
```

---

## 5. LIBRARY MODULES ARCHITECTURE

### 5.1 Database.js (681 lines)
**Purpose:** PostgreSQL interface with transaction support

#### Database Methods (40+ methods)
**Pet Operations:**
- `getAllPets()` - Fetch all pets
- `getPetById(petId)` - Find pet by ID
- `getAvailablePets(limit)` - Get available pets

**League Operations:**
- `getLeagueByName(name)` - Find league by name
- `getLeagueById(id)` - Get league details
- `getAllLeagues()` - List all leagues

**User Operations:**
- `getUserByDiscordId(id)` - Find user by Discord ID
- `getUserByFirstName(name)` - Find user by name
- `linkPlayerToDiscord(userId, discordId)` - Link accounts
- `createUserWithDiscord(id, username)` - Create new user

**Roster Operations:**
- `getDraftedPetsForAdoption(petId)` - Find who drafted a pet
- `draftPet(userId, leagueId, petId)` - Add to roster
- `getUserRoster(userId, leagueId)` - Get user's roster
- `removeFromRosters(petId)` - Remove from all rosters

**Points Operations:**
- `getBreedPoints(breed)` - Get point value for breed
- `awardPoints(userId, leagueId, petId, amount)` - Award points
- `updateLeaderboardCache(userId, leagueId)` - Update rankings

**Leaderboard Operations:**
- `getLeaderboard(leagueId, limit)` - Get league standings
- `getGlobalLeaderboard(limit)` - Get global rankings

**Queue Operations:**
- `queuePetsForChannel(channelId, leagueId)` - Add pets to announcement queue
- `queueAdoptions()` - Add adoptions to global queue
- `getNextPetToPost(channelId)` - Get next pet for channel
- `getNextAdoptionToPost()` - Get next adoption announcement
- `markQueueItemPosted(id)` - Mark queue item as sent
- `markPetAvailablePosted(id)` - Mark pet as announced
- `markPetAdoptedPosted(id)` - Mark adoption as announced

**Photo Operations:**
- `updatePetDiscordPhotoUrl(petId, url)` - Store Discord photo URL

**Transaction Support:**
- `beginTransaction()` - Start transaction
- `commitTransaction(client)` - Commit changes
- `rollbackTransaction(client)` - Rollback changes

**Statistics:**
- `getStats()` - Global statistics
- `getPointHistory(userId, leagueId)` - Point history
- `getQueueStats()` - Queue status

---

### 5.2 PointsManager.js (366 lines)
**Purpose:** Points calculation, awarding, and leaderboard updates

#### Key Methods
1. **processAdoptions(adoptedPets)** - Main adoption processing
   - Uses database transactions for atomicity
   - For each adopted pet:
     - Finds all users who drafted it
     - Looks up breed point value
     - Awards points to each user
     - Updates leaderboard cache
     - Removes from rosters
   - Returns results with details of all awards

2. **Helper Methods (Transaction-based):**
   - `awardPointsInTransaction(client, userId, leagueId, petId, points)` - Award within transaction
   - `updateLeaderboardCacheInTransaction(client, userId, leagueId)` - Update cache in transaction
   - `removeFromRostersInTransaction(client, petId)` - Remove from rosters in transaction

3. **Statistics & Analysis:**
   - `getUserPoints(userId, leagueId)` - Get user's total points
   - `getPointHistory(userId, leagueId, limit)` - Point history
   - `getTopPerformers(limit)` - Top performers across all time
   - `getLeagueStats(leagueId)` - League statistics
   - `getBreedStats()` - Breed adoption & points stats

4. **Maintenance:**
   - `recalculateAllLeaderboards()` - Recalculate all rankings
   - `cleanupOrphanPoints()` - Fix orphan data

**Race Condition Protection:**
- Uses database transactions to ensure atomic operations
- Prevents double-awarding of points
- Rollback support for error handling

---

### 5.3 StateManager.js (326 lines)
**Purpose:** Persistent state management across restarts

#### State Structure
```javascript
{
  pets: [],                           // Current pets snapshot
  lastCheck: null,                    // Last check timestamp
  lastPetIds: Set(),                  // Set of known pet IDs
  queueTimings: {
    petQueues: {},                    // Per-channel queue last post times
    adoptionQueueLastPost: null       // Global adoption queue last post
  },
  statistics: {
    totalChecks: 0,
    totalAdoptions: 0,
    totalNewPets: 0,
    totalPointsAwarded: 0
  },
  initialized: false
}
```

#### Key Methods
1. **Persistence:**
   - `load()` - Load state from JSON file
   - `save()` - Save state to JSON file
   - `loadFromFile()` - Read JSON file
   - `saveToFile()` - Write JSON file

2. **State Access:**
   - `getPets()` - Get current pet list
   - `updatePets(pets)` - Update pet snapshot
   - `getStatistics()` - Get statistics
   - `getLastCheck()` - Get last check time
   - `setLastCheck(timestamp)` - Update check time

3. **Queue Timing (15-min intervals):**
   - `recordPetQueuePost(channelId)` - Mark pet queue posted
   - `recordAdoptionQueuePost()` - Mark adoption queue posted
   - `isTimeForPetQueuePost(channelId)` - Check if ready for pet post
   - `isTimeForAdoptionQueuePost()` - Check if ready for adoption post
   - `getTimeUntilNextPetPost(channelId)` - Time remaining
   - `getTimeUntilNextAdoptionPost()` - Time remaining

4. **Broadcast Window:**
   - `isWithinBroadcastWindow()` - Check if within 9 AM - 9 PM CST

5. **Maintenance:**
   - `reset()` - Clear all state
   - `exportState()` - Export for debugging
   - `importState(data)` - Import/restore state

---

### 5.4 CommandHandler.js (470 lines)
**Purpose:** Implements all Discord text commands

#### Implemented Commands
1. **`!showLeaderboard(leagueId)`**
   - Shows top 10 players in a league
   - Displays rank, name, city, points
   - Adds medal emojis (🥇🥈🥉)

2. **`!draftPet(petId, leagueId)`**
   - Draft a pet to user's roster
   - Validates:
     - League configured for channel
     - Pet exists and is available
     - User hasn't drafted it already
     - Roster not full (limit 10)
   - Broadcasts draft announcement to channel

3. **`!showRoster(leagueId, targetUser)`**
   - Show user's roster with carousel
   - Can view own or others' rosters
   - Navigation buttons (⬅️ Previous, Next ➡️)
   - Shows pet details: name, breed, type, days on roster
   - 5-minute button timeout

4. **`!showAvailablePets(leagueId)`**
   - Display available pets in league
   - Paginated carousel with next/previous buttons

5. **`!showStats()`**
   - Global statistics
   - Adoption stats
   - User stats

6. **`!showPointHistory(leagueId)`**
   - User's point history
   - Shows pet name, breed, points, timestamp
   - Last 20 entries

#### Helper Methods
- `calculateDaysSince(date)` - Calculate days since a date

---

### 5.5 FilterHandler.js (916 lines)
**Purpose:** Interactive 4-step pet filtering system

#### Filter Steps
1. **Step 1: Animal Type**
   - Options: Dogs 🐕, Cats 🐈, All Animals ✨
   - Shows count for each type

2. **Step 2: Gender**
   - Options: Male, Female, Any
   - Emoji-based reactions

3. **Step 3: Age Group**
   - Options: Young (<1 year), Adult (1-5 years), Senior (5+ years), Any

4. **Step 4: Days in Shelter**
   - Options: Recent (<1 week), Medium (1-4 weeks), Long (4+ weeks), Any

#### Features
- **Carousel Navigation:** Browse filtered results with next/previous buttons
- **Draft Integration:** Draft directly from results
- **Ephemeral Messages:** Only user sees the filter interface
- **Result Pagination:** Shows X of Y results
- **Status Indicators:** Shows if pet is already drafted or adopted

#### Key Methods
- `startFiltering(message, leagueId)` - Initialize filter
- `showAnimalTypeStep()` through `showDaysInShelterStep()` - Each filter step
- `showResults(message, userId)` - Display filtered results
- `getPetCountWithFilters(filters)` - Count matching pets
- `filterPetsByAllCriteria(filters)` - Apply all filters

---

### 5.6 QueueManager.js (488 lines)
**Purpose:** Manages announcement queues with broadcast windows

#### Queue System
Two separate queues:
1. **Pet Queue** - Per-channel, for new complete pets
2. **Adoption Queue** - Global, for adopted pets

#### Processing (Every 15 minutes)
1. **processPetQueues(configs)**
   - Check broadcast window (9 AM - 9 PM CST)
   - Per-channel 15-minute spacing
   - Validates pets before posting (checks if status still valid)
   - Creates embeds with pet info & draft buttons
   - Sets up button collectors for drafting

2. **processAdoptionQueue(configs)**
   - Similar timing with broadcast window
   - Aggregates points awarded
   - Shows leaderboard updates

#### Validation
- `validatePetForBroadcast(pet)` - Checks:
  - Pet still exists
  - Pet still has complete info (name + photo)
  - Pet status is still available
  - Removes invalid pets from queue

#### Button Interactions
- Draft button handlers
- Real-time roster limit checking
- Double-draft prevention
- Button disabling after successful draft

#### Message Creation
- `createPetEmbedWithButton(pet, leagueName, isOnRoster, channelId)` - Build embed
- Rich embeds with pet image, details, and conditional buttons

---

### 5.7 PhotoCache.js (130 lines)
**Purpose:** Cache pet photos to Discord for permanent storage

#### Rationale
Shelter URLs become dead after pets are adopted. Discord stores photos permanently.

#### Methods
1. **cachePhotoIfNeeded(pet)**
   - Check if already cached (discord_photo_url exists)
   - Skip if no valid photo
   - Download photo from shelter
   - Upload to Discord cache channel
   - Store Discord URL in database

2. **downloadPhoto(photoUrl)**
   - Uses Node.js built-in fetch (Node 18+)
   - Sets User-Agent header
   - 15-second timeout
   - Returns buffer

3. **uploadToDiscord(buffer, petId, petName)**
   - Send to PHOTO_CHANNEL_ID
   - Extract attachment URL from message
   - Return permanent Discord URL

4. **getPhotoUrl(pet)**
   - Returns cached Discord URL if available
   - Falls back to shelter URL

---

## 6. DATABASE SCHEMA

### New Tables (migrations/add_discord_bot_tables.sql)

#### 1. discord_channel_config
```sql
- id (UUID, PK)
- channel_id (VARCHAR, UNIQUE) - Discord channel ID
- league_id (UUID, FK) - References leagues.id
- configured_at (TIMESTAMP)
- configured_by (VARCHAR)
```
Maps Discord channels to leagues.

#### 2. discord_bot_state
```sql
- id (INTEGER, PK, always 1)
- state_data (JSONB) - Full state snapshot
- updated_at (TIMESTAMP)
```
Persists bot state across restarts.

#### 3. discord_notification_preferences
```sql
- id (UUID, PK)
- user_id (UUID, FK) - References users.id
- discord_user_id (VARCHAR)
- notify_adoptions (BOOLEAN)
- notify_new_pets (BOOLEAN)
- notify_points (BOOLEAN)
- created_at, updated_at (TIMESTAMP)
```
User notification settings.

#### 4. discord_bot_logs
```sql
- id (UUID, PK)
- event_type (VARCHAR) - adoption, new_pet, points_awarded, command, error
- event_data (JSONB) - Event details
- channel_id (VARCHAR)
- user_id (VARCHAR)
- created_at (TIMESTAMP)
```
Audit log for debugging.

#### 5. discord_queue_items
```sql
- id (UUID, PK)
- queue_type (VARCHAR) - 'pet' or 'adoption'
- pet_id (UUID, FK) - References pets.id
- channel_id (VARCHAR) - For pet queue only
- league_id (UUID) - For pet queue only
- queued_at (TIMESTAMP)
- posted (BOOLEAN)
- posted_at (TIMESTAMP)
```
Announcement queue items.

### Schema Modifications
- **users table:** Added `discord_id` column (VARCHAR, UNIQUE)
- **points table:** Added `awarded_by`, `notes` columns

### Database Views
1. **league_member_counts** - Member count per league
2. **recent_adoptions** - Adoptions from last 30 days

### Database Functions
- **get_user_stats(discord_id)** - Returns comprehensive user statistics

### Indexes
- discord_channel_config on channel_id
- users on discord_id
- discord_bot_logs on created_at, event_type

---

## 7. COMMAND STRUCTURE

### Command Routing (bot.js, lines 373-427)
Text commands start with `!` and are parsed as:
```
!command [arg1] [arg2] ...
```

### Implemented Commands
| Command | Args | Purpose | Required |
|---------|------|---------|----------|
| `!linkplayer` | [first_name] | Link Discord to player profile | No |
| `!setleague` | [league_name] | Configure channel for league | No |
| `!leaderboard` | - | Show league standings | Channel configured |
| `!addpet` | [pet_id] | Draft pet to roster | Channel configured |
| `!roster` | [@mention] | View roster (own or others') | Channel configured |
| `!myroster` | - | Alias for !roster | Channel configured |
| `!pets` | - | Interactive filter browser | Channel configured |
| `!stats` | - | Global statistics | No |
| `!points` | - | Personal point history | Channel configured |
| `!queue` | - | Queue statistics | No |
| `!forcecheck` | - | Manual adoption check | Admin only |
| `!help` | - | Show command help | No |

### Automatic Pet Lookup
- Triggers on **any message** containing pet ID pattern (A1XXXXXX or A2XXXXXX)
- Returns pet card embed with draft button
- Works in any channel

---

## 8. DATA PERSISTENCE & STATE

### Bot State (bot_state.json)
```json
{
  "pets": [...],                    // Pet snapshots
  "lastCheck": "2024-01-15T14:00Z",
  "lastPetIds": ["A1234567", ...],
  "queueTimings": {
    "petQueues": {
      "channel_id": "2024-01-15T14:00Z"
    },
    "adoptionQueueLastPost": "2024-01-15T14:00Z"
  },
  "statistics": {
    "totalChecks": 42,
    "totalAdoptions": 156,
    "totalNewPets": 812,
    "totalPointsAwarded": 3421
  },
  "initialized": true,
  "savedAt": "2024-01-15T14:05Z"
}
```

### State Persistence Locations
1. **File:** `bot_state.json` (primary)
2. **Database:** `discord_bot_state` table (backup)
3. **Queue Timings:** Tracked in state for proper spacing

### Graceful Shutdown
- Saves state on SIGINT/SIGTERM
- Closes database connection
- Destroys bot connection
- Process exits cleanly

---

## 9. ERROR HANDLING & DEBUGGING

### Error Broadcasting
- **DEBUG_CHANNEL_ID:** Dedicated Discord channel for error messages
- Error embeds include:
  - Title (❌ error type)
  - Description (error message)
  - Stack trace (truncated to 1000 chars)
  - Timestamp

### Logging
- Console logging with emojis for visual identification
- Detailed operation logs in check cycle
- Transaction rollback on errors
- Error tracking in database logs

### Health Checks
- Database connection verification on startup
- State loading validation
- Channel config validation
- Queue stats monitoring

---

## 10. KEY WORKFLOWS

### Adoption Detection & Points Awarding
```
1. Check Cycle triggered (every 60 min)
2. Fetch all pets from DB
3. Compare with previous state
4. Identify adopted pets (status: available → removed)
5. For each adoption:
   a. Start transaction
   b. Find all users who drafted pet
   c. Look up breed points value
   d. Award points to each user
   e. Update leaderboard cache
   f. Remove from rosters
   g. Commit transaction
   h. Queue adoption for announcement
6. Update state & save
7. Process announcements (after 15+ min spacing)
```

### Pet Filtering & Drafting
```
1. User: !pets
2. Bot shows Step 1 (animal type)
3. User reacts with emoji
4. Bot shows Step 2 (gender)
5. ... (Steps 3-4)
6. Bot shows filtered results carousel
7. User presses "Draft" button
8. Validation checks:
   - League configured
   - Pet exists & available
   - Not already drafted by user
   - Roster not full
9. Draft recorded in roster_entries
10. Confirmation sent to user
11. Announcement sent to channel
```

### Pet Lookup
```
1. User mentions pet ID in chat: "Check out A2043899"
2. Bot detects pattern: /A[12]\d{6}/g
3. For each pet ID:
   a. Query pet details
   b. Get draft status (anyone in league)
   c. Create pet card embed
   d. Add draft button (if available)
   e. Add image (cached Discord URL preferred)
   f. Send reply
   g. Set up button collector (10 minutes)
4. On button click:
   - Draft validation
   - Record draft
   - Update message (grey out button)
   - Broadcast to channel
```

---

## 11. CONFIGURATION & ENVIRONMENT

### Required Environment Variables
```
DISCORD_BOT_TOKEN          - Discord bot token (required)
DATABASE_URL               - PostgreSQL connection string (required)
```

### Optional Environment Variables
```
CHECK_INTERVAL             - Minutes between adoption checks (default: 60)
DEFAULT_CHANNEL_ID         - Default notification channel ID
DEBUG_CHANNEL_ID           - Debug/error log channel ID
PHOTO_CHANNEL_ID           - Private channel for photo caching
ROSTER_LIMIT               - Max pets per roster (default: 10)
```

### Example .env
```
DISCORD_BOT_TOKEN=your_bot_token_here
DATABASE_URL=postgresql://user:pass@host:5432/dbname
CHECK_INTERVAL=60
DEBUG_CHANNEL_ID=your_debug_channel_id
PHOTO_CHANNEL_ID=your_photo_cache_channel_id
ROSTER_LIMIT=10
```

---

## 12. DEPLOYMENT

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### npm Scripts
```json
{
  "start": "node bot.js",              // Production
  "dev": "nodemon bot.js",             // Development with auto-restart
  "migrate": "psql $DATABASE_URL < migrations/add_discord_bot_tables.sql",
  "test": "node test.js"               // Run test suite
}
```

### Railway Deployment
Bot can run 24/7 on Railway.app with:
- PostgreSQL database
- Environment variables
- Persistent node process

---

## 13. TESTING

### test.js (180 lines)
Comprehensive test suite covering:

1. **Database Connection** - Verify PostgreSQL connectivity
2. **Fetch Pets** - Load pet data
3. **Fetch Leagues** - Load league data
4. **State Management** - Load/save state
5. **Recent Adoptions** - Check adoption history
6. **Breed Points** - Verify point values
7. **Leaderboard** - Load league standings
8. **Global Statistics** - Aggregate stats

### Running Tests
```bash
npm test
```

Returns:
- Pass/fail count
- Success rate
- Detailed error messages

---

## 14. FILE TYPE SUMMARY

| Type | Count | Purpose |
|------|-------|---------|
| JavaScript | 8 | Core application code |
| SQL | 1 | Database schema |
| JSON | 1 | Dependencies & config |
| Markdown | 3+ | Documentation |
| Docker | 1 | Container config |

---

## 15. ARCHITECTURAL PATTERNS

### Design Patterns Used
1. **Singleton Pattern** - Database, StateManager instances
2. **Manager Pattern** - PointsManager, CommandHandler classes
3. **Transaction Pattern** - Database atomicity
4. **Event-Driven** - Discord.js event handlers
5. **State Machine** - Filter steps progression
6. **Queue Pattern** - Pet & adoption announcement queues

### Architecture Layers
1. **Presentation Layer** - Discord.js interface (commands, embeds, buttons)
2. **Business Logic Layer** - Managers (Points, Commands, Queue)
3. **Data Access Layer** - Database class
4. **Persistence Layer** - StateManager, database
5. **Configuration Layer** - Environment variables

### Separation of Concerns
- **bot.js** - Orchestration & event routing
- **lib/Database.js** - Data access
- **lib/PointsManager.js** - Business logic
- **lib/CommandHandler.js** - Command implementations
- **lib/StateManager.js** - Persistence
- **lib/FilterHandler.js** - Filtering UI
- **lib/QueueManager.js** - Queue management
- **lib/PhotoCache.js** - Photo management

---

## 16. KEY ARCHITECTURAL FEATURES

### 1. Stateful Operation
- Maintains running memory of pet state
- Persists state to JSON file
- Compares current vs previous for change detection
- Survives bot restarts

### 2. Transactional Safety
- Database transactions for atomic operations
- Prevents race conditions in point awarding
- Rollback on errors
- Exactly-once point award guarantee

### 3. Queue System with Timing
- Announcement queue prevents spam
- 15-minute spacing per channel
- Broadcast window restriction (9 AM - 9 PM CST)
- Validation before posting

### 4. Discord Integration Levels
1. **Automatic** - Pet lookup in any message
2. **Command-based** - Text commands with arguments
3. **Interactive** - Buttons, reactions, carousels
4. **Notifications** - Embeds sent to configured channels

### 5. Rate Limiting
- 15-minute queue spacing
- Per-channel queue processing
- Broadcast window restrictions
- Button timeouts (5-10 minutes)

### 6. Photo Persistence
- Downloads photos from shelter
- Uploads to Discord (permanent storage)
- Stores Discord URLs in DB
- Prevents dead links for adopted pets

---

## 17. CONCURRENCY & RACE CONDITIONS

### Transaction Handling
- Locks used for point awarding
- Multiple users drafting same pet prevented at DB level
- League member tracking with proper constraints

### Queue Processing
- Single queue processor per interval
- Per-channel spacing prevents simultaneous posts
- State-based timing prevents conflicts

### Button Interactions
- User ID verification on collectors
- One collector per message
- Timeout cleanup (5-10 minutes)

---

## 18. SCALABILITY CONSIDERATIONS

### Current Limitations
- Single database connection pool
- All state in memory + JSON file
- Sequential pet processing
- Per-message button collectors

### Scalability Features
- Database connection pooling (pg library)
- Parallel pet processing possible
- Queue-based announcement system
- Transaction support for multi-user scenarios

### Performance Optimizations
- Photo caching prevents bandwidth waste
- Leaderboard cache table for fast lookups
- Indexed database queries
- Ephemeral message for filters (reduces memory)

---

## 19. SECURITY FEATURES

### Access Control
- Admin-only commands (`!forcecheck` requires ADMINISTRATOR permission)
- User-specific button collectors (verify user.id)
- Permission checks before operations

### Data Protection
- Discord tokens in environment variables only
- Database credentials in connection string
- No plaintext secrets in code
- Transaction rollback on unauthorized actions

### Validation
- Pet status validation before awarding points
- Roster limit enforcement
- Double-draft prevention
- Backend validation for button actions

---

## 20. DEPENDENCIES & RELATIONSHIPS

### Module Dependencies
```
bot.js
  ├─→ Database.js (pool operations)
  ├─→ PointsManager.js (award points)
  ├─→ StateManager.js (persistence)
  ├─→ CommandHandler.js (command implementations)
  ├─→ FilterHandler.js (pet filtering)
  ├─→ QueueManager.js (queue processing)
  └─→ PhotoCache.js (photo caching)

Database.js (no dependencies)
PointsManager.js → Database.js
StateManager.js (no dependencies)
CommandHandler.js → Database.js
FilterHandler.js → Database.js
QueueManager.js → Database.js, StateManager.js
PhotoCache.js → Database.js
```

### External Dependencies
- discord.js ↔ bot.js (event handling)
- pg ↔ Database.js (queries)
- dotenv → all modules (config)

---

## 21. SUMMARY STATISTICS

| Metric | Value |
|--------|-------|
| Total Lines of Code | 4,666 |
| Main Bot File | 1,109 lines |
| Library Code | 3,557 lines |
| Core Modules | 7 |
| Database Tables | 5 new + 2 modified |
| Implemented Commands | 12 |
| API Methods | 40+ |
| Test Cases | 8 |
| Environmental Variables | 6 |

---

## 22. CONCLUSION

This is a **comprehensive, production-ready Discord bot** that serves as the single source of truth for points in a Fantasy Pet League ecosystem. It demonstrates:

- **Robust architecture** with clear separation of concerns
- **Safe concurrency** using database transactions
- **Persistent state** for 24/7 operation
- **Rich Discord integration** with interactive features
- **Comprehensive error handling** and logging
- **Scalable design** supporting multiple leagues and users
- **Well-documented** code with clear patterns

The codebase is well-organized, maintainable, and ready for production deployment on platforms like Railway.app.

