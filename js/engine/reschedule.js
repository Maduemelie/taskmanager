/* js/engine/reschedule.js */
import { scoreTask } from './scoring.js';
import { today, formatTime } from '../utils/date.js';

/**
 * Inserts an unplanned task into today's plan at the designated insertTime.
 * @param {Object} plan The daily plan object
 * @param {Object} newTask The new task to add { taskId, name, bucket, estimatedMinutes }
 * @param {string} insertTime The time it occurred (e.g., "14:15")
 * @returns {Object} The updated plan object
 */
export function addUnplannedTask(plan, newTask, insertTime) {
  const entry = {
    taskId: newTask.taskId,
    name: newTask.name,
    bucket: newTask.bucket || 'unplanned',
    estimatedMinutes: newTask.estimatedMinutes || 30,
    scheduledTime: insertTime,
    status: 'pending',
    completedAt: null,
    actualMinutes: null,
    isUnplanned: true
  };

  plan.plannedTasks.push(entry);
  
  // Sort tasks chronologically by scheduled time
  plan.plannedTasks.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  
  return plan;
}

/**
 * Shifts subsequent pending/in-progress tasks forward in time.
 * @param {Object} plan The daily plan object
 * @param {string} fromTime Shift tasks starting at or after this time (e.g., "14:15")
 * @param {number} minutesToShift Number of minutes to push tasks forward
 * @param {string} excludeTaskId ID of the task to exclude from shifting (usually the inserted task itself)
 * @returns {Object} The updated plan object
 */
export function rescheduleRemaining(plan, fromTime, minutesToShift, excludeTaskId = null) {
  const parseTimeToMinutes = (tStr) => {
    const [h, m] = tStr.split(':').map(Number);
    return h * 60 + m;
  };

  const fromMin = parseTimeToMinutes(fromTime);

  plan.plannedTasks = plan.plannedTasks.map(t => {
    // Only shift pending or in-progress tasks starting at/after fromTime (excluding the trigger task)
    if (t.taskId !== excludeTaskId && (t.status === 'pending' || t.status === 'in-progress')) {
      const taskMin = parseTimeToMinutes(t.scheduledTime);
      if (taskMin >= fromMin) {
        const newMin = taskMin + minutesToShift;
        const newHour = Math.floor(newMin / 60) % 24;
        const newMins = newMin % 60;
        
        return {
          ...t,
          scheduledTime: formatTime(newHour, newMins)
        };
      }
    }
    return t;
  });

  // Re-sort chronologically
  plan.plannedTasks.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

  return plan;
}

/**
 * Calculates current daily duration and suggests pending tasks to defer if over capacity.
 * @param {Object} plan The daily plan object
 * @param {number} capacity User capacity in minutes
 * @param {Array} allTasks All task definitions from the database (for scoring)
 * @param {Object} preferences User preferences
 * @param {string} energyLevel Current energy level
 * @returns {Array} List of task entries suggested for deferral [{ taskId, name, estimatedMinutes }]
 */
export function suggestDeferrals(plan, capacity, allTasks, preferences, energyLevel) {
  // 1. Calculate current plan focus minutes (excluding rescheduled and skipped ones)
  const activeTasks = plan.plannedTasks.filter(t => t.status !== 'rescheduled' && t.status !== 'skipped');
  const totalDuration = activeTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);

  if (totalDuration <= capacity) {
    return []; // Within capacity limits, no deferrals needed
  }

  let overage = totalDuration - capacity;
  const deferrals = [];

  // 2. Find tasks that are eligible for deferral (pending and not unplanned if possible, sorted by score ascending)
  const pendingTasks = plan.plannedTasks.filter(t => t.status === 'pending');
  
  // Build a lookup map for master tasks
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  // Score each pending task
  const scoredPending = pendingTasks.map(pt => {
    let masterTask = taskMap.get(pt.taskId);
    
    // Synthesize a master task if it was a quick-added unplanned task
    if (!masterTask) {
      masterTask = {
        id: pt.taskId,
        name: pt.name,
        bucket: pt.bucket || 'unplanned',
        priority: 2,
        estimatedMinutes: pt.estimatedMinutes,
        energyLevel: 'medium',
        preferredTime: 'anytime',
        createdAt: new Date().toISOString(),
        completionHistory: [],
        currentStreak: 0,
        bestStreak: 0,
        isActive: true,
        isArchived: false
      };
    }

    const score = scoreTask(masterTask, {
      date: plan.date,
      currentPlan: plan.plannedTasks.filter(t => t.taskId !== pt.taskId), // score without current task
      energyWindow: energyLevel,
      preferences
    });

    return {
      planEntry: pt,
      score: score
    };
  });

  // Sort by score ascending (lowest score = first to defer)
  scoredPending.sort((a, b) => a.score - b.score);

  // 3. Collect deferrals until capacity is satisfied
  for (const entry of scoredPending) {
    if (overage <= 0) break;
    
    deferrals.push({
      taskId: entry.planEntry.taskId,
      name: entry.planEntry.name,
      estimatedMinutes: entry.planEntry.estimatedMinutes
    });
    
    overage -= entry.planEntry.estimatedMinutes;
  }

  return deferrals;
}

/**
 * Defers tasks in the plan by marking their status as 'rescheduled'.
 * @param {Object} plan The daily plan object
 * @param {Array<string>} taskIdsToDefer List of task IDs to defer
 * @returns {Object} The updated plan object
 */
export function applyDeferrals(plan, taskIdsToDefer) {
  const idsSet = new Set(taskIdsToDefer);
  
  plan.plannedTasks = plan.plannedTasks.map(t => {
    if (idsSet.has(t.taskId)) {
      return {
        ...t,
        status: 'rescheduled'
      };
    }
    return t;
  });

  return plan;
}
