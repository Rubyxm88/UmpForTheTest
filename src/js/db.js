/**
 * IndexedDB Database Management Module for UmpSim3000
 * Handles high-reliability client-side storage, migration, and encryption.
 */

const DB_NAME = 'UmpSimDatabase';
const DB_VERSION = 1;

let dbInstance = null;

/**
 * Initialize IndexedDB database
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store user profiles: { handle, pinHash, xp, level, favoriteTeam, overallAccuracy, maxStreak, completedWeekly, dnfs }
      if (!db.objectStoreNames.contains('profiles')) {
        db.createObjectStore('profiles', { keyPath: 'handle' });
      }

      // Store detailed pitch logs for session recovery (mid-at-bat resets prevention)
      // Key: `${handle}_active_session`
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions');
      }

      // Store cached games metadata & pitch lists
      if (!db.objectStoreNames.contains('game_cache')) {
        db.createObjectStore('game_cache', { keyPath: 'gamePk' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB failed to open:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * SHA-256 Helper for secure credential storage
 */
export async function hashPIN(pin) {
  const msgBuffer = new TextEncoder().encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Perform generic operation on store
 */
function getStore(storeName, mode = 'readonly') {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initDB();
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(transaction.objectStoreNames[0] || storeName);
      resolve(store);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Get profile data
 */
export function getProfile(handle) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initDB();
      const transaction = db.transaction('profiles', 'readonly');
      const store = transaction.objectStore('profiles');
      const request = store.get(handle.toUpperCase());

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Save profile data
 */
export function saveProfile(profile) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initDB();
      const transaction = db.transaction('profiles', 'readwrite');
      const store = transaction.objectStore('profiles');
      
      profile.handle = profile.handle.toUpperCase();
      const request = store.put(profile);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Get active session (mid-game state)
 */
export function getActiveSession(handle) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initDB();
      const transaction = db.transaction('sessions', 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.get(handle.toUpperCase());

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Save active session
 */
export function saveActiveSession(handle, sessionData) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initDB();
      const transaction = db.transaction('sessions', 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.put(sessionData, handle.toUpperCase());

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Clear active session
 */
export function clearActiveSession(handle) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initDB();
      const transaction = db.transaction('sessions', 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.delete(handle.toUpperCase());

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Get game cache (fetch from network fallback)
 */
export function getCachedGame(gamePk) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initDB();
      const transaction = db.transaction('game_cache', 'readonly');
      const store = transaction.objectStore('game_cache');
      const request = store.get(Number(gamePk));

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Save game cache
 */
export function saveCachedGame(gamePk, gameData) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await initDB();
      const transaction = db.transaction('game_cache', 'readwrite');
      const store = transaction.objectStore('game_cache');
      
      const payload = {
        gamePk: Number(gamePk),
        data: gameData,
        timestamp: Date.now()
      };
      
      const request = store.put(payload);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Migrate legacy LocalStorage users into IndexedDB
 */
export async function migrateLegacyData() {
  try {
    const rawUsers = localStorage.getItem('pitch_ump_users');
    if (!rawUsers) return;

    const users = JSON.parse(rawUsers);
    for (const [handle, record] of Object.entries(users)) {
      if (!record || typeof record !== 'object') continue;

      const upperHandle = handle.toUpperCase();
      const existing = await getProfile(upperHandle);
      if (existing) continue;

      // Get stats
      const statsKey = `pitch_ump_stats_${upperHandle}`;
      const rawStats = localStorage.getItem(statsKey);
      const stats = rawStats ? JSON.parse(rawStats) : {};

      // Calculate hash of PIN
      const pinHash = record.pin ? await hashPIN(String(record.pin)) : '';

      // Build new profile
      const newProfile = {
        handle: upperHandle,
        pinHash,
        xp: stats.xp || 0,
        level: stats.level || 1,
        favoriteTeam: stats.favoriteTeam || localStorage.getItem('pitch_ump_favorite_team') || 'none',
        overallAccuracy: stats.overallAccuracy !== undefined ? stats.overallAccuracy : null,
        maxStreak: stats.maxStreak || 0,
        completedWeekly: stats.completedWeekly || 0,
        dnfs: stats.dnfs || 0,
        history: stats.history || []
      };

      await saveProfile(newProfile);
      console.log(`Migrated legacy user: ${upperHandle}`);
    }
  } catch (e) {
    console.warn('Migration of legacy data failed:', e);
  }
}
