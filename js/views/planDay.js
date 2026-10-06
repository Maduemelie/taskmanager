/* js/views/planDay.js */
import db from '../db.js';
import { generateDayPlan } from '../engine/planner.js';
import { 
  generateDeterministicSchedule, 
  validateSchedule, 
  formatMinutesToTime, 
  parseTimeToMinutes 
} from '../engine/deterministicScheduler.js';
import { calculateCandidateScore, rankCandidateTasks } from '../engine/scoring.js';
import { getTodayPlan, createPlan, updatePlan } from '../models/plan.js';
import { getActiveTasks } from '../models/task.js';
import { getPreferences } from '../models/preferences.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { today, formatTime, formatTime12 } from '../utils/date.js';
import { stagger, slideUp } from '../utils/animate.js';

let activeEnergy = 'medium';
let activePlanningStyle = 'balanced';
let generatedSuggestions = []; // Array of { task, isChecked, block, scheduledTime }
let initialCapacity = 180; // Default capacity in minutes (3 hours)
let lastScheduleResult = null;

/**
 * Calculates real-time start time if planning for today after wake time.
 * Rounds up to the nearest 15-minute mark.
 */
export function getEffectiveStartTime(wakeTime = '07:00') {
  const [wakeH, wakeM] = wakeTime.split(':').map(Number);
  const wakeMin = wakeH * 60 + wakeM;
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  if (currentMin > wakeMin) {
    const roundedMin = Math.ceil(currentMin / 15) * 15;
    const h = Math.floor(roundedMin / 60) % 24;
    const m = roundedMin % 60;
    return formatTime(h, m);
  }
  return wakeTime;
}

/**
 * Helper to sequentially assign start times to a list of tasks with transition buffers.
 */
export function rescheduleSequentially(selectedTasks, startTime = '07:00', bufferMinutes = 10) {
  const [startH, startM] = startTime.split(':').map(Number);
  let currentMinutes = startH * 60 + startM;

  return selectedTasks.map(item => {
    const h = Math.floor(currentMinutes / 60) % 24;
    const m = currentMinutes % 60;
    const scheduledTime = formatTime(h, m);
    const taskObj = item.task || item;
    const duration = taskObj.estimatedMinutes || 30;
    const taskId = taskObj.id || item.taskId;
    currentMinutes += duration + bufferMinutes;
    return {
      taskId: taskId,
      estimatedMinutes: duration,
      scheduledTime: scheduledTime,
      isUnplanned: false
    };
  });
}

/**
 * Computes and renders real-time Capacity Summary metrics (Section 5.1 & 5.2).
 */
export async function updateCapacitySummary() {
  try {
    const allTasks = await getActiveTasks();
    const activeTasks = allTasks.filter(t => t.status !== 'inbox');

    const winStartInput = document.getElementById('plan-window-start');
    const winEndInput = document.getElementById('plan-window-end');
    const winStart = winStartInput ? winStartInput.value || '09:00' : '09:00';
    const winEnd = winEndInput ? winEndInput.value || '17:00' : '17:00';

    const startMin = parseTimeToMinutes(winStart);
    const endMin = parseTimeToMinutes(winEnd);
    const availableMinutes = Math.max(0, endMin - startMin);
    const availHours = Math.floor(availableMinutes / 60);
    const availMins = availableMinutes % 60;

    const availTimeEl = document.getElementById('metric-avail-time');
    if (availTimeEl) availTimeEl.textContent = `${availHours}h ${availMins}m`;

    const unscheduledEl = document.getElementById('metric-unscheduled-count');
    if (unscheduledEl) unscheduledEl.textContent = activeTasks.length;

    const highPriorityTasks = activeTasks.filter(t => (t.priority >= 70 || t.priority >= 4));
    const priorityEl = document.getElementById('metric-priority-count');
    if (priorityEl) priorityEl.textContent = highPriorityTasks.length;

    const habitsDue = activeTasks.filter(t => t.type === 'habit' || t.recurrence);
    const habitsEl = document.getElementById('metric-habits-count');
    if (habitsEl) habitsEl.textContent = habitsDue.length;

    const commitmentsEl = document.getElementById('metric-commitments-count');
    if (commitmentsEl) commitmentsEl.textContent = '0';
  } catch (err) {
    console.error('Error updating capacity summary:', err);
  }
}

/**
 * Initializes listeners for sliders, energy chips, presets, and action buttons in Plan view.
 */
export function initPlanDayView() {
  const startBtn = document.getElementById('plan-start-setup-btn');
  const preSetupSec = document.getElementById('plan-pre-setup');
  const setupSec = document.getElementById('plan-setup');
  
  const capacityInput = document.getElementById('plan-capacity');
  const capacityDisplay = document.getElementById('plan-capacity-display');
  const presetBtns = document.querySelectorAll('.capacity-preset');
  const energyOptions = document.querySelectorAll('#plan-setup .energy-option');

  const winStartInput = document.getElementById('plan-window-start');
  const winEndInput = document.getElementById('plan-window-end');

  const stylePills = document.querySelectorAll('#planning-style-selector .style-pill');
  const prefBufferInput = document.getElementById('pref-buffer');
  const prefBufferDisplay = document.getElementById('pref-buffer-display');
  const prefFocusInput = document.getElementById('pref-focus-block');
  const prefFocusDisplay = document.getElementById('pref-focus-block-display');

  const generateBtn = document.getElementById('plan-generate-btn');
  const addMoreBtn = document.getElementById('plan-add-more-btn');
  const confirmBtn = document.getElementById('plan-confirm-btn');

  if (!generateBtn) return;

  // 1. Setup flow routing toggle
  if (startBtn && preSetupSec && setupSec) {
    startBtn.addEventListener('click', () => {
      preSetupSec.classList.add('hidden');
      setupSec.classList.remove('hidden');
    });
  }

  // 2. Working Windows change triggers capacity recalculation
  if (winStartInput && winEndInput) {
    winStartInput.addEventListener('change', updateCapacitySummary);
    winEndInput.addEventListener('change', updateCapacitySummary);
  }

  // 3. Capacity Slider & Presets
  if (capacityInput && capacityDisplay) {
    capacityInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      initialCapacity = val;
      updateCapacityLabel(val, capacityDisplay);
    });
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val, 10);
      initialCapacity = val;
      if (capacityInput) capacityInput.value = val;
      updateCapacityLabel(val, capacityDisplay);
    });
  });

  // 4. Planning Style Selection (Section 5.4)
  stylePills.forEach(pill => {
    pill.addEventListener('click', () => {
      stylePills.forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      activePlanningStyle = pill.dataset.style || 'balanced';
    });
  });

  // 5. Sliders (Buffer & Focus Block)
  if (prefBufferInput && prefBufferDisplay) {
    prefBufferInput.addEventListener('input', (e) => {
      prefBufferDisplay.textContent = `${e.target.value}m`;
    });
  }
  if (prefFocusInput && prefFocusDisplay) {
    prefFocusInput.addEventListener('input', (e) => {
      prefFocusDisplay.textContent = `${e.target.value}m`;
    });
  }

  // 6. Energy Selector
  energyOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      energyOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      activeEnergy = opt.dataset.energy;
    });
  });

  // 7. Generate Plan Proposal Button (Section 5.5)
  generateBtn.addEventListener('click', async () => {
    const allTasks = await getActiveTasks();
    const tasks = allTasks.filter(t => t.status !== 'inbox');
    const prefs = await getPreferences();

    const winStart = winStartInput ? winStartInput.value || '09:00' : '09:00';
    const winEnd = winEndInput ? winEndInput.value || '17:00' : '17:00';
    const bufferMinutes = prefBufferInput ? parseInt(prefBufferInput.value, 10) : 10;
    const maxFocusBlock = prefFocusInput ? parseInt(prefFocusInput.value, 10) : 90;

    const breaksEnabled = document.getElementById('pref-breaks') ? document.getElementById('pref-breaks').checked : true;
    const energyMatching = document.getElementById('pref-energy-matching') ? document.getElementById('pref-energy-matching').checked : true;

    // Call deterministic scheduling engine (Section 8.4)
    const scheduleResult = generateDeterministicSchedule({
      tasks,
      availableWindows: [{ start: winStart, end: winEnd }],
      strategy: activePlanningStyle,
      minBufferMinutes: bufferMinutes,
      maxFocusBlockMinutes: maxFocusBlock,
      energyLevel: activeEnergy,
      breaksEnabled,
      energyMatchingEnabled: energyMatching,
      capacityMinutes: initialCapacity
    });

    lastScheduleResult = scheduleResult;

    // Map task blocks into editable proposal list
    const taskBlocks = scheduleResult.blocks.filter(b => b.type === 'task');
    generatedSuggestions = taskBlocks.map(block => {
      const masterTask = tasks.find(t => t.id === block.taskId) || {
        id: block.taskId,
        name: block.title || 'Task',
        title: block.title || 'Task',
        estimatedMinutes: block.duration || 30,
        bucket: block.categoryId || 'home',
        priority: block.priority || 50
      };

      return {
        task: masterTask,
        isChecked: true,
        block: block,
        scheduledTime: block.start
      };
    });

    // Update Proposal Metrics Bar (Section 5.5)
    const focusMinEl = document.getElementById('proposal-focus-min');
    const utilEl = document.getElementById('proposal-utilization');
    const covEl = document.getElementById('proposal-coverage');

    if (focusMinEl) focusMinEl.textContent = `${scheduleResult.metrics?.plannedFocusMinutes || 0}m`;
    if (utilEl) utilEl.textContent = `${Math.round((scheduleResult.metrics?.utilization || 0) * 100)}%`;
    if (covEl) covEl.textContent = `${Math.round((scheduleResult.metrics?.priorityCoverage || 0) * 100)}%`;

    renderSuggestionsList();
    
    // Switch panels
    setupSec.classList.add('hidden');
    document.getElementById('plan-suggestions').classList.remove('hidden');
  });

  // 8. Add More button
  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', async () => {
      await showAddMoreModal();
    });
  }

  // 9. Approve Plan (Section 5.5)
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      const selectedTasks = generatedSuggestions.filter(item => item.isChecked);
      if (selectedTasks.length === 0) {
        showToast('Please select at least one task to schedule', 'warning');
        return;
      }

      // Sort selected tasks chronologically
      selectedTasks.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

      const plannedTasksInput = selectedTasks.map(item => ({
        taskId: item.task.id || item.taskId,
        estimatedMinutes: item.task.estimatedMinutes,
        scheduledTime: item.scheduledTime,
        isUnplanned: false
      }));

      await createPlan(today(), initialCapacity, plannedTasksInput);
      showToast('Daily plan approved! Let\'s focus ✨', 'success');
      
      // Navigate to Today view
      window.location.hash = '#today';
    });
  }
}

/**
 * Renders the state of the Day Planning flow depending on if today's plan is already generated.
 */
export async function renderPlanDayView() {
  await updateCapacitySummary();

  const plan = await getTodayPlan();
  
  const preSetupSec = document.getElementById('plan-pre-setup');
  const setupSec = document.getElementById('plan-setup');
  const suggestionsSec = document.getElementById('plan-suggestions');

  if (!preSetupSec || !setupSec || !suggestionsSec) return;

  // Clear states
  preSetupSec.classList.remove('hidden');
  setupSec.classList.add('hidden');
  suggestionsSec.classList.add('hidden');

  const prefs = await getPreferences();
  initialCapacity = prefs.defaultCapacity || 300;
  
  // Set slider to preference capacity
  const capacityInput = document.getElementById('plan-capacity');
  const capacityDisplay = document.getElementById('plan-capacity-display');
  if (capacityInput) {
    capacityInput.value = initialCapacity;
    updateCapacityLabel(initialCapacity, capacityDisplay);
  }

  if (plan) {
    // Plan already exists for today! Render plan-exists state
    preSetupSec.innerHTML = `
      <div class="plan-hero-icon">📋</div>
      <h2>Plan Already Created</h2>
      <p style="color: var(--text-muted); max-width: 300px; margin-bottom: var(--spacing-lg);">
        You have ${plan.plannedTasks?.length || 0} tasks scheduled for today.
      </p>
      <div style="display: flex; flex-direction: column; gap: var(--spacing-sm); width: 100%; max-width: 280px;">
        <button id="exists-view-schedule-btn" class="btn btn-primary">
          View Today's Schedule
        </button>
        <button id="exists-replan-btn" class="btn btn-ghost" style="color: var(--primary-color);">
          Replan My Day
        </button>
      </div>
    `;

    document.getElementById('exists-view-schedule-btn').addEventListener('click', () => {
      window.location.hash = '#today';
    });

    document.getElementById('exists-replan-btn').addEventListener('click', async () => {
      if (confirm('Re-planning will clear today\'s existing timeline. Do you want to continue?')) {
        await db.dailyPlans.delete(plan.id);
        renderPlanDayView(); // Reload setup screen
      }
    });
  } else {
    // Normal pre-setup button HTML
    preSetupSec.innerHTML = `
      <div class="plan-hero-icon">✨</div>
      <h2>Ready to focus?</h2>
      <p style="color: var(--text-muted); max-width: 280px; margin-bottom: var(--spacing-lg);">
        Let's design a customized schedule for today.
      </p>
      <button id="plan-start-setup-btn" class="btn btn-primary plan-btn-start">
        Start Planning
      </button>
    `;
    
    // Wire up start button
    document.getElementById('plan-start-setup-btn').addEventListener('click', () => {
      preSetupSec.classList.add('hidden');
      setupSec.classList.remove('hidden');
    });
  }
}

function updateCapacityLabel(minutes, displayEl) {
  if (!displayEl) return;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  displayEl.textContent = `${hours}h ${mins}m`;
}

async function renderSuggestionsList() {
  const container = document.getElementById('suggestions-list-container');
  if (!container) return;

  container.innerHTML = '';

  const prefs = await getPreferences();
  const bucketMap = new Map((prefs.buckets || []).map(b => [b.id, b]));

  generatedSuggestions.forEach((item, index) => {
    const taskName = item.task.title || item.task.name || 'Untitled Task';
    const taskBucket = item.task.categoryId || item.task.bucket || 'home';
    const bucket = bucketMap.get(taskBucket) || { name: taskBucket, emoji: '📌', color: '#8E8E8E' };

    const row = document.createElement('div');
    row.className = `suggestion-card card ${!item.isChecked ? 'suggestion-unchecked' : ''}`;

    // 1. Checkbox wrapper
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'suggestion-checkbox-container';
    
    const checkbox = document.createElement('div');
    checkbox.className = `custom-checkbox ${item.isChecked ? 'checked' : ''}`;
    checkbox.innerHTML = item.isChecked ? '✓' : '';
    
    const toggleChecked = () => {
      item.isChecked = !item.isChecked;
      checkbox.classList.toggle('checked', item.isChecked);
      checkbox.innerHTML = item.isChecked ? '✓' : '';
      row.classList.toggle('suggestion-unchecked', !item.isChecked);
      
      // Update planned focus display
      let currentTotal = 0;
      generatedSuggestions.forEach(g => {
        if (g.isChecked) currentTotal += (g.task.estimatedMinutes || 30);
      });
      const focusMinEl = document.getElementById('proposal-focus-min');
      if (focusMinEl) focusMinEl.textContent = `${currentTotal}m`;
    };

    checkbox.addEventListener('click', toggleChecked);
    checkboxWrapper.appendChild(checkbox);
    row.appendChild(checkboxWrapper);

    // 2. Main content container
    const mainContent = document.createElement('div');
    mainContent.className = 'suggestion-main';

    // Header: Task Title & Bucket Chip
    const header = document.createElement('div');
    header.className = 'suggestion-header';
    header.innerHTML = `
      <span class="suggestion-title">${taskName}</span>
      <span class="chip suggestion-bucket-chip" style="background-color: ${bucket.color}15; color: ${bucket.color}; border-color: ${bucket.color}40; font-size: 0.75rem; padding: 2px 8px;">
        ${bucket.emoji} ${bucket.name}
      </span>
    `;
    mainContent.appendChild(header);

    // Time & Duration Custom Inputs Row
    const timeRow = document.createElement('div');
    timeRow.className = 'suggestion-time-row';

    // Start Time Group
    const timeGroup = document.createElement('div');
    timeGroup.className = 'suggestion-time-group';
    
    const timeLabel = document.createElement('label');
    timeLabel.className = 'suggestion-field-label';
    timeLabel.textContent = '🕒 Start:';
    
    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.className = 'input suggestion-time-input';
    timeInput.value = item.scheduledTime;

    const timeBadge = document.createElement('span');
    timeBadge.className = 'suggestion-time-12h';
    timeBadge.textContent = formatTime12(item.scheduledTime);

    timeInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val) {
        item.scheduledTime = val;
        timeBadge.textContent = formatTime12(val);
      }
    });

    timeGroup.appendChild(timeLabel);
    timeGroup.appendChild(timeInput);
    timeGroup.appendChild(timeBadge);
    timeRow.appendChild(timeGroup);

    // Duration Group
    const durationGroup = document.createElement('div');
    durationGroup.className = 'suggestion-duration-group';

    const durLabel = document.createElement('label');
    durLabel.className = 'suggestion-field-label';
    durLabel.textContent = '⏱️ Duration:';

    const durBox = document.createElement('div');
    durBox.className = 'suggestion-duration-box';

    const durInput = document.createElement('input');
    durInput.type = 'number';
    durInput.className = 'input suggestion-duration-input';
    durInput.min = '5';
    durInput.max = '480';
    durInput.step = '5';
    durInput.value = item.task.estimatedMinutes || 30;

    const durUnit = document.createElement('span');
    durUnit.className = 'duration-unit';
    durUnit.textContent = 'min';

    durInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val && val > 0) {
        item.task.estimatedMinutes = val;
        let currentTotal = 0;
        generatedSuggestions.forEach(g => {
          if (g.isChecked) currentTotal += (g.task.estimatedMinutes || 30);
        });
        const focusMinEl = document.getElementById('proposal-focus-min');
        if (focusMinEl) focusMinEl.textContent = `${currentTotal}m`;
      }
    });

    durBox.appendChild(durInput);
    durBox.appendChild(durUnit);
    durationGroup.appendChild(durLabel);
    durationGroup.appendChild(durBox);
    timeRow.appendChild(durationGroup);

    mainContent.appendChild(timeRow);
    row.appendChild(mainContent);

    container.appendChild(row);
  });

  // Stagger animate suggested cards
  const cards = container.querySelectorAll('.suggestion-card');
  stagger(cards, (el, delay) => slideUp(el, 15, 300, delay));
}

/**
 * Modal to select additional tasks from the bucket.
 */
async function showAddMoreModal() {
  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = 'var(--spacing-md)';

  const allActiveTasks = await getActiveTasks();
  const activeTasks = allActiveTasks.filter(t => t.status !== 'inbox');
  const prefs = await getPreferences();
  const bufferMinutes = typeof prefs.bufferMinutes === 'number' ? prefs.bufferMinutes : 10;
  
  // Filter out tasks already in the suggestion list
  const suggestedIds = new Set(generatedSuggestions.map(g => g.task.id));
  const availableTasks = activeTasks.filter(t => !suggestedIds.has(t.id));

  if (availableTasks.length === 0) {
    content.innerHTML = '<p style="text-align:center;color:var(--text-muted);">All active tasks are already scheduled!</p>';
    openModal('Add More Tasks', content);
    return;
  }

  availableTasks.forEach(task => {
    const item = document.createElement('div');
    item.className = 'card';
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = 'var(--spacing-md)';
    item.style.cursor = 'pointer';

    const tName = task.title || task.name || 'Task';
    item.innerHTML = `
      <div>
        <span style="font-weight:700;display:block;">${tName}</span>
        <span style="font-size:0.75rem;color:var(--text-muted);">⏱️ ${task.estimatedMinutes}m | Priority: ${task.priority}</span>
      </div>
      <button class="btn btn-primary" style="padding:4px 12px;font-size:0.8rem;">Add</button>
    `;

    item.addEventListener('click', () => {
      const lastSuggestion = generatedSuggestions[generatedSuggestions.length - 1];
      let scheduledTime = getEffectiveStartTime(prefs.wakeTime || '07:00');
      
      if (lastSuggestion) {
        const [h, m] = lastSuggestion.scheduledTime.split(':').map(Number);
        const nextMin = h * 60 + m + (lastSuggestion.task.estimatedMinutes || 30) + bufferMinutes;
        scheduledTime = formatTime(Math.floor(nextMin / 60) % 24, nextMin % 60);
      }

      generatedSuggestions.push({
        task: task,
        isChecked: true,
        scheduledTime: scheduledTime
      });

      closeModal();
      renderSuggestionsList();
      showToast(`${tName} added to plan`, 'success');
    });

    content.appendChild(item);
  });

  openModal('Add More Tasks', content);
}
