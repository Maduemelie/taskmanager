/* js/tests/deterministicScheduler.test.js */
import { describe, it, expect } from './runner.js';
import { 
  parseTimeToMinutes, 
  formatMinutesToTime, 
  validateSchedule, 
  generateDeterministicSchedule,
  createScheduleGaps
} from '../engine/deterministicScheduler.js';
import { candidateScore, rankCandidateTasks, parseDeadline } from '../engine/scoring.js';

describe('Deterministic Scheduling Engine (Spec Section 8)', () => {

  it('should accurately convert time strings to minutes and back', () => {
    expect(parseTimeToMinutes('08:30')).toBe(510);
    expect(parseTimeToMinutes('13:45')).toBe(825);
    expect(formatMinutesToTime(510)).toBe('08:30');
    expect(formatMinutesToTime(825)).toBe('13:45');
  });

  it('should score high priority and high urgency tasks higher than low priority tasks', () => {
    const highTask = { id: 'h1', title: 'Critical Bugfix', priority: 90, urgency: 85, energy: 'high' };
    const lowTask = { id: 'l1', title: 'Organize Desktop', priority: 20, urgency: 10, energy: 'low' };

    const scoreHigh = candidateScore(highTask);
    const scoreLow = candidateScore(lowTask);

    expect(scoreHigh).toBeGreaterThan(scoreLow);

    const ranked = rankCandidateTasks([lowTask, highTask]);
    expect(ranked[0].id).toBe('h1');
    expect(ranked[1].id).toBe('l1');
  });

  it('should enforce hard constraints with zero overlapping time blocks in generated schedules', () => {
    const tasks = [
      { id: 't1', title: 'Deep Work A', estimatedMinutes: 60, priority: 80, status: 'ready' },
      { id: 't2', title: 'Deep Work B', estimatedMinutes: 45, priority: 70, status: 'ready' },
      { id: 't3', title: 'Admin Sync', estimatedMinutes: 30, priority: 60, status: 'ready' }
    ];

    const result = generateDeterministicSchedule({
      tasks,
      availableWindows: [{ start: '09:00', end: '13:00' }],
      minBufferMinutes: 10
    });

    expect(result.status).toBe('draft');
    expect(result.blocks.length).toBeGreaterThan(0);

    const validation = validateSchedule(result.blocks);
    expect(validation.isValid).toBe(true);
    expect(validation.hasOverlaps).toBe(false);
    expect(validation.overlaps.length).toBe(0);
  });

  it('should handle capacity limits safely and leave excess tasks unscheduled without crashing', () => {
    // 60 minutes available, but tasks total 120 minutes
    const tasks = [
      { id: 't1', title: 'Priority 1 Task', estimatedMinutes: 40, priority: 95, urgency: 90, status: 'ready' },
      { id: 't2', title: 'Priority 2 Task', estimatedMinutes: 40, priority: 70, urgency: 50, status: 'ready' },
      { id: 't3', title: 'Priority 3 Task', estimatedMinutes: 40, priority: 30, urgency: 20, status: 'ready' }
    ];

    const result = generateDeterministicSchedule({
      tasks,
      availableWindows: [{ start: '10:00', end: '11:00' }], // 60 min total
      minBufferMinutes: 0
    });

    expect(result.status).toBe('draft');
    
    // Validate zero overlaps
    const validation = validateSchedule(result.blocks);
    expect(validation.isValid).toBe(true);
    expect(validation.hasOverlaps).toBe(false);

    // High priority task should be scheduled
    const scheduledTaskIds = result.blocks.filter(b => b.type === 'task').map(b => b.taskId);
    expect(scheduledTaskIds.includes('t1')).toBe(true);

    // Unscheduled tasks should contain lower priority items safely
    expect(Array.isArray(result.unscheduledTasks)).toBe(true);
    const unscheduledIds = result.unscheduledTasks.map(t => t.id);
    expect(unscheduledIds.includes('t3')).toBe(true);
  });

  it('should preserve fixed commitments and strictly avoid overlapping them', () => {
    const tasks = [
      { id: 't1', title: 'Task Before Meeting', estimatedMinutes: 60, priority: 80, status: 'ready' },
      { id: 't2', title: 'Task After Meeting', estimatedMinutes: 60, priority: 70, status: 'ready' }
    ];
    const fixedCommitments = [
      { id: 'm1', title: 'Sprint Review', start: '10:00', end: '11:00' }
    ];

    const result = generateDeterministicSchedule({
      tasks,
      startTime: '09:00',
      endTime: '12:00',
      fixedCommitments,
      bufferMinutes: 0
    });

    const validation = validateSchedule(result.blocks);
    expect(validation.isValid).toBe(true);
    expect(validation.hasOverlaps).toBe(false);

    // Verify fixed commitment is present and locked
    const meetingBlock = result.blocks.find(b => b.id === 'm1' || b.title === 'Sprint Review');
    expect(Boolean(meetingBlock)).toBe(true);
    expect(meetingBlock.locked).toBe(true);
    expect(meetingBlock.start).toBe('10:00');
    expect(meetingBlock.end).toBe('11:00');

    // Verify task blocks do not overlap with 10:00 - 11:00
    const taskBlocks = result.blocks.filter(b => b.type === 'task');
    for (const b of taskBlocks) {
      const s = parseTimeToMinutes(b.start);
      const e = parseTimeToMinutes(b.end);
      const overlapsMeeting = s < 660 && 600 < e;
      expect(overlapsMeeting).toBe(false);
    }
  });

  it('should respect task dependencies and schedule prerequisites first', () => {
    const tasks = [
      // Dependent task has higher priority, but depends on t_prereq
      { id: 't_dep', title: 'Deploy to Prod', estimatedMinutes: 30, priority: 95, dependencies: ['t_prereq'], status: 'ready' },
      { id: 't_prereq', title: 'Run QA Tests', estimatedMinutes: 30, priority: 50, status: 'ready' }
    ];

    const result = generateDeterministicSchedule({
      tasks,
      availableWindows: [{ start: '09:00', end: '11:00' }],
      bufferMinutes: 5
    });

    const validation = validateSchedule(result.blocks);
    expect(validation.isValid).toBe(true);
    expect(validation.hasOverlaps).toBe(false);

    const prereqBlock = result.blocks.find(b => b.taskId === 't_prereq');
    const depBlock = result.blocks.find(b => b.taskId === 't_dep');
    expect(Boolean(prereqBlock)).toBe(true);
    expect(Boolean(depBlock)).toBe(true);

    const prereqEnd = parseTimeToMinutes(prereqBlock.end);
    const depStart = parseTimeToMinutes(depBlock.start);
    expect(depStart).toBeGreaterThan(prereqEnd - 1);
  });

  it('should correctly map gaps: buffer for short intervals and open time for long intervals', () => {
    const placedBlocks = [
      { id: 'b1', start: '09:00', end: '09:30', type: 'task' },
      // gap: 09:30 to 09:40 (10 min <= 15 min threshold -> buffer)
      { id: 'b2', start: '09:40', end: '10:00', type: 'task' },
      // gap: 10:00 to 11:00 (60 min > 15 min threshold -> open)
      { id: 'b3', start: '11:00', end: '12:00', type: 'task' }
    ];

    const gaps = createScheduleGaps(placedBlocks, parseTimeToMinutes('09:00'), parseTimeToMinutes('12:00'), 15);
    expect(gaps.length).toBe(2);

    const smallGap = gaps.find(g => g.start === '09:30' && g.end === '09:40');
    expect(Boolean(smallGap)).toBe(true);
    expect(smallGap.type).toBe('buffer');

    const largeGap = gaps.find(g => g.start === '10:00' && g.end === '11:00');
    expect(Boolean(largeGap)).toBe(true);
    expect(largeGap.type).toBe('open');
    expect(largeGap.title).toBe('Open Time');
  });

  it('should gracefully handle empty task lists and zero capacity', () => {
    const emptyResult = generateDeterministicSchedule({
      tasks: [],
      availableWindows: [{ start: '09:00', end: '12:00' }]
    });

    expect(emptyResult.status).toBe('draft');
    expect(emptyResult.scheduledTasks.length).toBe(0);
    expect(emptyResult.unscheduledTasks.length).toBe(0);
    expect(emptyResult.isValid).toBe(true);
    expect(emptyResult.hasOverlaps).toBe(false);

    const zeroCapacityResult = generateDeterministicSchedule({
      tasks: [{ id: 't1', title: 'Task', estimatedMinutes: 30, priority: 50, status: 'ready' }],
      capacity: 0
    });

    expect(zeroCapacityResult.scheduledTasks.length).toBe(0);
    expect(zeroCapacityResult.unscheduledTasks.length).toBe(1);
    expect(zeroCapacityResult.unscheduledTasks[0].status).toBe('ready');
  });

  it('should handle time-only and future-day deadlines accurately', () => {
    // 1. Time-only deadline defaults to today and allows scheduling if completing before deadline
    const taskTimeDeadline = {
      id: 'td1',
      title: 'Submit Today By 3pm',
      estimatedMinutes: 60,
      priority: 80,
      deadline: '15:00',
      status: 'ready'
    };
    
    // 2. Future-day deadline (tomorrow 14:00) should be schedulable today past 14:00
    const taskFutureDeadline = {
      id: 'td2',
      title: 'Due Tomorrow Afternoon',
      estimatedMinutes: 60,
      priority: 75,
      deadline: '2026-10-07T14:00',
      status: 'ready'
    };

    // 3. Past-hour deadline today should be rejected
    const taskPastDeadlineToday = {
      id: 'td3',
      title: 'Due Earlier Today',
      estimatedMinutes: 60,
      priority: 90,
      deadline: '10:00',
      status: 'ready'
    };

    const result = generateDeterministicSchedule({
      date: '2026-10-06',
      tasks: [taskTimeDeadline, taskFutureDeadline, taskPastDeadlineToday],
      availableWindows: [{ start: '13:00', end: '17:00' }],
      minBufferMinutes: 0
    });

    expect(result.isValid).toBe(true);
    expect(result.hasOverlaps).toBe(false);

    const scheduledIds = result.scheduledTasks.map(t => t.id);
    expect(scheduledIds.includes('td1')).toBe(true); // 13:00-14:00 completes before 15:00
    expect(scheduledIds.includes('td2')).toBe(true); // 14:00-15:00 completes today before tomorrow 14:00
    expect(scheduledIds.includes('td3')).toBe(false); // cannot fit before 10:00 when window starts at 13:00

    // Check parseDeadline helper
    const parsedTime = parseDeadline('15:00', '2026-10-06');
    expect(parsedTime.date).toBe('2026-10-06');
    expect(parsedTime.time).toBe('15:00');
    expect(parsedTime.hasTime).toBe(true);

    const parsedFuture = parseDeadline('2026-10-07T14:00', '2026-10-06');
    expect(parsedFuture.date).toBe('2026-10-07');
    expect(parsedFuture.time).toBe('14:00');
  });

  it('should carve custom available windows around fixed commitments preventing overlaps', () => {
    const tasks = [
      { id: 't1', title: 'Task 1', estimatedMinutes: 60, priority: 80, status: 'ready' },
      { id: 't2', title: 'Task 2', estimatedMinutes: 60, priority: 70, status: 'ready' },
      { id: 't3', title: 'Task 3', estimatedMinutes: 60, priority: 60, status: 'ready' }
    ];

    const fixedCommitments = [
      { id: 'fc1', title: 'Dentist Appointment', start: '10:00', end: '11:00' }
    ];

    const result = generateDeterministicSchedule({
      tasks,
      availableWindows: [{ start: '09:00', end: '13:00' }],
      fixedCommitments,
      bufferMinutes: 0
    });

    const validation = validateSchedule(result.blocks);
    expect(validation.isValid).toBe(true);
    expect(validation.hasOverlaps).toBe(false);

    // Verify fixed commitment is present and locked
    const fcBlock = result.blocks.find(b => b.id === 'fc1');
    expect(Boolean(fcBlock)).toBe(true);
    expect(fcBlock.locked).toBe(true);

    // Verify tasks do not overlap 10:00 - 11:00
    const taskBlocks = result.blocks.filter(b => b.type === 'task');
    for (const b of taskBlocks) {
      const s = parseTimeToMinutes(b.start);
      const e = parseTimeToMinutes(b.end);
      const overlaps = s < 660 && 600 < e;
      expect(overlaps).toBe(false);
    }
  });

  it('should re-verify constraints after break insertion when continuous focus limit is reached', () => {
    // Task A: 60m focus. Max focus block is 60m.
    // Task B: 30m, but has latestStart: '10:05'.
    // Window: 09:00 to 12:00.
    // At 10:00, Task A ends. Task B would exceed maxFocusBlockMinutes, so 15m break is inserted (10:00 - 10:15).
    // At 10:15, Task B cannot start because 10:15 > latestStart '10:05'!
    // Task B must NOT be scheduled at 10:15.
    const tasks = [
      { id: 'tA', title: 'Deep Work A', estimatedMinutes: 60, priority: 90, status: 'ready' },
      { id: 'tB', title: 'Tight Start Task', estimatedMinutes: 30, priority: 85, latestStart: '10:05', status: 'ready' }
    ];

    const result = generateDeterministicSchedule({
      tasks,
      availableWindows: [{ start: '09:00', end: '12:00' }],
      maxFocusBlockMinutes: 60,
      bufferMinutes: 0
    });

    expect(result.isValid).toBe(true);
    expect(result.hasOverlaps).toBe(false);

    const taskBBlock = result.blocks.find(b => b.taskId === 'tB');
    expect(Boolean(taskBBlock)).toBe(false); // Task B was not placed illegally after 10:05

    const unscheduledIds = result.unscheduledTasks.map(t => t.id);
    expect(unscheduledIds.includes('tB')).toBe(true);
  });

  it('should support options.capacityMinutes and return proposal metrics', () => {
    const tasks = [
      { id: 't1', title: 'Task 1', estimatedMinutes: 60, priority: 100, status: 'ready' },
      { id: 't2', title: 'Task 2', estimatedMinutes: 30, priority: 50, status: 'ready' }
    ];

    const result = generateDeterministicSchedule({
      tasks,
      availableWindows: [{ start: '09:00', end: '15:00' }],
      capacityMinutes: 90,
      bufferMinutes: 0
    });

    expect(result.capacity).toBe(90);
    expect(result.capacityMinutes).toBe(90);
    expect(result.plannedFocusMinutes).toBe(90);

    // Verify metrics object for planDay.js interoperability
    expect(Boolean(result.metrics)).toBe(true);
    expect(result.metrics.plannedFocusMinutes).toBe(90);
    expect(result.metrics.utilization).toBe(1);
    expect(result.metrics.priorityCoverage).toBe(1);
  });

});
