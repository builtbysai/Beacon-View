import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const pool = new Pool({
  connectionString: 'postgresql://beacon_local:local-development-only@127.0.0.1:5432/beacon_secureview',
});

async function seed() {
  const email = 'test@example.com';
  const now = new Date();
  
  // Check if user exists
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  let userId;
  if (userRes.rowCount > 0) {
    userId = userRes.rows[0].id;
  } else {
    userId = randomUUID();
    await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, email]);
  }

  // Check if household exists for user
  const hhRes = await pool.query('SELECT household_id FROM household_members WHERE user_id = $1', [userId]);
  let householdId;
  if (hhRes.rowCount > 0) {
    householdId = hhRes.rows[0].household_id;
  } else {
    householdId = randomUUID();
    await pool.query('INSERT INTO households (id, name, owner_id) VALUES ($1, $2, $3)', [householdId, 'My Home', userId]);
    await pool.query('INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, $3)', [householdId, userId, 'owner']);
  }

  await pool.query('DELETE FROM motion_events WHERE camera_source_id IN (SELECT id FROM camera_sources WHERE device_id IN (SELECT id FROM cameras WHERE household_id = $1))', [householdId]);
  await pool.query('DELETE FROM camera_sources WHERE device_id IN (SELECT id FROM cameras WHERE household_id = $1)', [householdId]);
  await pool.query('DELETE FROM cameras WHERE household_id = $1', [householdId]);
  
  // Clean fake users
  await pool.query('DELETE FROM household_members WHERE household_id = $1 AND user_id != $2', [householdId, userId]);
  
  const setupFakeUser = async (userEmail, role, expiresAt = null) => {
    let uid;
    const res = await pool.query('SELECT id FROM users WHERE email = $1', [userEmail]);
    if (res.rowCount > 0) {
      uid = res.rows[0].id;
    } else {
      uid = randomUUID();
      await pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [uid, userEmail]);
    }
    if (expiresAt) {
      await pool.query('INSERT INTO household_members (household_id, user_id, role, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [householdId, uid, role, expiresAt]);
    } else {
      await pool.query('INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [householdId, uid, role]);
    }
  };

  await setupFakeUser('viewer@example.com', 'viewer');
  await setupFakeUser('guest@example.com', 'guest', new Date(now.getTime() + 1000000000));

  // Add fake devices
  const onlineDate = new Date(now.getTime() - 10000);
  const offlineDate = new Date(now.getTime() - 1000000);

  const devices = [
    { id: randomUUID(), name: 'Front Door', lastSeen: offlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Living Room', lastSeen: offlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Backyard', lastSeen: offlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Kitchen', lastSeen: onlineDate, privacy: false, platform: 'browser' }, 
    { id: randomUUID(), name: 'Garage', lastSeen: onlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Nursery', lastSeen: onlineDate, privacy: true, platform: 'android' }, 
    { id: randomUUID(), name: 'Side Gate', lastSeen: onlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Office', lastSeen: offlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Driveway', lastSeen: onlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Patio', lastSeen: onlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Workshop', lastSeen: offlineDate, privacy: false, platform: 'android' }, 
    { id: randomUUID(), name: 'Entry Hall', lastSeen: onlineDate, privacy: false, platform: 'browser' }
  ];

  for (const d of devices) {
    await pool.query(
      'INSERT INTO cameras (id, household_id, public_device_id, installation_id, name, last_seen_at, privacy_mode, platform) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', 
      [d.id, householdId, randomUUID(), randomUUID(), d.name, d.lastSeen, d.privacy, d.platform]
    );

    const sourceId = randomUUID();
    // Add camera source for each
    await pool.query(
      'INSERT INTO camera_sources (id, device_id, public_camera_id, display_name, source_key) VALUES ($1, $2, $3, $4, $5)',
      [sourceId, d.id, randomUUID(), 'Main', 'main']
    );

    // Add some motion events for online cameras
    if (d.lastSeen === onlineDate) {
      await pool.query(
        'INSERT INTO motion_events (id, camera_source_id, confidence, occurred_at) VALUES ($1, $2, $3, $4)',
        [randomUUID(), sourceId, 0.85, new Date(now.getTime() - 60000 * Math.floor(Math.random() * 60))]
      );
      await pool.query(
        'INSERT INTO motion_events (id, camera_source_id, confidence, occurred_at) VALUES ($1, $2, $3, $4)',
        [randomUUID(), sourceId, 0.92, new Date(now.getTime() - 120000 * Math.floor(Math.random() * 60))]
      );
    }
  }

  console.log('Seeded demo cameras, users, and motion events for test@example.com');
  pool.end();
}

seed().catch(console.error);
