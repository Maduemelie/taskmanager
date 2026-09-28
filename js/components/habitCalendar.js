/* js/components/habitCalendar.js */
import { today, formatDateLocal } from '../utils/date.js';
import { openModal, closeModal } from './modal.js';
import { triggerHaptic } from '../utils/haptics.js';

/**
 * Renders a 30-day history calendar for a given habit task.
 * @param {Object} task The task object
 * @param {string} planId The active plan ID
 * @param {Function} onComplete Callback for when the user marks it done from the modal
 */
export function showHabitCalendarModal(task, planId, onComplete) {
  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = 'var(--spacing-md)';

  // Header / Streak info
  const header = document.createElement('div');
  header.innerHTML = `<p style="color: var(--text-muted); margin-bottom: var(--spacing-sm); font-size: 0.95rem;">Consistency is key. Here is your recent activity for <strong>${task.name}</strong>.</p>`;
  
  if (task.currentStreak > 0) {
    header.innerHTML += `<div style="display:inline-block; background:var(--secondary-light); color:var(--secondary-color); padding: 4px 10px; border-radius:var(--radius-sm); font-weight:bold; font-size: 0.9rem;">🔥 ${task.currentStreak} Day Streak!</div>`;
  }
  content.appendChild(header);

  // Calendar Grid
  const gridContainer = document.createElement('div');
  gridContainer.style.display = 'grid';
  gridContainer.style.gridTemplateColumns = 'repeat(7, 1fr)';
  gridContainer.style.gap = '6px';
  gridContainer.style.marginTop = 'var(--spacing-md)';

  // Determine the past 28-30 days to fit nicely in a grid
  const historySet = new Set((task.completionHistory || []).map(h => h.date));
  const todayStr = today();
  
  // Use task.createdAt if available, otherwise just use today
  const createdDate = task.createdAt ? task.createdAt.split('T')[0] : todayStr;

  // We will loop from (today - 27 days) up to today to create a 4-week grid
  const daysToLookBack = 27; 
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysToLookBack);

  // Weekday Headers (M, T, W, T, F, S, S)
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const startDayIdx = startDate.getDay(); // 0 is Sunday
  for (let i = 0; i < 7; i++) {
    const lbl = document.createElement('div');
    lbl.style.textAlign = 'center';
    lbl.style.fontSize = '0.7rem';
    lbl.style.fontWeight = 'bold';
    lbl.style.color = 'var(--text-light)';
    lbl.textContent = weekdays[(startDayIdx + i) % 7];
    gridContainer.appendChild(lbl);
  }

  // Day Squares
  for (let i = 0; i <= daysToLookBack; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = formatDateLocal(d);

    const daySquare = document.createElement('div');
    daySquare.style.aspectRatio = '1 / 1';
    daySquare.style.borderRadius = 'var(--radius-sm)';
    daySquare.style.display = 'flex';
    daySquare.style.alignItems = 'center';
    daySquare.style.justifyContent = 'center';
    daySquare.style.fontSize = '0.75rem';
    daySquare.style.fontWeight = 'bold';
    daySquare.style.transition = 'all var(--transition-fast)';
    
    daySquare.textContent = d.getDate();

    if (historySet.has(dateStr)) {
      // Completed (Green)
      daySquare.style.backgroundColor = 'var(--secondary-color)';
      daySquare.style.color = '#fff';
      daySquare.style.boxShadow = '0 2px 4px rgba(91, 140, 90, 0.3)';
    } else if (dateStr > todayStr) {
      // Future
      daySquare.style.backgroundColor = 'transparent';
      daySquare.style.color = 'transparent';
    } else if (dateStr >= createdDate && dateStr < todayStr) {
      // Missed (Light Red/Orange)
      daySquare.style.backgroundColor = '#FFEBEE';
      daySquare.style.color = '#D32F2F';
    } else if (dateStr === todayStr && !historySet.has(dateStr)) {
      // Today (Not done yet)
      daySquare.style.backgroundColor = 'var(--bg-primary)';
      daySquare.style.border = '2px dashed var(--text-muted)';
      daySquare.style.color = 'var(--text-muted)';
    } else {
      // Before task was created
      daySquare.style.backgroundColor = 'var(--bg-secondary)';
      daySquare.style.color = 'var(--text-light)';
    }

    gridContainer.appendChild(daySquare);
  }

  content.appendChild(gridContainer);
  
  // Quick Actions
  if (!historySet.has(todayStr)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.style.width = '100%';
    btn.style.marginTop = 'var(--spacing-xl)';
    btn.style.fontSize = '1.05rem';
    btn.innerHTML = '✅ Mark Done for Today';
    btn.onclick = () => {
      triggerHaptic(20);
      btn.innerHTML = 'Tracking...';
      btn.disabled = true;
      if (onComplete) {
        onComplete();
        setTimeout(() => closeModal(), 600);
      }
    };
    content.appendChild(btn);
  } else {
    const msg = document.createElement('p');
    msg.style.textAlign = 'center';
    msg.style.marginTop = 'var(--spacing-xl)';
    msg.style.color = 'var(--secondary-color)';
    msg.style.fontWeight = '800';
    msg.style.fontSize = '1.1rem';
    msg.innerHTML = '✨ You nailed it today!';
    content.appendChild(msg);
  }

  openModal(`Track It: ${task.name}`, content);
}
