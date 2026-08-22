/* js/components/taskCard.js */

/**
 * Creates and renders a task card DOM element.
 * Supports three modes: 'bucket', 'plan', and 'today'.
 * 
 * @param {Object} task Task data definition
 * @param {string} mode 'bucket' | 'plan' | 'today'
 * @param {Object} [callbacks] Callbacks triggered by events:
 *   - onComplete(taskId)
 *   - onSkip(taskId)
 *   - onTap(taskId)
 *   - onToggleCheck(taskId, isChecked)
 * @returns {HTMLElement} The card DOM node
 */
export function renderTaskCard(task, mode, callbacks = {}) {
  const cardContainer = document.createElement('div');
  cardContainer.className = 'task-card-container';
  cardContainer.style.position = 'relative';
  cardContainer.style.overflow = 'hidden';
  cardContainer.style.borderRadius = 'var(--radius-lg)';
  cardContainer.style.width = '100%';

  // Swipe Action Backgrounds
  const actionBg = document.createElement('div');
  actionBg.className = 'task-card-action-bg';
  actionBg.style.position = 'absolute';
  actionBg.style.top = '0';
  actionBg.style.left = '0';
  actionBg.style.right = '0';
  actionBg.style.bottom = '0';
  actionBg.style.display = 'flex';
  actionBg.style.alignItems = 'center';
  actionBg.style.justifyContent = 'space-between';
  actionBg.style.padding = '0 var(--spacing-xl)';
  actionBg.style.borderRadius = 'var(--radius-lg)';
  actionBg.style.color = '#FFF';
  actionBg.style.fontWeight = 'bold';
  actionBg.style.fontSize = '1.1rem';
  actionBg.style.transition = 'background-color var(--transition-fast)';
  actionBg.innerHTML = '<span class="action-left">✅ Done</span><span class="action-right">⏭️ Skip</span>';
  cardContainer.appendChild(actionBg);

  // The actual sliding card
  const card = document.createElement('div');
  card.className = `card task-card mode-${mode}`;
  card.style.position = 'relative';
  card.style.zIndex = '2';
  card.style.display = 'flex';
  card.style.alignItems = 'center';
  card.style.gap = 'var(--spacing-md)';
  card.style.cursor = 'pointer';
  card.style.touchAction = 'pan-y'; // Allow vertical scrolling, capture horizontal swipes
  cardContainer.appendChild(card);

  // Checkbox for plan mode
  if (mode === 'plan') {
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'suggestion-checkbox-container';
    
    const isChecked = callbacks.initialChecked !== false;
    const checkbox = document.createElement('div');
    checkbox.className = `custom-checkbox ${isChecked ? 'checked' : ''}`;
    checkbox.innerHTML = isChecked ? '✓' : '';
    
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      const checkState = !checkbox.classList.contains('checked');
      checkbox.classList.toggle('checked', checkState);
      checkbox.innerHTML = checkState ? '✓' : '';
      if (callbacks.onToggleCheck) {
        callbacks.onToggleCheck(task.id, checkState);
      }
    });
    
    checkboxWrapper.appendChild(checkbox);
    card.appendChild(checkboxWrapper);
  }

  // Card Content Info
  const cardContent = document.createElement('div');
  cardContent.className = 'timeline-card-content';
  cardContent.style.flex = '1';
  
  // Title / Name
  const title = document.createElement('h4');
  title.style.margin = '0 0 var(--spacing-xs) 0';
  title.style.fontSize = '1.05rem';
  title.textContent = task.name;
  cardContent.appendChild(title);

  // Footer Metadata row
  const metaRow = document.createElement('div');
  metaRow.style.display = 'flex';
  metaRow.style.flexWrap = 'wrap';
  metaRow.style.gap = 'var(--spacing-sm)';
  metaRow.style.alignItems = 'center';
  metaRow.style.fontSize = '0.8rem';
  metaRow.style.color = 'var(--text-muted)';

  // Priority Dots
  const pDots = document.createElement('span');
  pDots.style.fontWeight = 'bold';
  pDots.style.color = task.priority >= 4 ? 'var(--primary-color)' : 'var(--text-muted)';
  pDots.textContent = '•'.repeat(task.priority || 3);
  metaRow.appendChild(pDots);

  // Estimated duration
  const duration = document.createElement('span');
  duration.className = 'chip';
  duration.style.padding = '2px 8px';
  duration.innerHTML = `⏱️ ${task.estimatedMinutes}m`;
  metaRow.appendChild(duration);

  // Energy required
  const energy = document.createElement('span');
  energy.className = 'chip';
  energy.style.padding = '2px 8px';
  const batteryEmoji = task.energyLevel === 'high' ? '🚀' : task.energyLevel === 'medium' ? '⚡' : '🔋';
  energy.innerHTML = `${batteryEmoji} ${task.energyLevel}`;
  metaRow.appendChild(energy);

  // Streaks badge
  if (task.currentStreak && task.currentStreak >= 3) {
    const streak = document.createElement('span');
    streak.className = 'badge';
    streak.innerHTML = `🔥 ${task.currentStreak}`;
    metaRow.appendChild(streak);
  }

  // Recurrence label
  if (mode === 'bucket' && task.recurrence) {
    const rec = document.createElement('span');
    rec.className = 'chip';
    rec.style.backgroundColor = 'var(--accent-light)';
    rec.style.color = 'var(--accent-color)';
    rec.innerHTML = `🔁 ${task.recurrence.type}`;
    metaRow.appendChild(rec);
  }

  cardContent.appendChild(metaRow);
  card.appendChild(cardContent);

  // Tap action -> edit task (bucket mode) or start task (today mode)
  card.addEventListener('click', (e) => {
    if (e.target.closest('.suggestion-checkbox-container')) return;
    if (callbacks.onTap) callbacks.onTap(task.id);
  });

  // Swipe Gestures handling (pointer events)
  if (mode === 'today') {
    let startX = 0;
    let diffX = 0;
    let isDragging = false;

    card.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      card.setPointerCapture(e.pointerId);
      isDragging = true;
      card.style.transition = 'none';
      actionBg.style.backgroundColor = '#8E8E8E'; // Neutral grey start
    });

    card.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      diffX = e.clientX - startX;
      
      // Perform translation
      card.style.transform = `translateX(${diffX}px)`;

      // Color action backgrounds depending on direction
      if (diffX > 0) {
        // Swipe Right to Complete (Green)
        actionBg.style.backgroundColor = 'var(--secondary-color)';
        actionBg.querySelector('.action-left').style.opacity = Math.min(1, diffX / 100);
        actionBg.querySelector('.action-right').style.opacity = '0';
      } else {
        // Swipe Left to Defer/Skip (Orange/Red)
        actionBg.style.backgroundColor = 'var(--primary-color)';
        actionBg.querySelector('.action-left').style.opacity = '0';
        actionBg.querySelector('.action-right').style.opacity = Math.min(1, Math.abs(diffX) / 100);
      }
    });

    card.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      card.releasePointerCapture(e.pointerId);
      
      card.style.transition = 'transform var(--transition-normal)';
      
      // Determine if swipe thresholds met
      if (diffX > 120) {
        // Confirm Complete
        card.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (callbacks.onComplete) callbacks.onComplete(task.id);
        }, 150);
      } else if (diffX < -120) {
        // Confirm Skip
        card.style.transform = 'translateX(-100%)';
        setTimeout(() => {
          if (callbacks.onSkip) callbacks.onSkip(task.id);
        }, 150);
      } else {
        // Revert card back to original position
        card.style.transform = 'translateX(0)';
      }
      diffX = 0;
    });

    card.addEventListener('pointercancel', () => {
      isDragging = false;
      card.style.transition = 'transform var(--transition-normal)';
      card.style.transform = 'translateX(0)';
      diffX = 0;
    });
  }

  return cardContainer;
}
