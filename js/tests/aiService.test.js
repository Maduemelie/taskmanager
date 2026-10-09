/* js/tests/aiService.test.js */
import { describe, it, expect } from './runner.js';
import { 
  validateTaskExtractionSchema, 
  extractTaskFromText, 
  decomposeTask, 
  suggestTaskClarifications 
} from '../engine/aiService.js';

describe('AI Task Extraction & Clarification Service (Spec Sections 10 & 11)', () => {

  const sampleBuckets = [
    { id: 'learning', name: 'Learning', emoji: '📚' },
    { id: 'health', name: 'Health', emoji: '💪' },
    { id: 'home', name: 'Home', emoji: '🏠' },
    { id: 'finance', name: 'Finance', emoji: '💰' }
  ];

  it('should validate and normalize task extraction schemas to canonical domain model', () => {
    const raw = {
      title: '  Prepare Taxes  ',
      estimatedMinutes: 45,
      priority: 4, // 1-5 legacy scale
      energy: 'high',
      categoryId: 'finance'
    };

    const validated = validateTaskExtractionSchema(raw);

    expect(validated.title).toBe('Prepare Taxes');
    expect(validated.estimatedMinutes).toBe(45);
    expect(validated.priority).toBe(80); // 4/5 * 100 = 80
    expect(validated.energy).toBe('high');
    expect(validated.categoryId).toBe('finance');
    expect(validated.type).toBe('one_time');
    expect(validated.focusRequired).toBe(true);
  });

  it('should reject non-object payloads with an explicit error', () => {
    let errorCaught = false;
    try {
      validateTaskExtractionSchema(null);
    } catch (e) {
      errorCaught = true;
    }
    expect(errorCaught).toBe(true);
  });

  it('should extract structured task from natural language with high confidence', async () => {
    const prompt = 'Study LangChain for an hour tomorrow morning';
    const result = await extractTaskFromText(prompt, { availableBuckets: sampleBuckets });

    expect(result.source).toBe('deterministic');
    expect(result.task.title.toLowerCase().includes('langchain')).toBe(true);
    expect(result.task.estimatedMinutes).toBe(60);
    expect(result.task.categoryId).toBe('learning');
    expect(result.task.preferredTime).toBe('morning');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('should decompose tasks with duration >= 60m into actionable subtasks', async () => {
    const prompt = 'Prepare presentation for quarterly business review for 90 minutes';
    const result = await extractTaskFromText(prompt, { availableBuckets: sampleBuckets });

    expect(result.task.estimatedMinutes).toBe(90);
    expect(result.task.subtasks.length).toBeGreaterThan(0);

    const firstSubtask = result.task.subtasks[0];
    expect(Boolean(firstSubtask.title)).toBe(true);
    expect(firstSubtask.estimatedMinutes).toBeGreaterThan(0);
  });

  it('should gracefully degrade on empty or ambiguous inputs into AI Inbox', async () => {
    const result = await extractTaskFromText('', { availableBuckets: sampleBuckets });

    expect(result.task.status).toBe('inbox');
    expect(result.confidence).toBeLessThan(0.3);
    expect(result.clarifications.length).toBeGreaterThan(0);
  });

  it('should fall back to deterministic extraction when custom AI Gateway fails', async () => {
    const faultyGateway = {
      extract: async () => {
        throw new Error('503 Service Unavailable');
      }
    };

    const prompt = 'Quick workout for 30m';
    const result = await extractTaskFromText(prompt, {
      availableBuckets: sampleBuckets,
      customApiGateway: faultyGateway
    });

    expect(result.source).toBe('deterministic');
    expect(result.task.categoryId).toBe('health');
    expect(result.task.estimatedMinutes).toBe(30);
  });

  it('should decompose specific domain tasks using structured templates', () => {
    const workoutDecomp = decomposeTask({ title: 'Gym Workout Session', estimatedMinutes: 60, energy: 'high' });
    expect(workoutDecomp.length).toBe(3);
    expect(workoutDecomp[0].title.includes('warmup')).toBe(true);

    const taxDecomp = decomposeTask({ title: 'Annual Tax Filing', estimatedMinutes: 90, energy: 'high' });
    expect(taxDecomp.length).toBe(3);
    expect(taxDecomp[0].title.includes('receipts')).toBe(true);
  });

  it('should provide comprehensive clarification proposals for AI Inbox tasks', () => {
    const inboxTask = {
      id: 'task-inbox-1',
      title: 'taxes',
      status: 'inbox'
    };

    const proposal = suggestTaskClarifications(inboxTask, sampleBuckets);

    expect(proposal.suggestedCategory).toBe('finance');
    expect(proposal.suggestedDuration).toBe(60);
    expect(proposal.suggestedEnergy).toBe('high');
    expect(proposal.categoryReasoning.includes('financial')).toBe(true);
    expect(proposal.suggestedSubtasks.length).toBeGreaterThan(0);
    expect(proposal.readyToApprove).toBe(true);
  });

});
