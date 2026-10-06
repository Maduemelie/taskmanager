/* js/models/task.js */
import db from '../db.js';
import { generateId } from '../utils/id.js';
import { today, daysBetween } from '../utils/date.js';

export const VALID_ENERGY_LEVELS = ['low', 'medium', 'high'];

export const VALID_TASK_STATUSES = [
  'inbox',
  'ready',
  'scheduled',
  'active',
  'completed',
  'skipped',
  'snoozed',
  'archived'
];

export const VALID_TASK_TYPES = ['one_time', 'habit'];

/**
 * State machine allowed transitions according to Section 13
 * INBOX -> READY -> SCHEDULED -> ACTIVE
 *                          ├-> COMPLETED
 *                          ├-> SKIPPED
 *                          └-> READY
 * Snoozed and archived states support suspension and reactivation.
 */
export const TASK_STATUS_TRANSITIONS = {
  inbox: ['ready', 'snoozed', 'archived'],
  ready: ['inbox', 'scheduled', 'active', 'completed', 'snoozed', 'archived'],
  scheduled: ['ready', 'active', 'completed', 'skipped', 'snoozed', 'archived'],
  active: ['completed', 'skipped', 'ready', 'scheduled', 'snoozed', 'archived'],
  completed: ['ready', 'archived'],
  skipped: ['ready', 'inbox', 'archived'],
  snoozed: ['ready', 'inbox', 'archived'],
  archived: ['ready', 'inbox']
};

/**
 * Checks if a status transition is permitted by the state machine.
 * @param {string} fromStatus 
 * @param {string} toStatus 
 * @returns {boolean}
 */
export function canTransitionStatus(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) return false;
  if (fromStatus === toStatus) return true;
  const allowed = TASK_STATUS_TRANSITIONS[fromStatus];
  return Boolean(allowed && allowed.includes(toStatus));
}

/**
 * Normalizes input object to adhere to canonical Section 7.1 Task domain model,
 * ensuring all required fields are typed and valid, with backward compatibility aliases.
 * 
 * @param {Object} raw 
 * @returns {Object} Normalized Task object
 */
export function normalizeTask(raw = {}) {
  const title = (raw.title !== undefined ? raw.title : (raw.name || '')).trim();
  const categoryId = raw.categoryId || raw.bucket || 'home';
  
  // Normalize energy level (low | medium | high)
  const rawEnergy = (raw.energy || raw.energyLevel || 'medium').toLowerCase();
  const energy = VALID_ENERGY_LEVELS.includes(rawEnergy) ? rawEnergy : 'medium';

  // Normalize priority to 0-100 range
  let priority = 50;
  if (raw.priority !== undefined && raw.priority !== null) {
    const parsed = Number(raw.priority);
    if (!isNaN(parsed)) {
      priority = Math.max(0, Math.min(100, Math.round(parsed)));
    }
  }

  // Normalize urgency (0-100)
  let urgency = 50;
  if (raw.urgency !== undefined && raw.urgency !== null) {
    const parsed = Number(raw.urgency);
    if (!isNaN(parsed)) urgency = Math.max(0, Math.min(100, Math.round(parsed)));
  }

  // Normalize importance (0-100)
  let importance = 50;
  if (raw.importance !== undefined && raw.importance !== null) {
    const parsed = Number(raw.importance);
    if (!isNaN(parsed)) importance = Math.max(0, Math.min(100, Math.round(parsed)));
  }

  // Normalize duration in minutes
  let estimatedMinutes = 30;
  if (raw.estimatedMinutes !== undefined && raw.estimatedMinutes !== null) {
    const parsedMin = parseInt(raw.estimatedMinutes, 10);
    if (!isNaN(parsedMin) && parsedMin > 0) estimatedMinutes = parsedMin;
  }

  // Normalize type
  const isHabit = raw.type === 'habit' || Boolean(raw.isHabit);
  const type = isHabit ? 'habit' : 'one_time';

  // Normalize status
  let status = 'ready';
  if (raw.status && VALID_TASK_STATUSES.includes(raw.status)) {
    status = raw.status;
  } else if (raw.isArchived || (raw.isActive === false && raw.isArchived)) {
    status = 'archived';
  } else if (raw.isActive === false) {
    status = 'completed';
  } else if (raw.status === 'inbox') {
    status = 'inbox';
  }

  const isActive = status !== 'archived' && status !== 'completed';
  const isArchived = status === 'archived';

  return {
    id: raw.id || generateId(),
    userId: raw.userId || 'user_default',
    title,
    name: title, // Legacy alias
    description: raw.description || '',
    categoryId,
    bucket: categoryId, // Legacy alias
    estimatedMinutes,
    priority,
    urgency,
    importance,
    energy,
    energyLevel: energy, // Legacy alias
    focusRequired: Boolean(raw.focusRequired),
    type,
    isHabit, // Legacy alias
    recurrence: raw.recurrence || null,
    preferredTime: raw.preferredTime || 'anytime',
    deadline: raw.deadline || null,
    earliestStart: raw.earliestStart || null,
    latestStart: raw.latestStart || null,
    status,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    lastCompletedAt: raw.lastCompletedAt || null,
    completionHistory: Array.isArray(raw.completionHistory) ? raw.completionHistory : [],
    currentStreak: typeof raw.currentStreak === 'number' ? raw.currentStreak : 0,
    bestStreak: typeof raw.bestStreak === 'number' ? raw.bestStreak : 0,
    activeUntil: raw.activeUntil || null,
    isActive,
    isArchived
  };
}

/**
 * Creates a new task in the database with defaults merged and normalized.
 * @param {Object} taskData 
 * @returns {Promise<string>} The ID of the created task
 */
export async function createTask(taskData) {
  const normalizedTask = normalizeTask(taskData);
  await db.tasks.add(normalizedTask);
  return normalizedTask.id;
}

/**
 * Updates an existing task by ID with new changes.
 * Maintains synchronicity between canonical fields and legacy aliases.
 * @param {string} id 
 * @param {Object} changes 
 * @returns {Promise<number>} Number of modified rows
 */
export async function updateTask(id, changes) {
  const sanitized = { ...changes, updatedAt: new Date().toISOString() };

  if (sanitized.title !== undefined || sanitized.name !== undefined) {
    const val = (sanitized.title !== undefined ? sanitized.title : sanitized.name).trim();
    sanitized.title = val;
    sanitized.name = val;
  }

  if (sanitized.categoryId !== undefined || sanitized.bucket !== undefined) {
    const val = sanitized.categoryId || sanitized.bucket;
    sanitized.categoryId = val;
    sanitized.bucket = val;
  }

  if (sanitized.energy !== undefined || sanitized.energyLevel !== undefined) {
    const rawE = (sanitized.energy || sanitized.energyLevel || 'medium').toLowerCase();
    const e = VALID_ENERGY_LEVELS.includes(rawE) ? rawE : 'medium';
    sanitized.energy = e;
    sanitized.energyLevel = e;
  }

  if (sanitized.priority !== undefined) {
    const p = Number(sanitized.priority);
    if (!isNaN(p)) {
      sanitized.priority = Math.max(0, Math.min(100, Math.round(p)));
    }
  }

  if (sanitized.status !== undefined && VALID_TASK_STATUSES.includes(sanitized.status)) {
    sanitized.isActive = sanitized.status !== 'archived' && sanitized.status !== 'completed';
    sanitized.isArchived = sanitized.status === 'archived';
  } else if (sanitized.isActive !== undefined || sanitized.isArchived !== undefined) {
    if (sanitized.isArchived) {
      sanitized.status = 'archived';
      sanitized.isActive = false;
    } else if (sanitized.isActive === false) {
      sanitized.status = 'completed';
      sanitized.isArchived = false;
    } else if (sanitized.isActive === true || sanitized.isArchived === false) {
      sanitized.status = 'ready';
      sanitized.isActive = true;
      sanitized.isArchived = false;
    }
  }

  if (sanitized.type !== undefined || sanitized.isHabit !== undefined) {
    const isHabit = sanitized.type === 'habit' || Boolean(sanitized.isHabit);
    sanitized.type = isHabit ? 'habit' : 'one_time';
    sanitized.isHabit = isHabit;
  }

  return await db.tasks.update(id, sanitized);
}

/**
 * Transitions task status following Section 13 state machine.
 * Throws an error if transition is illegal.
 * 
 * @param {string} taskId 
 * @param {string} nextStatus 
 * @returns {Promise<Object>} Updated task object
 */
export async function transitionTaskStatus(taskId, nextStatus) {
  const task = await getTask(taskId);
  if (!task) {
    throw new Error(`Task with ID ${taskId} not found`);
  }

  if (!VALID_TASK_STATUSES.includes(nextStatus)) {
    throw new Error(`Invalid status '${nextStatus}'. Must be one of: ${VALID_TASK_STATUSES.join(', ')}`);
  }

  const currentStatus = task.status || (task.isArchived ? 'archived' : (task.isActive === false ? 'completed' : 'ready'));

  if (!canTransitionStatus(currentStatus, nextStatus)) {
    throw new Error(`Illegal status transition from '${currentStatus}' to '${nextStatus}'`);
  }

  const changes = {
    status: nextStatus,
    isActive: nextStatus !== 'archived' && nextStatus !== 'completed',
    isArchived: nextStatus === 'archived',
    updatedAt: new Date().toISOString()
  };

  if (nextStatus === 'completed') {
    changes.lastCompletedAt = new Date().toISOString();
  }

  await updateTask(taskId, changes);
  return { ...task, ...changes };
}

/**
 * Soft-deletes/archives a task.
 * @param {string} id 
 * @returns {Promise<void>}
 */
export async function deleteTask(id) {
  await updateTask(id, { isActive: false, isArchived: true, status: 'archived' });
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
 * Includes inbox, ready, scheduled, active, snoozed states.
 * @returns {Promise<Array>}
 */
export async function getActiveTasks() {
  return await db.tasks.filter(task => {
    if (task.status) {
      return task.status !== 'archived' && task.status !== 'completed';
    }
    return task.isActive && !task.isArchived;
  }).toArray();
}

/**
 * Retrieves all active tasks for a specific bucket category.
 * @param {string} bucketId 
 * @returns {Promise<Array>}
 */
export async function getTasksByBucket(bucketId) {
  return await db.tasks.filter(task => {
    const isCategory = (task.categoryId === bucketId || task.bucket === bucketId);
    const isAct = task.status ? (task.status !== 'archived' && task.status !== 'completed') : (task.isActive && !task.isArchived);
    return isCategory && isAct;
  }).toArray();
}

/**
 * Retrieves tasks with a specific status.
 * @param {string} status 
 * @returns {Promise<Array>}
 */
export async function getTasksByStatus(status) {
  return await db.tasks.filter(task => task.status === status).toArray();
}

/**
 * Records completion of a task, updates its completion history and streaks.
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

  const historyList = Array.isArray(task.completionHistory) ? task.completionHistory : [];
  const alreadyCompletedToday = historyList.some(entry => entry && entry.date === completionDate);

  const updatedHistory = [...historyList, completionEntry];
  const lastCompletedAt = completionEntry.completedAt;

  let currentStreak = task.currentStreak || 0;
  let bestStreak = task.bestStreak || 0;

  if (!alreadyCompletedToday) {
    const streakResult = calculateNewStreak(updatedHistory, task.recurrence);
    currentStreak = streakResult.currentStreak;
    bestStreak = Math.max(bestStreak, currentStreak);
  }

  const changes = {
    completionHistory: updatedHistory,
    lastCompletedAt,
    currentStreak,
    bestStreak,
    // If not recurring/habit, transition to completed
    status: (task.recurrence || task.type === 'habit' || task.isHabit) ? 'ready' : 'completed'
  };

  await updateTask(taskId, changes);
  return { ...task, ...changes };
}

/**
 * Helper to calculate new streak based on completion history and recurrence pattern.
 */
function calculateNewStreak(completionHistory, recurrence) {
  if (!completionHistory || completionHistory.length === 0) {
    return { currentStreak: 0 };
  }

  const uniqueDates = Array.from(new Set(completionHistory.map(h => h.date))).sort().reverse();
  const currentDate = today();
  
  const lastCompletionDate = uniqueDates[0];
  const gap = daysBetween(lastCompletionDate, currentDate);

  if (gap > 1) {
    return { currentStreak: 1 };
  }

  if (!recurrence || recurrence.type === 'daily') {
    let streak = 1;
    for (let i = 0; i < uniqueDates.length - 1; i++) {
      const diff = daysBetween(uniqueDates[i], uniqueDates[i + 1]);
      if (diff === 1) {
        streak++;
      } else if (diff > 1) {
        break;
      }
    }
    return { currentStreak: streak };
  }

  let allowedGap = 8;
  if (recurrence.type === 'monthly') {
    allowedGap = 32;
  } else if (recurrence.type === 'weekly') {
    allowedGap = 8;
  } else if (recurrence.type === 'custom') {
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
 * @param {string} [dateStr] Optional date, defaults to today
 * @returns {Promise<Array>} Overdue tasks
 */
export async function getOverdueTasks(dateStr = today()) {
  const activeTasks = await getActiveTasks();
  
  return activeTasks.filter(task => {
    const historyList = Array.isArray(task.completionHistory) ? task.completionHistory : [];
    const completedToday = historyList.some(entry => entry && entry.date === dateStr);
    if (completedToday) return false;

    if (task.deadline && task.deadline < dateStr) {
      return true;
    }

    return false;
  });
}
