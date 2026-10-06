/* js/engine/planner.js */
import { scoreTask } from './scoring.js';
import { isTaskDueOn } from './recurrence.js';
import { today, formatTime, isToday } from '../utils/date.js';

export { generateDeterministicSchedule, scheduleDay, validateSchedule, parseTimeToMinutes, formatMinutesToTime, createScheduleGaps } from './deterministicScheduler.js';
export { candidateScore, calculateCandidateScore, rankCandidateTasks } from './scoring.js';

/**
 * Generates today's suggested plan from the available active tasks.
 * Uses a greedy selection algorithm with dynamic re-scoring to optimize bucket diversity
 * and energy/priority match, up to the user's focus capacity.
 * 
 * @param {Array} allTasks All active tasks from the bucket
 * @param {Object} preferences User preferences (wakeTime, sleepTime, bufferMinutes, defaultCapacity, buckets)
 * @param {number} capacity Focus capacity in minutes
 * @param {string} energyLevel Current energy level 'low' | 'medium' | 'high'
 * @param {string} [dateStr] Optional date string YYYY-MM-DD, defaults to today
 * @param {string} [startTimeStr] Optional start time string HH:MM (defaults to real-time aware or wakeTime)
 * @returns {Array} List of planned task objects with scheduled start times
 */
export function generateDayPlan(allTasks, preferences, capacity, energyLevel, dateStr = today(), startTimeStr = null) {
  const wakeTime = preferences?.wakeTime || '07:00';
  const sleepTime = preferences?.sleepTime || '23:00';
  const bufferMinutes = typeof preferences?.bufferMinutes === 'number' ? preferences.bufferMinutes : 10;
  
  // Determine effective starting time
  let effectiveStartTime = startTimeStr;
  if (!effectiveStartTime) {
    if (isToday(dateStr)) {
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const [wakeH, wakeM] = wakeTime.split(':').map(Number);
      const wakeMin = wakeH * 60 + wakeM;
      if (currentMin > wakeMin) {
        // Round up to the next 15-minute block
        const roundedMin = Math.ceil(currentMin / 15) * 15;
        const h = Math.floor(roundedMin / 60) % 24;
        const m = roundedMin % 60;
        effectiveStartTime = formatTime(h, m);
      } else {
        effectiveStartTime = wakeTime;
      }
    } else {
      effectiveStartTime = wakeTime;
    }
  }

  // 1. Filter tasks that are active and due on dateStr
  let candidates = allTasks.filter(task => isTaskDueOn(task, dateStr));
  
  const plannedTasks = [];
  let remainingCapacity = capacity;

  // 2. Greedy selection with dynamic re-scoring
  while (remainingCapacity > 0 && candidates.length > 0) {
    // Score all remaining candidates in the context of what has been scheduled so far
    const scoredCandidates = candidates.map(task => {
      // Map task entries in plannedTasks to match the format expected by scoreTask
      const currentPlanState = plannedTasks.map(pt => ({
        taskId: pt.taskId,
        bucket: pt.bucket
      }));
      
      const score = scoreTask(task, {
        date: dateStr,
        currentPlan: currentPlanState,
        energyWindow: energyLevel,
        preferences
      });
      
      return { task, score };
    });

    // Sort by score descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Pick the highest scoring task
    const best = scoredCandidates[0];
    
    // If the score is extremely low (meaning it's heavily penalized/already in plan), break
    if (best.score < -50) break;

    const task = best.task;
    const duration = task.estimatedMinutes || 30;

    // Check if it fits in remaining capacity (allow slight overflow if it's the first task)
    if (duration <= remainingCapacity || plannedTasks.length === 0) {
      plannedTasks.push({
        taskId: task.id,
        name: task.name,
        bucket: task.bucket,
        estimatedMinutes: duration,
        preferredTime: task.preferredTime || 'anytime',
        priority: task.priority
      });
      remainingCapacity -= duration;
    }

    // Remove from candidates list to avoid infinite loops
    candidates = candidates.filter(c => c.id !== task.id);
  }

  // 3. Time slot scheduling logic
  return assignTimeSlots(plannedTasks, wakeTime, sleepTime, effectiveStartTime, bufferMinutes);
}

/**
 * Assigns start times to planned tasks based on their preferred block of day.
 * Splits wake time to sleep time into morning, afternoon, evening windows and introduces buffer breaks.
 */
function assignTimeSlots(plannedTasks, wakeStr, sleepStr, startStr = wakeStr, bufferMinutes = 10) {
  // Convert time strings (HH:MM) to minutes since midnight
  const parseTimeToMinutes = (tStr) => {
    const [h, m] = tStr.split(':').map(Number);
    return h * 60 + m;
  };

  const wakeMin = parseTimeToMinutes(wakeStr);
  const sleepMin = parseTimeToMinutes(sleepStr);
  const startMin = parseTimeToMinutes(startStr);
  const activeDayDuration = sleepMin - wakeMin;

  // Define block boundary markers
  const blockLength = Math.max(60, Math.floor(activeDayDuration / 3));
  const morningStart = Math.max(wakeMin, startMin);
  const afternoonStart = Math.max(wakeMin + blockLength, startMin);
  const eveningStart = Math.max(wakeMin + (blockLength * 2), startMin);

  // Group tasks by preferred block
  const morningQueue = [];
  const afternoonQueue = [];
  const eveningQueue = [];
  const anytimeQueue = [];

  plannedTasks.forEach(task => {
    if (task.preferredTime === 'morning') morningQueue.push(task);
    else if (task.preferredTime === 'afternoon') afternoonQueue.push(task);
    else if (task.preferredTime === 'evening') eveningQueue.push(task);
    else anytimeQueue.push(task);
  });

  // Distribute 'anytime' tasks to balance the queues (greedy smallest queue size)
  anytimeQueue.forEach(task => {
    const mSize = morningQueue.reduce((acc, t) => acc + t.estimatedMinutes, 0);
    const aSize = afternoonQueue.reduce((acc, t) => acc + t.estimatedMinutes, 0);
    const eSize = eveningQueue.reduce((acc, t) => acc + t.estimatedMinutes, 0);

    if (mSize <= aSize && mSize <= eSize) {
      morningQueue.push(task);
    } else if (aSize <= mSize && aSize <= eSize) {
      afternoonQueue.push(task);
    } else {
      eveningQueue.push(task);
    }
  });

  const finalSchedule = [];
  let timePointer = startMin;

  // 1. Schedule Morning
  timePointer = Math.max(timePointer, morningStart);
  morningQueue.forEach(task => {
    const startHour = Math.floor(timePointer / 60) % 24;
    const startMinVal = timePointer % 60;
    
    finalSchedule.push({
      ...task,
      scheduledTime: formatTime(startHour, startMinVal)
    });
    timePointer += task.estimatedMinutes + bufferMinutes;
  });

  // 2. Schedule Afternoon
  timePointer = Math.max(afternoonStart, timePointer);
  afternoonQueue.forEach(task => {
    const startHour = Math.floor(timePointer / 60) % 24;
    const startMinVal = timePointer % 60;
    
    finalSchedule.push({
      ...task,
      scheduledTime: formatTime(startHour, startMinVal)
    });
    timePointer += task.estimatedMinutes + bufferMinutes;
  });

  // 3. Schedule Evening
  timePointer = Math.max(eveningStart, timePointer);
  eveningQueue.forEach(task => {
    const startHour = Math.floor(timePointer / 60) % 24;
    const startMinVal = timePointer % 60;
    
    finalSchedule.push({
      ...task,
      scheduledTime: formatTime(startHour, startMinVal)
    });
    timePointer += task.estimatedMinutes + bufferMinutes;
  });

  // Sort the final schedule by time chronologically
  return finalSchedule.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
}
