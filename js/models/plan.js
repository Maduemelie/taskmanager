/* js/models/plan.js */
import db from '../db.js';
import { generateId } from '../utils/id.js';
import { today } from '../utils/date.js';
import { recordCompletion } from './task.js';

/**
 * Retrieves the daily plan for today.
 * @returns {Promise<Object|undefined>}
 */
export async function getTodayPlan() {
  return await getPlanForDate(today());
}

/**
 * Retrieves the daily plan for a specific date (YYYY-MM-DD).
 * @param {string} dateStr 
 * @returns {Promise<Object|undefined>}
 */
export async function getPlanForDate(dateStr) {
  return await db.dailyPlans.where('date').equals(dateStr).first();
}

/**
 * Creates a new daily plan.
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} capacity In minutes
 * @param {Array} plannedTasks Array of tasks to schedule
 * @returns {Promise<string>} The ID of the created plan
 */
export async function createPlan(dateStr, capacity, plannedTasks) {
  // Format plannedTasks with defaults
  const formattedTasks = plannedTasks.map(task => ({
    taskId: task.taskId,
    scheduledTime: task.scheduledTime || '09:00',
    estimatedMinutes: task.estimatedMinutes || 30,
    status: 'pending', // pending | in-progress | completed | skipped | rescheduled
    completedAt: null,
    actualMinutes: null,
    isUnplanned: task.isUnplanned || false
  }));

  const newPlan = {
    id: generateId(),
    date: dateStr,
    capacity: capacity,
    plannedTasks: formattedTasks,
    energyProfile: 'default',
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString()
  };

  await db.dailyPlans.add(newPlan);
  return newPlan.id;
}

/**
 * Updates a plan directly.
 * @param {string} planId 
 * @param {Object} changes 
 * @returns {Promise<number>}
 */
export async function updatePlan(planId, changes) {
  const updatedChanges = {
    ...changes,
    lastModifiedAt: new Date().toISOString()
  };
  return await db.dailyPlans.update(planId, updatedChanges);
}

/**
 * Adds an interruption / unplanned task to the active plan.
 * @param {string} planId 
 * @param {Object} taskEntry { taskId, estimatedMinutes, scheduledTime }
 */
export async function addTaskToPlan(planId, taskEntry) {
  const plan = await db.dailyPlans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const newTask = {
    taskId: taskEntry.taskId,
    scheduledTime: taskEntry.scheduledTime || '12:00',
    estimatedMinutes: taskEntry.estimatedMinutes || 30,
    status: 'pending',
    completedAt: null,
    actualMinutes: null,
    isUnplanned: taskEntry.isUnplanned !== undefined ? taskEntry.isUnplanned : true
  };

  const updatedTasks = [...plan.plannedTasks, newTask];
  await updatePlan(planId, { plannedTasks: updatedTasks });
}

/**
 * Removes a task from a daily plan.
 * @param {string} planId 
 * @param {string} taskId 
 */
export async function removeTaskFromPlan(planId, taskId) {
  const plan = await db.dailyPlans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const updatedTasks = plan.plannedTasks.filter(t => t.taskId !== taskId);
  await updatePlan(planId, { plannedTasks: updatedTasks });
}

/**
 * Marks the status of a task in the plan. If status is 'completed',
 * it automatically logs completion in the tasks store to increment streaks.
 * @param {string} planId 
 * @param {string} taskId 
 * @param {string} status 'pending' | 'in-progress' | 'completed' | 'skipped' | 'rescheduled'
 * @param {number} [actualMinutes] 
 */
export async function markTaskStatus(planId, taskId, status, actualMinutes = null) {
  const plan = await db.dailyPlans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  let completionData = null;
  
  const updatedTasks = await Promise.all(plan.plannedTasks.map(async (t) => {
    if (t.taskId === taskId) {
      const isCompleted = status === 'completed';
      
      if (isCompleted && t.status !== 'completed') {
        // Record in the task master list (updates history, streaks)
        completionData = await recordCompletion(taskId, actualMinutes || t.estimatedMinutes);
      }

      return {
        ...t,
        status,
        actualMinutes: actualMinutes || t.estimatedMinutes,
        completedAt: isCompleted ? new Date().toISOString() : t.completedAt
      };
    }
    return t;
  }));

  await updatePlan(planId, { plannedTasks: updatedTasks });
  return completionData;
}

/**
 * Closes out a plan at the end of the day.
 * Marks any remaining pending/in-progress tasks as skipped.
 * @param {string} planId 
 * @returns {Promise<Array<string>>} List of taskIds that were skipped (returned to bucket)
 */
export async function processEndOfDay(planId) {
  const plan = await db.dailyPlans.get(planId);
  if (!plan) return [];

  const skippedTaskIds = [];
  const updatedTasks = plan.plannedTasks.map(t => {
    if (t.status === 'pending' || t.status === 'in-progress') {
      skippedTaskIds.push(t.taskId);
      return {
        ...t,
        status: 'skipped',
        actualMinutes: 0
      };
    }
    return t;
  });

  await updatePlan(planId, { plannedTasks: updatedTasks });
  console.log(`[End of Day] Processed plan ${plan.date}. Skipped ${skippedTaskIds.length} tasks.`);
  return skippedTaskIds;
}

/**
 * Checks if a plan's date is in the past, meaning it needs end-of-day processing.
 * @param {Object} plan 
 * @returns {boolean}
 */
export function isStale(plan) {
  return plan.date < today();
}
