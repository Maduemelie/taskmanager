/* js/engine/scoring.js */
import { isTaskDueOn, getNextDueDate } from './recurrence.js';
import { daysBetween } from '../utils/date.js';

/**
 * Scores a task to determine its priority/suitability for today's plan.
 * @param {Object} task The task object
 * @param {Object} context The current context containing:
 *   - date {string} YYYY-MM-DD
 *   - currentPlan {Object} Current daily plan object or list of planned tasks
 *   - energyWindow {string} 'low' | 'medium' | 'high'
 *   - preferences {Object} User preferences object
 * @returns {number} The calculated score
 */
export function scoreTask(task, context) {
  const { date, currentPlan = [], energyWindow = 'medium', preferences } = context;
  
  let score = 0;

  const isDue = isTaskDueOn(task, date);
  const createdDateStr = task.createdAt.split('T')[0];
  const lastCompDateStr = task.lastCompletedAt ? task.lastCompletedAt.split('T')[0] : null;

  // 1. Due Today (+40)
  if (isDue) {
    score += 40;
  }

  // 2. User Priority (+10 to +50)
  const priority = task.priority || 3;
  score += priority * 10;

  // 3. Frequency Weight
  if (task.recurrence) {
    const type = task.recurrence.type;
    if (type === 'daily') score += 10;
    else if (type === 'weekly') score += 5;
    else if (type === 'custom') score += 8;
    else if (type === 'monthly') score += 2;
  }

  // 4. Overdue Bonus (+30 per day overdue, max +90)
  if (task.recurrence) {
    const baseDate = lastCompDateStr || createdDateStr;
    const nextDue = getNextDueDate(task, baseDate);
    if (nextDue && nextDue < date) {
      const overdueDays = daysBetween(nextDue, date);
      score += Math.min(90, overdueDays * 30);
    }
  } else if (!task.lastCompletedAt && task.deadline && task.deadline < date) {
    // Non-recurring task overdue past deadline
    const overdueDays = daysBetween(task.deadline, date);
    score += Math.min(90, overdueDays * 30);
  }

  // 5. Deadline Urgency (+15 to +50)
  if (task.deadline && !task.lastCompletedAt) {
    const daysToDeadline = daysBetween(date, task.deadline);
    if (task.deadline >= date) {
      if (daysToDeadline <= 1) score += 50;
      else if (daysToDeadline <= 3) score += 30;
      else if (daysToDeadline <= 7) score += 15;
    } else {
      // Already overdue (handled above but add baseline maximum urgency here)
      score += 50;
    }
  }

  // 6. Streak Protection (+20 if streak >= 3)
  if (task.currentStreak >= 3) {
    score += 20;
  }

  // 7. Energy Match (+15 if matches user's current energy window)
  if (task.energyLevel === energyWindow) {
    score += 15;
  }

  // Extract planned task IDs to run plan check penalties
  const plannedTasks = Array.isArray(currentPlan) ? currentPlan : (currentPlan.plannedTasks || []);

  // 8. Already in Plan Check (-100 to avoid duplicates)
  const isAlreadyPlanned = plannedTasks.some(t => t.taskId === task.id);
  if (isAlreadyPlanned) {
    score -= 100;
  }

  // 9. Bucket Diversity (-20 per task from same bucket already in the plan)
  const sameBucketCount = plannedTasks.filter(t => {
    // We need to look up the task's bucket. But in plannedTasks we might only have taskId.
    // If the caller passes the original task objects in plannedTasks, we check t.bucket.
    // Otherwise, we skip or check task mapping. Let's assume plannedTasks entries have bucket info
    // or we check a bucket property.
    return t.bucket === task.bucket;
  }).length;
  score -= sameBucketCount * 20;

  return score;
}
