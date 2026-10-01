/* js/tests/planner.test.js */
import { describe, it, expect } from './runner.js';
import { generateDayPlan } from '../engine/planner.js';
import { rescheduleSequentially } from '../views/planDay.js';

describe('Planner Engine Day Scheduler', () => {

  const preferences = {
    wakeTime: '08:00',
    sleepTime: '20:00', // 12 hours = 720 minutes. Morning: 8-12, Afternoon: 12-16, Evening: 16-20
    buckets: [
      { id: 'health', name: 'Health' },
      { id: 'learning', name: 'Learning' }
    ]
  };

  const mockTasks = [
    {
      id: 'task-1',
      name: 'Morning Workout 🏃‍♂️',
      bucket: 'health',
      priority: 4,
      estimatedMinutes: 60,
      energyLevel: 'high',
      preferredTime: 'morning',
      createdAt: '2026-08-10T12:00:00.000Z',
      completionHistory: [],
      isActive: true,
      isArchived: false,
      recurrence: { type: 'daily', interval: 1 }
    },
    {
      id: 'task-2',
      name: 'Read Book 📚',
      bucket: 'learning',
      priority: 3,
      estimatedMinutes: 60,
      energyLevel: 'medium',
      preferredTime: 'evening',
      createdAt: '2026-08-10T12:00:00.000Z',
      completionHistory: [],
      isActive: true,
      isArchived: false,
      recurrence: { type: 'daily', interval: 1 }
    }
  ];

  it('should respect total capacity target', () => {
    // Capacity 60 min -> should only select 1 task
    const plan = generateDayPlan(mockTasks, preferences, 60, 'medium', '2026-08-20');
    expect(plan.length).toBe(1);
    expect(plan[0].estimatedMinutes).toBeLessThan(61);
  });

  it('should respect preferred timeslot positioning', () => {
    const plan = generateDayPlan(mockTasks, preferences, 300, 'high', '2026-08-20');
    expect(plan.length).toBe(2);

    const workout = plan.find(p => p.taskId === 'task-1');
    const read = plan.find(p => p.taskId === 'task-2');

    expect(workout).toBeTruthy();
    expect(read).toBeTruthy();
    
    // Workout preferred morning (wake at 08:00, morning slot starting range 08:00 - 12:00)
    const [wHour] = workout.scheduledTime.split(':').map(Number);
    expect(wHour).toBeLessThan(12);

    // Reading preferred evening (16:00 - 20:00)
    const [rHour] = read.scheduledTime.split(':').map(Number);
    expect(rHour).toBeGreaterThan(15);
  });

  it('should return empty list if capacity is zero', () => {
    const plan = generateDayPlan(mockTasks, preferences, 0, 'medium', '2026-08-20');
    expect(plan.length).toBe(0);
  });

  it('should sequentially re-assign start times with buffer when tasks are confirmed', () => {
    const selected = [
      { task: { id: 'task-1', estimatedMinutes: 45 } },
      { task: { id: 'task-3', estimatedMinutes: 30 } }
    ];
    const rescheduled = rescheduleSequentially(selected, '07:00', 10);
    expect(rescheduled.length).toBe(2);
    expect(rescheduled[0].scheduledTime).toBe('07:00');
    expect(rescheduled[1].scheduledTime).toBe('07:55');
  });

  it('should format 24-hour rollover correctly across midnight in sequential rescheduling', () => {
    const selected = [
      { task: { id: 'night-1', estimatedMinutes: 45 } },
      { task: { id: 'night-2', estimatedMinutes: 30 } }
    ];
    const rescheduled = rescheduleSequentially(selected, '23:30', 10);
    expect(rescheduled.length).toBe(2);
    expect(rescheduled[0].scheduledTime).toBe('23:30');
    expect(rescheduled[1].scheduledTime).toBe('00:25');
  });

  it('should schedule from evening start time when planning in the evening (e.g. 19:00 / 7:00 PM)', () => {
    const plan = generateDayPlan(mockTasks, { ...preferences, bufferMinutes: 10 }, 120, 'medium', '2026-08-20', '19:00');
    expect(plan.length).toBeGreaterThan(0);
    const firstTask = plan[0];
    const [h] = firstTask.scheduledTime.split(':').map(Number);
    expect(h).toBeGreaterThan(18);
  });

  it('should space tasks out by buffer duration between tasks', () => {
    const plan = generateDayPlan(mockTasks, { ...preferences, bufferMinutes: 15 }, 180, 'high', '2026-08-20', '08:00');
    expect(plan.length).toBe(2);
    const workout = plan.find(p => p.taskId === 'task-1');
    expect(workout.scheduledTime).toBe('08:00');
  });

});
