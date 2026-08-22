/* js/db.js */
import Dexie from '../lib/dexie.mjs';

// Initialize the database
const db = new Dexie('TaskPlannerDB');

// Define the schema for v1
// Note: We only index properties we plan to query on (filter, sort, etc.)
db.version(1).stores({
  tasks: 'id, bucket, isActive, isArchived',
  dailyPlans: 'id, date',
  preferences: 'id'
});

export default db;
export { db };
