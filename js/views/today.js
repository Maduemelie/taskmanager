/* js/views/today.js */
import { getTodayPlan, markTaskStatus, updatePlan } from '../models/plan.js';
import { getAllTasks, createTask, getTask } from '../models/task.js';
import { getPreferences } from '../models/preferences.js';
import { renderTimeSlot } from '../components/timeSlot.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { addUnplannedTask, rescheduleRemaining, suggestDeferrals, applyDeferrals } from '../engine/reschedule.js';
import { today, formatTime, formatTime12 } from '../utils/date.js';
import { stagger, slideUp, popEffect } from '../utils/animate.js';
import { triggerHaptic } from '../utils/haptics.js';
import { showHabitCalendarModal } from '../components/habitCalendar.js';

let activePlan = null;
let timeIndicatorInterval = null;

/**
 * Initializes listeners for interruption FAB and other actions on Today view.
 */
export function initTodayView() {
  const interruptionFab = document.getElementById('interruption-fab');
  if (interruptionFab) {
    interruptionFab.addEventListener('click', () => {
      showInterruptionModal();
    });
  }

  // Set interval to update active task highlight
  if (timeIndicatorInterval) clearInterval(timeIndicatorInterval);
  timeIndicatorInterval = setInterval(updateActiveTaskHighlight, 60000); // every minute
}

/**
 * Renders the Today timeline view, tasks checklist, and progress summary.
 */
export async function renderTodayView() {
  const container = document.getElementById('timeline-container');
  const progressText = document.getElementById('today-progress-text');
  const progressFill = document.getElementById('today-progress-fill');
  const progressCount = document.getElementById('today-progress-count');

  if (!container) return;

  activePlan = await getTodayPlan();
  
  if (!activePlan) {
    // Render Empty State
    container.innerHTML = `
      <div id="timeline-empty-state" class="bucket-empty-state" style="border-style: solid; padding: var(--spacing-xxl);">
        <h3>Your day is clear!</h3>
        <p style="margin-top: 8px; margin-bottom: var(--spacing-md);">No tasks scheduled for today.</p>
        <button id="timeline-plan-now-btn" class="btn btn-primary">Plan My Day ✨</button>
      </div>
    `;
    
    document.getElementById('timeline-plan-now-btn').addEventListener('click', () => {
      window.location.hash = '#plan';
    });

    if (progressText) progressText.textContent = '0%';
    if (progressFill) progressFill.style.width = '0%';
    if (progressCount) progressCount.textContent = '0/0 done';
    return;
  }

  // Clear timeline
  container.innerHTML = '';

  // Get all master task records for rendering details
  const allTasks = await getAllTasks();
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  // Render slots
  const activeSlots = activePlan.plannedTasks.filter(t => t.status !== 'rescheduled');
  
  if (activeSlots.length === 0) {
    container.innerHTML = '<div class="bucket-empty-state">All today\'s tasks were skipped or deferred.</div>';
  } else {
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();

    let lastPeriod = null;
    let lastSlotEndMin = null;

    activeSlots.forEach(slot => {
      let taskDetail = taskMap.get(slot.taskId);
      if (!taskDetail) {
        // Fallback mock details for quick-added unplanned tasks
        taskDetail = {
          id: slot.taskId,
          name: slot.name || 'Unplanned Task',
          bucket: slot.bucket || 'unplanned',
          estimatedMinutes: slot.estimatedMinutes,
          priority: 2,
          energyLevel: 'medium',
          preferredTime: 'anytime',
          completionHistory: []
        };
      }

      const [h, m] = slot.scheduledTime.split(':').map(Number);
      const startMin = h * 60 + m;
      const endMin = startMin + slot.estimatedMinutes;

      // 1. Time Period Demarcation (Morning, Afternoon, Evening)
      let period = 'morning';
      let periodTitle = 'Morning Focus 🌅';
      if (h >= 12 && h < 17) {
        period = 'afternoon';
        periodTitle = 'Afternoon Flow ☀️';
      } else if (h >= 17 || h < 5) {
        period = 'evening';
        periodTitle = 'Evening Wind-down 🌙';
      }

      if (period !== lastPeriod) {
        lastPeriod = period;
        const periodHeader = document.createElement('div');
        periodHeader.className = `timeline-period-header period-${period}`;
        periodHeader.innerHTML = `<span>${periodTitle}</span>`;
        container.appendChild(periodHeader);
      }

      // 2. Buffer / Rest Gap Demarcation between tasks
      if (lastSlotEndMin !== null && startMin > lastSlotEndMin) {
        const gap = startMin - lastSlotEndMin;
        if (gap >= 5) {
          const bufferDiv = document.createElement('div');
          bufferDiv.className = 'timeline-buffer';
          const gapStartH = Math.floor(lastSlotEndMin / 60) % 24;
          const gapStartM = lastSlotEndMin % 60;
          const gapEndH = Math.floor(startMin / 60) % 24;
          const gapEndM = startMin % 60;
          const gapTimeStr = `${formatTime12(gapStartH, gapStartM)} – ${formatTime12(gapEndH, gapEndM)}`;
          
          bufferDiv.innerHTML = `
            <div class="timeline-dot buffer-dot"></div>
            <div class="timeline-buffer-content">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="buffer-icon">☕</span>
                <span class="buffer-label">${gap}m Buffer / Break</span>
              </div>
              <span class="buffer-time">${gapTimeStr}</span>
            </div>
          `;
          container.appendChild(bufferDiv);
        }
      }

      lastSlotEndMin = endMin;

      const callbacks = {
        onStart: async (taskId) => {
          if (taskDetail.isHabit) {
            showHabitCalendarModal(taskDetail, activePlan.id, async () => {
              await markTaskStatus(activePlan.id, taskId, 'completed', 0);
              renderTodayView();
            });
            return;
          }
          triggerHaptic(10);
          await markTaskStatus(activePlan.id, taskId, 'in-progress');
          showToast('Task started! Focus time ⚡', 'info');
          renderTodayView();
        },
        onComplete: async (taskId) => {
          if (taskDetail.isHabit) {
            triggerHaptic(15);
            await markTaskStatus(activePlan.id, taskId, 'completed', 0);
            showToast('Habit tracked! 🎉', 'success');
            renderTodayView();
            return;
          }
          // Open quick completion modal asking actual time
          showCompletionMinutesModal(taskId, slot.estimatedMinutes);
        },
        onSkip: async (taskId) => {
          triggerHaptic(10);
          await markTaskStatus(activePlan.id, taskId, 'skipped');
          showToast('Task deferred back to bucket ⏭️', 'info');
          renderTodayView();
        },
        onEdit: (taskId) => {
          if (taskDetail.isHabit) {
            showHabitCalendarModal(taskDetail, activePlan.id, async () => {
              await markTaskStatus(activePlan.id, taskId, 'completed', 0);
              renderTodayView();
            });
            return;
          }
          window.location.hash = `#add-task?id=${taskId}`;
        }
      };

      const slotElement = renderTimeSlot(slot, taskDetail, callbacks);

      // Check if this task is currently active based on system time, scheduled start time, and duration
      const isActive = currentMin >= startMin && currentMin < endMin && slot.status !== 'completed' && slot.status !== 'skipped';

      if (isActive) {
        slotElement.classList.add('is-active-task');
        const card = slotElement.querySelector('.timeline-card');
        if (card) card.classList.add('is-active-task');
      }

      container.appendChild(slotElement);
    });

    // Stagger animate timeline slots
    const slots = container.querySelectorAll('.timeline-slot, .timeline-buffer');
    stagger(slots, (el, delay) => slideUp(el, 15, 300, delay));
  }
  const totalTasks = activeSlots.length;
  const completedTasks = activeSlots.filter(t => t.status === 'completed').length;
  const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  if (progressText) progressText.textContent = `${percentage}%`;
  
  const ringFill = document.getElementById('today-progress-ring-fill');
  if (ringFill) {
    const offset = 113 - (113 * percentage) / 100;
    ringFill.style.strokeDashoffset = offset;
    
    // Color shift based on completion percentage
    if (percentage >= 100) {
      ringFill.style.stroke = 'var(--secondary-color)';
      if (progressText) progressText.style.color = 'var(--secondary-color)';
    } else if (percentage >= 50) {
      ringFill.style.stroke = 'var(--accent-color)';
      if (progressText) progressText.style.color = 'var(--accent-color)';
    } else {
      ringFill.style.stroke = 'var(--primary-color)';
      if (progressText) progressText.style.color = 'var(--primary-color)';
    }
  }

  if (progressCount) progressCount.textContent = `${completedTasks}/${totalTasks} tasks done`;

  // Trigger fullscreen confetti if all done!
  if (totalTasks > 0 && completedTasks === totalTasks) {
    triggerConfettiCelebration();
  }
}

/**
 * Dynamically determines and updates the currently active task card highlight in today's timeline.
 */
export function updateActiveTaskHighlight() {
  if (!activePlan) return;
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  const activeSlots = activePlan.plannedTasks.filter(t => t.status !== 'rescheduled');
  activeSlots.forEach(slot => {
    const slotEl = document.querySelector(`.timeline-slot[data-task-id="${slot.taskId}"]`);
    if (!slotEl) return;
    const card = slotEl.querySelector('.timeline-card');
    const [h, m] = slot.scheduledTime.split(':').map(Number);
    const startMin = h * 60 + m;
    const endMin = startMin + slot.estimatedMinutes;
    const isActive = currentMin >= startMin && currentMin < endMin && slot.status !== 'completed' && slot.status !== 'skipped';

    slotEl.classList.toggle('is-active-task', isActive);
    if (card) {
      card.classList.toggle('is-active-task', isActive);
    }
  });
}

/**
 * Prompts user for actual minutes took to complete the task.
 */
function showCompletionMinutesModal(taskId, estimatedMinutes) {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="comp-minutes">How many minutes did this take?</label>
      <input type="number" id="comp-minutes" class="input" value="${estimatedMinutes}" min="1">
    </div>
    <div style="display:flex;gap:var(--spacing-md);margin-top:var(--spacing-lg);">
      <button id="comp-cancel-btn" class="btn btn-secondary" style="flex:1;">Cancel</button>
      <button id="comp-confirm-btn" class="btn btn-primary" style="flex:1;">Log & Complete</button>
    </div>
  `;

  openModal('Log Completion', content);

  const compMinInput = content.querySelector('#comp-minutes');
  if (compMinInput) {
    compMinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('comp-confirm-btn')?.click();
      }
    });
  }

  document.getElementById('comp-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('comp-confirm-btn').addEventListener('click', async () => {
    const minInput = document.getElementById('comp-minutes');
    const actualMinutes = parseInt(minInput.value, 10) || estimatedMinutes;

    // Trigger vibration and pop spring effect before re-render
    triggerHaptic(15);
    const slot = document.querySelector(`.timeline-slot[data-task-id="${taskId}"]`);
    if (slot) {
      const card = slot.querySelector('.card');
      if (card) popEffect(card);
    }

    closeModal();
    
    // Wait for pop effect animation to finish
    await new Promise(resolve => setTimeout(resolve, 300));

    await markTaskStatus(activePlan.id, taskId, 'completed', actualMinutes);
    showToast('Task completed! Streak updated 🎉', 'success');
    renderTodayView();
  });
}

/**
 * Bottom sheet modal for quick-adding unplanned tasks ("Something Came Up").
 */
async function showInterruptionModal() {
  const prefs = await getPreferences();
  const bucketOptions = (prefs.buckets || []).map(b => 
    `<option value="${b.id}">${b.emoji} ${b.name}</option>`
  ).join('');

  const content = document.createElement('div');
  content.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="inter-name">What came up? (Task Name)</label>
      <input type="text" id="inter-name" class="input" placeholder="e.g., Attend emergency client call" required>
    </div>
    <div class="form-group">
      <label class="form-label" for="inter-bucket">Category / Bucket</label>
      <select id="inter-bucket" class="select" required>
        ${bucketOptions}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Estimated Duration</label>
      <div style="display:flex;gap:var(--spacing-sm);margin-top:var(--spacing-xs);">
        <button class="btn btn-secondary duration-preset-btn" data-val="15" style="flex:1;">15m</button>
        <button class="btn btn-secondary duration-preset-btn selected" data-val="30" style="flex:1;background-color:var(--primary-light);border-color:var(--primary-color);color:var(--primary-color);">30m</button>
        <button class="btn btn-secondary duration-preset-btn" data-val="45" style="flex:1;">45m</button>
        <button class="btn btn-secondary duration-preset-btn" data-val="60" style="flex:1;">60m</button>
      </div>
      <input type="hidden" id="inter-duration" value="30">
    </div>
    <div style="display:flex;gap:var(--spacing-md);margin-top:var(--spacing-xl);">
      <button id="inter-cancel-btn" class="btn btn-secondary" style="flex:1;">Cancel</button>
      <button id="inter-save-btn" class="btn btn-primary" style="flex:1;">Add to Today</button>
    </div>
  `;

  openModal('Something Came Up 🌊', content);

  const interNameInput = content.querySelector('#inter-name');
  if (interNameInput) {
    interNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('inter-save-btn')?.click();
      }
    });
  }

  // Duration preset triggers
  const presets = content.querySelectorAll('.duration-preset-btn');
  presets.forEach(btn => {
    btn.addEventListener('click', () => {
      presets.forEach(p => {
        p.classList.remove('selected');
        p.style.backgroundColor = '';
        p.style.borderColor = '';
        p.style.color = '';
      });
      btn.classList.add('selected');
      btn.style.backgroundColor = 'var(--primary-light)';
      btn.style.borderColor = 'var(--primary-color)';
      btn.style.color = 'var(--primary-color)';
      document.getElementById('inter-duration').value = btn.dataset.val;
    });
  });

  document.getElementById('inter-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('inter-save-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('inter-name');
    if (!nameInput.value.trim()) {
      showToast('Please specify what occurred', 'warning');
      return;
    }

    const bucketSelect = document.getElementById('inter-bucket');
    const selectedBucket = bucketSelect ? bucketSelect.value : (prefs.buckets[0]?.id || 'home');

    const duration = parseInt(document.getElementById('inter-duration').value, 10);
    const now = new Date();
    const insertTime = formatTime(now.getHours(), now.getMinutes());

    // 1. Create a master task record in background so it can be loaded later
    const newTaskId = await createTask({
      name: nameInput.value.trim() + ' 🌊',
      bucket: selectedBucket,
      priority: 3,
      estimatedMinutes: duration,
      energyLevel: 'medium',
      preferredTime: 'anytime'
    });

    // 2. Add to local activePlan state
    const unplannedTask = {
      taskId: newTaskId,
      name: nameInput.value.trim(),
      bucket: selectedBucket,
      estimatedMinutes: duration
    };

    activePlan = addUnplannedTask(activePlan, unplannedTask, insertTime);
    closeModal(); // close add modal

    // 3. Ask to reorganize schedule
    setTimeout(() => {
      showReorganizePrompt(newTaskId, duration, insertTime);
    }, 400);
  });
}

/**
 * Prompt to reorganize day schedule after interruption.
 */
function showReorganizePrompt(triggerTaskId, duration, insertTime) {
  const content = document.createElement('div');
  content.innerHTML = `
    <p style="margin-bottom:var(--spacing-lg);line-height:1.5;">
      Inserting this task affects the rest of your day. Would you like me to reorganize your remaining schedule automatically?
    </p>
    <div style="display:flex;gap:var(--spacing-md);">
      <button id="reorg-no-btn" class="btn btn-secondary" style="flex:1;">No, keep overlap</button>
      <button id="reorg-yes-btn" class="btn btn-primary" style="flex:1;">Yes, reschedule</button>
    </div>
  `;

  openModal('Reorganize Schedule?', content);

  document.getElementById('reorg-no-btn').addEventListener('click', async () => {
    // Just save plan with overlap
    await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });
    closeModal();
    showToast('Task added overlapping timeline', 'info');
    renderTodayView();
  });

  document.getElementById('reorg-yes-btn').addEventListener('click', async () => {
    closeModal();
    
    // Perform shift
    activePlan = rescheduleRemaining(activePlan, insertTime, duration, triggerTaskId);
    
    // Check overflow and suggest deferrals
    const prefs = await getPreferences();
    const allTasks = await getAllTasks();
    const suggested = suggestDeferrals(activePlan, activePlan.capacity, allTasks, prefs, 'medium');

    if (suggested.length > 0) {
      setTimeout(() => {
        showDeferralsSuggestionsModal(suggested);
      }, 400);
    } else {
      await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });
      showToast('Remaining tasks shifted forward! ⏭️', 'success');
      renderTodayView();
    }
  });
}

/**
 * Suggestions modal to defer tasks if over focus capacity limit.
 */
function showDeferralsSuggestionsModal(deferrals) {
  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = 'var(--spacing-md)';

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = 'var(--spacing-sm)';
  
  deferrals.forEach(d => {
    const item = document.createElement('div');
    item.className = 'card';
    item.style.padding = 'var(--spacing-md)';
    item.style.borderLeft = '4px solid var(--accent-color)';
    item.innerHTML = `<strong>${d.name}</strong> <span style="float:right;font-size:0.8rem;color:var(--text-muted);">⏱️ ${d.estimatedMinutes}m</span>`;
    list.appendChild(item);
  });

  content.appendChild(list);

  const desc = document.createElement('p');
  desc.style.fontSize = '0.9rem';
  desc.style.color = 'var(--text-muted)';
  desc.textContent = 'To respect your daily capacity limits, I suggest deferring these lowest-scoring tasks back to your bucket.';
  content.appendChild(desc);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = 'var(--spacing-md)';
  actions.style.marginTop = 'var(--spacing-lg)';
  actions.innerHTML = `
    <button id="def-keep-btn" class="btn btn-secondary" style="flex:1;">Keep anyway</button>
    <button id="def-apply-btn" class="btn btn-primary" style="flex:1;">Defer selected</button>
  `;
  content.appendChild(actions);

  openModal('Re-schedule Overflow', content);

  document.getElementById('def-keep-btn').addEventListener('click', async () => {
    await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });
    closeModal();
    showToast('Plan updated without deferrals', 'info');
    renderTodayView();
  });

  document.getElementById('def-apply-btn').addEventListener('click', async () => {
    activePlan = applyDeferrals(activePlan, deferrals.map(d => d.taskId));
    await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });
    closeModal();
    showToast('Deferred tasks returned to bucket', 'success');
    renderTodayView();
  });
}

/**
 * Triggers fullscreen Canvas Confetti burst
 */
function triggerConfettiCelebration() {
  if (window.confettiInjected) return;
  window.confettiInjected = true;

  // Let's create a lightweight particle celebration on the window
  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '9999';
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#E8703A', '#5B8C5A', '#D4A373', '#E8A838', '#E91E63'];

  for (let i = 0; i < 150; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2 + 100,
      vx: (Math.random() - 0.5) * 15,
      vy: (Math.random() - 0.8) * 15 - 5,
      r: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      decay: Math.random() * 0.015 + 0.01
    });
  }

  function anim() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3; // gravity
      p.vx *= 0.98; // drag
      p.alpha -= p.decay;

      if (p.alpha > 0) {
        active = true;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    if (active) {
      requestAnimationFrame(anim);
    } else {
      canvas.remove();
      window.confettiInjected = false;
    }
  }

  anim();
}
