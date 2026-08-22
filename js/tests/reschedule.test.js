/* js/tests/reschedule.test.js */
import { describe, it, expect } from './runner.js';
import { addUnplannedTask, rescheduleRemaining, suggestDeferrals, applyDeferrals } from '../engine/reschedule.js';

describe('Reschedule & Overflow Engine', () => {

  const initialPlan = {
    id: 'plan-123',
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
    // Slippage happens at 09:15, shift remainder by 20 minutes (since interruption took 20m)
    // task-1 is at 09:00, starts before 09:15 -> not shifted.
    // task-2 is at 09:30, starts after 09:15 -> shifted by 20m to 09:50.
    // task-3 is at 10:15, starts after 09:15 -> shifted by 20m to 10:35.
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

});
