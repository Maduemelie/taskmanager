/* js/tests/bucket.test.js */
import { describe, it, expect } from './runner.js';
import { 
  createTask, 
  getTask, 
  updateTask, 
  deleteTask, 
  normalizeTask, 
  transitionTaskStatus, 
  canTransitionStatus,
  VALID_TASK_STATUSES,
  VALID_ENERGY_LEVELS 
} from '../models/task.js';
import { parseNaturalLanguageTask, quickCaptureTask } from '../engine/quickCapture.js';
import { renderTaskCard } from '../components/taskCard.js';
import { initBucketView, renderBucketView } from '../views/bucket.js';
import { scoreTask } from '../engine/scoring.js';
import db from '../db.js';

describe('Phase 1 & 2: Adaptive AI Planner Task Bucket & Domain Model', () => {

  const testBuckets = [
    { id: 'health', name: 'Health', emoji: '💪', color: '#4CAF50' },
    { id: 'learning', name: 'Learning', emoji: '📚', color: '#2196F3' },
    { id: 'home', name: 'Home', emoji: '🏠', color: '#FF9800' },
    { id: 'finance', name: 'Finance', emoji: '💰', color: '#9C27B0' },
    { id: 'relationships', name: 'Relationships', emoji: '❤️', color: '#E91E63' }
  ];

  // -------------------------------------------------------------
  // Requirement 1: Task Domain Model Normalization (Section 7.1)
  // -------------------------------------------------------------
  describe('R1: Task Domain Model Normalization & State Transitions', () => {

    it('should create task with canonical fields: title, estimatedMinutes, energy, priority (0-100), status', async () => {
      const taskId = await createTask({
        title: 'Master Prompt Engineering',
        estimatedMinutes: 45,
        energy: 'high',
        priority: 85,
        status: 'ready',
        categoryId: 'learning'
      });

      const task = await getTask(taskId);
      expect(task).toBeTruthy();
      expect(task.title).toBe('Master Prompt Engineering');
      expect(task.name).toBe('Master Prompt Engineering'); // legacy alias sync
      expect(task.estimatedMinutes).toBe(45);
      expect(task.energy).toBe('high');
      expect(task.energyLevel).toBe('high'); // legacy alias sync
      expect(task.priority).toBe(85);
      expect(task.status).toBe('ready');
      expect(task.categoryId).toBe('learning');
      expect(task.bucket).toBe('learning'); // legacy alias sync
      expect(task.isActive).toBe(true);
      expect(task.isArchived).toBe(false);

      // Clean up
      await db.tasks.delete(taskId);
    });

    it('should clamp and validate priority strictly within 0-100 range', () => {
      const taskLow = normalizeTask({ title: 'Low priority', priority: -15 });
      expect(taskLow.priority).toBe(0);

      const taskHigh = normalizeTask({ title: 'High priority', priority: 140 });
      expect(taskHigh.priority).toBe(100);

      const taskMid = normalizeTask({ title: 'Mid priority', priority: 50 });
      expect(taskMid.priority).toBe(50);
    });

    it('should enforce energy level to one of low, medium, high', () => {
      const taskValidLow = normalizeTask({ title: 'Low effort', energy: 'low' });
      expect(taskValidLow.energy).toBe('low');

      const taskValidHigh = normalizeTask({ title: 'High effort', energy: 'high' });
      expect(taskValidHigh.energy).toBe('high');

      const taskFallback = normalizeTask({ title: 'Unknown effort', energy: 'super_saiyan' });
      expect(taskFallback.energy).toBe('medium');
    });

    it('should correctly validate permitted state machine transitions', () => {
      // INBOX -> READY
      expect(canTransitionStatus('inbox', 'ready')).toBe(true);
      // READY -> SCHEDULED
      expect(canTransitionStatus('ready', 'scheduled')).toBe(true);
      // SCHEDULED -> ACTIVE
      expect(canTransitionStatus('scheduled', 'active')).toBe(true);
      // ACTIVE -> COMPLETED
      expect(canTransitionStatus('active', 'completed')).toBe(true);
      // ACTIVE -> SKIPPED
      expect(canTransitionStatus('active', 'skipped')).toBe(true);
      // ACTIVE -> READY
      expect(canTransitionStatus('active', 'ready')).toBe(true);
      // READY -> SNOOZED / ARCHIVED
      expect(canTransitionStatus('ready', 'snoozed')).toBe(true);
      expect(canTransitionStatus('ready', 'archived')).toBe(true);

      // Illegal transitions
      expect(canTransitionStatus('inbox', 'completed')).toBe(false);
      expect(canTransitionStatus('inbox', 'active')).toBe(false);
    });

    it('should execute state transitions and persist status update in IndexedDB', async () => {
      const taskId = await createTask({
        title: 'State Transition Test Task',
        status: 'inbox'
      });

      // 1. inbox -> ready
      const toReady = await transitionTaskStatus(taskId, 'ready');
      expect(toReady.status).toBe('ready');

      // 2. ready -> scheduled
      const toScheduled = await transitionTaskStatus(taskId, 'scheduled');
      expect(toScheduled.status).toBe('scheduled');

      // 3. scheduled -> active
      const toActive = await transitionTaskStatus(taskId, 'active');
      expect(toActive.status).toBe('active');

      // 4. active -> completed
      const toCompleted = await transitionTaskStatus(taskId, 'completed');
      expect(toCompleted.status).toBe('completed');
      expect(toCompleted.lastCompletedAt).toBeTruthy();

      // Clean up
      await db.tasks.delete(taskId);
    });

    it('should reject illegal status transitions with an explicit Error', async () => {
      const taskId = await createTask({
        title: 'Illegal Transition Test',
        status: 'inbox'
      });

      let threw = false;
      try {
        // inbox cannot directly transition to completed
        await transitionTaskStatus(taskId, 'completed');
      } catch (err) {
        threw = true;
      }
      expect(threw).toBe(true);

      // Clean up
      await db.tasks.delete(taskId);
    });

    it('should allow completing ready and scheduled tasks', () => {
      expect(canTransitionStatus('ready', 'completed')).toBe(true);
      expect(canTransitionStatus('scheduled', 'completed')).toBe(true);
    });

    it('should gracefully transition legacy tasks without an explicit status field', async () => {
      const legacyId = 'legacy-task-xyz';
      await db.tasks.add({
        id: legacyId,
        name: 'Legacy Task',
        bucket: 'home',
        isActive: true,
        isArchived: false
      });

      const transitioned = await transitionTaskStatus(legacyId, 'scheduled');
      expect(transitioned.status).toBe('scheduled');
      expect(transitioned.isActive).toBe(true);

      await db.tasks.delete(legacyId);
    });

    it('should score tasks with canonical 0-100 priority proportionally without distorting other factors', () => {
      const baseContext = {
        date: '2026-08-20',
        currentPlan: [],
        energyWindow: 'medium',
        preferences: { buckets: [{ id: 'health' }] }
      };
      const canonicalHigh = {
        id: 't-high',
        title: 'High priority task',
        priority: 100,
        createdAt: '2026-08-20T00:00:00.000Z',
        isActive: true
      };
      const canonicalLow = {
        id: 't-low',
        title: 'Low priority task',
        priority: 20,
        createdAt: '2026-08-20T00:00:00.000Z',
        isActive: true
      };
      const scoreHigh = scoreTask(canonicalHigh, baseContext);
      const scoreLow = scoreTask(canonicalLow, baseContext);
      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });

    it('should synchronize status to completed when updateTask sets isActive: false', async () => {
      const taskId = await createTask({ title: 'Completion Sync Task', status: 'ready' });
      await updateTask(taskId, { isActive: false });
      const updated = await getTask(taskId);
      expect(updated.status).toBe('completed');
      expect(updated.isActive).toBe(false);
      await db.tasks.delete(taskId);
    });

    it('should normalize tasks with isActive: false to status completed without resurrecting to ready', () => {
      const normalizedInactive = normalizeTask({ title: 'Inactive task', isActive: false });
      expect(normalizedInactive.status).toBe('completed');
      expect(normalizedInactive.isActive).toBe(false);

      const normalizedArchived = normalizeTask({ title: 'Archived task', isArchived: true });
      expect(normalizedArchived.status).toBe('archived');
      expect(normalizedArchived.isActive).toBe(false);
      expect(normalizedArchived.isArchived).toBe(true);
    });

    it('should promote an inbox task to ready upon update when clarifying fields', async () => {
      const inboxTaskId = await createTask({ title: 'stuff', status: 'inbox' });
      const task = await getTask(inboxTaskId);
      expect(task.status).toBe('inbox');

      await updateTask(inboxTaskId, { title: 'Clean the kitchen', status: 'ready' });
      const updated = await getTask(inboxTaskId);
      expect(updated.status).toBe('ready');
      expect(updated.isActive).toBe(true);
      await db.tasks.delete(inboxTaskId);
    });

  });

  // -------------------------------------------------------------
  // Requirement 3: Natural Language Quick Capture Extraction (R3)
  // -------------------------------------------------------------
  describe('R3: Natural Language Quick Capture Extraction', () => {

    it('should parse "Study for an hour tomorrow" and populate at least 3 structured fields (title, duration, category)', () => {
      const parsed = parseNaturalLanguageTask('Study for an hour tomorrow', testBuckets);

      expect(parsed.title).toBe('Study');
      expect(parsed.estimatedMinutes).toBe(60);
      expect(parsed.categoryId).toBe('learning');
      expect(parsed.deadline).toBeTruthy();
      expect(parsed.extractedFieldsCount).toBeGreaterThan(2);
    });

    it('should parse "Study LangChain for an hour tomorrow morning" with timing and category', () => {
      const parsed = parseNaturalLanguageTask('Study LangChain for an hour tomorrow morning', testBuckets);

      expect(parsed.title).toBe('Study LangChain');
      expect(parsed.estimatedMinutes).toBe(60);
      expect(parsed.preferredTime).toBe('morning');
      expect(parsed.categoryId).toBe('learning');
      expect(parsed.deadline).toBeTruthy();
      expect(parsed.status).toBe('ready');
    });

    it('should parse "Workout 45 mins high energy #health" with energy, duration, and hashtag category', () => {
      const parsed = parseNaturalLanguageTask('Workout 45 mins high energy #health', testBuckets);

      expect(parsed.title).toBe('Workout');
      expect(parsed.estimatedMinutes).toBe(45);
      expect(parsed.energy).toBe('high');
      expect(parsed.categoryId).toBe('health');
    });

    it('should parse "Review budget for 30m urgent #finance" with priority, duration, and category', () => {
      const parsed = parseNaturalLanguageTask('Review budget for 30m urgent #finance', testBuckets);

      expect(parsed.title).toBe('Review budget');
      expect(parsed.estimatedMinutes).toBe(30);
      expect(parsed.priority).toBe(90);
      expect(parsed.categoryId).toBe('finance');
    });

    it('should route ambiguous capture inputs into AI Inbox (status: inbox)', () => {
      const ambiguous = parseNaturalLanguageTask('stuff', testBuckets);
      expect(ambiguous.status).toBe('inbox');
      expect(ambiguous.isAmbiguous).toBe(true);
    });

    it('should parse weekdays like "Read notes on Friday" with future deadline', () => {
      const parsed = parseNaturalLanguageTask('Read notes on Friday', testBuckets);
      expect(parsed.title).toBe('Read notes');
      expect(parsed.categoryId).toBe('learning');
      expect(parsed.deadline).toBeTruthy();
      expect(parsed.status).toBe('ready');
    });

    it('should handle conflicting / multi-duration inputs by taking primary duration and cleanly extracting title', () => {
      const parsed = parseNaturalLanguageTask('Study for 1 hour or maybe 30 minutes tomorrow', testBuckets);
      expect(parsed.title).toBe('Study');
      expect(parsed.estimatedMinutes).toBe(60);
      expect(parsed.categoryId).toBe('learning');
      expect(parsed.deadline).toBeTruthy();
      expect(parsed.status).toBe('ready');
    });

    it('should route metadata-only inputs without a task name to AI Inbox', () => {
      const parsed = parseNaturalLanguageTask('for an hour tomorrow', testBuckets);
      expect(parsed.isAmbiguous).toBe(true);
      expect(parsed.status).toBe('inbox');
    });

    it('should route whitespace-only inputs to AI Inbox with Untitled Task', () => {
      const parsed = parseNaturalLanguageTask('   ', testBuckets);
      expect(parsed.title).toBe('Untitled Task');
      expect(parsed.isAmbiguous).toBe(true);
      expect(parsed.status).toBe('inbox');
    });

    it('should parse "Study for an hour and a half tomorrow" as 90 mins without corrupting title', () => {
      const parsed = parseNaturalLanguageTask('Study for an hour and a half tomorrow', testBuckets);
      expect(parsed.title).toBe('Study');
      expect(parsed.estimatedMinutes).toBe(90);
      expect(parsed.categoryId).toBe('learning');
      expect(parsed.deadline).toBeTruthy();
    });

    it('should parse "Meditate 10 mins daily" with habit type and daily recurrence', () => {
      const parsed = parseNaturalLanguageTask('Meditate 10 mins daily', testBuckets);
      expect(parsed.title).toBe('Meditate');
      expect(parsed.estimatedMinutes).toBe(10);
      expect(parsed.type).toBe('habit');
      expect(parsed.recurrence).toEqual({ type: 'daily' });
      expect(parsed.categoryId).toBe('health');
    });

    it('should parse "Deep work on presentation at 9am tomorrow" with focusRequired and morning preferredTime', () => {
      const parsed = parseNaturalLanguageTask('Deep work on presentation at 9am tomorrow', testBuckets);
      expect(parsed.title).toBe('presentation');
      expect(parsed.focusRequired).toBe(true);
      expect(parsed.energy).toBe('high');
      expect(parsed.preferredTime).toBe('morning');
      expect(parsed.deadline).toBeTruthy();
    });

    it('should parse "Call mom tonight" with deadline today and evening preferredTime', () => {
      const parsed = parseNaturalLanguageTask('Call mom tonight', testBuckets);
      expect(parsed.title).toBe('Call mom');
      expect(parsed.preferredTime).toBe('evening');
      expect(parsed.deadline).toBeTruthy();
      expect(parsed.categoryId).toBe('relationships');
    });

    it('should persist quick captured task to database with canonical model fields', async () => {
      const task = await quickCaptureTask('Study for an hour tomorrow', testBuckets);

      expect(task).toBeTruthy();
      expect(task.id).toBeTruthy();
      expect(task.title).toBe('Study');
      expect(task.estimatedMinutes).toBe(60);
      expect(task.categoryId).toBe('learning');
      expect(task.status).toBe('ready');

      // Clean up
      await db.tasks.delete(task.id);
    });

    it('should persist quick captured habit with recurrence to database', async () => {
      const habitTask = await quickCaptureTask('Workout 30 mins daily #health', testBuckets);

      expect(habitTask).toBeTruthy();
      expect(habitTask.title).toBe('Workout');
      expect(habitTask.type).toBe('habit');
      expect(habitTask.isHabit).toBe(true);
      expect(habitTask.recurrence).toEqual({ type: 'daily' });

      await db.tasks.delete(habitTask.id);
    });

    it('should parse "Study this morning" and "Workout this afternoon" without leaving "this" in title', () => {
      const parsedMorning = parseNaturalLanguageTask('Study this morning', testBuckets);
      expect(parsedMorning.title).toBe('Study');
      expect(parsedMorning.preferredTime).toBe('morning');

      const parsedAfternoon = parseNaturalLanguageTask('Workout this afternoon', testBuckets);
      expect(parsedAfternoon.title).toBe('Workout');
      expect(parsedAfternoon.preferredTime).toBe('afternoon');

      const parsedEvening = parseNaturalLanguageTask('Clean room this evening', testBuckets);
      expect(parsedEvening.title).toBe('Clean room');
      expect(parsedEvening.preferredTime).toBe('evening');
    });

    it('should parse "Study for an hour and 15 mins tomorrow" as 75 mins without title corruption', () => {
      const parsed = parseNaturalLanguageTask('Study for an hour and 15 mins tomorrow', testBuckets);
      expect(parsed.title).toBe('Study');
      expect(parsed.estimatedMinutes).toBe(75);
      expect(parsed.categoryId).toBe('learning');
      expect(parsed.deadline).toBeTruthy();
    });

    it('should parse "Study for 2 hours and call mom" without stripping the conjunction "and" from the title', () => {
      const parsed = parseNaturalLanguageTask('Study for 2 hours and call mom', testBuckets);
      expect(parsed.title).toBe('Study and call mom');
      expect(parsed.estimatedMinutes).toBe(120);
    });

    it('should not false-match bucket "Work" on "Workout 30 mins"', () => {
      const bucketsWithWork = [
        { id: 'work', name: 'Work', emoji: '💼', color: '#9E9E9E' },
        ...testBuckets
      ];
      const parsed = parseNaturalLanguageTask('Workout 30 mins', bucketsWithWork);
      expect(parsed.categoryId).toBe('health');
    });

    it('should parse "Meeting at noon tomorrow" with afternoon preferredTime and clean title', () => {
      const parsed = parseNaturalLanguageTask('Meeting at noon tomorrow', testBuckets);
      expect(parsed.title).toBe('Meeting');
      expect(parsed.preferredTime).toBe('afternoon');
      expect(parsed.deadline).toBeTruthy();
    });

    it('should parse "Clean kitchen later today" with today deadline and clean title', () => {
      const parsed = parseNaturalLanguageTask('Clean kitchen later today', testBuckets);
      expect(parsed.title).toBe('Clean kitchen');
      expect(parsed.deadline).toBeTruthy();
    });

  });

  // -------------------------------------------------------------
  // Requirement 2: Task Bucket UI Hierarchy & Compact Cards (R2)
  // -------------------------------------------------------------
  describe('R2: Task Bucket UI & Compact Task Cards', () => {

    it('should render compact task cards that do NOT show non-essential details (like full descriptions) by default', () => {
      const mockTask = {
        id: 'mock-1',
        title: 'Step count 3000',
        description: 'This is a long verbose description that must NOT clutter the compact card view by default.',
        estimatedMinutes: 30,
        energy: 'medium',
        priority: 60,
        type: 'habit',
        recurrence: { type: 'daily' },
        categoryId: 'health'
      };

      const card = renderTaskCard(mockTask, 'bucket');
      expect(card).toBeTruthy();

      const textContent = card.textContent;
      // Essential metadata surfaced
      expect(textContent.includes('Step count 3000')).toBe(true);
      expect(textContent.includes('30m')).toBe(true);
      expect(textContent.includes('Medium energy')).toBe(true);
      expect(textContent.includes('Priority ●●●○○')).toBe(true);
      expect(textContent.includes('Habit')).toBe(true);

      // Non-essential description NOT rendered
      expect(textContent.includes('This is a long verbose description')).toBe(false);
    });

    it('should correctly render 1 dot for priority 0 tasks without defaulting to 3 dots', () => {
      const taskP0 = {
        id: 'mock-p0',
        title: 'Lowest priority task',
        priority: 0,
        estimatedMinutes: 30,
        energy: 'low'
      };
      const card = renderTaskCard(taskP0, 'bucket');
      expect(card.textContent.includes('Priority ●○○○○')).toBe(true);
    });

    it('should render deadline metadata chip on compact task cards when present', () => {
      const taskWithDeadline = {
        id: 'mock-dl',
        title: 'Task with deadline',
        deadline: '2026-10-15',
        estimatedMinutes: 30,
        energy: 'medium',
        priority: 50
      };
      const card = renderTaskCard(taskWithDeadline, 'bucket');
      expect(card.textContent.includes('📅')).toBe(true);
    });

    it('should verify bucket view DOM hierarchy elements exist', () => {
      let bucketView = document.getElementById('bucket-view');
      let createdFixture = false;

      if (!bucketView) {
        // Running inside tests.html runner: create test fixture
        bucketView = document.createElement('section');
        bucketView.id = 'bucket-view';
        bucketView.className = 'view';
        bucketView.innerHTML = `
          <header class="bucket-header-main">
            <h1>Task Bucket</h1>
            <span id="bucket-total-count" class="badge">0 tasks</span>
          </header>
          <div class="form-group">
            <input type="text" id="bucket-search" class="input" placeholder="Search tasks...">
          </div>
          <div id="bucket-filter-chips"></div>
          <div id="bucket-inbox-section" class="bucket-inbox-section hidden"></div>
          <div id="bucket-list" class="bucket-grid"></div>
          <div id="quick-add-container" class="quick-add-floating-container">
            <input type="text" id="quick-add-input" class="quick-add-input">
          </div>
        `;
        document.body.appendChild(bucketView);
        createdFixture = true;
      }

      try {
        expect(bucketView).toBeTruthy();

        // Header
        const header = bucketView.querySelector('header');
        expect(header).toBeTruthy();

        // Search bar
        const search = document.getElementById('bucket-search');
        expect(search).toBeTruthy();

        // Category filter chips container
        const filterChips = document.getElementById('bucket-filter-chips');
        expect(filterChips).toBeTruthy();

        // AI Inbox section container
        const inboxSection = document.getElementById('bucket-inbox-section');
        expect(inboxSection).toBeTruthy();

        // Task list container
        const listContainer = document.getElementById('bucket-list');
        expect(listContainer).toBeTruthy();

        // Floating Quick Add Composer input
        const quickAddInput = document.getElementById('quick-add-input');
        expect(quickAddInput).toBeTruthy();
      } finally {
        if (createdFixture && bucketView) {
          bucketView.remove();
        }
      }
    });

  });

});
