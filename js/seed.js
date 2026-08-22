/* js/seed.js */
import db from './db.js';
import { createTask } from './models/task.js';

// Starter seed tasks
const SEED_TASKS = [
  {
    name: 'Morning Workout 🏃‍♂️',
    bucket: 'health',
    priority: 4,
    estimatedMinutes: 30,
    energyLevel: 'high',
    preferredTime: 'morning',
    recurrence: { type: 'daily', interval: 1 }
  },
  {
    name: 'Read AI & Tech Book 📚',
    bucket: 'learning',
    priority: 3,
    estimatedMinutes: 45,
    energyLevel: 'medium',
    preferredTime: 'evening',
    recurrence: { type: 'daily', interval: 1 }
  },
  {
    name: 'Laundry 🧺',
    bucket: 'home',
    priority: 2,
    estimatedMinutes: 40,
    energyLevel: 'low',
    preferredTime: 'afternoon',
    recurrence: { type: 'weekly', interval: 1, daysOfWeek: [6] } // Saturday
  },
  {
    name: 'Call Mom ❤️',
    bucket: 'relationships',
    priority: 4,
    estimatedMinutes: 30,
    energyLevel: 'low',
    preferredTime: 'evening',
    recurrence: { type: 'weekly', interval: 1, daysOfWeek: [0] } // Sunday
  },
  {
    name: 'Monthly Budget Review 💰',
    bucket: 'finance',
    priority: 5,
    estimatedMinutes: 60,
    energyLevel: 'high',
    preferredTime: 'morning',
    recurrence: { type: 'monthly', interval: 1, dayOfMonth: 1 } // 1st of month
  },
  {
    name: 'Learn React/Web Dev 💻',
    bucket: 'learning',
    priority: 4,
    estimatedMinutes: 90,
    energyLevel: 'high',
    preferredTime: 'afternoon',
    recurrence: { type: 'custom', interval: 2 } // Every 2 days
  },
  {
    name: 'Clean Kitchen Counters 🧼',
    bucket: 'home',
    priority: 2,
    estimatedMinutes: 15,
    energyLevel: 'low',
    preferredTime: 'evening',
    recurrence: { type: 'daily', interval: 1 }
  },
  {
    name: 'Grocery Shopping 🛒',
    bucket: 'home',
    priority: 3,
    estimatedMinutes: 45,
    energyLevel: 'medium',
    preferredTime: 'afternoon',
    recurrence: { type: 'weekly', interval: 1, daysOfWeek: [4] } // Thursday
  },
  {
    name: 'Practice Coding Exercises 🧩',
    bucket: 'learning',
    priority: 4,
    estimatedMinutes: 60,
    energyLevel: 'high',
    preferredTime: 'morning',
    recurrence: { type: 'weekly', interval: 1, daysOfWeek: [1, 2, 3, 4, 5] } // Weekdays
  },
  {
    name: 'Weekly Finances Check 💳',
    bucket: 'finance',
    priority: 3,
    estimatedMinutes: 20,
    energyLevel: 'medium',
    preferredTime: 'morning',
    recurrence: { type: 'weekly', interval: 1, daysOfWeek: [5] } // Friday
  },
  {
    name: 'Date Night 🌹',
    bucket: 'relationships',
    priority: 5,
    estimatedMinutes: 120,
    energyLevel: 'medium',
    preferredTime: 'evening',
    recurrence: { type: 'weekly', interval: 1, daysOfWeek: [5] } // Friday
  },
  {
    name: 'Yoga / Stretching 🧘‍♂️',
    bucket: 'health',
    priority: 3,
    estimatedMinutes: 15,
    energyLevel: 'low',
    preferredTime: 'morning',
    recurrence: { type: 'daily', interval: 1 }
  }
];

/**
 * Seeds the database if the tasks table is currently empty.
 * @returns {Promise<boolean>} True if seed was executed, false if already has data
 */
export async function seedDatabase() {
  const taskCount = await db.tasks.count();
  if (taskCount > 0) {
    console.log('[Seed] Database already has tasks. Skipping seed.');
    return false;
  }

  console.log(`[Seed] Database empty. Seeding ${SEED_TASKS.length} tasks...`);
  
  for (const task of SEED_TASKS) {
    await createTask(task);
  }
  
  console.log('[Seed] Seeding completed.');
  return true;
}

/**
 * Resets all user tables (tasks, dailyPlans, preferences) and re-seeds.
 */
export async function resetDemoData() {
  console.log('[Seed] Resetting demo data...');
  
  // Clear tables
  await db.tasks.clear();
  await db.dailyPlans.clear();
  await db.preferences.clear();
  
  // Re-seed DB (default preferences are auto-created when queried, see preferences.js)
  // Let's seed the tasks
  for (const task of SEED_TASKS) {
    await createTask(task);
  }
  
  console.log('[Seed] Demo data reset successfully.');
}
