\# 🤖 Fantasy Pet League Discord Bot \& Points Manager



A dedicated Discord bot that runs 24/7, monitors pet adoptions, awards points, and manages league interactions. This is \*\*App 3\*\* in the Fantasy Pet League ecosystem.



\## 🎯 Core Responsibilities



\### 1. Points Management (Primary Source of Truth)

\- \*\*Sole authority\*\* for awarding points - no other app can award points

\- Runs checks every 60 minutes to detect adopted pets

\- Awards points based on breed values from `breed\_points` table

\- Updates leaderboard caches automatically



\### 2. Discord Integration

\- Real-time notifications for adoptions and new pets

\- Interactive commands for league management

\- Channel-specific league tracking

\- Persistent state across restarts



\### 3. State Management

\- Maintains memory of last seen pets

\- Tracks adoption events

\- Persists state to survive restarts

\- Provides audit logging



\## 🚀 Quick Start



\### Prerequisites

\- Node.js 18+

\- PostgreSQL database (shared with main app)

\- Discord bot token



\### Installation



```bash

\# Clone the repository

git clone https://github.com/yourusername/fantasy-pet-league-bot.git

cd fantasy-pet-league-bot



\# Install dependencies

npm install



\# Copy environment file

cp .env.example .env

\# Edit .env with your credentials



\# Run database migrations

npm run migrate



\# Start the bot

npm start

```



\## ⚙️ Configuration



\### Environment Variables



| Variable | Required | Default | Description |

|----------|----------|---------|-------------|

| `DISCORD\_BOT\_TOKEN` | Yes | - | Discord bot token |

| `DATABASE\_URL` | Yes | - | PostgreSQL connection string |

| `CHECK\_INTERVAL` | No | 60 | Minutes between adoption checks |

| `DEFAULT\_CHANNEL\_ID` | No | - | Default channel for notifications |



\### Discord Bot Setup



1\. \*\*Create Discord Application\*\*

&nbsp;  ```

&nbsp;  1. Go to https://discord.com/developers/applications

&nbsp;  2. Click "New Application"

&nbsp;  3. Name it "Fantasy Pet League Bot"

&nbsp;  4. Go to Bot tab → Add Bot

&nbsp;  5. Copy token to .env

&nbsp;  ```



2\. \*\*Set Bot Permissions\*\*

&nbsp;  - Send Messages

&nbsp;  - Embed Links

&nbsp;  - Read Message History

&nbsp;  - Manage Messages



3\. \*\*Invite Bot to Server\*\*

&nbsp;  ```

&nbsp;  Use OAuth2 URL Generator:

&nbsp;  - Scopes: bot, applications.commands

&nbsp;  - Copy generated URL and visit it

&nbsp;  ```



\## 💬 Discord Commands



\### User Commands



| Command | Description | Example |

|---------|-------------|---------|

| `!setleague \[name]` | Configure channel for a league | `!setleague Houston Pets` |

| `!leaderboard` | Show current league standings | `!leaderboard` |

| `!addpet \[pet\_id]` | Draft a pet to your roster | `!addpet A2043899` |

| `!roster` | View your drafted pets | `!roster` |

| `!pets` | Show available pets | `!pets` |

| `!stats` | View global statistics | `!stats` |

| `!help` | Show command help | `!help` |



\### Admin Commands



| Command | Description | Required Permission |

|---------|-------------|-------------------|

| `!forcecheck` | Manually trigger adoption check | Administrator |



\## 🔄 How It Works



\### Check Cycle (Every 60 minutes)



```

1\. Bot wakes up on schedule

2\. Queries current pets from PostgreSQL

3\. Compares with last known state

4\. Detects changes:

&nbsp;  - Adopted pets (available → removed)

&nbsp;  - New pets (not in previous state)

5\. Awards points for adoptions

6\. Sends Discord notifications

7\. Updates state for next check

```



\### Points Award Process



```sql

For each adopted pet:

&nbsp; 1. Find all users who drafted it

&nbsp; 2. Look up breed points value

&nbsp; 3. Award points to each user

&nbsp; 4. Remove pet from rosters

&nbsp; 5. Update leaderboard cache

&nbsp; 6. Send Discord notifications

```



\## 📊 Database Schema



\### New Tables



```sql

-- Channel to league mapping

discord\_channel\_config

&nbsp; - channel\_id (Discord channel)

&nbsp; - league\_id (Fantasy league)

&nbsp; - configured\_at



-- Bot persistent state

discord\_bot\_state

&nbsp; - state\_data (JSON)

&nbsp; - updated\_at



-- Activity logs

discord\_bot\_logs

&nbsp; - event\_type

&nbsp; - event\_data

&nbsp; - channel\_id

&nbsp; - user\_id

&nbsp; - created\_at

```



\### Required Existing Tables

\- `pets` - Pet information

\- `users` - User accounts

\- `leagues` - League definitions

\- `roster\_entries` - Drafted pets

\- `points` - Points awarded

\- `breed\_points` - Point values per breed

\- `leaderboard\_cache` - Cached standings



\## 🏗️ Architecture



```

bot.js                    # Main bot entry point

├── lib/

│   ├── Database.js      # PostgreSQL interface

│   ├── PointsManager.js # Points logic

│   ├── StateManager.js  # State persistence

│   └── CommandHandler.js # Discord commands

├── migrations/

│   └── add\_discord\_bot\_tables.sql

├── bot\_state.json       # Persistent state file

└── .env                 # Configuration

```



\## 🚂 Railway Deployment



\### Deploy to Railway



1\. \*\*Create New Project\*\*

&nbsp;  ```bash

&nbsp;  railway new fantasy-pet-league-bot

&nbsp;  ```



2\. \*\*Add PostgreSQL\*\*

&nbsp;  - Use existing database from main app

&nbsp;  - Or add new PostgreSQL plugin



3\. \*\*Set Environment Variables\*\*

&nbsp;  ```bash

&nbsp;  railway variables set DISCORD\_BOT\_TOKEN=your\_token

&nbsp;  railway variables set DATABASE\_URL=${{Postgres.DATABASE\_URL}}

&nbsp;  railway variables set CHECK\_INTERVAL=60

&nbsp;  ```



4\. \*\*Deploy\*\*

&nbsp;  ```bash

&nbsp;  railway up

&nbsp;  ```



5\. \*\*Keep Alive 24/7\*\*

&nbsp;  - Railway apps run continuously by default

&nbsp;  - No special configuration needed



\## 🔍 Monitoring



\### Health Checks



The bot logs its status regularly:

```

✅ Bot logged in as BotName#1234

⏰ Check interval: 60 minutes

✅ Database connected

✅ State loaded

```



\### Check Logs



Monitor adoption checks:

```

⏰ \[2024-01-15T14:00:00Z] Running scheduled check...

🔍 Checking for pet status changes...

📊 Changes detected:

&nbsp;  - 2 pets adopted

&nbsp;  - 5 new pets available

✅ Check complete

```



\### Discord Notifications



Adoption announcement:

```

🎉 Pet Adopted!

Buddy has been adopted!

Breed: German Shepherd mix

Days in Shelter: 45



🏆 Points Awarded:

• John earned 2 points in Houston League

• Sarah earned 2 points in Austin League

```



\## 📈 Statistics Tracking



The bot tracks:

\- Total checks performed

\- Total adoptions detected

\- Total new pets found

\- Total points awarded

\- Time since last check



Access via `!stats` command or check `bot\_state.json`



\## 🐛 Troubleshooting



\### Bot Not Responding

```bash

\# Check logs

npm start



\# Verify token

echo $DISCORD\_BOT\_TOKEN



\# Test database connection

psql $DATABASE\_URL -c "SELECT 1;"

```



\### Points Not Awarding

```sql

-- Check if pet was drafted

SELECT \* FROM roster\_entries re

JOIN pets p ON p.id = re.pet\_id

WHERE p.pet\_id = 'A2043899';



-- Check breed points

SELECT \* FROM breed\_points WHERE breed = 'German Shepherd mix';



-- Check points table

SELECT \* FROM points ORDER BY awarded\_at DESC LIMIT 10;

```



\### State Issues

```bash

\# Reset state (careful!)

rm bot\_state.json

npm start



\# Or clear from database

psql $DATABASE\_URL -c "DELETE FROM discord\_bot\_state;"

```



\## 🧪 Testing



\### Manual Test

```javascript

// test.js

require('dotenv').config();

const Database = require('./lib/Database');



async function test() {

&nbsp; const db = new Database();

&nbsp; await db.connect();

&nbsp; 

&nbsp; // Test queries

&nbsp; const pets = await db.getAllPets();

&nbsp; console.log(`Found ${pets.length} pets`);

&nbsp; 

&nbsp; await db.close();

}



test();

```



\### Force Adoption Check

Use `!forcecheck` command (admin only) in Discord



\## 🔐 Security



\- Bot token stored in environment variables

\- Database credentials encrypted

\- No direct pet status modification

\- Points can only be awarded once per adoption

\- User permissions checked for admin commands



\## 📝 Maintenance



\### Daily Tasks

\- Monitor Discord notifications

\- Check bot online status

\- Review error logs



\### Weekly Tasks

\- Review adoption statistics

\- Check for stuck pets

\- Verify point calculations



\### Monthly Tasks

\- Clean up old logs

\- Review breed point values

\- Database maintenance



\## 🤝 Contributing



1\. Fork the repository

2\. Create feature branch

3\. Make changes

4\. Test thoroughly

5\. Submit pull request



\## 📄 License



MIT License - See LICENSE file



\## 🆘 Support



\- GitHub Issues: \[Report bugs](https://github.com/yourusername/fantasy-pet-league-bot/issues)

\- Discord Server: Join our community

\- Documentation: Check wiki



\## 🎯 Roadmap



\- \[ ] Slash commands support

\- \[ ] DM notifications for adoptions

\- \[ ] Weekly summary reports

\- \[ ] Breed statistics tracking

\- \[ ] Multi-server support

\- \[ ] Web dashboard

\- \[ ] Prediction system

\- \[ ] Achievement system



---



\*\*Remember:\*\* This bot is the \*\*sole source of truth\*\* for points. No other application should award points directly.

