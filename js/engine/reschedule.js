/* js/engine/reschedule.js */
import { scoreTask, candidateScore, rankCandidateTasks } from './scoring.js';
import { today, formatTime } from '../utils/date.js';

/**
 * Converts "HH:MM" to minutes from midnight.
 */
function parseTimeToMinutes(tStr) {
  if (typeof tStr === 'number') return tStr;
  if (!tStr || typeof tStr !== 'string') return 0;
  if (tStr.includes('T')) {
    const timePart = tStr.split('T')[1];
    const [h, m] = timePart.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  const [h, m] = tStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Converts minutes from midnight into 24-hour time format "HH:MM".
 */
function formatMinutesToTime(minutes) {
  const normalized = Math.max(0, Math.round(minutes)) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return formatTime(h, m);
}

/**
 * Section 9.1: Evaluates whether a replanning update should be triggered.
 * 
 * @param {Object} context
 * @param {Object} context.plan Active daily plan
 * @param {string} [context.currentTime] Current time string "HH:MM"
 * @param {Object} [context.completedTask] Task just completed { estimatedMinutes, actualMinutes }
 * @param {Object} [context.activeTask] Currently running task { scheduledTime, estimatedMinutes }
 * @returns {{ shouldReplan: boolean, trigger: string|null, reason: string|null, autoApply: boolean, diffMinutes: number }}
 */
export function evaluateReplanTrigger(context = {}) {
  const { plan, currentTime, completedTask, activeTask } = context;

  if (!plan || !Array.isArray(plan.plannedTasks)) {
    return { shouldReplan: false, trigger: null, reason: null, autoApply: false, diffMinutes: 0 };
  }

  const currentMin = currentTime ? parseTimeToMinutes(currentTime) : (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  // 1. Task Overrun: Current task duration > planned by > 15m
  if (activeTask && activeTask.status === 'in-progress') {
    const startMin = parseTimeToMinutes(activeTask.scheduledTime);
    const plannedDur = activeTask.estimatedMinutes || 30;
    const elapsed = Math.max(0, currentMin - startMin);
    const overrun = elapsed - plannedDur;

    if (overrun > 15) {
      return {
        shouldReplan: true,
        trigger: 'task_overrun',
        reason: `Current task is overrunning planned duration by ${overrun} minutes`,
        autoApply: false,
        diffMinutes: overrun
      };
    }
  }

  // 2. Early Completion: Task finished > 20m early
  if (completedTask && typeof completedTask.actualMinutes === 'number') {
    const planned = completedTask.estimatedMinutes || 30;
    const actual = completedTask.actualMinutes;
    const saved = planned - actual;

    if (saved > 20) {
      return {
        shouldReplan: true,
        trigger: 'early_completion',
        reason: `Task completed ${saved} minutes early! Schedule can be pulled forward`,
        autoApply: true,
        diffMinutes: saved
      };
    }
  }

  // 3. Missed Start: Scheduled task not started > 30m past scheduled start
  const pendingTasks = plan.plannedTasks.filter(t => t.status === 'pending');
  for (const pt of pendingTasks) {
    const startMin = parseTimeToMinutes(pt.scheduledTime);
    if (currentMin - startMin > 30) {
      return {
        shouldReplan: true,
        trigger: 'missed_start',
        reason: `Task was scheduled for ${pt.scheduledTime} but hasn't started (${currentMin - startMin}m late)`,
        autoApply: false,
        diffMinutes: currentMin - startMin
      };
    }
  }

  return { shouldReplan: false, trigger: null, reason: null, autoApply: false, diffMinutes: 0 };
}

/**
 * Section 9.2 & 9.3: Adaptive Replanning Core.
 * Evaluates remaining capacity and cascades or rebalances pending tasks non-destructively.
 * 
 * Non-destructive invariant:
 * - Completed task records are strictly frozen.
 * - Logged actual minutes are never overwritten.
 * - In-progress task state is preserved.
 * - Operates only on remaining time and remaining candidate tasks.
 * 
 * @param {Object} options
 * @param {Object} options.plan The active daily plan
 * @param {string} [options.currentTime] Current time string "HH:MM"
 * @param {string} [options.dayEndTime="22:00"] End of scheduled day
 * @param {number} [options.bufferMinutes=10] Minimum transition buffer
 * @param {Array<Object>} [options.allTasks=[]] Master task records
 * @param {Object} [options.preferences={}] User preferences
 * @returns {{ type: 'cascade'|'rebalance', updatedPlan: Object, keptTasks: Array, deferredTasks: Array, remainingCapacity: number, neededMinutes: number, slippageResolved: boolean }}
 */
export function replanRemainingDay(options = {}) {
  const {
    plan,
    currentTime,
    dayEndTime = '22:00',
    bufferMinutes = 10,
    allTasks = [],
    preferences = {}
  } = options;

  if (!plan || !Array.isArray(plan.plannedTasks)) {
    throw new Error('Valid daily plan is required for replanning');
  }

  // 1. Snapshot and freeze completed tasks
  const completedTasks = plan.plannedTasks.filter(t => t.status === 'completed');
  const inProgressTask = plan.plannedTasks.find(t => t.status === 'in-progress');
  const pendingTasks = plan.plannedTasks.filter(t => t.status === 'pending');

  const nowMin = currentTime ? parseTimeToMinutes(currentTime) : (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  const dayEndMin = parseTimeToMinutes(dayEndTime);

  // 2. Determine cascade start cursor
  let cascadeStartMin = Math.ceil(nowMin / 5) * 5; // Round to nearest 5m
  if (inProgressTask) {
    const inProgStart = parseTimeToMinutes(inProgressTask.scheduledTime);
    const inProgEnd = inProgStart + (inProgressTask.estimatedMinutes || 30);
    // If in progress task still running, place pending tasks after it + buffer
    cascadeStartMin = Math.max(cascadeStartMin, inProgEnd + bufferMinutes);
  }

  // 3. Determine remaining capacity (minutes available between cascadeStart and dayEnd)
  const remainingCapacity = Math.max(0, dayEndMin - cascadeStartMin);

  // 4. Calculate total duration needed for all pending tasks with buffers
  const neededMinutes = pendingTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 30) + bufferMinutes, 0);

  // Deep clone plan to avoid mutating input directly until confirmed
  const clonedTasks = plan.plannedTasks.map(t => ({ ...t }));
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  // Case A: Everything fits in remaining capacity -> Cascade forward
  if (neededMinutes <= remainingCapacity) {
    let currentCursor = cascadeStartMin;
    const keptTasks = [];

    // Sort pending tasks by their original order or priority
    const sortedPending = pendingTasks.slice().sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

    sortedPending.forEach(pt => {
      const duration = pt.estimatedMinutes || 30;
      const targetInCloned = clonedTasks.find(t => t.taskId === pt.taskId && t.status === 'pending');
      if (targetInCloned) {
        targetInCloned.scheduledTime = formatMinutesToTime(currentCursor);
        keptTasks.push(targetInCloned);
      }
      currentCursor += duration + bufferMinutes;
    });

    clonedTasks.sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

    return {
      type: 'cascade',
      updatedPlan: { ...plan, plannedTasks: clonedTasks },
      keptTasks,
      deferredTasks: [],
      remainingCapacity,
      neededMinutes,
      slippageResolved: true
    };
  }

  // Case B: Over capacity -> Rebalance: score remaining tasks and propose deferrals
  const scoredPending = pendingTasks.map(pt => {
    const master = taskMap.get(pt.taskId) || {
      id: pt.taskId,
      name: pt.name || pt.title || 'Task',
      priority: pt.priority || 50,
      estimatedMinutes: pt.estimatedMinutes || 30
    };

    const score = candidateScore(master, {
      date: plan.date,
      energyWindow: preferences.energyLevel || 'medium',
      preferences
    });

    return {
      planTask: pt,
      masterTask: master,
      score: score,
      duration: pt.estimatedMinutes || 30
    };
  });

  // Sort descending by score (highest priority tasks kept first)
  scoredPending.sort((a, b) => b.score - a.score);

  let allocatedMinutes = 0;
  const keptTasks = [];
  const deferredTasks = [];

  for (const item of scoredPending) {
    const neededSlot = item.duration + bufferMinutes;
    if (allocatedMinutes + neededSlot <= remainingCapacity) {
      keptTasks.push(item.planTask);
      allocatedMinutes += neededSlot;
    } else {
      deferredTasks.push({
        taskId: item.planTask.taskId,
        name: item.planTask.name || item.masterTask.name || 'Task',
        estimatedMinutes: item.duration,
        score: item.score
      });
    }
  }

  // Cascade the kept tasks forward in time starting at cascadeStartMin
  let currentCursor = cascadeStartMin;
  keptTasks.sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

  const keptIds = new Set(keptTasks.map(t => t.taskId));
  const deferredIds = new Set(deferredTasks.map(t => t.taskId));

  const rebalancedTasks = clonedTasks.map(t => {
    if (keptIds.has(t.taskId) && t.status === 'pending') {
      const duration = t.estimatedMinutes || 30;
      const scheduledTime = formatMinutesToTime(currentCursor);
      currentCursor += duration + bufferMinutes;
      return { ...t, scheduledTime };
    }
    if (deferredIds.has(t.taskId) && t.status === 'pending') {
      return { ...t, status: 'rescheduled' };
    }
    return t;
  });

  rebalancedTasks.sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

  return {
    type: 'rebalance',
    updatedPlan: { ...plan, plannedTasks: rebalancedTasks },
    keptTasks,
    deferredTasks,
    remainingCapacity,
    neededMinutes,
    slippageResolved: true
  };
}

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
  plan.plannedTasks.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  return plan;
}

/**
 * Shifts subsequent pending/in-progress tasks forward in time.
 * @param {Object} plan The daily plan object
 * @param {string} fromTime Shift tasks starting at or after this time (e.g., "14:15")
 * @param {number} minutesToShift Number of minutes to push tasks forward
 * @param {string} excludeTaskId ID of the task to exclude from shifting
 * @returns {Object} The updated plan object
 */
export function rescheduleRemaining(plan, fromTime, minutesToShift, excludeTaskId = null) {
  const fromMin = parseTimeToMinutes(fromTime);

  plan.plannedTasks = plan.plannedTasks.map(t => {
    if (t.taskId !== excludeTaskId && (t.status === 'pending' || t.status === 'in-progress')) {
      const taskMin = parseTimeToMinutes(t.scheduledTime);
      if (taskMin >= fromMin) {
        const newMin = taskMin + minutesToShift;
        return {
          ...t,
          scheduledTime: formatMinutesToTime(newMin)
        };
      }
    }
    return t;
  });

  plan.plannedTasks.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  return plan;
}

/**
 * Calculates current daily duration and suggests pending tasks to defer if over capacity.
 */
export function suggestDeferrals(plan, capacity, allTasks, preferences, energyLevel) {
  const activeTasks = plan.plannedTasks.filter(t => t.status !== 'rescheduled' && t.status !== 'skipped');
  const totalDuration = activeTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);

  if (totalDuration <= capacity) {
    return [];
  }

  let overage = totalDuration - capacity;
  const deferrals = [];
  const pendingTasks = plan.plannedTasks.filter(t => t.status === 'pending');
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  const scoredPending = pendingTasks.map(pt => {
    let masterTask = taskMap.get(pt.taskId);
    if (!masterTask) {
      masterTask = {
        id: pt.taskId,
        name: pt.name,
        bucket: pt.bucket || 'unplanned',
        priority: 2,
        estimatedMinutes: pt.estimatedMinutes || 30
      };
    }

    const score = scoreTask(masterTask, {
      date: plan.date,
      currentPlan: plan.plannedTasks.filter(t => t.taskId !== pt.taskId),
      energyWindow: energyLevel,
      preferences
    });

    return {
      planEntry: pt,
      score: score
    };
  });

  scoredPending.sort((a, b) => a.score - b.score);

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
