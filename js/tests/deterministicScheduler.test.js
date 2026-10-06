/* js/tests/deterministicScheduler.test.js */
import { describe, it, expect } from './runner.js';
import { 
  parseTimeToMinutes, 
  formatMinutesToTime, 
  validateSchedule, 
  generateDeterministicSchedule 
} from '../engine/deterministicScheduler.js';
import { candidateScore, rankCandidateTasks } from '../engine/scoring.js';

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

});
