/* js/tests/recurrence.test.js */
import { describe, it, expect } from './runner.js';
import { isTaskActive, isTaskDueOn } from '../engine/recurrence.js';

describe('Recurrence & Active Rules Engine', () => {
  
  it('should filter active tasks within window', () => {
    const activeTask = {
      isActive: true,
      isArchived: false,
      createdAt: '2026-08-01T12:00:00.000Z',
      activeUntil: '2026-08-30'
    };
    
    // Active date
    expect(isTaskActive(activeTask, '2026-08-15')).toBeTruthy();
    // Expiration date
    expect(isTaskActive(activeTask, '2026-09-01')).toBeFalsy();
    // Prior date
    expect(isTaskActive(activeTask, '2026-07-29')).toBeFalsy();
  });

  it('should detect daily recurring tasks due today', () => {
    const dailyTask = {
      isActive: true,
      isArchived: false,
      createdAt: '2026-08-10T12:00:00.000Z',
      recurrence: { type: 'daily', interval: 1 }
    };
    
    expect(isTaskDueOn(dailyTask, '2026-08-11')).toBeTruthy();
    expect(isTaskDueOn(dailyTask, '2026-08-15')).toBeTruthy();
  });

  it('should detect weekly recurring tasks on specific days', () => {
    const weeklyTask = {
      isActive: true,
      isArchived: false,
      createdAt: '2026-08-10T12:00:00.000Z', // Monday
      recurrence: { 
        type: 'weekly', 
        interval: 1, 
        daysOfWeek: [1, 3, 5] // Mon, Wed, Fri
      }
    };

    expect(isTaskDueOn(weeklyTask, '2026-08-10')).toBeTruthy(); // Monday
    expect(isTaskDueOn(weeklyTask, '2026-08-11')).toBeFalsy(); // Tuesday
    expect(isTaskDueOn(weeklyTask, '2026-08-12')).toBeTruthy(); // Wednesday
  });

  it('should detect custom interval gaps', () => {
    const customTask = {
      isActive: true,
      isArchived: false,
      createdAt: '2026-08-10T12:00:00.000Z',
      recurrence: { 
        type: 'custom', 
        interval: 3 // Every 3 days
      }
    };

    expect(isTaskDueOn(customTask, '2026-08-13')).toBeTruthy();
    expect(isTaskDueOn(customTask, '2026-08-14')).toBeFalsy();
    expect(isTaskDueOn(customTask, '2026-08-16')).toBeTruthy();
  });

});
