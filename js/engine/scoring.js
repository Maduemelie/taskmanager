/* js/engine/scoring.js */
import { isTaskDueOn, getNextDueDate } from './recurrence.js';
import { daysBetween, today } from '../utils/date.js';

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
/**
 * Safely parses deadline strings into date and time components.
 * Handles formats:
 * - "YYYY-MM-DD" -> { date: "YYYY-MM-DD", time: null, hasTime: false }
 * - "YYYY-MM-DDTHH:MM..." -> { date: "YYYY-MM-DD", time: "HH:MM", hasTime: true }
 * - "YYYY-MM-DD HH:MM..." -> { date: "YYYY-MM-DD", time: "HH:MM", hasTime: true }
 * - "HH:MM" (time-only) -> { date: defaultDate, time: "HH:MM", hasTime: true }
 * 
 * @param {string} deadline 
 * @param {string} [defaultDate]
 * @returns {{ date: string, time: string|null, hasTime: boolean } | null}
 */
export function parseDeadline(deadline, defaultDate = today()) {
  if (!deadline || typeof deadline !== 'string') return null;

  const trimmed = deadline.trim();
  if (!trimmed) return null;

  let datePart = defaultDate;
  let timePart = null;

  if (trimmed.includes('T')) {
    const parts = trimmed.split('T');
    datePart = parts[0];
    timePart = parts[1] ? parts[1].substring(0, 5) : null;
  } else if (trimmed.includes(' ')) {
    const parts = trimmed.split(' ');
    datePart = parts[0];
    timePart = parts[1] ? parts[1].substring(0, 5) : null;
  } else if (trimmed.includes('-')) {
    datePart = trimmed;
    timePart = null;
  } else if (trimmed.includes(':')) {
    // Time-only format, e.g. "15:00"
    datePart = defaultDate;
    timePart = trimmed.substring(0, 5);
  } else {
    datePart = trimmed;
    timePart = null;
  }

  return {
    date: datePart,
    time: timePart,
    hasTime: Boolean(timePart && timePart.includes(':'))
  };
}

export function scoreTask(task, context = {}) {
  const { currentPlan = [], energyWindow = 'medium', preferences } = context;
  const planningDate = context.date || today();
  
  let score = 0;

  const isDue = isTaskDueOn(task, planningDate);
  const createdDateStr = task.createdAt ? task.createdAt.split('T')[0] : planningDate;
  const lastCompDateStr = task.lastCompletedAt ? task.lastCompletedAt.split('T')[0] : null;

  // 1. Due Today (+40)
  if (isDue) {
    score += 40;
  }

  // 2. User Priority (+10 to +50)
  const priority = typeof task.priority === 'number' ? task.priority : 3;
  // Support both canonical 0-100 priority scale and legacy 1-5 scale gracefully
  const normalizedPriority = priority > 5 ? (priority / 100) * 50 : priority * 10;
  score += Math.round(normalizedPriority);

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
    if (nextDue && nextDue < planningDate) {
      const overdueDays = daysBetween(nextDue, planningDate);
      score += Math.min(90, overdueDays * 30);
    }
  } else if (!task.lastCompletedAt && task.deadline) {
    const parsedDeadline = parseDeadline(task.deadline, planningDate);
    if (parsedDeadline && parsedDeadline.date < planningDate) {
      // Non-recurring task overdue past deadline
      const overdueDays = daysBetween(parsedDeadline.date, planningDate);
      score += Math.min(90, overdueDays * 30);
    }
  }

  // 5. Deadline Urgency (+15 to +50)
  if (task.deadline && !task.lastCompletedAt) {
    const parsedDeadline = parseDeadline(task.deadline, planningDate);
    if (parsedDeadline) {
      if (parsedDeadline.date < planningDate) {
        // Already overdue (handled above but add baseline maximum urgency here)
        score += 50;
      } else {
        const daysToDeadline = daysBetween(planningDate, parsedDeadline.date);
        if (daysToDeadline <= 1) score += 50;
        else if (daysToDeadline <= 3) score += 30;
        else if (daysToDeadline <= 7) score += 15;
      }
    }
  }

  // 6. Streak Protection (+20 if streak >= 3)
  if (task.currentStreak >= 3) {
    score += 20;
  }

  // 7. Energy Match (+15 if matches user's current energy window)
  const currentTaskEnergy = task.energy || task.energyLevel;
  if (currentTaskEnergy === energyWindow) {
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

/**
 * Canonical Candidate Task Scoring (Section 8.3)
 * Evaluates and scores an eligible task for placement in the daily schedule.
 *
 * Baseline formula components:
 * 0.30 priority
 * + 0.20 urgency
 * + 0.15 energy fit
 * + 0.10 deadline fit (deadline pressure)
 * + 0.10 context continuity
 * + 0.05 preference fit
 * + 0.10 completion probability
 *
 * @param {Object} task The candidate task object
 * @param {Object} [context] Scheduling context:
 *   - date {string} YYYY-MM-DD (defaults to today)
 *   - energyWindow {string} 'low' | 'medium' | 'high'
 *   - previousTask {Object} The previously placed task in the schedule
 *   - slotTime {string} 'HH:MM' (start time of current placement window)
 *   - preferences {Object} User preferences
 * @returns {number} Normalized composite score in range [0, 100]
 */
export function candidateScore(task, context = {}) {
  const result = calculateCandidateScore(task, context);
  return result.score;
}

/**
 * Detailed candidate score calculation returning composite score and component breakdown.
 * @param {Object} task 
 * @param {Object} [context] 
 * @returns {{ score: number, normalizedScore: number, breakdown: Object }}
 */
export function calculateCandidateScore(task, context = {}) {
  if (!task) {
    return { score: 0, normalizedScore: 0, breakdown: {} };
  }

  const date = context.date || today();
  const energyWindow = (context.energyWindow || context.energyLevel || 'medium').toLowerCase();
  const previousTask = context.previousTask || null;
  const preferences = context.preferences || {};
  const slotTime = context.slotTime || null;

  // 1. Priority (weight: 0.30)
  // Support canonical 0-100 scale; legacy 1-5 scale is normalized to 0-100
  let rawPriority = typeof task.priority === 'number' ? task.priority : 50;
  let priorityScore = rawPriority;
  if (rawPriority <= 5 && rawPriority >= 0) {
    priorityScore = (rawPriority / 5) * 100;
  }
  priorityScore = Math.max(0, Math.min(100, priorityScore));

  // 2. Urgency (weight: 0.20)
  // Canonical range 0-100. If omitted, default to 50 or infer from deadline
  let urgencyScore = 50;
  if (typeof task.urgency === 'number') {
    urgencyScore = task.urgency <= 5 && task.urgency >= 0 ? (task.urgency / 5) * 100 : task.urgency;
  } else if (task.deadline) {
    const parsedDeadline = parseDeadline(task.deadline, date);
    if (parsedDeadline) {
      if (parsedDeadline.date < date) {
        urgencyScore = 100; // Past due
      } else {
        const daysToDeadline = daysBetween(date, parsedDeadline.date);
        if (daysToDeadline === 0) urgencyScore = 95;
        else if (daysToDeadline <= 1) urgencyScore = 85;
        else if (daysToDeadline <= 3) urgencyScore = 70;
        else if (daysToDeadline <= 7) urgencyScore = 45;
        else urgencyScore = 20;
      }
    }
  }
  urgencyScore = Math.max(0, Math.min(100, urgencyScore));

  // 3. Energy Fit (weight: 0.15)
  // Matches task energy level against the context energy window
  const energyLevels = { low: 1, medium: 2, high: 3 };
  const taskEnergy = (task.energy || task.energyLevel || 'medium').toLowerCase();
  const taskLevel = energyLevels[taskEnergy] || 2;
  const windowLevel = energyLevels[energyWindow] || 2;
  const energyDiff = Math.abs(taskLevel - windowLevel);
  let energyScore = 100;
  if (energyDiff === 1) energyScore = 50;
  else if (energyDiff >= 2) energyScore = 0;

  // 4. Deadline Fit / Deadline Pressure (weight: 0.10)
  let deadlineScore = 0;
  if (task.deadline) {
    const parsedDeadline = parseDeadline(task.deadline, date);
    if (parsedDeadline) {
      if (parsedDeadline.date < date) {
        deadlineScore = 100; // Overdue
      } else if (parsedDeadline.date === date) {
        // Due today
        if (parsedDeadline.hasTime) {
          const timePart = parsedDeadline.time;
          if (slotTime) {
            const [sH, sM] = slotTime.split(':').map(Number);
            const [dH, dM] = timePart.split(':').map(Number);
            const diffMin = (dH * 60 + dM) - (sH * 60 + sM);
            if (diffMin <= 0) deadlineScore = 100;
            else if (diffMin <= 120) deadlineScore = 95;
            else if (diffMin <= 240) deadlineScore = 85;
            else deadlineScore = 75;
          } else {
            deadlineScore = 90;
          }
        } else {
          deadlineScore = 85;
        }
      } else {
        const days = daysBetween(date, parsedDeadline.date);
        if (days === 1) deadlineScore = 70;
        else if (days <= 3) deadlineScore = 50;
        else if (days <= 7) deadlineScore = 25;
        else deadlineScore = 10;
      }
    }
  }

  // 5. Context Continuity (weight: 0.10)
  // Reduces cognitive switching friction by favoring same category or energy continuation
  let continuityScore = 50; // Neutral baseline when no prior task in sequence
  if (previousTask) {
    const prevCategory = previousTask.categoryId || previousTask.bucket;
    const taskCategory = task.categoryId || task.bucket;
    if (prevCategory && taskCategory && prevCategory === taskCategory) {
      continuityScore = 100;
    } else if ((previousTask.energy || previousTask.energyLevel) === taskEnergy) {
      continuityScore = 60;
    } else {
      continuityScore = 10;
    }
  }

  // 6. User Preference Fit (weight: 0.05)
  // Preferred time of day alignment and category preference
  let preferenceScore = 70;
  const preferredTime = task.preferredTime || 'anytime';
  if (slotTime) {
    const [h] = slotTime.split(':').map(Number);
    const slotPeriod = h < 12 ? 'morning' : (h < 17 ? 'afternoon' : 'evening');
    if (preferredTime === 'anytime' || preferredTime === slotPeriod) {
      preferenceScore = 100;
    } else {
      preferenceScore = 30;
    }
  } else if (preferredTime === 'anytime') {
    preferenceScore = 100;
  }

  // 7. Completion Probability (weight: 0.10)
  let probabilityScore = 75;
  if (typeof task.completionProbability === 'number') {
    probabilityScore = task.completionProbability <= 1 ? task.completionProbability * 100 : task.completionProbability;
  } else if (typeof task.currentStreak === 'number' && task.currentStreak > 0) {
    probabilityScore = Math.min(100, 70 + task.currentStreak * 6);
  } else if (Array.isArray(task.completionHistory) && task.completionHistory.length > 0) {
    probabilityScore = 85;
  }
  probabilityScore = Math.max(0, Math.min(100, probabilityScore));

  // Composite calculation
  const weightedSum = (
    0.30 * priorityScore +
    0.20 * urgencyScore +
    0.15 * energyScore +
    0.10 * deadlineScore +
    0.10 * continuityScore +
    0.05 * preferenceScore +
    0.10 * probabilityScore
  );

  const finalScore = Number(weightedSum.toFixed(2));

  return {
    score: finalScore,
    normalizedScore: Number((finalScore / 100).toFixed(4)),
    breakdown: {
      priority: Number((0.30 * priorityScore).toFixed(2)),
      urgency: Number((0.20 * urgencyScore).toFixed(2)),
      energyFit: Number((0.15 * energyScore).toFixed(2)),
      deadlineFit: Number((0.10 * deadlineScore).toFixed(2)),
      contextContinuity: Number((0.10 * continuityScore).toFixed(2)),
      preferenceFit: Number((0.05 * preferenceScore).toFixed(2)),
      completionProbability: Number((0.10 * probabilityScore).toFixed(2)),
      raw: {
        priority: priorityScore,
        urgency: urgencyScore,
        energy: energyScore,
        deadline: deadlineScore,
        continuity: continuityScore,
        preference: preferenceScore,
        probability: probabilityScore
      }
    }
  };
}

/**
 * Evaluates and ranks candidate tasks in descending order of candidateScore.
 * @param {Array<Object>} tasks 
 * @param {Object} [context] 
 * @returns {Array<Object>} Sorted tasks with candidateScore metadata attached
 */
export function rankCandidateTasks(tasks, context = {}) {
  if (!Array.isArray(tasks)) return [];
  
  const scored = tasks.map(task => {
    const calculation = calculateCandidateScore(task, context);
    return {
      task,
      score: calculation.score,
      breakdown: calculation.breakdown
    };
  });

  // Sort descending by score. Secondary tie-breaks: priority, urgency, shorter duration
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pA = a.task.priority || 0;
    const pB = b.task.priority || 0;
    if (pB !== pA) return pB - pA;
    const uA = a.task.urgency || 0;
    const uB = b.task.urgency || 0;
    if (uB !== uA) return uB - uA;
    const durA = a.task.estimatedMinutes || 30;
    const durB = b.task.estimatedMinutes || 30;
    return durA - durB;
  });

  return scored.map(item => ({
    ...item.task,
    _candidateScore: item.score,
    _candidateScoreBreakdown: item.breakdown
  }));
}
