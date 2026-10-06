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
const undoStack = [];

/**
 * Pushes an undo action to the stack and shows the undo toast.
 * @param {Object} action - { taskId, description, previousStatus, previousTime, previousActualMinutes, previousCompletedAt }
 */
function pushUndoAction(action) {
  undoStack.push(action);
  showUndoToast(action.description, async () => {
    await executeUndoRollback(action);
  });
}

/**
 * Rolls back a task state change in IndexedDB and re-renders the timeline.
 */
async function executeUndoRollback(action) {
  try {
    const plan = await getTodayPlan();
    if (!plan) return;

    plan.plannedTasks = plan.plannedTasks.map(t => {
      if (t.taskId === action.taskId) {
        return {
          ...t,
          status: action.previousStatus,
          scheduledTime: action.previousTime || t.scheduledTime,
          actualMinutes: action.previousActualMinutes,
          completedAt: action.previousCompletedAt
        };
      }
      return t;
    });

    await updatePlan(plan.id, { plannedTasks: plan.plannedTasks });
    triggerHaptic(15);
    showToast('Action undone! ↩️', 'info');
    await renderTodayView();
  } catch (err) {
    console.error('Failed to execute undo rollback:', err);
    showToast('Could not undo action', 'error');
  }
}

/**
 * Displays a floating undo toast with a 6-second countdown progress bar.
 */
function showUndoToast(message, onUndo) {
  // Remove any existing undo toast
  const existingToast = document.querySelector('.toast-undo');
  if (existingToast) existingToast.remove();

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed; bottom:80px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:8px; pointer-events:none;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast-undo';
  toast.setAttribute('role', 'alert');
  toast.style.cssText = `
    pointer-events:auto; background:var(--text-color, #333); color:var(--bg-color, #fff);
    border-radius:var(--radius-lg, 12px); padding:12px 16px; box-shadow:var(--shadow-lg);
    min-width:280px; max-width:360px; animation: slideUp 0.25s ease-out;
  `;
  toast.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <span style="font-size:0.9rem;">${message}</span>
      <button class="toast-undo-btn" type="button" style="
        background:var(--primary-color); color:white; border:none; border-radius:var(--radius-md, 8px);
        padding:6px 14px; font-weight:700; font-size:0.85rem; cursor:pointer; white-space:nowrap;
      ">Undo</button>
    </div>
    <div style="margin-top:8px; height:3px; background:rgba(255,255,255,0.2); border-radius:2px; overflow:hidden;">
      <div class="toast-progress-bar" style="height:100%; background:var(--primary-color); border-radius:2px; transition:width 6s linear; width:100%;"></div>
    </div>
  `;

  const undoBtn = toast.querySelector('.toast-undo-btn');
  const progressBar = toast.querySelector('.toast-progress-bar');
  let dismissed = false;

  // Start the countdown animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progressBar.style.width = '0%';
    });
  });

  const timer = setTimeout(() => {
    if (!dismissed) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'opacity 0.25s, transform 0.25s';
      setTimeout(() => toast.remove(), 250);
    }
  }, 6000);

  undoBtn.addEventListener('click', () => {
    dismissed = true;
    clearTimeout(timer);
    toast.remove();
    onUndo();
  });

  container.appendChild(toast);
}

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

  // Wire the Replan button
  const replanBtn = document.getElementById('today-replan-btn');
  if (replanBtn) {
    replanBtn.addEventListener('click', handleReplanRequest);
  }

  // Set interval to update active task highlight
  if (timeIndicatorInterval) clearInterval(timeIndicatorInterval);
  timeIndicatorInterval = setInterval(updateActiveTaskHighlight, 60000); // every minute
}

/**
 * Handles the Replan button click — shows a modal with Quick Cascade and Full Re-Balance options.
 */
async function handleReplanRequest() {
  if (!activePlan || !activePlan.plannedTasks) return;

  const completedCount = activePlan.plannedTasks.filter(t => t.status === 'completed').length;
  const pendingTasks = activePlan.plannedTasks.filter(t => t.status === 'pending');

  if (pendingTasks.length === 0) {
    showToast('All planned tasks are completed or deferred! 🎉', 'info');
    return;
  }

  const modalContent = document.createElement('div');
  modalContent.className = 'replan-dialog-content';
  modalContent.innerHTML = `
    <p style="color: var(--text-muted); margin-bottom: var(--spacing-md);">
      You have <strong>${completedCount}</strong> completed and <strong>${pendingTasks.length}</strong> remaining tasks.
      How would you like to adjust your day?
    </p>
    <div style="display:flex; flex-direction:column; gap:8px;">
      <button id="replan-shift-btn" class="btn btn-primary" style="justify-content:flex-start; text-align:left; padding:12px 16px;">
        <div>
          <div style="font-weight:700;">⚡ Quick Cascade (Shift Remaining)</div>
          <div style="font-size:0.8rem; opacity:0.85;">Align all remaining tasks starting right now</div>
        </div>
      </button>
      <button id="replan-rebalance-btn" class="btn btn-secondary" style="justify-content:flex-start; text-align:left; padding:12px 16px;">
        <div>
          <div style="font-weight:700;">🔄 Full Re-Balance</div>
          <div style="font-size:0.8rem; color:var(--text-muted);">Adjust task allocations and energy profile in Plan view</div>
        </div>
      </button>
      <button id="replan-cancel-btn" class="btn btn-ghost" style="margin-top:4px;">Cancel</button>
    </div>
  `;

  openModal("Adjust Today's Schedule", modalContent);

  document.getElementById('replan-shift-btn')?.addEventListener('click', async () => {
    closeModal();
    await autoCascadeSchedule();
    showToast('Schedule re-aligned to current time! ⚡', 'success');
  });

  document.getElementById('replan-rebalance-btn')?.addEventListener('click', () => {
    closeModal();
    window.location.hash = '#plan';
  });

  document.getElementById('replan-cancel-btn')?.addEventListener('click', closeModal);
}

/**
 * Auto-cascades all pending tasks forward starting from the current time,
 * preserving completed/in-progress tasks and respecting buffer preferences.
 */
async function autoCascadeSchedule() {
  if (!activePlan) return;

  const prefs = await getPreferences();
  const bufferMin = prefs.bufferMinutes || 10;
  const now = new Date();
  let currentMin = now.getHours() * 60 + now.getMinutes();

  // Round up to the next 5-minute boundary
  currentMin = Math.ceil(currentMin / 5) * 5;

  // Sort pending tasks by their original scheduled time
  const pendingTasks = activePlan.plannedTasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

  // Reassign times sequentially from now
  pendingTasks.forEach(task => {
    const h = Math.floor(currentMin / 60) % 24;
    const m = currentMin % 60;
    task.scheduledTime = formatTime(h, m);
    currentMin += (task.estimatedMinutes || 30) + bufferMin;
  });

  await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });
  triggerHaptic(15);
  await renderTodayView();
}

/**
 * Renders the Today timeline view, tasks checklist, and progress summary.
 */
export async function renderTodayView() {
  const container = document.getElementById('timeline-container');
  const progressText = document.getElementById('today-progress-text');
  const ringFill = document.getElementById('today-progress-ring-fill');
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
    if (ringFill) ringFill.style.strokeDashoffset = '113';
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
      if (h >= 12 && h < 17) {
        period = 'afternoon';
      } else if (h >= 17 || h < 5) {
        period = 'evening';
      }

      if (period !== lastPeriod) {
        lastPeriod = period;
        // Compute micro-summary for this period
        const periodTasks = activeSlots.filter(s => {
          const [sh] = s.scheduledTime.split(':').map(Number);
          if (period === 'morning') return sh >= 5 && sh < 12;
          if (period === 'afternoon') return sh >= 12 && sh < 17;
          return sh >= 17 || sh < 5;
        });
        const periodCount = periodTasks.length;
        const periodMinutes = periodTasks.reduce((sum, s) => sum + (s.estimatedMinutes || 0), 0);

        const periodMeta = {
          morning: { title: 'Morning Focus', icon: '🌅', color: '#D97706' },
          afternoon: { title: 'Afternoon Flow', icon: '☀️', color: '#D45D25' },
          evening: { title: 'Evening Wind-down', icon: '🌙', color: '#4F46E5' }
        }[period];

        const periodHeader = document.createElement('div');
        periodHeader.className = `timeline-period-header period-${period}`;
        periodHeader.setAttribute('role', 'separator');
        periodHeader.setAttribute('aria-label', `${periodMeta.title}, ${periodCount} tasks, ${periodMinutes} minutes`);
        periodHeader.innerHTML = `
          <div class="divider-line"></div>
          <span style="border-left: 3px solid ${periodMeta.color};">
            ${periodMeta.icon} ${periodMeta.title}
            <span class="divider-metrics">${periodCount} tasks • ${periodMinutes}m</span>
          </span>
          <div class="divider-line"></div>
        `;
        container.appendChild(periodHeader);
      }

      // 2. Buffer / Rest Gap Demarcation between tasks
      if (lastSlotEndMin !== null && startMin > lastSlotEndMin) {
        const gap = startMin - lastSlotEndMin;
        if (gap >= 5) {
          const bufferDiv = document.createElement('div');
          bufferDiv.className = 'timeline-buffer buffer-slot-card';
          bufferDiv.setAttribute('role', 'region');
          bufferDiv.setAttribute('aria-label', `${gap} minute break buffer`);

          const gapStartH = Math.floor(lastSlotEndMin / 60) % 24;
          const gapStartM = lastSlotEndMin % 60;
          const gapEndH = Math.floor(startMin / 60) % 24;
          const gapEndM = startMin % 60;
          const gapTimeStr = `${formatTime12(gapStartH, gapStartM)} – ${formatTime12(gapEndH, gapEndM)}`;
          
          let blockClass = 'timeline-block-buffer';
          let icon = '🛡️';
          let label = `${gap}m Buffer`;

          if (gap >= 90) {
            // Open Time (Section 6.4)
            blockClass = 'timeline-block-open';
            icon = '🕒';
            const h = Math.floor(gap / 60);
            const m = gap % 60;
            label = `Open Time (${h}h ${m > 0 ? m + 'm' : ''})`;
          } else if (gap >= 25) {
            // Intentional Rest Break (Section 6.4)
            blockClass = 'timeline-block-break';
            const isLunch = gap >= 40 && gapStartH >= 11 && gapStartH <= 14;
            icon = isLunch ? '🥗' : '☕';
            label = isLunch ? 'Lunch & Recharge' : `${gap}m Rest Break`;
          }

          bufferDiv.className = `timeline-buffer ${blockClass}`;
          bufferDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1rem;">${icon}</span>
                <span style="font-weight: 700; font-size: 0.82rem;">${label}</span>
                <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">(${gapTimeStr})</span>
              </div>
              <div style="display: flex; gap: 6px;">
                <button type="button" class="btn btn-ghost btn-quick-task" style="padding: 3px 8px; font-size: 0.72rem; border: 1px solid var(--border-color); background: var(--surface-color); border-radius: var(--radius-sm);" title="Add quick task">
                  + Quick Task
                </button>
                <button type="button" class="btn btn-ghost btn-pull-next" style="padding: 3px 8px; font-size: 0.72rem; border: 1px solid var(--border-color); background: var(--surface-color); border-radius: var(--radius-sm);" title="Pull next task">
                  ⏭️ Pull Next
                </button>
              </div>
            </div>
          `;

          // Wiring Quick Task hook
          bufferDiv.querySelector('.btn-quick-task').addEventListener('click', (e) => {
            e.stopPropagation();
            // Opens the interruption FAB modal as a proxy for "add task"
            const fab = document.getElementById('interruption-fab');
            if (fab) fab.click();
            showToast('Add a quick task for your break', 'info');
          });

          // Wiring Pull Next hook
          bufferDiv.querySelector('.btn-pull-next').addEventListener('click', async (e) => {
            e.stopPropagation();
            // Simple logic: cascade remaining tasks starting from the buffer start time
            // which effectively "pulls" the next task forward.
            // For now, let's just trigger a full re-alignment from current time if they are pulling it.
            // A more robust implementation would recalculate from gapStartMin.
            await autoCascadeSchedule();
            showToast('Schedule pulled forward! ⏭️', 'success');
          });

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
          showCompletionMinutesModal(taskId, slot.estimatedMinutes, slot, taskDetail);
        },
        onSkip: async (taskId) => {
          const prevStatus = slot.status;
          const prevTime = slot.scheduledTime;
          const prevActual = slot.actualMinutes;
          const prevCompleted = slot.completedAt;
          triggerHaptic(10);
          await markTaskStatus(activePlan.id, taskId, 'skipped');
          pushUndoAction({
            taskId,
            description: `"${taskDetail.name}" deferred`,
            previousStatus: prevStatus,
            previousTime: prevTime,
            previousActualMinutes: prevActual,
            previousCompletedAt: prevCompleted
          });
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
        },
        onEditTime: (taskId) => {
          showEditTimeModal(slot, taskDetail);
        }
      };

      const slotElement = renderTimeSlot(slot, taskDetail, callbacks);

      // Check if this task is currently active or overrunning
      const isActive = currentMin >= startMin && currentMin < endMin && slot.status !== 'completed' && slot.status !== 'skipped';
      const isOverrun = currentMin >= endMin && (slot.status === 'in-progress' || (slot.status === 'pending' && currentMin >= startMin && currentMin < startMin + 60));

      if (isActive || isOverrun) {
        slotElement.classList.add('is-active-task');
        if (isOverrun) slotElement.classList.add('is-overrun');
        
        const card = slotElement.querySelector('.timeline-card');
        if (card) {
          card.classList.add('is-active-task');
          if (isOverrun) {
            card.classList.add('is-overrun');
            const overrunMin = currentMin - endMin;
            const overrunBadge = document.createElement('div');
            overrunBadge.className = 'overrun-badge';
            overrunBadge.style.cssText = 'margin-top:6px; padding:3px 8px; background:rgba(217,119,6,0.12); color:var(--accent-color); font-size:0.75rem; font-weight:700; border-radius:var(--radius-sm); display:inline-block;';
            overrunBadge.textContent = `⚠️ +${overrunMin}m overrun`;
            card.appendChild(overrunBadge);
          }

          // Add Now Playing Action Bar
          const actionArr = [];
          if (isOverrun) {
             actionArr.push(`<button type="button" class="now-playing-btn btn-add-time" data-min="15">+15m</button>`);
             actionArr.push(`<button type="button" class="now-playing-btn btn-add-time" data-min="30">+30m</button>`);
          } else {
             actionArr.push(`<button type="button" class="now-playing-btn btn-add-time" data-min="15">+15m</button>`);
          }
          actionArr.push(`<button type="button" class="now-playing-btn btn-defer">⏭️ Defer</button>`);
          actionArr.push(`<button type="button" class="now-playing-btn btn-done" style="background:var(--secondary-color); color:#fff; border:none;">✅ Done</button>`);

          const actionBar = document.createElement('div');
          actionBar.className = 'now-playing-bar';
          actionBar.innerHTML = actionArr.join('');

          actionBar.querySelectorAll('.btn-add-time').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const mins = parseInt(btn.dataset.min, 10);
              slot.estimatedMinutes = (slot.estimatedMinutes || 30) + mins;
              await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });
              showToast(`Added ${mins} minutes ⏱️`, 'info');
              renderTodayView();
            });
          });

          actionBar.querySelector('.btn-defer').addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.onSkip(slot.taskId);
          });

          actionBar.querySelector('.btn-done').addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.onComplete(slot.taskId);
          });

          card.appendChild(actionBar);
        }
      }

      container.appendChild(slotElement);
    });

    // Stagger animate timeline slots
    const slots = container.querySelectorAll('.timeline-slot, .timeline-buffer');
    stagger(slots, (el, delay) => slideUp(el, 15, 300, delay));
  }
  const totalTasks = activeSlots.length;
  const completedSlots = activeSlots.filter(t => t.status === 'completed');
  const completedTasks = completedSlots.length;

  const totalPlannedMinutes = activeSlots.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
  const completedFocusMinutes = completedSlots.reduce((sum, t) => sum + (t.actualMinutes || t.estimatedMinutes || 0), 0);

  const totalWeightedPriority = activeSlots.reduce((sum, t) => sum + ((t.priority || 50) * (t.estimatedMinutes || 30)), 0);
  const completedWeightedPriority = completedSlots.reduce((sum, t) => sum + ((t.priority || 50) * (t.actualMinutes || t.estimatedMinutes || 30)), 0);
  const priorityCoverage = totalWeightedPriority > 0 ? Math.round((completedWeightedPriority / totalWeightedPriority) * 100) : 0;

  const percentage = totalPlannedMinutes > 0 
    ? Math.min(100, Math.round((completedFocusMinutes / totalPlannedMinutes) * 100))
    : 0;

  if (progressText) progressText.textContent = `${percentage}%`;
  
  const flowMinutesEl = document.getElementById('daily-flow-minutes');
  if (flowMinutesEl) flowMinutesEl.textContent = `${completedFocusMinutes}m / ${totalPlannedMinutes}m focus`;
  const flowCoverageEl = document.getElementById('daily-flow-coverage');
  if (flowCoverageEl) flowCoverageEl.textContent = `Priority: ${priorityCoverage}%`;

  if (ringFill) {
    const circumference = 125.6;
    const offset = circumference - (circumference * percentage) / 100;
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

  if (progressCount) progressCount.textContent = `${completedTasks}/${totalTasks} done`;

  // Render Section 6.3 NOW Card
  renderNowCard(activeSlots, taskMap, currentMin);

  // Trigger fullscreen confetti if all done!
  if (totalTasks > 0 && completedTasks === totalTasks) {
    triggerConfettiCelebration();
  }

  // 6.3.3 Check for Schedule Slippage
  checkScheduleSlippage();
}

/**
 * Renders the Section 6.3 NOW Card into #today-now-card-container.
 */
function renderNowCard(activeSlots, taskMap, currentMin) {
  const container = document.getElementById('today-now-card-container');
  if (!container) return;

  if (!activeSlots || activeSlots.length === 0) {
    container.innerHTML = '';
    return;
  }

  // 1. Check for a task currently within its active time window
  let nowSlot = activeSlots.find(s => {
    const [h, m] = s.scheduledTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (s.estimatedMinutes || 30);
    return currentMin >= start && currentMin < end && s.status !== 'completed' && s.status !== 'skipped';
  });

  // 2. If no task currently inside its window, find an in-progress task
  if (!nowSlot) {
    nowSlot = activeSlots.find(s => s.status === 'in-progress');
  }

  // 3. Fallback: find the next upcoming pending task
  let isUpcoming = false;
  if (!nowSlot) {
    nowSlot = activeSlots.find(s => s.status === 'pending');
    if (nowSlot) isUpcoming = true;
  }

  // 4. If all tasks are completed / skipped:
  if (!nowSlot) {
    const allCompleted = activeSlots.every(s => s.status === 'completed' || s.status === 'skipped');
    if (allCompleted) {
      container.innerHTML = `
        <div class="now-card" style="border-color: var(--secondary-color); background: rgba(94, 149, 96, 0.08);">
          <div class="now-header">
            <span class="now-tag" style="background: var(--secondary-color);">🎉 DAY WRAP-UP</span>
          </div>
          <div class="now-title">All tasks completed!</div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 4px 0 0 0;">
            Great execution today. Time to relax and recharge.
          </p>
        </div>
      `;
    } else {
      container.innerHTML = '';
    }
    return;
  }

  const [h, m] = nowSlot.scheduledTime.split(':').map(Number);
  const startMin = h * 60 + m;
  const duration = nowSlot.estimatedMinutes || 30;
  const endMin = startMin + duration;
  const endH = Math.floor(endMin / 60) % 24;
  const endM = endMin % 60;
  const timeRangeStr = `${formatTime12(h, m)} – ${formatTime12(endH, endM)}`;

  const taskDetail = taskMap.get(nowSlot.taskId) || {
    name: nowSlot.name || nowSlot.title || 'Focus Task',
    title: nowSlot.name || nowSlot.title || 'Focus Task',
    bucket: nowSlot.bucket || 'work'
  };
  const taskTitle = taskDetail.title || taskDetail.name || 'Focus Task';

  const remainingMin = Math.max(0, endMin - currentMin);
  const elapsedMin = Math.max(0, currentMin - startMin);
  const progressPct = isUpcoming ? 0 : Math.min(100, Math.max(5, Math.round((elapsedMin / duration) * 100)));

  const tagHtml = isUpcoming
    ? `<span class="now-tag" style="background: var(--text-muted);">UPCOMING NEXT</span>`
    : `<span class="now-tag"><span class="now-pulse-dot"></span> NOW</span>`;

  const remainingText = isUpcoming
    ? `Starts in ${Math.max(0, startMin - currentMin)}m (${duration}m planned)`
    : `${remainingMin}m remaining`;

  container.innerHTML = `
    <div class="now-card">
      <div class="now-header">
        ${tagHtml}
        <span class="now-time-range">${timeRangeStr}</span>
      </div>
      <div class="now-title">${taskTitle}</div>
      <div class="now-progress-track">
        <div class="now-progress-fill" style="width: ${progressPct}%;"></div>
      </div>
      <div class="now-meta-row">
        <span>${remainingText}</span>
        <span style="text-transform: capitalize;">${nowSlot.status}</span>
      </div>
      <div class="now-actions">
        ${isUpcoming ? `
          <button type="button" class="now-btn now-btn-primary btn-now-start">
            ⚡ Start Now
          </button>
        ` : `
          <button type="button" class="now-btn now-btn-primary btn-now-done">
            ✅ Complete
          </button>
          <button type="button" class="now-btn now-btn-secondary btn-now-plus15">
            +15m
          </button>
          <button type="button" class="now-btn now-btn-secondary btn-now-skip">
            ⏭️ Skip
          </button>
        `}
      </div>
    </div>
  `;

  // Wire buttons
  const startBtn = container.querySelector('.btn-now-start');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      triggerHaptic(10);
      await markTaskStatus(activePlan.id, nowSlot.taskId, 'in-progress');
      showToast('Focus session started! ⚡', 'info');
      renderTodayView();
    });
  }

  const doneBtn = container.querySelector('.btn-now-done');
  if (doneBtn) {
    doneBtn.addEventListener('click', () => {
      showCompletionMinutesModal(nowSlot.taskId, nowSlot.estimatedMinutes, nowSlot, taskDetail);
    });
  }

  const plus15Btn = container.querySelector('.btn-now-plus15');
  if (plus15Btn) {
    plus15Btn.addEventListener('click', async () => {
      nowSlot.estimatedMinutes = (nowSlot.estimatedMinutes || 30) + 15;
      await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });
      showToast('Added 15 minutes ⏱️', 'info');
      renderTodayView();
    });
  }

  const skipBtn = container.querySelector('.btn-now-skip');
  if (skipBtn) {
    skipBtn.addEventListener('click', async () => {
      await markTaskStatus(activePlan.id, nowSlot.taskId, 'skipped');
      showToast('Task skipped', 'info');
      renderTodayView();
    });
  }
}

/**
 * Dynamically determines and updates the currently active task card highlight in today's timeline.
 */
export function updateActiveTaskHighlight() {
  if (!activePlan) return;
  // Trigger a full re-render so that dynamic elements like the
  // Now Playing bar and overrun badges are correctly added/removed
  // as the system time crosses task boundaries.
  renderTodayView();
}

/**
 * Prompts user for actual minutes took to complete the task.
 */
function showCompletionMinutesModal(taskId, estimatedMinutes, slotEntry, taskDetail) {
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

    // Capture previous state for undo
    const prevStatus = slotEntry ? slotEntry.status : 'pending';
    const prevTime = slotEntry ? slotEntry.scheduledTime : null;
    const prevActual = slotEntry ? slotEntry.actualMinutes : null;
    const prevCompleted = slotEntry ? slotEntry.completedAt : null;
    const taskName = taskDetail ? taskDetail.name : 'Task';

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
    pushUndoAction({
      taskId,
      description: `"${taskName}" completed`,
      previousStatus: prevStatus,
      previousTime: prevTime,
      previousActualMinutes: prevActual,
      previousCompletedAt: prevCompleted
    });
    renderTodayView();
  });
}

/**
 * Modal to adjust scheduled start time and duration directly from today's timeline.
 */
async function showEditTimeModal(slot, taskDetail) {
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="margin-bottom: var(--spacing-md);">
      <h4 style="margin-bottom: 4px; font-weight: 800; font-size: 1.05rem;">${taskDetail.name}</h4>
      <p style="font-size: 0.85rem; color: var(--text-muted);">Adjust start time or duration for today's schedule.</p>
    </div>

    <div class="form-group">
      <label class="form-label" for="edit-slot-time">Start Time</label>
      <input type="time" id="edit-slot-time" class="input" value="${slot.scheduledTime}" required style="font-size: 1.1rem; padding: var(--spacing-sm) var(--spacing-md); font-weight: 700;">
    </div>

    <div class="form-group">
      <label class="form-label" for="edit-slot-duration">Duration (minutes)</label>
      <input type="number" id="edit-slot-duration" class="input" min="5" max="480" step="5" value="${slot.estimatedMinutes}" required style="font-size: 1rem; padding: var(--spacing-sm) var(--spacing-md); font-weight: 700;">
    </div>

    <div class="form-group">
      <label class="form-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="edit-slot-shift-subsequent" checked style="width: 18px; height: 18px;">
        <span style="font-size: 0.9rem; font-weight: 600;">Shift subsequent tasks forward if time moved back</span>
      </label>
    </div>

    <div style="display: flex; gap: var(--spacing-md); margin-top: var(--spacing-xl);">
      <button id="edit-slot-cancel-btn" class="btn btn-secondary" style="flex: 1;">Cancel</button>
      <button id="edit-slot-save-btn" class="btn btn-primary" style="flex: 1;">Save Changes</button>
    </div>
  `;

  openModal('Adjust Timing ⏰', content);

  document.getElementById('edit-slot-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('edit-slot-save-btn').addEventListener('click', async () => {
    const newTime = document.getElementById('edit-slot-time').value;
    const newDur = parseInt(document.getElementById('edit-slot-duration').value, 10) || slot.estimatedMinutes;
    const shiftOthers = document.getElementById('edit-slot-shift-subsequent').checked;

    if (!newTime) {
      showToast('Please select a valid time', 'warning');
      return;
    }

    const oldTime = slot.scheduledTime;
    slot.scheduledTime = newTime;
    slot.estimatedMinutes = newDur;

    if (shiftOthers) {
      const [oldH, oldM] = oldTime.split(':').map(Number);
      const [newH, newM] = newTime.split(':').map(Number);
      const oldMinVal = oldH * 60 + oldM;
      const newMinVal = newH * 60 + newM;
      const shift = newMinVal - oldMinVal;

      if (shift > 0) {
        activePlan = rescheduleRemaining(activePlan, oldTime, shift, slot.taskId);
      }
    }

    // Sort chronologically
    activePlan.plannedTasks.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });

    closeModal();
    showToast('Task timing updated ⏱️', 'success');
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
    <form id="interruption-form" novalidate style="display:flex; flex-direction:column; gap:var(--spacing-lg);">
      <div class="form-group">
        <label for="inter-name" class="form-label">What needs your attention?</label>
        <input 
          type="text" 
          id="inter-name" 
          class="input input-lg" 
          placeholder="e.g., Emergency server outage" 
          required 
          autocomplete="off"
          style="width: 100%; box-sizing: border-box;"
        >
      </div>

      <div class="form-row-dual" style="display:flex; gap:var(--spacing-md);">
        <div class="form-group" style="flex: 1;">
          <label for="inter-bucket" class="form-label">Category</label>
          <select id="inter-bucket" class="select select-lg" required style="width: 100%;">
            ${bucketOptions}
          </select>
        </div>

        <div class="form-group" style="flex: 1;">
          <label class="form-label">Duration</label>
          <div class="segmented-control" role="radiogroup" style="display:flex; gap:4px; margin-top:4px;">
            <button type="button" class="segment-btn" data-val="15" style="flex:1; padding:8px 0; border:1px solid var(--border-color); background:var(--surface-color); border-radius:var(--radius-sm); font-size:0.8rem; font-weight:700;">15m</button>
            <button type="button" class="segment-btn active" data-val="30" style="flex:1; padding:8px 0; border:1px solid var(--primary-color); background:var(--primary-light); color:var(--primary-color); border-radius:var(--radius-sm); font-size:0.8rem; font-weight:700;">30m</button>
            <button type="button" class="segment-btn" data-val="45" style="flex:1; padding:8px 0; border:1px solid var(--border-color); background:var(--surface-color); border-radius:var(--radius-sm); font-size:0.8rem; font-weight:700;">45m</button>
          </div>
          <input type="hidden" id="inter-duration" value="30">
        </div>
      </div>

      <div class="form-toggle-row" style="margin-top:var(--spacing-xs); padding:12px; background:rgba(0,0,0,0.02); border-radius:var(--radius-md);">
        <label class="toggle-container" for="inter-auto-rebalance" style="display:flex; align-items:center; gap:12px; cursor:pointer;">
          <input type="checkbox" id="inter-auto-rebalance" checked style="width:20px; height:20px; accent-color:var(--primary-color);">
          <span class="toggle-label" style="display:flex; flex-direction:column;">
            <strong style="font-size:0.9rem;">Auto-shift remaining tasks</strong>
            <small style="font-size:0.75rem; color:var(--text-muted);">Pushes downstream tasks forward safely</small>
          </span>
        </label>
      </div>

      <button id="inter-submit-btn" class="btn btn-primary" type="submit" style="padding:14px; font-size:1rem; width:100%; margin-top:8px;">
        Add & Update Schedule ⚡
      </button>
    </form>
  `;

  openModal('Something Came Up ⚡', content);

  const form = content.querySelector('#interruption-form');
  const durationInput = form.querySelector('#inter-duration');
  
  // Segmented control logic
  const segmentBtns = form.querySelectorAll('.segment-btn');
  segmentBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      segmentBtns.forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = 'var(--border-color)';
        b.style.backgroundColor = 'var(--surface-color)';
        b.style.color = 'inherit';
      });
      btn.classList.add('active');
      btn.style.borderColor = 'var(--primary-color)';
      btn.style.backgroundColor = 'var(--primary-light)';
      btn.style.color = 'var(--primary-color)';
      durationInput.value = btn.dataset.val;
    });
  });

  // Submit Logic
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const taskName = form.querySelector('#inter-name').value.trim();
    if (!taskName) {
      showToast('Please specify what occurred', 'warning');
      return;
    }

    const bucketSelect = form.querySelector('#inter-bucket');
    const selectedBucket = bucketSelect ? bucketSelect.value : (prefs.buckets[0]?.id || 'home');
    const duration = parseInt(durationInput.value, 10);
    const autoRebalance = form.querySelector('#inter-auto-rebalance').checked;

    const now = new Date();
    const insertTime = formatTime(now.getHours(), now.getMinutes());
    const tempTaskId = `task_temp_${Date.now()}`;

    // 1. Instant Modal Dismissal
    closeModal();

    // 2. Optimistic In-Memory State Update
    const unplannedEntry = {
      taskId: tempTaskId,
      name: taskName + ' ⚡',
      bucket: selectedBucket,
      estimatedMinutes: duration,
      scheduledTime: insertTime,
      status: 'in-progress', // assumes you're starting it right now
      completedAt: null,
      actualMinutes: null,
      isUnplanned: true
    };

    activePlan = addUnplannedTask(activePlan, unplannedEntry, insertTime);

    if (autoRebalance) {
      activePlan = rescheduleRemaining(activePlan, insertTime, duration, tempTaskId);
    }

    // 3. Instant UI Re-render (Sub-16ms)
    await renderTodayView();
    showToast('Interruption logged! Schedule updated ⚡', 'success');

    // 4. Background IndexedDB Persistence
    try {
      const realTaskId = await createTask({
        name: taskName,
        bucket: selectedBucket,
        priority: 3,
        estimatedMinutes: duration,
        energyLevel: 'medium',
        preferredTime: 'anytime'
      });

      // Swap temporary ID with real IndexedDB ID
      activePlan.plannedTasks = activePlan.plannedTasks.map(t => 
        t.taskId === tempTaskId ? { ...t, taskId: realTaskId } : t
      );

      await updatePlan(activePlan.id, { plannedTasks: activePlan.plannedTasks });
    } catch (err) {
      console.error('Background persistence failed:', err);
      showToast('Failed to save to database', 'error');
    }
  });

  // Autofocus the input field
  setTimeout(() => {
    const input = document.getElementById('inter-name');
    if (input) input.focus();
  }, 300);
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

/**
 * Checks if the schedule is slipping behind current time by >= 15m
 */
function checkScheduleSlippage() {
  if (!activePlan || !activePlan.plannedTasks) return;

  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  // Find the earliest incomplete task whose scheduled end time has passed
  const overdueTasks = activePlan.plannedTasks.filter(t => {
    if (t.status === 'completed' || t.status === 'skipped') return false;
    const [h, m] = t.scheduledTime.split(':').map(Number);
    const endMin = h * 60 + m + t.estimatedMinutes;
    return currentMin > endMin;
  });

  if (overdueTasks.length === 0) {
    hideSlippageBanner();
    return;
  }

  const latestOverrun = overdueTasks[overdueTasks.length - 1];
  const [h, m] = latestOverrun.scheduledTime.split(':').map(Number);
  const scheduledEnd = h * 60 + m + latestOverrun.estimatedMinutes;
  const slippageMinutes = currentMin - scheduledEnd;

  if (slippageMinutes >= 15) {
    showSlippageBanner(slippageMinutes);
  } else {
    hideSlippageBanner();
  }
}

function showSlippageBanner(minutes) {
  let banner = document.getElementById('slippage-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'slippage-banner';
    banner.style.cssText = 'background:var(--accent-color); color:#fff; padding:12px 16px; border-radius:var(--radius-md); margin-bottom:var(--spacing-lg); display:flex; align-items:center; justify-content:space-between; gap:12px; box-shadow:var(--shadow-md); animation:slideDown 0.3s ease-out;';
    
    // Insert at top of today view right after header
    const todayHeader = document.querySelector('#today-view header');
    if (todayHeader && todayHeader.parentNode) {
      todayHeader.parentNode.insertBefore(banner, todayHeader.nextSibling);
    }
  }

  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span>⚡</span>
      <span style="font-size:0.85rem; font-weight:500;">Behind schedule by <strong>${minutes}m</strong></span>
    </div>
    <div style="display:flex; gap:8px;">
      <button id="banner-realign-btn" class="btn btn-sm" style="background:rgba(255,255,255,0.2); color:#fff; border:none; padding:4px 8px; font-size:0.75rem; border-radius:var(--radius-sm); cursor:pointer;">Auto-Align</button>
      <button id="banner-dismiss-btn" class="btn btn-sm btn-ghost" style="color:#fff; padding:4px; margin-left:4px; border:none; background:transparent; cursor:pointer;" aria-label="Dismiss">✕</button>
    </div>
  `;

  document.getElementById('banner-realign-btn').addEventListener('click', async () => {
    await autoCascadeSchedule();
    hideSlippageBanner();
    showToast('Schedule re-aligned! ⚡', 'success');
  });

  document.getElementById('banner-dismiss-btn').addEventListener('click', () => {
    banner.style.display = 'none';
  });
}

function hideSlippageBanner() {
  const banner = document.getElementById('slippage-banner');
  if (banner) {
    banner.remove();
  }
}
