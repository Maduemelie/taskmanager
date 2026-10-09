/* js/engine/aiService.js */
import { parseNaturalLanguageTask } from './quickCapture.js';
import { today, addDays } from '../utils/date.js';

/**
 * Common task verbs and domain decomposition templates for intelligent decomposition
 */
const DECOMPOSITION_TEMPLATES = {
  tax: [
    { title: 'Gather financial receipts & statements', estimatedMinutes: 30, energy: 'medium' },
    { title: 'Reconcile income and deductible expenses', estimatedMinutes: 45, energy: 'high' },
    { title: 'Draft and submit filing or report', estimatedMinutes: 30, energy: 'high' }
  ],
  presentation: [
    { title: 'Outline key talking points & narrative', estimatedMinutes: 30, energy: 'high' },
    { title: 'Draft presentation slides & visual assets', estimatedMinutes: 45, energy: 'high' },
    { title: 'Rehearse speech & refine timing', estimatedMinutes: 20, energy: 'medium' }
  ],
  report: [
    { title: 'Collect relevant research data & metrics', estimatedMinutes: 30, energy: 'medium' },
    { title: 'Draft report findings and recommendations', estimatedMinutes: 45, energy: 'high' },
    { title: 'Proofread and format final document', estimatedMinutes: 20, energy: 'low' }
  ],
  exam: [
    { title: 'Review core lecture notes & concepts', estimatedMinutes: 45, energy: 'high' },
    { title: 'Complete practice exam questions', estimatedMinutes: 45, energy: 'high' },
    { title: 'Identify weak areas and summarize flashcards', estimatedMinutes: 30, energy: 'medium' }
  ],
  project: [
    { title: 'Define project scope & milestones', estimatedMinutes: 30, energy: 'high' },
    { title: 'Execute primary implementation milestone', estimatedMinutes: 60, energy: 'high' },
    { title: 'Review deliverables and test outcomes', estimatedMinutes: 30, energy: 'medium' }
  ],
  workout: [
    { title: 'Dynamic warmup & mobility stretch', estimatedMinutes: 10, energy: 'low' },
    { title: 'Main training session & sets', estimatedMinutes: 35, energy: 'high' },
    { title: 'Cool down & hydration', estimatedMinutes: 10, energy: 'low' }
  ],
  clean: [
    { title: 'Declutter surfaces & put away loose items', estimatedMinutes: 15, energy: 'low' },
    { title: 'Wipe down surfaces & sanitize', estimatedMinutes: 20, energy: 'medium' },
    { title: 'Vacuum / sweep & take out trash', estimatedMinutes: 15, energy: 'medium' }
  ]
};

/**
 * Category inference rule base with semantic rationale
 */
const CATEGORY_RATIONALES = {
  learning: {
    name: 'Learning',
    emoji: '📚',
    keywords: ['study', 'read', 'course', 'learn', 'research', 'homework', 'exam', 'book', 'lecture', 'code', 'algorithm'],
    reasoning: 'Involves cognitive skill acquisition, reading, or structured study.'
  },
  health: {
    name: 'Health & Fitness',
    emoji: '💪',
    keywords: ['workout', 'gym', 'run', 'walk', 'exercise', 'yoga', 'stretch', 'doctor', 'dentist', 'meditate', 'sleep', 'diet'],
    reasoning: 'Directly supports physical or mental health and fitness.'
  },
  home: {
    name: 'Home & Life',
    emoji: '🏠',
    keywords: ['clean', 'cook', 'grocery', 'laundry', 'dishes', 'repair', 'tidy', 'meal', 'fix', 'apartment', 'house'],
    reasoning: 'Related to personal living environment, chores, or household maintenance.'
  },
  finance: {
    name: 'Finance',
    emoji: '💰',
    keywords: ['tax', 'taxes', 'budget', 'bill', 'invest', 'invoice', 'expense', 'bank', 'salary', 'rent', 'crypto', 'payment'],
    reasoning: 'Involves financial management, obligations, or budgeting.'
  },
  relationships: {
    name: 'Relationships',
    emoji: '👥',
    keywords: ['call', 'mom', 'dad', 'friend', 'meet', 'dinner', 'lunch', 'birthday', 'family', 'parents', 'hangout', 'date'],
    reasoning: 'Nurtures personal relationships, family connections, or social commitments.'
  }
};

/**
 * Validates and normalizes an extracted task object against Section 7.1 domain schema.
 * 
 * @param {Object} raw 
 * @returns {Object} Canonical structured task payload
 */
export function validateTaskExtractionSchema(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Extraction payload must be a non-null object');
  }

  const title = (raw.title || raw.name || 'Untitled Task').trim();
  const estimatedMinutes = Number.isInteger(raw.estimatedMinutes) && raw.estimatedMinutes > 0
    ? raw.estimatedMinutes
    : 30;

  // Normalize priority to 0-100 scale
  let priority = 50;
  if (typeof raw.priority === 'number') {
    if (raw.priority <= 5 && raw.priority >= 0) {
      priority = Math.round((raw.priority / 5) * 100);
    } else {
      priority = Math.min(100, Math.max(0, Math.round(raw.priority)));
    }
  }

  // Normalize urgency to 0-100 scale
  let urgency = priority;
  if (typeof raw.urgency === 'number') {
    if (raw.urgency <= 5 && raw.urgency >= 0) {
      urgency = Math.round((raw.urgency / 5) * 100);
    } else {
      urgency = Math.min(100, Math.max(0, Math.round(raw.urgency)));
    }
  }

  const energy = ['low', 'medium', 'high'].includes(raw.energy) ? raw.energy : 'medium';
  const categoryId = raw.categoryId || raw.bucket || 'home';
  const focusRequired = Boolean(raw.focusRequired || energy === 'high' || estimatedMinutes >= 60);
  const type = raw.type === 'habit' || raw.isHabit ? 'habit' : 'one_time';
  const recurrence = raw.recurrence || null;
  const deadline = raw.deadline || null;
  const preferredTime = ['morning', 'afternoon', 'evening', 'anytime'].includes(raw.preferredTime) 
    ? raw.preferredTime 
    : 'anytime';

  const status = ['inbox', 'ready', 'scheduled', 'active', 'completed', 'skipped', 'archived'].includes(raw.status)
    ? raw.status
    : 'ready';

  const subtasks = Array.isArray(raw.subtasks)
    ? raw.subtasks.map((st, idx) => ({
        id: st.id || `st-${idx + 1}`,
        title: (st.title || st.name || `Subtask ${idx + 1}`).trim(),
        estimatedMinutes: st.estimatedMinutes || Math.max(15, Math.round(estimatedMinutes / Math.max(1, raw.subtasks.length))),
        energy: ['low', 'medium', 'high'].includes(st.energy) ? st.energy : energy,
        completed: Boolean(st.completed)
      }))
    : [];

  return {
    title,
    description: raw.description ? raw.description.trim() : '',
    categoryId,
    estimatedMinutes,
    priority,
    urgency,
    importance: raw.importance !== undefined ? Math.min(100, Math.max(0, raw.importance)) : priority,
    energy,
    focusRequired,
    type,
    recurrence,
    deadline,
    preferredTime,
    status,
    subtasks
  };
}

/**
 * Extracts structured task metadata from unstructured natural language input.
 * Meets Section 10 & 11 (/v1/tasks/extract) specifications with deterministic fallback.
 * 
 * @param {string} rawInput Unstructured text prompt
 * @param {Object} [options={}]
 * @param {Array} [options.availableBuckets=[]] User category buckets
 * @param {string} [options.currentDate] Defaults to today
 * @param {Object} [options.customApiGateway] Optional LLM gateway handler
 * @returns {Promise<Object>} Extracted and validated task schema with confidence metrics
 */
export async function extractTaskFromText(rawInput, options = {}) {
  const { availableBuckets = [], currentDate = today(), customApiGateway = null } = options;

  if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
    return {
      task: validateTaskExtractionSchema({
        title: 'Untitled Task',
        estimatedMinutes: 30,
        status: 'inbox'
      }),
      confidence: 0.1,
      clarifications: ['What is the name or goal of this task?'],
      source: 'deterministic'
    };
  }

  // 1. Attempt Custom AI Gateway if provided (Section 10/11)
  if (customApiGateway && typeof customApiGateway.extract === 'function') {
    try {
      const remoteResult = await customApiGateway.extract(rawInput, { availableBuckets, currentDate });
      if (remoteResult && remoteResult.task) {
        const validated = validateTaskExtractionSchema(remoteResult.task);
        return {
          task: validated,
          confidence: remoteResult.confidence || 0.9,
          clarifications: remoteResult.clarifications || [],
          source: 'ai_gateway'
        };
      }
    } catch (apiErr) {
      console.warn('[AIService] Gateway request failed, falling back to deterministic extractor:', apiErr);
    }
  }

  // 2. Deterministic Rule-Based Extraction (Guaranteed Fallback)
  const baseParsed = parseNaturalLanguageTask(rawInput, availableBuckets);

  // 3. Cognitive Decomposition Check
  let subtasks = [];
  if (baseParsed.estimatedMinutes >= 60 || isComplexTask(baseParsed.title)) {
    subtasks = decomposeTask({
      title: baseParsed.title,
      estimatedMinutes: baseParsed.estimatedMinutes,
      energy: baseParsed.energy
    });
  }

  // 4. Compute Confidence and Clarifications
  const clarifications = [];
  let confidence = 0.5;

  if (baseParsed.isAmbiguous) {
    confidence = 0.3;
    if (baseParsed.title === 'Untitled Task' || baseParsed.title.length < 3) {
      clarifications.push('Please provide a more descriptive task title.');
    }
    if (!baseParsed.extractedFields.includes('duration')) {
      clarifications.push('Estimated duration defaulted to 30m. How long will this take?');
    }
    if (!baseParsed.extractedFields.includes('category')) {
      clarifications.push('Which category does this belong to?');
    }
  } else {
    confidence = Math.min(1.0, 0.6 + (baseParsed.extractedFieldsCount * 0.1));
  }

  const rawCandidate = {
    title: baseParsed.title,
    categoryId: baseParsed.categoryId,
    estimatedMinutes: baseParsed.estimatedMinutes,
    priority: baseParsed.priority,
    urgency: baseParsed.priority,
    energy: baseParsed.energy,
    focusRequired: baseParsed.focusRequired,
    type: baseParsed.type,
    recurrence: baseParsed.recurrence,
    deadline: baseParsed.deadline,
    preferredTime: baseParsed.preferredTime,
    status: baseParsed.status,
    subtasks
  };

  const validated = validateTaskExtractionSchema(rawCandidate);

  return {
    task: validated,
    confidence,
    clarifications,
    source: 'deterministic'
  };
}

/**
 * Decomposes a large, vague, or multi-step task into discrete actionable subtasks.
 * 
 * @param {Object} task
 * @param {string} task.title
 * @param {number} [task.estimatedMinutes=60]
 * @param {string} [task.energy='medium']
 * @returns {Array<{ title: string, estimatedMinutes: number, energy: string, completed: boolean }>}
 */
export function decomposeTask(task) {
  if (!task || !task.title) return [];

  const lowerTitle = task.title.toLowerCase();
  const totalMins = task.estimatedMinutes || 60;

  // Check matching domain templates
  for (const [key, templateSteps] of Object.entries(DECOMPOSITION_TEMPLATES)) {
    if (lowerTitle.includes(key)) {
      // Scale step minutes proportionally to match total task duration
      const templateTotal = templateSteps.reduce((acc, s) => acc + s.estimatedMinutes, 0);
      const ratio = totalMins / Math.max(1, templateTotal);

      return templateSteps.map(step => ({
        title: step.title,
        estimatedMinutes: Math.max(10, Math.round(step.estimatedMinutes * ratio / 5) * 5),
        energy: step.energy,
        completed: false
      }));
    }
  }

  // Generic 3-step cognitive decomposition for large tasks
  const partDuration = Math.max(15, Math.round((totalMins / 3) / 5) * 5);
  return [
    { title: `Prepare & outline: ${task.title}`, estimatedMinutes: partDuration, energy: 'medium', completed: false },
    { title: `Execute core work: ${task.title}`, estimatedMinutes: partDuration, energy: task.energy || 'high', completed: false },
    { title: `Review & finalize: ${task.title}`, estimatedMinutes: partDuration, energy: 'low', completed: false }
  ];
}

/**
 * Suggests clarifications and enhancements for ambiguous tasks in the AI Inbox.
 * 
 * @param {Object} task 
 * @param {Array} [availableBuckets=[]] 
 * @returns {Object} Comprehensive clarification proposal
 */
export function suggestTaskClarifications(task, availableBuckets = []) {
  if (!task) return null;

  const title = (task.title || task.name || '').trim();
  const lower = title.toLowerCase();

  // 1. Infer Best Category with Reasoning
  let suggestedCategory = task.categoryId || task.bucket || 'home';
  let categoryReasoning = 'Default category based on general task characteristics.';

  for (const [catKey, meta] of Object.entries(CATEGORY_RATIONALES)) {
    const hasMatch = meta.keywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(lower));
    if (hasMatch) {
      suggestedCategory = catKey;
      categoryReasoning = `${meta.emoji} ${meta.reasoning}`;
      break;
    }
  }

  // 2. Recommend Duration with Reasoning
  let suggestedDuration = task.estimatedMinutes || 30;
  let durationReasoning = 'Standard 30-minute default focus block.';

  if (/(tax|taxes|report|presentation|exam|project|deep\s+work)/i.test(lower)) {
    suggestedDuration = 60;
    durationReasoning = 'Complex task requiring sustained focus. Recommended 60m block.';
  } else if (/(quick|call|email|text|check|pay|cancel|ping)/i.test(lower)) {
    suggestedDuration = 15;
    durationReasoning = 'Quick action item. Recommended 15m block to preserve capacity.';
  } else if (/(study|workout|gym|clean|reading|exercise)/i.test(lower)) {
    suggestedDuration = 45;
    durationReasoning = 'Moderate depth activity. Recommended 45m block.';
  }

  // 3. Recommend Energy Profile
  let suggestedEnergy = task.energy || 'medium';
  let energyReasoning = 'Moderate energy profile suitable for standard working hours.';

  if (suggestedDuration >= 60 || /(study|code|exam|tax|write|design)/i.test(lower)) {
    suggestedEnergy = 'high';
    energyReasoning = 'Demands deep concentration and high cognitive energy.';
  } else if (suggestedDuration <= 15 || /(call|email|tidy|trash|dishes|relax)/i.test(lower)) {
    suggestedEnergy = 'low';
    energyReasoning = 'Low cognitive load item, ideal for post-focus recovery.';
  }

  // 4. Subtask Decomposition if oversized
  const suggestedSubtasks = suggestedDuration >= 45 || isComplexTask(title)
    ? decomposeTask({ title, estimatedMinutes: suggestedDuration, energy: suggestedEnergy })
    : [];

  return {
    taskId: task.id,
    originalTitle: title,
    refinedTitle: cleanActionTitle(title),
    suggestedCategory,
    categoryReasoning,
    suggestedDuration,
    durationReasoning,
    suggestedEnergy,
    energyReasoning,
    suggestedSubtasks,
    readyToApprove: true
  };
}

/**
 * Checks if a task title indicates multi-step complexity.
 */
function isComplexTask(title) {
  if (!title) return false;
  return /\b(and|then|after|prepare|plan|organize|build|create|write|launch|setup|develop)\b/i.test(title);
}

/**
 * Normalizes title into an imperative action format.
 */
function cleanActionTitle(title) {
  if (!title) return 'Action Task';
  return title
    .replace(/^([a-z])/, (m) => m.toUpperCase())
    .replace(/\b(pls|please|need to|want to|have to)\s+/gi, '')
    .trim();
}
