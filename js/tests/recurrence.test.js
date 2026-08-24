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

  it('should detect monthly recurring tasks on specified day of month', () => {
    const monthlyTask = {
      isActive: true,
      isArchived: false,
      createdAt: '2026-08-01T12:00:00.000Z',
      recurrence: { 
        type: 'monthly', 
        interval: 1, 
        dayOfMonth: 15 
      }
    };

    expect(isTaskDueOn(monthlyTask, '2026-08-15')).toBeTruthy();
    expect(isTaskDueOn(monthlyTask, '2026-08-14')).toBeFalsy();
    expect(isTaskDueOn(monthlyTask, '2026-08-16')).toBeFalsy();
    expect(isTaskDueOn(monthlyTask, '2026-09-15')).toBeTruthy();
  });

  it('should handle monthly recurring tasks set to day 31 on shorter months', () => {
    const monthlyEndOfMonthTask = {
      isActive: true,
      isArchived: false,
      createdAt: '2026-01-01T12:00:00.000Z',
      recurrence: { 
        type: 'monthly', 
        interval: 1, 
        dayOfMonth: 31 
      }
    };

    // 31-day month (January)
    expect(isTaskDueOn(monthlyEndOfMonthTask, '2026-01-31')).toBeTruthy();
    expect(isTaskDueOn(monthlyEndOfMonthTask, '2026-01-30')).toBeFalsy();

    // 28-day month (February 2026)
    expect(isTaskDueOn(monthlyEndOfMonthTask, '2026-02-28')).toBeTruthy();
    expect(isTaskDueOn(monthlyEndOfMonthTask, '2026-02-27')).toBeFalsy();

    // 30-day month (April 2026)
    expect(isTaskDueOn(monthlyEndOfMonthTask, '2026-04-30')).toBeTruthy();
    expect(isTaskDueOn(monthlyEndOfMonthTask, '2026-04-29')).toBeFalsy();
  });

  it('should fallback to creation day for monthly recurrence when dayOfMonth is omitted', () => {
    const legacyMonthlyTask = {
      isActive: true,
      isArchived: false,
      createdAt: '2026-03-18T10:00:00.000Z',
      recurrence: { 
        type: 'monthly', 
        interval: 1
      }
    };

    expect(isTaskDueOn(legacyMonthlyTask, '2026-03-18')).toBeTruthy();
    expect(isTaskDueOn(legacyMonthlyTask, '2026-03-17')).toBeFalsy();
    expect(isTaskDueOn(legacyMonthlyTask, '2026-04-18')).toBeTruthy();
  });

});
