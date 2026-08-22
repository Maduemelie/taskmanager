/* js/views/planDay.js */
import { generateDayPlan } from '../engine/planner.js';
import { getTodayPlan, createPlan, updatePlan } from '../models/plan.js';
import { getActiveTasks } from '../models/task.js';
import { getPreferences } from '../models/preferences.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { today } from '../utils/date.js';

let activeEnergy = 'medium';
let generatedSuggestions = []; // Array of { task, isChecked }
let initialCapacity = 180; // Default capacity in minutes (3 hours)

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

  // 2. Capacity Slider & Presets
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

  // 3. Energy Selector
  energyOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      energyOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      activeEnergy = opt.dataset.energy;
    });
  });

  // 4. Generate Suggestions Button
  generateBtn.addEventListener('click', async () => {
    const tasks = await getActiveTasks();
    const prefs = await getPreferences();
    
    // Call planner engine
    const plannedList = generateDayPlan(tasks, prefs, initialCapacity, activeEnergy);
    
    // Store generated list locally with checked state
    generatedSuggestions = plannedList.map(item => {
      // Find full task details from master list
      const masterTask = tasks.find(t => t.id === item.taskId);
      return {
        task: masterTask || { id: item.taskId, name: item.name, estimatedMinutes: item.estimatedMinutes, bucket: item.bucket, priority: item.priority },
        isChecked: true,
        scheduledTime: item.scheduledTime
      };
    });

    renderSuggestionsList();
    
    // Switch panels
    setupSec.classList.add('hidden');
    document.getElementById('plan-suggestions').classList.remove('hidden');
  });

  // 5. Add More button
  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', async () => {
      await showAddMoreModal();
    });
  }

  // 6. Confirm / Let's Do It! button
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      const selectedTasks = generatedSuggestions.filter(item => item.isChecked);
      if (selectedTasks.length === 0) {
        showToast('Please select at least one task to schedule', 'warning');
        return;
      }

      // Re-assign times sequentially to the finalized list
      const prefs = await getPreferences();
      
      // Save plan to database
      const plannedTasksInput = selectedTasks.map(item => ({
        taskId: item.task.id,
        estimatedMinutes: item.task.estimatedMinutes,
        scheduledTime: item.scheduledTime,
        isUnplanned: false
      }));

      await createPlan(today(), initialCapacity, plannedTasksInput);
      showToast('Daily plan created! Let\'s focus ✨', 'success');
      
      // Navigate to Today view
      window.location.hash = '#today';
    });
  }
}

/**
 * Renders the state of the Day Planning flow depending on if today's plan is already generated.
 */
export async function renderPlanDayView() {
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
        You have ${plan.plannedTasks.length} tasks scheduled for today.
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
    
    // Wire up start button again (since we replaced innerHTML)
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

function renderSuggestionsList() {
  const container = document.getElementById('suggestions-list-container');
  const capacitySummary = document.getElementById('suggestions-capacity-summary');
  if (!container) return;

  container.innerHTML = '';

  let totalScheduledMin = 0;
  
  generatedSuggestions.forEach((item, index) => {
    if (item.isChecked) {
      totalScheduledMin += item.task.estimatedMinutes;
    }

    const row = document.createElement('div');
    row.className = 'suggestion-card';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = 'var(--spacing-md)';
    row.style.width = '100%';
    row.style.marginBottom = 'var(--spacing-sm)';

    // Checkbox custom
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'suggestion-checkbox-container';
    
    const checkbox = document.createElement('div');
    checkbox.className = `custom-checkbox ${item.isChecked ? 'checked' : ''}`;
    checkbox.innerHTML = item.isChecked ? '✓' : '';
    
    checkbox.addEventListener('click', () => {
      item.isChecked = !item.isChecked;
      checkbox.classList.toggle('checked', item.isChecked);
      checkbox.innerHTML = item.isChecked ? '✓' : '';
      
      // Update capacity total label
      let currentTotal = 0;
      generatedSuggestions.forEach(g => {
        if (g.isChecked) currentTotal += g.task.estimatedMinutes;
      });
      if (capacitySummary) {
        capacitySummary.textContent = `${currentTotal}m / ${initialCapacity}m`;
      }
    });

    checkboxWrapper.appendChild(checkbox);
    row.appendChild(checkboxWrapper);

    // Simple display card details
    const card = document.createElement('div');
    card.className = 'card';
    card.style.flex = '1';
    card.style.display = 'flex';
    card.style.justifyContent = 'space-between';
    card.style.alignItems = 'center';
    card.style.padding = 'var(--spacing-md)';

    const details = document.createElement('div');
    details.innerHTML = `<span style="font-size:0.75rem; color:var(--text-light); font-weight:800; display:block;">[${item.scheduledTime}]</span><span style="font-weight:700;">${item.task.name}</span>`;

    const meta = document.createElement('div');
    meta.innerHTML = `<span class="chip" style="font-size:0.75rem;">⏱️ ${item.task.estimatedMinutes}m</span>`;

    card.appendChild(details);
    card.appendChild(meta);
    row.appendChild(card);

    container.appendChild(row);
  });

  if (capacitySummary) {
    capacitySummary.textContent = `${totalScheduledMin}m / ${initialCapacity}m`;
  }
}

/**
 * Modal to select additional tasks from the bucket.
 */
async function showAddMoreModal() {
  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = 'var(--spacing-md)';

  const activeTasks = await getActiveTasks();
  
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

    item.innerHTML = `
      <div>
        <span style="font-weight:700;display:block;">${task.name}</span>
        <span style="font-size:0.75rem;color:var(--text-muted);">⏱️ ${task.estimatedMinutes}m | Priority: ${task.priority}</span>
      </div>
      <button class="btn btn-primary" style="padding:4px 12px;font-size:0.8rem;">Add</button>
    `;

    item.addEventListener('click', () => {
      // Append to suggestions. We'll set start time to end of current suggestions or wake time.
      const lastSuggestion = generatedSuggestions[generatedSuggestions.length - 1];
      let scheduledTime = '09:00';
      if (lastSuggestion) {
        const [h, m] = lastSuggestion.scheduledTime.split(':').map(Number);
        const nextMin = h * 60 + m + lastSuggestion.task.estimatedMinutes;
        scheduledTime = `${String(Math.floor(nextMin / 60) % 24).padStart(2, '0')}:${String(nextMin % 60).padStart(2, '0')}`;
      }

      generatedSuggestions.push({
        task: task,
        isChecked: true,
        scheduledTime: scheduledTime
      });

      closeModal();
      renderSuggestionsList();
      showToast(`${task.name} added to plan`, 'success');
    });

    content.appendChild(item);
  });

  openModal('Add More Tasks', content);
}
