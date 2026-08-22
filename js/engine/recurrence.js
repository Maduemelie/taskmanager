/* js/engine/recurrence.js */
import { daysBetween, formatDateLocal } from '../utils/date.js';

/**
 * Checks if a task is active on a given date.
 * Active means not archived, is active, date is after creation, and before expiration.
 * @param {Object} task 
 * @param {string} dateStr YYYY-MM-DD
 * @returns {boolean}
 */
export function isTaskActive(task, dateStr) {
  if (!task.isActive || task.isArchived) return false;
  
  const createdDate = task.createdAt.split('T')[0];
  if (dateStr < createdDate) return false;
  
  if (task.activeUntil && dateStr > task.activeUntil) return false;
  
  return true;
}

/**
 * Determines if a task is due on a given date.
 * Handles non-recurring and recurring tasks.
 * @param {Object} task 
 * @param {string} dateStr YYYY-MM-DD
 * @returns {boolean}
 */
export function isTaskDueOn(task, dateStr) {
  // 1. Must be active
  if (!isTaskActive(task, dateStr)) return false;

  // 2. Check if already completed on this date
  const completedOnDate = task.completionHistory.some(entry => entry.date === dateStr);
  if (completedOnDate) return false;

  // 3. Non-recurring tasks
  if (!task.recurrence) {
    // If it has never been completed, it's available to schedule
    return !task.lastCompletedAt;
  }

  // 4. Recurring tasks dispatcher
  const { type, interval = 1 } = task.recurrence;
  const lastCompDateStr = task.lastCompletedAt ? task.lastCompletedAt.split('T')[0] : null;

  switch (type) {
    case 'daily':
      return isDailyDue(dateStr, lastCompDateStr, task.createdAt.split('T')[0], interval);
      
    case 'weekly':
      return isWeeklyDue(dateStr, lastCompDateStr, task.createdAt.split('T')[0], interval, task.recurrence.daysOfWeek);
      
    case 'monthly':
      return isMonthlyDue(dateStr, lastCompDateStr, task.createdAt.split('T')[0], interval, task.recurrence.dayOfMonth);
      
    case 'custom':
      // custom acts like daily every N days
      return isDailyDue(dateStr, lastCompDateStr, task.createdAt.split('T')[0], interval);
      
    default:
      return false;
  }
}

/**
 * Computes the next date a task is due after a given date.
 * Iterates forward up to 365 days to find the next due date.
 * @param {Object} task 
 * @param {string} afterDateStr YYYY-MM-DD
 * @returns {string|null} The next due date as YYYY-MM-DD or null
 */
export function getNextDueDate(task, afterDateStr) {
  if (!task.isActive || task.isArchived) return null;
  
  // Non-recurring task never completed
  if (!task.recurrence) {
    if (!task.lastCompletedAt) {
      // It's due immediately
      const createdDate = task.createdAt.split('T')[0];
      return afterDateStr >= createdDate ? afterDateStr : createdDate;
    }
    return null; // already completed
  }

  // Find next due date by checking consecutive days up to 1 year
  let current = new Date(afterDateStr + 'T00:00:00');
  for (let i = 0; i < 366; i++) {
    const checkDateStr = formatDateLocal(current);
    if (isTaskDueOn(task, checkDateStr)) {
      return checkDateStr;
    }
    current.setDate(current.getDate() + 1);
  }
  return null;
}

/* --- Recurrence Type Helpers --- */

function isDailyDue(dateStr, lastCompletedDateStr, createdDateStr, interval) {
  if (!lastCompletedDateStr) {
    // Never completed. Due if days since creation is a multiple of interval, or just due on any day.
    // In our system, if it's never been done, it's due today.
    return true;
  }
  
  const diff = daysBetween(lastCompletedDateStr, dateStr);
  return diff >= interval;
}

function isWeeklyDue(dateStr, lastCompletedDateStr, createdDateStr, interval, daysOfWeek) {
  const queryDate = new Date(dateStr + 'T00:00:00');
  const queryDayOfWeek = queryDate.getDay(); // 0 = Sun, 1 = Mon...
  
  // 1. Is today one of the selected days?
  if (daysOfWeek && daysOfWeek.length > 0) {
    if (!daysOfWeek.includes(queryDayOfWeek)) return false;
  } else {
    // If no daysOfWeek specified, default to same day of week as creation
    const createdDayOfWeek = new Date(createdDateStr + 'T00:00:00').getDay();
    if (queryDayOfWeek !== createdDayOfWeek) return false;
  }

  if (!lastCompletedDateStr) {
    return true; // Never completed, due on the selected days
  }

  // 2. Check week interval
  // Find Sunday of the week for both dates
  const querySun = getSundayOfDate(queryDate);
  const lastCompSun = getSundayOfDate(new Date(lastCompletedDateStr + 'T00:00:00'));

  const weeksBetween = Math.round(daysBetween(formatDateLocal(lastCompSun), formatDateLocal(querySun)) / 7);
  return weeksBetween >= interval;
}

function isMonthlyDue(dateStr, lastCompletedDateStr, createdDateStr, interval, dayOfMonth) {
  const queryDate = new Date(dateStr + 'T00:00:00');
  const queryDayOfMonth = queryDate.getDate();

  // 1. Is it the correct day of month?
  const targetDay = dayOfMonth || new Date(createdDateStr + 'T00:00:00').getDate();
  if (queryDayOfMonth !== targetDay) return false;

  if (!lastCompletedDateStr) {
    return true;
  }

  // 2. Check month interval
  const lastCompDate = new Date(lastCompletedDateStr + 'T00:00:00');
  const monthsBetween = (queryDate.getFullYear() - lastCompDate.getFullYear()) * 12 + 
                        (queryDate.getMonth() - lastCompDate.getMonth());

  return monthsBetween >= interval;
}

/**
 * Gets Sunday of the week containing date
 */
function getSundayOfDate(date) {
  const d = new Date(date.getTime());
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}
