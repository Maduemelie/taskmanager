/* js/tests/planner.test.js */
import { describe, it, expect } from './runner.js';
import { generateDayPlan } from '../engine/planner.js';

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

});
