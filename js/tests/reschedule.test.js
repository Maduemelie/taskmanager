/* js/tests/reschedule.test.js */
import { describe, it, expect } from './runner.js';
import { 
  addUnplannedTask, 
  rescheduleRemaining, 
  suggestDeferrals, 
  applyDeferrals,
  evaluateReplanTrigger,
  replanRemainingDay
} from '../engine/reschedule.js';

describe('Reschedule & Adaptive Replanning Engine (Spec Section 9)', () => {

  const initialPlan = {
    id: 'plan-123',
    date: '2026-10-06',
    capacity: 120,
    plannedTasks: [
      { taskId: 'task-1', scheduledTime: '09:00', estimatedMinutes: 30, status: 'pending', isUnplanned: false },
      { taskId: 'task-2', scheduledTime: '09:30', estimatedMinutes: 45, status: 'pending', isUnplanned: false },
      { taskId: 'task-3', scheduledTime: '10:15', estimatedMinutes: 30, status: 'pending', isUnplanned: false }
    ]
  };

  it('should insert unplanned task overlapping scheduled slots', () => {
    const newTask = { taskId: 'interruption-1', name: 'Emergency client call', estimatedMinutes: 20 };
    const plan = addUnplannedTask(initialPlan, newTask, '09:15');
    
    expect(plan.plannedTasks.length).toBe(4);
    
    const inserted = plan.plannedTasks.find(t => t.taskId === 'interruption-1');
    expect(inserted).toBeTruthy();
    expect(inserted.scheduledTime).toBe('09:15');
    expect(inserted.isUnplanned).toBeTruthy();
  });

  it('should shift remaining tasks forward after time slippage', () => {
    const plan = rescheduleRemaining(initialPlan, '09:15', 20);
    
    const t1 = plan.plannedTasks.find(t => t.taskId === 'task-1');
    const t2 = plan.plannedTasks.find(t => t.taskId === 'task-2');
    const t3 = plan.plannedTasks.find(t => t.taskId === 'task-3');

    expect(t1.scheduledTime).toBe('09:00');
    expect(t2.scheduledTime).toBe('09:50');
    expect(t3.scheduledTime).toBe('10:35');
  });

  it('should filter task slots when deferrals are applied', () => {
    const plan = applyDeferrals(initialPlan, ['task-3']);
    
    const t3 = plan.plannedTasks.find(t => t.taskId === 'task-3');
    expect(t3.status).toBe('rescheduled');
  });

  it('should format 24-hour rollover across midnight when tasks shift past 23:59', () => {
    const latePlan = {
      id: 'plan-late',
      date: '2026-10-06',
      capacity: 120,
      plannedTasks: [
        { taskId: 'late-1', scheduledTime: '23:45', estimatedMinutes: 30, status: 'pending', isUnplanned: false }
      ]
    };
    const shifted = rescheduleRemaining(latePlan, '23:00', 30);
    const t1 = shifted.plannedTasks.find(t => t.taskId === 'late-1');
    expect(t1.scheduledTime).toBe('00:15');
  });

  // Section 9.1: Trigger Evaluations
  it('should evaluate replan triggers per Section 9.1: overrun, early completion, missed start', () => {
    const testPlan = {
      id: 'p-triggers',
      date: '2026-10-06',
      plannedTasks: [
        { taskId: 't-late', scheduledTime: '09:00', estimatedMinutes: 30, status: 'pending' },
        { taskId: 't-prog', scheduledTime: '10:00', estimatedMinutes: 30, status: 'in-progress' }
      ]
    };

    // 1. Task Overrun (> 15m)
    const overrunEval = evaluateReplanTrigger({
      plan: testPlan,
      currentTime: '10:50', // 50m elapsed on a 30m task (20m overrun)
      activeTask: testPlan.plannedTasks[1]
    });
    expect(overrunEval.shouldReplan).toBe(true);
    expect(overrunEval.trigger).toBe('task_overrun');

    // 2. Early Completion (> 20m early)
    const earlyEval = evaluateReplanTrigger({
      plan: testPlan,
      currentTime: '10:00',
      completedTask: { estimatedMinutes: 60, actualMinutes: 25 } // 35m early
    });
    expect(earlyEval.shouldReplan).toBe(true);
    expect(earlyEval.trigger).toBe('early_completion');

    // 3. Missed Start (> 30m past scheduled start)
    const missedEval = evaluateReplanTrigger({
      plan: testPlan,
      currentTime: '09:45' // scheduled 09:00, 45m late
    });
    expect(missedEval.shouldReplan).toBe(true);
    expect(missedEval.trigger).toBe('missed_start');
  });

  // Section 9.2 & 9.3: Non-destructive replanning and adaptive cascade
  it('should strictly preserve completed tasks non-destructively per Section 9.2', () => {
    const planWithCompleted = {
      id: 'p-freeze',
      date: '2026-10-06',
      plannedTasks: [
        { taskId: 'done-1', scheduledTime: '08:00', estimatedMinutes: 60, status: 'completed', actualMinutes: 55, completedAt: '2026-10-06T08:55:00Z' },
        { taskId: 'pend-1', scheduledTime: '09:00', estimatedMinutes: 45, status: 'pending' },
        { taskId: 'pend-2', scheduledTime: '09:45', estimatedMinutes: 30, status: 'pending' }
      ]
    };

    const result = replanRemainingDay({
      plan: planWithCompleted,
      currentTime: '10:00',
      dayEndTime: '18:00',
      bufferMinutes: 10
    });

    const frozen = result.updatedPlan.plannedTasks.find(t => t.taskId === 'done-1');
    expect(frozen.status).toBe('completed');
    expect(frozen.actualMinutes).toBe(55);
    expect(frozen.completedAt).toBe('2026-10-06T08:55:00Z');
    expect(frozen.scheduledTime).toBe('08:00');
  });

  it('should cascade pending tasks forward when remaining duration fits capacity per Section 9.3', () => {
    const cascadePlan = {
      id: 'p-cascade',
      date: '2026-10-06',
      plannedTasks: [
        { taskId: 'p1', scheduledTime: '09:00', estimatedMinutes: 30, status: 'pending' },
        { taskId: 'p2', scheduledTime: '09:40', estimatedMinutes: 30, status: 'pending' }
      ]
    };

    // User is replanning at 11:00, day ends at 17:00 (360m available, only 70m needed)
    const result = replanRemainingDay({
      plan: cascadePlan,
      currentTime: '11:00',
      dayEndTime: '17:00',
      bufferMinutes: 10
    });

    expect(result.type).toBe('cascade');
    expect(result.deferredTasks.length).toBe(0);
    expect(result.keptTasks.length).toBe(2);

    const updatedP1 = result.updatedPlan.plannedTasks.find(t => t.taskId === 'p1');
    const updatedP2 = result.updatedPlan.plannedTasks.find(t => t.taskId === 'p2');

    expect(updatedP1.scheduledTime).toBe('11:00');
    expect(updatedP2.scheduledTime).toBe('11:40'); // 11:00 + 30m + 10m buffer = 11:40
  });

  it('should score and suggest deferrals when remaining duration exceeds capacity per Section 9.3', () => {
    const overCapacityPlan = {
      id: 'p-over',
      date: '2026-10-06',
      plannedTasks: [
        { taskId: 'crit', name: 'Critical Fix', priority: 95, estimatedMinutes: 60, status: 'pending' },
        { taskId: 'low1', name: 'File Clean', priority: 25, estimatedMinutes: 60, status: 'pending' },
        { taskId: 'low2', name: 'Read News', priority: 10, estimatedMinutes: 60, status: 'pending' }
      ]
    };

    // Replanning at 15:00, day ends at 16:30 (90m available, 180m+ needed)
    const result = replanRemainingDay({
      plan: overCapacityPlan,
      currentTime: '15:00',
      dayEndTime: '16:30',
      bufferMinutes: 10,
      allTasks: [
        { id: 'crit', name: 'Critical Fix', priority: 95, estimatedMinutes: 60 },
        { id: 'low1', name: 'File Clean', priority: 25, estimatedMinutes: 60 },
        { id: 'low2', name: 'Read News', priority: 10, estimatedMinutes: 60 }
      ]
    });

    expect(result.type).toBe('rebalance');
    expect(result.deferredTasks.length).toBeGreaterThan(0);

    // High priority task should be kept
    const keptIds = result.keptTasks.map(t => t.taskId);
    expect(keptIds.includes('crit')).toBe(true);

    // Low priority tasks should be deferred
    const deferredIds = result.deferredTasks.map(t => t.taskId);
    expect(deferredIds.includes('low2')).toBe(true);
  });

});
