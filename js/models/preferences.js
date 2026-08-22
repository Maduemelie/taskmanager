/* js/models/preferences.js */
import db from '../db.js';

const PREFS_ID = 'user_default';

const DEFAULT_PREFERENCES = {
  id: PREFS_ID,
  defaultCapacity: 300, // minutes
  wakeTime: '07:00',
  sleepTime: '23:00',
  energyCurve: {
    morning: 'high',
    afternoon: 'medium',
    evening: 'low'
  },
  buckets: [
    { id: 'health', name: 'Health', emoji: '💪', color: '#4CAF50' },
    { id: 'learning', name: 'Learning', emoji: '📚', color: '#2196F3' },
    { id: 'home', name: 'Home', emoji: '🏠', color: '#FF9800' },
    { id: 'finance', name: 'Finance', emoji: '💰', color: '#9C27B0' },
    { id: 'relationships', name: 'Relationships', emoji: '❤️', color: '#E91E63' }
  ]
};

/**
 * Retrieves the stored user preferences or creates and returns defaults.
 * @returns {Promise<Object>}
 */
export async function getPreferences() {
  let prefs = await db.preferences.get(PREFS_ID);
  if (!prefs) {
    prefs = { ...DEFAULT_PREFERENCES };
    await db.preferences.add(prefs);
  }
  return prefs;
}

/**
 * Updates user preferences in the database.
 * @param {Object} changes 
 * @returns {Promise<void>}
 */
export async function updatePreferences(changes) {
  const current = await getPreferences();
  const updated = { ...current, ...changes };
  await db.preferences.put(updated);
}

/**
 * Adds a new bucket category.
 * @param {string} name 
 * @param {string} emoji 
 * @param {string} color Hex code
 * @returns {Promise<Object>} The created bucket object
 */
export async function addBucket(name, emoji, color) {
  const prefs = await getPreferences();
  
  // Generate a URL-safe slug for the bucket ID
  let id = name.toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  
  if (!id) id = 'custom-' + Math.floor(Math.random() * 1000);
  
  // Check duplicate
  const exists = prefs.buckets.some(b => b.id === id);
  if (exists) {
    id = `${id}-${Math.floor(Math.random() * 1000)}`;
  }

  const newBucket = { id, name, emoji, color };
  const updatedBuckets = [...prefs.buckets, newBucket];
  
  await updatePreferences({ buckets: updatedBuckets });
  return newBucket;
}

/**
 * Updates a bucket definition.
 * @param {string} id 
 * @param {Object} changes 
 * @returns {Promise<void>}
 */
export async function updateBucket(id, changes) {
  const prefs = await getPreferences();
  const updatedBuckets = prefs.buckets.map(b => {
    if (b.id === id) {
      return { ...b, ...changes };
    }
    return b;
  });
  await updatePreferences({ buckets: updatedBuckets });
}

/**
 * Deletes a bucket category.
 * @param {string} id 
 * @returns {Promise<void>}
 */
export async function deleteBucket(id) {
  const prefs = await getPreferences();
  const updatedBuckets = prefs.buckets.filter(b => b.id !== id);
  await updatePreferences({ buckets: updatedBuckets });
}

/**
 * Reorders buckets based on an array of bucket IDs.
 * @param {Array<string>} orderedIds 
 * @returns {Promise<void>}
 */
export async function reorderBuckets(orderedIds) {
  const prefs = await getPreferences();
  
  // Reorder according to the provided ID list
  const bucketMap = new Map(prefs.buckets.map(b => [b.id, b]));
  const reordered = [];
  
  orderedIds.forEach(id => {
    if (bucketMap.has(id)) {
      reordered.push(bucketMap.get(id));
      bucketMap.delete(id);
    }
  });

  // Append any that weren't included in the ordered list
  bucketMap.forEach(b => reordered.push(b));

  await updatePreferences({ buckets: reordered });
}
