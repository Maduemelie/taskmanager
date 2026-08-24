/* js/models/task.js */
import db from '../db.js';
import { generateId } from '../utils/id.js';
import { today, daysBetween } from '../utils/date.js';

/**
 * Creates a new task in the database with defaults merged.
 * @param {Object} taskData 
 * @returns {Promise<string>} The ID of the created task
 */
export async function createTask(taskData) {
  const defaultTask = {
    id: generateId(),
    name: '',
    bucket: 'home',
    priority: 3,
    estimatedMinutes: 30,
    energyLevel: 'medium',
    preferredTime: 'anytime',
    recurrence: null, // e.g. { type: 'daily' } or { type: 'weekly', daysOfWeek: [1, 3] }
    deadline: null,
    activeUntil: null,
    createdAt: new Date().toISOString(),
    lastCompletedAt: null,
    completionHistory: [], // Array of { completedAt: string, date: string, actualMinutes: number }
    currentStreak: 0,
    bestStreak: 0,
    isActive: true,
    isArchived: false
  };

  const finalTask = { ...defaultTask, ...taskData };
  await db.tasks.add(finalTask);
  return finalTask.id;
}

/**
 * Updates an existing task by ID with new changes.
 * @param {string} id 
 * @param {Object} changes 
 * @returns {Promise<number>} Number of modified rows
 */
export async function updateTask(id, changes) {
  return await db.tasks.update(id, changes);
}

/**
 * Soft-deletes/archives a task or deletes it permanently. We'll soft-delete.
 * @param {string} id 
 * @returns {Promise<void>}
 */
export async function deleteTask(id) {
  // We'll perform a soft-delete by setting isActive to false and archiving it
  await db.tasks.update(id, { isActive: false, isArchived: true });
}

/**
 * Gets a task by its ID.
 * @param {string} id 
 * @returns {Promise<Object|undefined>}
 */
export async function getTask(id) {
  return await db.tasks.get(id);
}

/**
 * Retrieves all tasks (including inactive/archived ones).
 * @returns {Promise<Array>}
 */
export async function getAllTasks() {
  return await db.tasks.toArray();
}

/**
 * Retrieves all active, non-archived tasks.
 * @returns {Promise<Array>}
 */
export async function getActiveTasks() {
  return await db.tasks.filter(task => task.isActive && !task.isArchived).toArray();
}

/**
 * Retrieves all active tasks for a specific bucket category.
 * @param {string} bucketId 
 * @returns {Promise<Array>}
 */
export async function getTasksByBucket(bucketId) {
  return await db.tasks
    .where('bucket').equals(bucketId)
    .filter(task => task.isActive && !task.isArchived)
    .toArray();
}

/**
 * Records completion of a task, updates its completion history and updates streaks.
 * @param {string} taskId 
 * @param {number} actualMinutes 
 * @returns {Promise<Object>} The updated task object
 */
export async function recordCompletion(taskId, actualMinutes) {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task with ID ${taskId} not found`);

  const completionDate = today();
  const completionEntry = {
    completedAt: new Date().toISOString(),
    date: completionDate,
    actualMinutes: actualMinutes || task.estimatedMinutes
  };

  // Prevent multiple completions on the same day for streak counts
  const historyList = Array.isArray(task.completionHistory) ? task.completionHistory : [];
  const alreadyCompletedToday = historyList.some(entry => entry && entry.date === completionDate);

  const updatedHistory = [...historyList, completionEntry];
  const lastCompletedAt = completionEntry.completedAt;

  let currentStreak = task.currentStreak;
  let bestStreak = task.bestStreak;

  if (!alreadyCompletedToday) {
    // Recalculate streak
    const streakResult = calculateNewStreak(updatedHistory, task.recurrence);
    currentStreak = streakResult.currentStreak;
    bestStreak = Math.max(bestStreak, currentStreak);
  }

  const changes = {
    completionHistory: updatedHistory,
    lastCompletedAt,
    currentStreak,
    bestStreak
  };

  await updateTask(taskId, changes);
  return { ...task, ...changes };
}

/**
 * Helper to calculate new streak based on completion history and recurrence pattern.
 * Simple algorithm:
 * - Sort history by date descending
 * - Check if the last completion is today or yesterday
 * - Loop backwards through unique completion dates to count consecutive completions matching recurrence
 */
function calculateNewStreak(completionHistory, recurrence) {
  if (!completionHistory || completionHistory.length === 0) {
    return { currentStreak: 0 };
  }

  // Get unique dates sorted descending
  const uniqueDates = Array.from(new Set(completionHistory.map(h => h.date))).sort().reverse();
  const currentDate = today();
  
  // If the last completion is not today and not yesterday, the streak is broken
  const lastCompletionDate = uniqueDates[0];
  const gap = daysBetween(lastCompletionDate, currentDate);

  if (gap > 1) {
    // Streak is broken
    return { currentStreak: 1 }; // Just completed today, so streak starts at 1
  }

  // If the recurrence is null or daily, we just count consecutive days
  if (!recurrence || recurrence.type === 'daily') {
    let streak = 1;
    for (let i = 0; i < uniqueDates.length - 1; i++) {
      const diff = daysBetween(uniqueDates[i], uniqueDates[i + 1]);
      if (diff === 1) {
        streak++;
      } else if (diff > 1) {
        break; // Streak broken in the past
      }
    }
    return { currentStreak: streak };
  }

  // For weekly/monthly, it can be more complex.
  // A simple approximation for weekly/monthly: count consecutive completions where interval isn't exceeded.
  // For weekly, gap shouldn't be more than 8 days. For monthly, not more than 32 days.
  let allowedGap = 8;
  if (recurrence.type === 'monthly') {
    allowedGap = 32;
  } else if (recurrence.type === 'weekly') {
    // If specific days are selected, e.g. Mon, Wed. The allowed gap between consecutive scheduled days is variable.
    // We will allow up to 8 days to keep it robust.
    allowedGap = 8;
  } else if (recurrence.type === 'custom') {
    // custom repeats every N days. Allowed gap is N + 1 days.
    allowedGap = (recurrence.interval || 1) + 1;
  }

  let streak = 1;
  for (let i = 0; i < uniqueDates.length - 1; i++) {
    const diff = daysBetween(uniqueDates[i], uniqueDates[i + 1]);
    if (diff <= allowedGap) {
      streak++;
    } else {
      break;
    }
  }
  return { currentStreak: streak };
}

/**
 * Gets tasks that are overdue.
 * Overdue means: active, non-archived, recurring or non-recurring tasks that have a deadline in the past 
 * and have not been completed today.
 * @param {string} [dateStr] Optional date, defaults to today
 * @returns {Promise<Array>} Overdue tasks
 */
export async function getOverdueTasks(dateStr = today()) {
  const activeTasks = await getActiveTasks();
  
  return activeTasks.filter(task => {
    // Check if completed today
    const historyList = Array.isArray(task.completionHistory) ? task.completionHistory : [];
    const completedToday = historyList.some(entry => entry && entry.date === dateStr);
    if (completedToday) return false;

    // Non-recurring task with deadline in the past
    if (task.deadline && task.deadline < dateStr) {
      return true;
    }

    return false;
  });
}
