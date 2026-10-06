/* js/engine/quickCapture.js */
import { createTask, getTask } from '../models/task.js';
import { today, addDays } from '../utils/date.js';

/**
 * Semantic keyword lookup for default buckets
 */
const CATEGORY_KEYWORDS = {
  learning: [
    'study', 'learn', 'reading', 'read', 'course', 'book', 'tutorial',
    'langchain', 'python', 'code', 'coding', 'homework', 'exam', 'research',
    'class', 'lesson', 'lecture', 'notes', 'algorithm', 'review'
  ],
  health: [
    'workout', 'gym', 'run', 'running', 'exercise', 'walk', 'walking',
    'yoga', 'stretch', 'stretching', 'jog', 'jogging', 'swim', 'swimming',
    'fitness', 'cardio', 'weights', 'meditate', 'meditation', 'doctor',
    'dentist', 'health', 'steps', 'pushups'
  ],
  home: [
    'clean', 'cleaning', 'dishes', 'laundry', 'grocery', 'groceries',
    'cook', 'cooking', 'meal', 'kitchen', 'trash', 'tidy', 'repair',
    'fix', 'vacuum', 'dust', 'house', 'apartment', 'bedroom'
  ],
  finance: [
    'budget', 'bill', 'bills', 'tax', 'taxes', 'invoice', 'invest',
    'investing', 'crypto', 'expense', 'expenses', 'receipt', 'bank',
    'salary', 'rent', 'accounting', 'statement'
  ],
  relationships: [
    'call mom', 'call dad', 'call parents', 'meet', 'dinner with',
    'lunch with', 'date night', 'friend', 'friends', 'birthday',
    'family', 'hangout', 'visit', 'catch up'
  ]
};

/**
 * Parses an unstructured natural language string into structured Task model fields.
 * 
 * @param {string} rawInput Unstructured task text (e.g., "Study for an hour tomorrow")
 * @param {Array} [availableBuckets=[]] User's available category buckets
 * @returns {Object} Extracted structured task attributes and extraction metadata
 */
export function parseNaturalLanguageTask(rawInput, availableBuckets = []) {
  if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
    return {
      title: 'Untitled Task',
      estimatedMinutes: 30,
      categoryId: availableBuckets[0]?.id || 'home',
      energy: 'medium',
      priority: 50,
      preferredTime: 'anytime',
      deadline: null,
      type: 'one_time',
      recurrence: null,
      focusRequired: false,
      status: 'inbox',
      extractedFields: [],
      extractedFieldsCount: 0,
      isAmbiguous: true
    };
  }

  let text = rawInput.trim();
  let extractedFields = new Set();
  let estimatedMinutes = 30; // default
  let durationMatched = false;
  let energy = 'medium';
  let energyMatched = false;
  let priority = 50;
  let priorityMatched = false;
  let preferredTime = 'anytime';
  let preferredTimeMatched = false;
  let deadline = null;
  let deadlineMatched = false;
  let categoryId = null;
  let categoryMatched = false;
  let type = 'one_time';
  let recurrence = null;
  let focusRequired = false;

  // 1. Extract Hashtag Category if present: #health, #learning, etc.
  const hashtagMatch = text.match(/#([a-zA-Z0-9_-]+)/i);
  if (hashtagMatch) {
    const rawCategory = hashtagMatch[1].toLowerCase();
    const matchedBucket = availableBuckets.find(b => b.id.toLowerCase() === rawCategory || b.name.toLowerCase() === rawCategory);
    categoryId = matchedBucket ? matchedBucket.id : rawCategory;
    categoryMatched = true;
    extractedFields.add('category');
    text = text.replace(hashtagMatch[0], ' ');
  }

  // 2. Extract Duration
  // "an hour and a half", "1 and a half hours", "an hour and 15 mins", "for an hour", "1.5 hours", "2 hrs 30 mins", "2 hrs", "30 mins", "45m"
  const hourAndHalfRegex = /(?:for\s+)?(?:(?:an?|one|1)\s+(?:hour|hr)\s+(?:and\s+a\s+half|and\s+half)|(?:1\.5|1,5)\s*(?:hours?|hrs?|h)|(?:1\s+and\s+a\s+half|one\s+and\s+a\s+half)\s*(?:hours?|hrs?))\b/i;
  const numAndHalfHoursRegex = /(?:for\s+)?(\d+)\s*(?:and\s+a\s+half|and\s+half)\s*(?:hours?|hrs?)\b/i;
  const singleHourWithMinsRegex = /(?:for\s+)?(?:an?|one)\s+(?:hour|hr)\s*(?:and\s+)?(\d+)\s*(?:minutes?|mins?|m)\b/i;
  const hourAndMinsRegex = /(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s+)?(\d+)\s*(?:minutes?|mins?|m)\b/i;
  const singleHourRegex = /(?:for\s+)?(?:an?|one)\s+(?:hour|hr)\b/i;
  const halfHourRegex = /(?:for\s+)?(?:half\s+(?:an?\s+)?hour|half-hour)\b/i;
  const hoursOnlyRegex = /(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i;
  const minutesRegex = /(?:for\s+)?(\d+)\s*(?:minutes?|mins?|m)\b/i;

  if (hourAndHalfRegex.test(text)) {
    estimatedMinutes = 90;
    durationMatched = true;
    extractedFields.add('duration');
    text = text.replace(hourAndHalfRegex, ' ');
  } else if (numAndHalfHoursRegex.test(text)) {
    const m = text.match(numAndHalfHoursRegex);
    estimatedMinutes = Math.round((parseInt(m[1], 10) + 0.5) * 60);
    durationMatched = true;
    extractedFields.add('duration');
    text = text.replace(numAndHalfHoursRegex, ' ');
  } else if (singleHourWithMinsRegex.test(text)) {
    const m = text.match(singleHourWithMinsRegex);
    estimatedMinutes = 60 + parseInt(m[1], 10);
    durationMatched = true;
    extractedFields.add('duration');
    text = text.replace(singleHourWithMinsRegex, ' ');
  } else if (hourAndMinsRegex.test(text)) {
    const m = text.match(hourAndMinsRegex);
    const hours = parseFloat(m[1] || 0);
    const mins = parseInt(m[2] || 0, 10);
    estimatedMinutes = Math.round(hours * 60) + mins;
    durationMatched = true;
    extractedFields.add('duration');
    text = text.replace(hourAndMinsRegex, ' ');
  } else if (halfHourRegex.test(text)) {
    estimatedMinutes = 30;
    durationMatched = true;
    extractedFields.add('duration');
    text = text.replace(halfHourRegex, ' ');
  } else if (singleHourRegex.test(text)) {
    estimatedMinutes = 60;
    durationMatched = true;
    extractedFields.add('duration');
    text = text.replace(singleHourRegex, ' ');
  } else if (hoursOnlyRegex.test(text)) {
    const m = text.match(hoursOnlyRegex);
    const hours = parseFloat(m[1] || 0);
    estimatedMinutes = Math.round(hours * 60);
    durationMatched = true;
    extractedFields.add('duration');
    text = text.replace(hoursOnlyRegex, ' ');
  } else {
    const minMatch = text.match(minutesRegex);
    if (minMatch) {
      estimatedMinutes = parseInt(minMatch[1], 10);
      durationMatched = true;
      extractedFields.add('duration');
      text = text.replace(minMatch[0], ' ');
    }
  }

  // 3. Extract Recurrence / Habit ("daily", "every day", "weekly", "every week")
  const dailyRegex = /\b(?:every\s+day|daily)\b/i;
  const weeklyRegex = /\b(?:every\s+week|weekly)\b/i;
  const monthlyRegex = /\b(?:every\s+month|monthly)\b/i;

  if (dailyRegex.test(text)) {
    type = 'habit';
    recurrence = { type: 'daily' };
    extractedFields.add('recurrence');
    text = text.replace(dailyRegex, ' ');
  } else if (weeklyRegex.test(text)) {
    type = 'habit';
    recurrence = { type: 'weekly' };
    extractedFields.add('recurrence');
    text = text.replace(weeklyRegex, ' ');
  } else if (monthlyRegex.test(text)) {
    type = 'habit';
    recurrence = { type: 'monthly' };
    extractedFields.add('recurrence');
    text = text.replace(monthlyRegex, ' ');
  }

  // 4. Extract Focus / Deep Work
  const focusRegex = /\b(deep\s+work|high\s+focus|focus\s+block|deepwork)\b/i;
  if (focusRegex.test(text)) {
    focusRequired = true;
    energy = 'high';
    energyMatched = true;
    extractedFields.add('focusRequired');
    extractedFields.add('energy');
    text = text.replace(focusRegex, ' ');
  }

  // 5. Extract Energy Level
  const highEnergyRegex = /\b(high|heavy|intense)\s*(?:energy|effort)\b/i;
  const lowEnergyRegex = /\b(low|light|easy|chill)\s*(?:energy|effort)\b/i;
  const medEnergyRegex = /\b(med(?:ium)?|moderate)\s*(?:energy|effort)\b/i;

  if (highEnergyRegex.test(text)) {
    energy = 'high';
    energyMatched = true;
    extractedFields.add('energy');
    text = text.replace(highEnergyRegex, ' ');
  } else if (lowEnergyRegex.test(text)) {
    energy = 'low';
    energyMatched = true;
    extractedFields.add('energy');
    text = text.replace(lowEnergyRegex, ' ');
  } else if (medEnergyRegex.test(text)) {
    energy = 'medium';
    energyMatched = true;
    extractedFields.add('energy');
    text = text.replace(medEnergyRegex, ' ');
  }

  // 6. Extract Priority
  const urgentRegex = /\b(urgent|asap|critical|high\s+priority|high\s+prio|p0|p1|!urgent|!1)\b/i;
  const lowPriorityRegex = /\b(low\s+priority|low\s+prio|p3|p4|p5|trivial|someday)\b/i;
  const medPriorityRegex = /\b(med(?:ium)?\s+priority|med\s+prio|p2|normal\s+priority)\b/i;

  if (urgentRegex.test(text)) {
    priority = 90;
    priorityMatched = true;
    extractedFields.add('priority');
    text = text.replace(urgentRegex, ' ');
  } else if (lowPriorityRegex.test(text)) {
    priority = 25;
    priorityMatched = true;
    extractedFields.add('priority');
    text = text.replace(lowPriorityRegex, ' ');
  } else if (medPriorityRegex.test(text)) {
    priority = 50;
    priorityMatched = true;
    extractedFields.add('priority');
    text = text.replace(medPriorityRegex, ' ');
  }

  // 7. Extract Preferred Time of Day & Specific Time
  const specificTimeRegex = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
  const specificMatch = text.match(specificTimeRegex);
  if (specificMatch) {
    let hour = parseInt(specificMatch[1], 10);
    const meridiem = specificMatch[3].toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour >= 5 && hour < 12) {
      preferredTime = 'morning';
    } else if (hour >= 12 && hour < 17) {
      preferredTime = 'afternoon';
    } else {
      preferredTime = 'evening';
    }
    preferredTimeMatched = true;
    extractedFields.add('preferredTime');
    text = text.replace(specificTimeRegex, ' ');
  }

  const noonRegex = /\b(?:at\s+)?noon\b/i;
  const midnightRegex = /\b(?:at\s+)?midnight\b/i;
  const morningRegex = /\b(?:in\s+the\s+|this\s+)?morning\b/i;
  const afternoonRegex = /\b(?:in\s+the\s+|this\s+)?afternoon\b/i;
  const eveningRegex = /\b(?:in\s+the\s+|this\s+)?(?:evening|tonight)\b/i;

  if (noonRegex.test(text)) {
    preferredTime = 'afternoon';
    preferredTimeMatched = true;
    extractedFields.add('preferredTime');
    text = text.replace(noonRegex, ' ');
  } else if (midnightRegex.test(text)) {
    preferredTime = 'evening';
    preferredTimeMatched = true;
    extractedFields.add('preferredTime');
    text = text.replace(midnightRegex, ' ');
  } else if (morningRegex.test(text)) {
    preferredTime = 'morning';
    preferredTimeMatched = true;
    extractedFields.add('preferredTime');
    text = text.replace(morningRegex, ' ');
  } else if (afternoonRegex.test(text)) {
    preferredTime = 'afternoon';
    preferredTimeMatched = true;
    extractedFields.add('preferredTime');
    text = text.replace(afternoonRegex, ' ');
  } else if (eveningRegex.test(text)) {
    preferredTime = 'evening';
    preferredTimeMatched = true;
    extractedFields.add('preferredTime');
    text = text.replace(eveningRegex, ' ');
  }

  // 8. Extract Deadlines (today, tomorrow, day after tomorrow, days of week, tonight)
  const tomorrowRegex = /\btomorrow\b/i;
  const todayRegex = /\b(?:later\s+)?today\b/i;
  const dayAfterRegex = /\bday\s+after\s+tomorrow\b/i;
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekdayRegex = /\b(?:on\s+|this\s+|next\s+|by\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

  const curDate = today();
  if (dayAfterRegex.test(text)) {
    deadline = addDays(curDate, 2);
    deadlineMatched = true;
    extractedFields.add('deadline');
    text = text.replace(dayAfterRegex, ' ');
  } else if (tomorrowRegex.test(text)) {
    deadline = addDays(curDate, 1);
    deadlineMatched = true;
    extractedFields.add('deadline');
    text = text.replace(tomorrowRegex, ' ');
  } else if (todayRegex.test(text)) {
    deadline = curDate;
    deadlineMatched = true;
    extractedFields.add('deadline');
    text = text.replace(todayRegex, ' ');
  } else {
    const weekdayMatch = text.match(weekdayRegex);
    if (weekdayMatch) {
      const targetDay = dayNames.indexOf(weekdayMatch[1].toLowerCase());
      if (targetDay !== -1) {
        const todayObj = new Date(curDate + 'T00:00:00');
        let diff = (targetDay - todayObj.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        deadline = addDays(curDate, diff);
        deadlineMatched = true;
        extractedFields.add('deadline');
        text = text.replace(weekdayMatch[0], ' ');
      }
    }
  }

  // If "tonight" was in input and deadline not explicitly assigned, deadline is today
  if (!deadline && /\btonight\b/i.test(rawInput)) {
    deadline = curDate;
    deadlineMatched = true;
    extractedFields.add('deadline');
  }

  // Check if text was solely metadata tokens (duration, deadline, energy, priority) without task intent
  const strippedResidual = text.replace(/[-–—:,.\s]+/g, '').trim();
  const onlyMetadataProvided = strippedResidual.length === 0;

  // 9. Clean Title Extraction
  // Strip residual duration phrases, conflicting conjunctions, and prepositions
  let cleanedTitle = text
    .replace(/(?:for\s+)?\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?|h|m)\b/gi, ' ')
    .replace(/(?:and\s+a\s+half|and\s+half)/gi, ' ')
    .replace(/\b(?:or\s+maybe|maybe)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(for|at|on|by|in|to|due|before|this)\s+/i, '')
    .replace(/\s+(for|at|on|by|in|to|due|before|this)$/i, '')
    .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '')
    .trim();

  // If title was stripped away completely, fallback to original input or Untitled
  if (!cleanedTitle) {
    cleanedTitle = rawInput.trim() || 'Untitled Task';
  } else {
    extractedFields.add('title');
  }

  // 10. Infer Category from direct bucket names or semantic keywords
  if (!categoryId && availableBuckets.length > 0) {
    const lowerInput = rawInput.toLowerCase();
    const directBucket = availableBuckets.find(b => {
      const bName = (b.name || '').toLowerCase().trim();
      const bId = (b.id || '').toLowerCase().trim();
      const matchName = bName && new RegExp(`\\b${escapeRegExp(bName)}\\b`, 'i').test(lowerInput);
      const matchId = bId && new RegExp(`\\b${escapeRegExp(bId)}\\b`, 'i').test(lowerInput);
      return matchName || matchId;
    });
    if (directBucket) {
      categoryId = directBucket.id;
      categoryMatched = true;
      extractedFields.add('category');
    }
  }

  if (!categoryId) {
    const lowerInput = rawInput.toLowerCase();
    for (const [catKey, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const hasMatch = keywords.some(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(lowerInput);
      });
      if (hasMatch) {
        // If availableBuckets specified, prefer bucket in availableBuckets
        const bucketExists = availableBuckets.length === 0 || availableBuckets.some(b => b.id === catKey);
        if (bucketExists) {
          categoryId = catKey;
          categoryMatched = true;
          extractedFields.add('category');
          break;
        }
      }
    }
  }

  // Fallback category if none matched
  if (!categoryId) {
    categoryId = availableBuckets[0]?.id || 'home';
  }

  // 11. Ambiguity check (Section 4: Ambiguous tasks enter AI Inbox)
  const isAmbiguous = (
    onlyMetadataProvided ||
    cleanedTitle.length <= 3 ||
    cleanedTitle === 'stuff' ||
    cleanedTitle === 'task' ||
    cleanedTitle === 'todo' ||
    cleanedTitle === '?' ||
    cleanedTitle === 'Untitled Task' ||
    (!durationMatched && !categoryMatched && !deadlineMatched)
  );

  const status = isAmbiguous ? 'inbox' : 'ready';

  return {
    title: cleanedTitle,
    estimatedMinutes,
    categoryId,
    energy,
    priority,
    preferredTime,
    deadline,
    type,
    recurrence,
    focusRequired,
    status,
    // Metadata on extracted structured fields
    extractedFields: Array.from(extractedFields),
    extractedFieldsCount: extractedFields.size,
    isAmbiguous
  };
}

/**
 * Creates and persists a Task directly from an unstructured natural language string.
 * 
 * @param {string} rawInput 
 * @param {Array} [availableBuckets=[]] 
 * @returns {Promise<Object>} The fully persisted canonical Task object
 */
export async function quickCaptureTask(rawInput, availableBuckets = []) {
  const parsed = parseNaturalLanguageTask(rawInput, availableBuckets);
  
  const taskData = {
    title: parsed.title,
    name: parsed.title,
    categoryId: parsed.categoryId,
    bucket: parsed.categoryId,
    estimatedMinutes: parsed.estimatedMinutes,
    energy: parsed.energy,
    energyLevel: parsed.energy,
    priority: parsed.priority,
    preferredTime: parsed.preferredTime,
    deadline: parsed.deadline,
    status: parsed.status,
    type: parsed.type || 'one_time',
    isHabit: parsed.type === 'habit',
    recurrence: parsed.recurrence || null,
    focusRequired: Boolean(parsed.focusRequired)
  };

  const taskId = await createTask(taskData);
  const created = await getTask(taskId);
  return created;
}

/**
 * Escapes characters with special meaning in regex patterns.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
