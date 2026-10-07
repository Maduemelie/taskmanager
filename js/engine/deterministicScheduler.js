/* js/engine/deterministicScheduler.js */
import { generateId } from '../utils/id.js';
import { today, formatTime } from '../utils/date.js';
import { candidateScore, rankCandidateTasks, parseDeadline } from './scoring.js';

/**
 * Converts a 24-hour time string ("HH:MM" or ISO string) to minutes from midnight (0 - 1439).
 * @param {string|number} timeStr 
 * @returns {number} Minutes from midnight
 */
export function parseTimeToMinutes(timeStr) {
  if (typeof timeStr === 'number') {
    return Math.max(0, Math.min(1440, Math.round(timeStr)));
  }
  if (!timeStr || typeof timeStr !== 'string') return 0;
  
  // ISO string extraction (e.g. "2026-10-06T09:30:00.000Z")
  if (timeStr.includes('T')) {
    const timePart = timeStr.split('T')[1];
    const [h, m] = timePart.split(':').map(Number);
    return ((h || 0) * 60 + (m || 0));
  }
  
  const [h, m] = timeStr.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0));
}

/**
 * Converts minutes from midnight into 24-hour time format "HH:MM".
 * @param {number} minutes 
 * @returns {string} e.g. "08:30"
 */
export function formatMinutesToTime(minutes) {
  const normalized = Math.max(0, Math.round(minutes)) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return formatTime(h, m);
}

/**
 * Rigorously checks a schedule for hard constraint violations:
 * - Strictly zero overlapping time blocks (startA < endB && startB < endA)
 * - Chronological ordering
 * - Valid start and end durations (end > start)
 * 
 * @param {Array<Object>} blocks List of ScheduleBlock objects
 * @returns {{ isValid: boolean, hasOverlaps: boolean, overlaps: Array, errors: Array }}
 */
export function validateSchedule(blocks = []) {
  const errors = [];
  const overlaps = [];

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { isValid: true, hasOverlaps: false, overlaps: [], errors: [] };
  }

  // Convert blocks to minute intervals for precise mathematical validation
  const intervals = blocks.map((b, idx) => ({
    index: idx,
    id: b.id || `block-${idx}`,
    type: b.type,
    title: b.title || b.name || b.taskId || b.type,
    startStr: b.start,
    endStr: b.end,
    startMin: parseTimeToMinutes(b.start),
    endMin: parseTimeToMinutes(b.end),
    raw: b
  }));

  // 1. Individual interval boundary validation
  for (const item of intervals) {
    if (item.endMin <= item.startMin) {
      errors.push(`Block [${item.id}] ("${item.title}") has invalid duration: start ${item.startStr} >= end ${item.endStr}`);
    }
  }

  // 2. Strict pairwise non-overlap validation
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i];
      const b = intervals[j];
      // Overlap condition: a.start < b.end && b.start < a.end
      if (a.startMin < b.endMin && b.startMin < a.endMin) {
        overlaps.push({
          blockA: { id: a.id, type: a.type, title: a.title, start: a.startStr, end: a.endStr },
          blockB: { id: b.id, type: b.type, title: b.title, start: b.startStr, end: b.endStr }
        });
        errors.push(`Overlap detected between "${a.title}" [${a.startStr}-${a.endStr}] and "${b.title}" [${b.startStr}-${b.endStr}]`);
      }
    }
  }

  return {
    isValid: errors.length === 0 && overlaps.length === 0,
    hasOverlaps: overlaps.length > 0,
    overlaps,
    errors
  };
}

/**
 * Maps unallocated intervals between placed schedule blocks into "Open" or "Buffer" blocks (Section 6.4).
 * Small gaps (<= bufferThreshold) are mapped as "buffer" blocks.
 * Larger intervals are mapped as "open" blocks ("Open Time"), respecting:
 * "Never label a huge free interval as a 'Rest Buffer'; use Open/Available Time."
 * 
 * @param {Array<Object>} placedBlocks Existing placed blocks (commitments, tasks, buffers)
 * @param {number} dayStartMin Start of day in minutes
 * @param {number} dayEndMin End of day in minutes
 * @param {number} [bufferThreshold=15] Max duration in minutes to treat as buffer instead of open time
 * @param {string} [planId] Daily plan ID
 * @returns {Array<Object>} Array of gap ScheduleBlock objects
 */
export function createScheduleGaps(placedBlocks = [], dayStartMin, dayEndMin, bufferThreshold = 15, planId = '') {
  const gapBlocks = [];
  if (dayEndMin <= dayStartMin) return gapBlocks;

  // Sort placed blocks chronologically
  const sorted = [...placedBlocks].sort((a, b) => {
    return parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start);
  });

  let cursor = dayStartMin;

  for (const block of sorted) {
    const bStart = parseTimeToMinutes(block.start);
    const bEnd = parseTimeToMinutes(block.end);

    if (bStart > cursor) {
      const gapDuration = bStart - cursor;
      const type = gapDuration <= bufferThreshold ? 'buffer' : 'open';
      const title = type === 'buffer' ? 'Buffer' : 'Open Time';

      gapBlocks.push({
        id: generateId(),
        planId,
        start: formatMinutesToTime(cursor),
        end: formatMinutesToTime(bStart),
        type,
        status: 'scheduled',
        source: 'planner',
        locked: false,
        title
      });
    }

    cursor = Math.max(cursor, bEnd);
  }

  // Trailing gap until day end
  if (cursor < dayEndMin) {
    const gapDuration = dayEndMin - cursor;
    const type = gapDuration <= bufferThreshold ? 'buffer' : 'open';
    const title = type === 'buffer' ? 'Buffer' : 'Open Time';

    gapBlocks.push({
      id: generateId(),
      planId,
      start: formatMinutesToTime(cursor),
      end: formatMinutesToTime(dayEndMin),
      type,
      status: 'scheduled',
      source: 'planner',
      locked: false,
      title
    });
  }

  return gapBlocks;
}

/**
 * Headless Deterministic Scheduling Engine (Phase 4, Sections 5.3 & 8)
 * 
 * Enforces hard constraints:
 * - Strictly zero overlapping blocks (Section 8.1)
 * - Fixed commitments preservation
 * - Earliest and latest start windows
 * - Strict task dependency ordering
 * - Hard deadline enforcement
 * - Sleep / wake protected personal windows
 * - Max focus block limits
 * 
 * Uses candidateScore (Section 8.3) to dynamically rank eligible tasks,
 * schedules up to focus capacity limit, safely leaves unplaceable tasks
 * in 'ready' state, and maps gaps to Open/Buffer blocks (Section 6.4).
 * 
 * @param {Object} options Configuration parameters:
 *   - tasks {Array<Object>} List of candidate tasks from bucket / ready pool
 *   - date {string} Target date YYYY-MM-DD (defaults to today)
 *   - startTime {string} Daily wake / start time HH:MM (defaults to '08:00')
 *   - endTime {string} Daily sleep / end time HH:MM (defaults to '20:00')
 *   - capacity {number} Planned focus capacity in minutes (optional)
 *   - bufferMinutes {number} Transition buffer duration in minutes (default 10)
 *   - maxFocusBlockMinutes {number} Maximum continuous focus duration before break (default 120)
 *   - fixedCommitments {Array<Object>} Pre-scheduled commitments/events [{ id, title, start, end }]
 *   - availableWindows {Array<Object>} Custom availability windows [{ start, end }] (optional)
 *   - energyProfile {string} Current energy window 'low' | 'medium' | 'high'
 *   - preferences {Object} User preferences object
 *   - planId {string} Optional plan identifier
 * @returns {Object} Deterministic DailyPlan result object:
 *   - id {string} Plan ID
 *   - date {string} Target date
 *   - blocks {Array<Object>} Strictly non-overlapping chronological schedule blocks
 *   - scheduledTasks {Array<Object>} List of successfully scheduled tasks
 *   - unscheduledTasks {Array<Object>} Tasks safely preserved in ready state
 *   - plannedFocusMinutes {number} Total focus minutes scheduled
 *   - plannedTaskMinutes {number} Same as plannedFocusMinutes
 *   - totalBufferMinutes {number} Total buffer minutes
 *   - totalOpenMinutes {number} Total open time minutes
 *   - totalCommitmentMinutes {number} Total fixed commitment minutes
 *   - hasOverlaps {boolean} Strictly false
 *   - isValid {boolean} Constraint validation status
 *   - isFeasible {boolean} True if plan succeeded within constraints
 */
export function generateDeterministicSchedule(options = {}) {
  const planId = options.planId || generateId();
  const date = options.date || today();
  const wakeTime = options.startTime || options.preferences?.wakeTime || '08:00';
  const sleepTime = options.endTime || options.preferences?.sleepTime || '20:00';

  const dayStartMin = parseTimeToMinutes(wakeTime);
  const dayEndMin = parseTimeToMinutes(sleepTime);

  // Guard against invalid day bounds
  const effectiveDayEndMin = dayEndMin > dayStartMin ? dayEndMin : Math.min(1440, dayStartMin + 720);

  const bufferMinutes = typeof options.bufferMinutes === 'number'
    ? options.bufferMinutes
    : (typeof options.minBufferMinutes === 'number'
      ? options.minBufferMinutes
      : (typeof options.preferences?.bufferMinutes === 'number' ? options.preferences.bufferMinutes : 10));

  const maxFocusBlockMinutes = options.maxFocusBlockMinutes || 120;
  const energyWindow = options.energyProfile || options.energyWindow || options.energyLevel || 'medium';

  // 1. Process and normalize Fixed Commitments (Hard Constraint Section 8.1)
  const rawCommitments = Array.isArray(options.fixedCommitments) ? options.fixedCommitments : [];
  const fixedBlocks = [];
  let totalCommitmentMinutes = 0;

  for (const c of rawCommitments) {
    const cStart = parseTimeToMinutes(c.start);
    const cEnd = parseTimeToMinutes(c.end);

    // Only include commitments that overlap with the active day window
    if (cEnd > dayStartMin && cStart < effectiveDayEndMin) {
      const clampedStart = Math.max(dayStartMin, cStart);
      const clampedEnd = Math.min(effectiveDayEndMin, cEnd);

      if (clampedEnd > clampedStart) {
        const duration = clampedEnd - clampedStart;
        totalCommitmentMinutes += duration;

        fixedBlocks.push({
          id: c.id || generateId(),
          planId,
          start: formatMinutesToTime(clampedStart),
          end: formatMinutesToTime(clampedEnd),
          type: c.type || 'commitment',
          status: 'scheduled',
          source: 'manual',
          locked: true,
          title: c.title || c.name || 'Fixed Commitment',
          startMin: clampedStart,
          endMin: clampedEnd
        });
      }
    }
  }

  // Sort fixed commitments chronologically
  fixedBlocks.sort((a, b) => a.startMin - b.endMin);

  // 2. Build Free Availability Windows (Section 5.3 & 8.1)
  let baseWindows = [];
  if (Array.isArray(options.availableWindows) && options.availableWindows.length > 0) {
    baseWindows = options.availableWindows.map(w => ({
      startMin: parseTimeToMinutes(w.start),
      endMin: parseTimeToMinutes(w.end)
    })).filter(w => w.endMin > w.startMin);
  } else {
    baseWindows = [{ startMin: dayStartMin, endMin: effectiveDayEndMin }];
  }

  // Carve base windows around fixed commitments
  let freeWindows = [];
  for (const bw of baseWindows) {
    let windowPieces = [bw];
    for (const fb of fixedBlocks) {
      const nextPieces = [];
      for (const piece of windowPieces) {
        // If piece does not overlap fb
        if (fb.endMin <= piece.startMin || fb.startMin >= piece.endMin) {
          nextPieces.push(piece);
        } else {
          // Left piece before fb
          if (piece.startMin < fb.startMin) {
            nextPieces.push({
              startMin: piece.startMin,
              endMin: Math.min(piece.endMin, fb.startMin)
            });
          }
          // Right piece after fb
          if (piece.endMin > fb.endMin) {
            nextPieces.push({
              startMin: Math.max(piece.startMin, fb.endMin),
              endMin: piece.endMin
            });
          }
        }
      }
      windowPieces = nextPieces;
    }
    freeWindows.push(...windowPieces);
  }

  freeWindows = freeWindows
    .filter(w => w.endMin > w.startMin)
    .sort((a, b) => a.startMin - b.startMin)
    .map(w => ({
      ...w,
      duration: w.endMin - w.startMin
    }));

  // 3. Determine Focus Capacity Limit
  const totalFreeAvailableMinutes = freeWindows.reduce((sum, w) => sum + (w.endMin - w.startMin), 0);
  const userCapacity = typeof options.capacity === 'number'
    ? options.capacity
    : (typeof options.capacityMinutes === 'number' ? options.capacityMinutes : totalFreeAvailableMinutes);
  const capacity = Math.max(0, Math.min(totalFreeAvailableMinutes, userCapacity));
  let remainingCapacity = capacity;

  // 4. Normalize and Filter Candidate Tasks
  const rawTasks = Array.isArray(options.tasks) ? options.tasks : [];
  
  // Eligible tasks must be active, not archived, not in AI inbox
  const eligibleTasks = rawTasks.filter(t => {
    if (!t) return false;
    if (t.status === 'archived' || t.status === 'completed' || t.status === 'inbox') return false;
    if (t.isArchived) return false;
    if (t.isActive === false && t.status !== 'ready' && t.status !== 'scheduled') return false;
    return true;
  });

  // Track dependencies state
  // Tasks already completed in historical records or explicitly passed in options
  const completedTaskIds = new Set();
  if (Array.isArray(options.completedTaskIds)) {
    options.completedTaskIds.forEach(id => completedTaskIds.add(id));
  }
  rawTasks.forEach(t => {
    if (t && (t.status === 'completed' || t.lastCompletedAt)) {
      completedTaskIds.add(t.id);
    }
  });

  // Map to track completion end-time of tasks scheduled during today's plan run
  const scheduledTaskEndTimes = new Map();

  const placedBlocks = [];
  const scheduledTasks = [];
  let remainingCandidatePool = [...eligibleTasks];
  let plannedTaskMinutes = 0;
  let previousTask = null;
  let continuousFocusMinutes = 0;

  // 5. Deterministic Placement Loop across Free Windows
  for (const window of freeWindows) {
    let currentMin = window.startMin;
    const windowEndMin = window.endMin;

    while (currentMin < windowEndMin && remainingCapacity > 0 && remainingCandidatePool.length > 0) {
      // Find all tasks in remainingCandidatePool that can validly be placed
      const placeableCandidates = [];

      for (const task of remainingCandidatePool) {
        const duration = typeof task.estimatedMinutes === 'number' && task.estimatedMinutes > 0
          ? task.estimatedMinutes
          : 30;

        // Hard Constraint: Capacity Limit
        if (duration > remainingCapacity) {
          continue;
        }

        // Hard Constraint: Dependencies (Section 8.1)
        const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
        let depsMet = true;
        let minStartFromDeps = currentMin;

        for (const depId of deps) {
          const rawId = typeof depId === 'string' ? depId : depId?.id;
          if (!rawId) continue;

          if (completedTaskIds.has(rawId)) {
            // Already completed in past/prior history
            continue;
          } else if (scheduledTaskEndTimes.has(rawId)) {
            // Scheduled earlier today
            const depEndTime = scheduledTaskEndTimes.get(rawId);
            minStartFromDeps = Math.max(minStartFromDeps, depEndTime + bufferMinutes);
          } else {
            // Prerequisite is not yet scheduled or completed
            depsMet = false;
            break;
          }
        }

        if (!depsMet) {
          continue;
        }

        // Hard Constraint: Earliest Start Window (Section 8.1)
        let effectiveEarliestStart = currentMin;
        if (task.earliestStart) {
          const eMin = parseTimeToMinutes(task.earliestStart);
          effectiveEarliestStart = Math.max(effectiveEarliestStart, eMin);
        }
        effectiveEarliestStart = Math.max(effectiveEarliestStart, minStartFromDeps);

        // Can it fit before the window ends?
        const candEnd = effectiveEarliestStart + duration;
        if (candEnd > windowEndMin) {
          continue;
        }

        // Hard Constraint: Latest Start Window (Section 8.1)
        if (task.latestStart) {
          const lMin = parseTimeToMinutes(task.latestStart);
          if (effectiveEarliestStart > lMin) {
            continue;
          }
        }

        // Hard Constraint: Deadlines (Section 8.1)
        if (task.deadline) {
          const parsed = parseDeadline(task.deadline, date);
          if (parsed) {
            // If deadline is for a past date, cannot be placed
            if (parsed.date < date) {
              continue;
            }
            // If deadline is today and has a specific time, task must complete on or before it
            if (parsed.date === date && parsed.hasTime) {
              const deadlineMin = parseTimeToMinutes(parsed.time);
              if (candEnd > deadlineMin) {
                continue; // Violates deadline today
              }
            }
          }
        }

        // Candidate Score (Section 8.3)
        const score = candidateScore(task, {
          date,
          energyWindow,
          previousTask,
          slotTime: formatMinutesToTime(effectiveEarliestStart),
          preferences: options.preferences
        });

        placeableCandidates.push({
          task,
          duration,
          effectiveStart: effectiveEarliestStart,
          candEnd,
          score
        });
      }

      // If no candidate task can be placed at this time in this window, stop window loop
      if (placeableCandidates.length === 0) {
        break;
      }

      // Sort placeable candidates: Highest candidateScore first!
      // Mathematical tie-breaking: priority descending, urgency descending, duration ascending
      placeableCandidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const pA = a.task.priority || 0;
        const pB = b.task.priority || 0;
        if (pB !== pA) return pB - pA;
        const uA = a.task.urgency || 0;
        const uB = b.task.urgency || 0;
        if (uB !== uA) return uB - uA;
        // Prefer task that can start earlier without creating gaps
        if (a.effectiveStart !== b.effectiveStart) return a.effectiveStart - b.effectiveStart;
        return a.duration - b.duration;
      });

      const selected = placeableCandidates[0];
      const task = selected.task;

      // Handle intermediate gap if effectiveStart > currentMin (e.g. earliestStart restriction)
      if (selected.effectiveStart > currentMin) {
        const gapDuration = selected.effectiveStart - currentMin;
        const gapType = gapDuration <= bufferMinutes ? 'buffer' : 'open';
        const gapTitle = gapType === 'buffer' ? 'Buffer' : 'Open Time';

        placedBlocks.push({
          id: generateId(),
          planId,
          start: formatMinutesToTime(currentMin),
          end: formatMinutesToTime(selected.effectiveStart),
          type: gapType,
          status: 'scheduled',
          source: 'planner',
          locked: false,
          title: gapTitle
        });
        currentMin = selected.effectiveStart;
        continuousFocusMinutes = 0;
      }

      // Hard Constraint: Max Focus Block Limit (Section 8.1)
      if (continuousFocusMinutes + selected.duration > maxFocusBlockMinutes && continuousFocusMinutes > 0) {
        const breakDuration = Math.min(15, windowEndMin - currentMin);
        if (breakDuration > 0) {
          placedBlocks.push({
            id: generateId(),
            planId,
            start: formatMinutesToTime(currentMin),
            end: formatMinutesToTime(currentMin + breakDuration),
            type: 'break',
            status: 'scheduled',
            source: 'planner',
            locked: false,
            title: 'Rest Break'
          });
          currentMin += breakDuration;
          continuousFocusMinutes = 0;

          // Re-verify if task still fits window bounds after break
          if (currentMin + selected.duration > windowEndMin) {
            continue;
          }

          // Re-verify latestStart constraint after break
          if (task.latestStart && currentMin > parseTimeToMinutes(task.latestStart)) {
            continue;
          }

          // Re-verify deadline constraint after break
          if (task.deadline) {
            const parsedDeadline = parseDeadline(task.deadline, date);
            if (parsedDeadline && parsedDeadline.date === date && parsedDeadline.hasTime) {
              const deadlineMin = parseTimeToMinutes(parsedDeadline.time);
              if (currentMin + selected.duration > deadlineMin) {
                continue;
              }
            }
          }
        }
      }

      // Successfully place the task!
      const taskStartMin = currentMin;
      const taskEndMin = currentMin + selected.duration;

      const taskBlock = {
        id: generateId(),
        planId,
        taskId: task.id,
        title: task.title || task.name || 'Untitled Task',
        start: formatMinutesToTime(taskStartMin),
        end: formatMinutesToTime(taskEndMin),
        type: 'task',
        status: 'scheduled',
        source: 'planner',
        locked: false,
        duration: selected.duration,
        priority: task.priority,
        urgency: task.urgency,
        score: selected.score
      };

      placedBlocks.push(taskBlock);

      // Record for return payload and dependency resolution
      scheduledTasks.push({
        ...task,
        scheduledTime: formatMinutesToTime(taskStartMin),
        scheduledEndTime: formatMinutesToTime(taskEndMin),
        status: 'scheduled',
        _scheduledBlockId: taskBlock.id,
        _score: selected.score
      });

      scheduledTaskEndTimes.set(task.id, taskEndMin);

      // State updates
      remainingCandidatePool = remainingCandidatePool.filter(t => t.id !== task.id);
      plannedTaskMinutes += selected.duration;
      remainingCapacity -= selected.duration;
      continuousFocusMinutes += selected.duration;
      previousTask = task;
      currentMin = taskEndMin;

      // Insert transition buffer after task (if room exists in current window)
      if (bufferMinutes > 0 && currentMin < windowEndMin && remainingCapacity > 0) {
        const actualBuffer = Math.min(bufferMinutes, windowEndMin - currentMin);
        if (actualBuffer > 0) {
          placedBlocks.push({
            id: generateId(),
            planId,
            start: formatMinutesToTime(currentMin),
            end: formatMinutesToTime(currentMin + actualBuffer),
            type: 'buffer',
            status: 'scheduled',
            source: 'planner',
            locked: false,
            title: 'Buffer'
          });
          currentMin += actualBuffer;
          continuousFocusMinutes = 0; // Buffer resets focus block counter
        }
      }
    } // end while in window
  } // end for window

  // 6. Safe Failure Handling & Remaining Tasks (Requirement R3)
  // Unscheduled tasks remain safely preserved in the 'ready' state
  const unscheduledTasks = remainingCandidatePool.map(t => ({
    ...t,
    status: t.status === 'scheduled' ? 'ready' : (t.status || 'ready')
  }));

  // 7. Combine All Blocks and Map Unused Gaps (Section 6.4)
  const combinedPlaced = [...fixedBlocks, ...placedBlocks];
  const gapBlocks = createScheduleGaps(combinedPlaced, dayStartMin, effectiveDayEndMin, bufferMinutes, planId);

  const allBlocks = [...combinedPlaced, ...gapBlocks];

  // Sort strictly chronologically by start time
  allBlocks.sort((a, b) => {
    return parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start);
  });

  // 8. Validate Schedule & Ensure Zero Overlaps Invariant
  const validation = validateSchedule(allBlocks);

  // Compute metrics
  let totalBufferMinutes = 0;
  let totalOpenMinutes = 0;
  for (const b of allBlocks) {
    const dur = parseTimeToMinutes(b.end) - parseTimeToMinutes(b.start);
    if (b.type === 'buffer') totalBufferMinutes += dur;
    if (b.type === 'open') totalOpenMinutes += dur;
  }

  const plannedFocusMinutes = plannedTaskMinutes;
  const utilization = capacity > 0 ? Math.min(1, Number((plannedFocusMinutes / capacity).toFixed(4))) : 0;

  const totalEligiblePriority = eligibleTasks.reduce((sum, t) => sum + (typeof t.priority === 'number' ? t.priority : 50), 0);
  const scheduledPriority = scheduledTasks.reduce((sum, t) => sum + (typeof t.priority === 'number' ? t.priority : 50), 0);
  const priorityCoverage = totalEligiblePriority > 0
    ? Math.min(1, Number((scheduledPriority / totalEligiblePriority).toFixed(4)))
    : (eligibleTasks.length === 0 ? 1 : 0);

  const metrics = {
    plannedFocusMinutes,
    utilization,
    priorityCoverage
  };

  return {
    id: planId,
    userId: options.userId || 'user_default',
    date,
    timezone: options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    version: 1,
    status: 'draft',
    blocks: allBlocks,
    scheduledTasks,
    unscheduledTasks,
    plannedFocusMinutes,
    plannedTaskMinutes: plannedFocusMinutes,
    totalBufferMinutes,
    totalOpenMinutes,
    totalCommitmentMinutes,
    capacity,
    capacityMinutes: capacity,
    remainingCapacity: Math.max(0, capacity - plannedFocusMinutes),
    metrics,
    hasOverlaps: validation.hasOverlaps, // Strictly false
    isValid: validation.isValid,
    isFeasible: unscheduledTasks.length === 0 || remainingCapacity === 0,
    validation
  };
}

/**
 * Convenience alias for generateDeterministicSchedule
 */
export const scheduleDay = generateDeterministicSchedule;
