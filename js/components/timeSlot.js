/* js/components/timeSlot.js */
import { renderTaskCard } from './taskCard.js';
import { formatTime12 } from '../utils/date.js';

/**
 * Renders a scheduled time slot in today's timeline.
 * Wraps a pointer-interactive task card with time labels, status badges, and progress lines.
 * 
 * @param {Object} slotEntry The scheduled task entry in the DailyPlan:
 *   { taskId, scheduledTime, estimatedMinutes, status, isUnplanned }
 * @param {Object} task The master task definition details
 * @param {Object} callbacks Callbacks for interactions:
 *   - onStart(taskId)
 *   - onComplete(taskId)
 *   - onSkip(taskId)
 *   - onEdit(taskId)
 * @returns {HTMLElement} The timeline slot DOM element
 */
export function renderTimeSlot(slotEntry, task, callbacks = {}) {
  const slot = document.createElement('div');
  slot.className = `timeline-slot ${slotEntry.status}`;
  slot.dataset.taskId = slotEntry.taskId;
  slot.style.position = 'relative';

  // Calculate End Time
  const [h, m] = slotEntry.scheduledTime.split(':').map(Number);
  const totalMin = h * 60 + m + slotEntry.estimatedMinutes;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  const startTime12 = formatTime12(slotEntry.scheduledTime);
  const endTime12 = formatTime12(endTimeStr);

  // Time display — upgraded to accessible 44x44px touch target
  const timeDisplay = document.createElement('button');
  timeDisplay.type = 'button';
  timeDisplay.className = 'timeline-time time-slot-time-trigger';
  timeDisplay.title = 'Tap to adjust start time or duration';
  timeDisplay.setAttribute('aria-label', `Edit time for ${task.name}. Scheduled from ${startTime12} to ${endTime12}`);
  timeDisplay.innerHTML = `
    <span class="time-start" style="font-weight: 800; display: block; font-size: 0.78rem; line-height: 1.15; color: var(--text-color);">${startTime12}</span>
    <span class="time-end" style="font-size: 0.65rem; color: var(--text-muted); font-weight: 600; display: block; margin-top: 2px;">to ${endTime12}</span>
    <span class="time-edit-hint" style="font-size: 0.65rem; color: var(--primary-color); display: block; margin-top: 2px; font-weight: 700;">✏️ edit</span>
  `;
  timeDisplay.addEventListener('click', (e) => {
    e.stopPropagation();
    if (callbacks.onEditTime) callbacks.onEditTime(slotEntry.taskId);
  });
  slot.appendChild(timeDisplay);

  // Timeline vertical indicator dot
  const dot = document.createElement('div');
  dot.className = 'timeline-dot';
  slot.appendChild(dot);

  // Status Badge mapping
  let statusEmoji = '⏳';
  let statusLabel = 'Upcoming';
  if (slotEntry.status === 'in-progress') {
    statusEmoji = '▶️';
    statusLabel = 'In Progress';
  } else if (slotEntry.status === 'completed') {
    statusEmoji = '✅';
    statusLabel = 'Completed';
  } else if (slotEntry.status === 'skipped') {
    statusEmoji = '⏭️';
    statusLabel = 'Skipped';
  } else if (slotEntry.status === 'rescheduled') {
    statusEmoji = '🔄';
    statusLabel = 'Deferred';
  }

  // Create Task Card callbacks wrapper
  const cardCallbacks = {
    onComplete: (id) => {
      if (callbacks.onComplete) callbacks.onComplete(id);
    },
    onSkip: (id) => {
      if (callbacks.onSkip) callbacks.onSkip(id);
    },
    onTap: (id) => {
      // Tap starts pending task, completes in-progress task
      if (slotEntry.status === 'pending') {
        if (callbacks.onStart) callbacks.onStart(id);
      } else if (slotEntry.status === 'in-progress') {
        if (callbacks.onComplete) callbacks.onComplete(id);
      } else {
        if (callbacks.onEdit) callbacks.onEdit(id);
      }
    }
  };

  // Render the task card
  const cardContainer = renderTaskCard(task, 'today', cardCallbacks);
  const card = cardContainer.querySelector('.card');
  card.classList.add('timeline-card');

  // Add flexbox header row with status and badges instead of float:right
  const headerContainer = card.querySelector('.timeline-card-content');

  // Create a flex header wrapper for title + status badges
  const cardHeaderFlex = document.createElement('div');
  cardHeaderFlex.className = 'card-header-flex';
  cardHeaderFlex.style.cssText = 'display:flex; align-items:flex-start; justify-content:space-between; gap:8px;';

  // Move the title into the flex header
  const titleEl = headerContainer.querySelector('.task-card-title');
  if (titleEl) {
    cardHeaderFlex.appendChild(titleEl);
  }

  // Badge container
  const badgeContainer = document.createElement('div');
  badgeContainer.className = 'card-header-badges';
  badgeContainer.style.cssText = 'display:flex; gap:4px; flex-shrink:0; align-items:center;';

  // Unplanned badge
  if (slotEntry.isUnplanned) {
    const waveBadge = document.createElement('span');
    waveBadge.className = 'chip chip-unplanned';
    waveBadge.style.cssText = 'font-size:0.7rem; padding:1px 6px; background-color:var(--primary-light); color:var(--primary-color); border:1px solid var(--primary-color);';
    waveBadge.textContent = '⚡ Unplanned';
    badgeContainer.appendChild(waveBadge);
  }

  // Status chip
  const statusChip = document.createElement('span');
  statusChip.className = `chip status-chip-${slotEntry.status}`;
  statusChip.style.cssText = `font-size:0.7rem; padding:1px 6px; background-color:${getStatusColor(slotEntry.status)}; color:#FFF;`;
  statusChip.textContent = `${statusEmoji} ${statusLabel}`;
  badgeContainer.appendChild(statusChip);

  cardHeaderFlex.appendChild(badgeContainer);
  headerContainer.prepend(cardHeaderFlex);

  // Add progress bar underneath card contents if "in-progress"
  if (slotEntry.status === 'in-progress') {
    const progContainer = document.createElement('div');
    progContainer.className = 'progress-bar-container';
    progContainer.style.marginTop = 'var(--spacing-md)';
    
    const progFill = document.createElement('div');
    progFill.className = 'progress-bar-fill';
    progFill.style.width = '100%';
    progFill.style.animation = 'pulseFill 2s infinite ease-in-out';
    progContainer.appendChild(progFill);
    card.appendChild(progContainer);

    // Style helper for pulsing fill animation
    if (!document.getElementById('pulse-fill-style')) {
      const style = document.createElement('style');
      style.id = 'pulse-fill-style';
      style.textContent = `
        @keyframes pulseFill {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  slot.appendChild(cardContainer);
  return slot;
}

function getStatusColor(status) {
  switch (status) {
    case 'in-progress': return 'var(--primary-color)';
    case 'completed': return 'var(--secondary-color)';
    case 'skipped': return 'var(--text-muted)';
    case 'rescheduled': return 'var(--accent-color)';
    default: return 'var(--text-light)';
  }
}
