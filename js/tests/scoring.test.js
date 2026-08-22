/* js/tests/scoring.test.js */
import { describe, it, expect } from './runner.js';
import { scoreTask } from '../engine/scoring.js';

describe('Task Scoring Algorithm', () => {

  const baseContext = {
    date: '2026-08-20',
    currentPlan: [],
    energyWindow: 'medium',
    preferences: {
      buckets: [{ id: 'health' }, { id: 'learning' }]
    }
  };

  const createBaseTask = (overrides = {}) => ({
    id: 'test-id',
    name: 'Generic Task',
    bucket: 'health',
    priority: 3,
    estimatedMinutes: 30,
    energyLevel: 'medium',
    preferredTime: 'anytime',
    createdAt: '2026-08-10T12:00:00.000Z',
    completionHistory: [],
    currentStreak: 0,
    isActive: true,
    isArchived: false,
    recurrence: { type: 'daily', interval: 1 },
    ...overrides
  });

  it('should score high priority tasks higher than low priority', () => {
    const taskHigh = createBaseTask({ priority: 5 });
    const taskLow = createBaseTask({ priority: 1 });
    
    const scoreHigh = scoreTask(taskHigh, baseContext);
    const scoreLow = scoreTask(taskLow, baseContext);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('should give energy match bonuses', () => {
    const energyTask = createBaseTask({ energyLevel: 'high' });
    
    const scoreMatch = scoreTask(energyTask, { ...baseContext, energyWindow: 'high' });
    const scoreMismatch = scoreTask(energyTask, { ...baseContext, energyWindow: 'low' });

    expect(scoreMatch).toBeGreaterThan(scoreMismatch);
  });

  it('should apply streak score bonuses for active streaks', () => {
    const streakTaskZero = createBaseTask({ currentStreak: 0 });
    const streakTaskFive = createBaseTask({ currentStreak: 5 });
    
    const scoreZero = scoreTask(streakTaskZero, baseContext);
    const scoreFive = scoreTask(streakTaskFive, baseContext);

    expect(scoreFive).toBeGreaterThan(scoreZero);
  });

});
