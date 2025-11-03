// test.js - Test database connection and basic operations
require('dotenv').config();
const Database = require('./lib/Database');
const StateManager = require('./lib/StateManager');
const PointsManager = require('./lib/PointsManager');

async function runTests() {
  console.log('🧪 Starting Fantasy Pet League Bot Tests\n');
  
  const db = new Database();
  const state = new StateManager('test_state.json');
  const points = new PointsManager(db, state);
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Database Connection
  console.log('📝 Test 1: Database Connection');
  try {
    await db.connect();
    console.log('   ✅ Database connected successfully');
    testsPassed++;
  } catch (error) {
    console.error('   ❌ Database connection failed:', error.message);
    testsFailed++;
    return;
  }
  
  // Test 2: Fetch Pets
  console.log('\n📝 Test 2: Fetch Pets');
  try {
    const pets = await db.getAllPets();
    console.log(`   ✅ Found ${pets.length} pets in database`);
    if (pets.length > 0) {
      console.log(`   📊 Sample: ${pets[0].name} (${pets[0].pet_id}) - ${pets[0].status}`);
    }
    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed to fetch pets:', error.message);
    testsFailed++;
  }
  
  // Test 3: Fetch Leagues
  console.log('\n📝 Test 3: Fetch Leagues');
  try {
    const leagues = await db.getAllLeagues();
    console.log(`   ✅ Found ${leagues.length} leagues`);
    if (leagues.length > 0) {
      console.log(`   📊 Sample: ${leagues[0].name}`);
    }
    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed to fetch leagues:', error.message);
    testsFailed++;
  }
  
  // Test 4: State Management
  console.log('\n📝 Test 4: State Management');
  try {
    await state.load();
    console.log('   ✅ State loaded successfully');
    
    const pets = await db.getAllPets();
    state.updatePets(pets);
    await state.save();
    console.log('   ✅ State saved successfully');
    
    const stats = state.getStatistics();
    console.log(`   📊 Stats: ${stats.totalChecks} checks performed`);
    testsPassed++;
  } catch (error) {
    console.error('   ❌ State management failed:', error.message);
    testsFailed++;
  }
  
  // Test 5: Check for Recent Adoptions
  console.log('\n📝 Test 5: Check for Recent Adoptions');
  try {
    const query = `
      SELECT * FROM pets 
      WHERE status = 'removed' 
      ORDER BY last_seen DESC 
      LIMIT 5
    `;
    const result = await db.pool.query(query);
    console.log(`   ✅ Found ${result.rows.length} recently adopted pets`);
    
    if (result.rows.length > 0) {
      console.log('   📊 Recent adoptions:');
      result.rows.forEach(pet => {
        console.log(`      - ${pet.name} (${pet.pet_id})`);
      });
    }
    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed to check adoptions:', error.message);
    testsFailed++;
  }
  
  // Test 6: Breed Points
  console.log('\n📝 Test 6: Breed Points');
  try {
    const query = 'SELECT * FROM breed_points LIMIT 5';
    const result = await db.pool.query(query);
    console.log(`   ✅ Found ${result.rows.length} breed point configurations`);
    
    if (result.rows.length > 0) {
      console.log('   📊 Sample breed points:');
      result.rows.forEach(bp => {
        console.log(`      - ${bp.breed}: ${bp.points} points`);
      });
    }
    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed to fetch breed points:', error.message);
    testsFailed++;
  }
  
  // Test 7: Leaderboard
  console.log('\n📝 Test 7: Leaderboard Check');
  try {
    const leagues = await db.getAllLeagues();
    if (leagues.length > 0) {
      const leaderboard = await db.getLeaderboard(leagues[0].id, 5);
      console.log(`   ✅ Leaderboard for "${leagues[0].name}": ${leaderboard.length} entries`);
      
      if (leaderboard.length > 0) {
        console.log('   📊 Top players:');
        leaderboard.slice(0, 3).forEach(entry => {
          console.log(`      #${entry.rank} ${entry.first_name}: ${entry.total_points} pts`);
        });
      }
    }
    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed to fetch leaderboard:', error.message);
    testsFailed++;
  }
  
  // Test 8: Global Statistics
  console.log('\n📝 Test 8: Global Statistics');
  try {
    const stats = await db.getStats();
    console.log('   ✅ Global stats retrieved:');
    console.log(`      - Available pets: ${stats.available_pets}`);
    console.log(`      - Adopted pets: ${stats.adopted_pets}`);
    console.log(`      - Total users: ${stats.total_users}`);
    console.log(`      - Total leagues: ${stats.total_leagues}`);
    console.log(`      - Points awarded: ${stats.total_points_awarded}`);
    console.log(`      - Pets drafted: ${stats.total_drafted}`);
    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed to get statistics:', error.message);
    testsFailed++;
  }
  
  // Clean up
  await db.close();
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${Math.round(testsPassed / (testsPassed + testsFailed) * 100)}%`);
  
  if (testsFailed === 0) {
    console.log('\n🎉 All tests passed! Bot is ready to run.');
  } else {
    console.log('\n⚠️  Some tests failed. Please check your configuration.');
  }
  
  process.exit(testsFailed === 0 ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Test suite failed:', error);
  process.exit(1);
});