/* js/db.js */
import Dexie from '../lib/dexie.mjs';

// Initialize the database
const db = new Dexie('TaskPlannerDB');

// Define schema v1
db.version(1).stores({
  tasks: 'id, bucket, isActive, isArchived',
  dailyPlans: 'id, date',
  preferences: 'id'
});

// Schema v3: Add daily feedback for Phase 8
db.version(3).stores({
  tasks: 'id, categoryId, bucket, status, priority, energy, isActive, isArchived',
  dailyPlans: 'id, date',
  preferences: 'id',
  dailyFeedback: 'id, date'
}).upgrade(tx => {
  return tx.tasks.toCollection().modify(task => {
    if (!task.title && task.name) task.title = task.name;
    if (!task.name && task.title) task.name = task.title;
    if (!task.categoryId && task.bucket) task.categoryId = task.bucket;
    if (!task.bucket && task.categoryId) task.bucket = task.categoryId;
    if (!task.energy && task.energyLevel) task.energy = task.energyLevel;
    if (!task.energyLevel && task.energy) task.energyLevel = task.energy;
    if (!task.status) {
      task.status = task.isArchived ? 'archived' : (task.isActive === false ? 'completed' : 'ready');
    }
  });
});

export default db;
export { db };
