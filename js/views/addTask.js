/* js/views/addTask.js */
import { createTask, updateTask, deleteTask, getTask } from '../models/task.js';
import { getPreferences } from '../models/preferences.js';
import { showToast } from '../components/toast.js';

let selectedEnergy = 'medium';

/**
 * Initializes form fields and interactions for creating and editing tasks.
 */
export function initAddTaskView() {
  const form = document.getElementById('task-form');
  const priorityInput = document.getElementById('task-priority');
  const priorityDisplay = document.getElementById('task-priority-display');
  const durationInput = document.getElementById('task-duration');
  const durationPresets = document.querySelectorAll('.duration-presets .duration-chip');
  const energyOptions = document.querySelectorAll('#task-energy-selector .energy-option');
  
  const recToggle = document.getElementById('task-recurring-toggle');
  const recOptions = document.getElementById('recurrence-options');
  const recType = document.getElementById('recurrence-type');
  const recWeeklyDays = document.getElementById('recurrence-weekly-days');
  const recIntervalGroup = document.getElementById('recurrence-interval-group');

  const deadlineToggle = document.getElementById('task-deadline-toggle');
  const deadlineInput = document.getElementById('task-deadline');

  const expiryToggle = document.getElementById('task-expiry-toggle');
  const expiryInput = document.getElementById('task-expiry');

  const cancelBtn = document.getElementById('task-cancel-btn');
  const deleteBtn = document.getElementById('task-delete-btn');
  const saveBtn = document.getElementById('task-save-btn');

  if (!form) return;

  // 1. Priority Slider display
  if (priorityInput && priorityDisplay) {
    priorityInput.addEventListener('input', (e) => {
      priorityDisplay.textContent = e.target.value;
    });
  }

  // 2. Duration Presets click
  durationPresets.forEach(chip => {
    chip.addEventListener('click', () => {
      durationPresets.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      if (durationInput) {
        durationInput.value = chip.dataset.min;
      }
    });
  });

  if (durationInput) {
    durationInput.addEventListener('input', () => {
      // De-select presets if custom input matches nothing
      durationPresets.forEach(c => {
        if (c.dataset.min === durationInput.value) {
          c.classList.add('selected');
        } else {
          c.classList.remove('selected');
        }
      });
    });
  }

  // 3. Energy Selector click
  energyOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      energyOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedEnergy = opt.dataset.energy;
    });
  });

  // 4. Recurrence Toggle
  if (recToggle && recOptions) {
    recToggle.addEventListener('change', () => {
      recOptions.classList.toggle('hidden', !recToggle.checked);
    });
  }

  // Recurrence Pattern select
  if (recType) {
    recType.addEventListener('change', () => {
      const type = recType.value;
      if (recWeeklyDays) recWeeklyDays.classList.toggle('hidden', type !== 'weekly');
      if (recIntervalGroup) {
        recIntervalGroup.classList.toggle('hidden', type !== 'custom');
        const unit = document.getElementById('recurrence-interval-unit');
        if (unit) unit.textContent = type === 'custom' ? 'days' : 'intervals';
      }
    });
  }

  // 5. Deadlines & Expiry Toggle
  if (deadlineToggle && deadlineInput) {
    deadlineToggle.addEventListener('change', () => {
      deadlineInput.classList.toggle('hidden', !deadlineToggle.checked);
      if (!deadlineToggle.checked) deadlineInput.value = '';
    });
  }

  if (expiryToggle && expiryInput) {
    expiryToggle.addEventListener('change', () => {
      expiryInput.classList.toggle('hidden', !expiryToggle.checked);
      if (!expiryToggle.checked) expiryInput.value = '';
    });
  }

  // 6. Action buttons
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      window.location.hash = '#bucket';
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const id = document.getElementById('edit-task-id').value;
      if (confirm('Are you sure you want to delete this task? It will be archived.')) {
        await deleteTask(id);
        showToast('Task deleted successfully', 'success');
        window.location.hash = '#bucket';
      }
    });
  }

  // Form Submit / Save
  saveBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    
    const taskNameInput = document.getElementById('task-name');
    if (!taskNameInput.value.trim()) {
      showToast('Task name is required', 'warning');
      return;
    }

    const taskData = {
      name: taskNameInput.value.trim(),
      bucket: document.getElementById('task-bucket').value,
      priority: parseInt(priorityInput.value, 10),
      estimatedMinutes: parseInt(durationInput.value, 10),
      energyLevel: selectedEnergy,
      preferredTime: document.getElementById('task-preferred-time').value,
      recurrence: null,
      deadline: deadlineToggle.checked ? deadlineInput.value || null : null,
      activeUntil: expiryToggle.checked ? expiryInput.value || null : null
    };

    // Gather recurrence settings
    if (recToggle.checked) {
      const type = recType.value;
      const recurrence = { type, interval: 1 };
      
      if (type === 'custom') {
        recurrence.interval = parseInt(document.getElementById('recurrence-interval').value, 10) || 1;
      }
      
      if (type === 'weekly') {
        const checkedDays = Array.from(document.querySelectorAll('input[name="weekly-day"]:checked')).map(el => parseInt(el.value, 10));
        recurrence.daysOfWeek = checkedDays.length > 0 ? checkedDays : [new Date().getDay()];
      }

      if (type === 'monthly') {
        recurrence.dayOfMonth = new Date().getDate();
      }

      taskData.recurrence = recurrence;
    }

    const editId = document.getElementById('edit-task-id').value;

    if (editId) {
      // Update Mode
      await updateTask(editId, taskData);
      showToast('Task updated successfully 🎉', 'success');
    } else {
      // Create Mode
      await createTask(taskData);
      showToast('Task added to bucket ✨', 'success');
    }

    window.location.hash = '#bucket';
  });
}

/**
 * Pre-fills the form depending on edit mode (reading query params) or creation mode.
 */
export async function renderAddTaskView() {
  const titleEl = document.getElementById('task-form-title');
  const deleteBtn = document.getElementById('task-delete-btn');
  const editIdInput = document.getElementById('edit-task-id');
  const bucketSelect = document.getElementById('task-bucket');

  if (!titleEl || !bucketSelect) return;

  // 1. Populate categories buckets selector
  const prefs = await getPreferences();
  bucketSelect.innerHTML = '';
  prefs.buckets.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.emoji} ${b.name}`;
    bucketSelect.appendChild(opt);
  });

  // 2. Parse Task ID if editing
  const hash = window.location.hash;
  let taskId = null;
  if (hash.includes('?')) {
    const query = hash.split('?')[1];
    const params = new URLSearchParams(query);
    taskId = params.get('id');
  }

  // Reset form to clean state
  document.getElementById('task-form').reset();
  document.querySelectorAll('.duration-presets .duration-chip').forEach(c => c.classList.remove('selected'));
  document.querySelector('.duration-presets .duration-chip[data-min="30"]').classList.add('selected');
  document.getElementById('task-priority-display').textContent = '3';
  
  // Hide details sub-menus
  document.getElementById('recurrence-options').classList.add('hidden');
  document.getElementById('task-recurring-toggle').checked = false;
  document.getElementById('task-deadline-toggle').checked = false;
  document.getElementById('task-deadline').classList.add('hidden');
  document.getElementById('task-expiry-toggle').checked = false;
  document.getElementById('task-expiry').classList.add('hidden');
  document.getElementById('recurrence-weekly-days').classList.add('hidden');
  document.getElementById('recurrence-interval-group').classList.add('hidden');
  
  // Reset energy to Medium
  document.querySelectorAll('#task-energy-selector .energy-option').forEach(o => o.classList.remove('selected'));
  document.querySelector('#task-energy-selector .energy-option[data-energy="medium"]').classList.add('selected');
  selectedEnergy = 'medium';

  if (taskId) {
    // EDIT MODE
    titleEl.textContent = 'Edit Task';
    if (deleteBtn) deleteBtn.classList.remove('hidden');
    editIdInput.value = taskId;

    const task = await getTask(taskId);
    if (task) {
      document.getElementById('task-name').value = task.name;
      bucketSelect.value = task.bucket;
      document.getElementById('task-priority').value = task.priority;
      document.getElementById('task-priority-display').textContent = task.priority;
      document.getElementById('task-duration').value = task.estimatedMinutes;

      // Select matching duration preset chip if exists
      document.querySelectorAll('.duration-presets .duration-chip').forEach(c => {
        c.classList.toggle('selected', parseInt(c.dataset.min, 10) === task.estimatedMinutes);
      });

      // Select Energy
      document.querySelectorAll('#task-energy-selector .energy-option').forEach(o => {
        const isMatch = o.dataset.energy === task.energyLevel;
        o.classList.toggle('selected', isMatch);
        if (isMatch) selectedEnergy = task.energyLevel;
      });

      document.getElementById('task-preferred-time').value = task.preferredTime;

      // Recurrence Pre-fills
      if (task.recurrence) {
        document.getElementById('task-recurring-toggle').checked = true;
        document.getElementById('recurrence-options').classList.remove('hidden');
        document.getElementById('recurrence-type').value = task.recurrence.type;
        
        if (task.recurrence.type === 'weekly') {
          document.getElementById('recurrence-weekly-days').classList.remove('hidden');
          // Clear all checked days first
          document.querySelectorAll('input[name="weekly-day"]').forEach(el => el.checked = false);
          // Check saved days
          if (task.recurrence.daysOfWeek) {
            task.recurrence.daysOfWeek.forEach(day => {
              const el = document.querySelector(`input[name="weekly-day"][value="${day}"]`);
              if (el) el.checked = true;
            });
          }
        } else if (task.recurrence.type === 'custom') {
          document.getElementById('recurrence-interval-group').classList.remove('hidden');
          document.getElementById('recurrence-interval').value = task.recurrence.interval || 1;
        }
      }

      // Deadline Pre-fill
      if (task.deadline) {
        document.getElementById('task-deadline-toggle').checked = true;
        document.getElementById('task-deadline').classList.remove('hidden');
        document.getElementById('task-deadline').value = task.deadline;
      }

      // Expiry Pre-fill
      if (task.activeUntil) {
        document.getElementById('task-expiry-toggle').checked = true;
        document.getElementById('task-expiry').classList.remove('hidden');
        document.getElementById('task-expiry').value = task.activeUntil;
      }
    }
  } else {
    // CREATE MODE
    titleEl.textContent = 'Create Task';
    if (deleteBtn) deleteBtn.classList.add('hidden');
    editIdInput.value = '';
  }
}
