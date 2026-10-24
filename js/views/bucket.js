import { getActiveTasks, getAllTasks, getTask, transitionTaskStatus, updateTask, createTask, deleteTask } from '../models/task.js';
import { getPlanForDate, createPlan, addTaskToPlan, updatePlan } from '../models/plan.js';
import db from '../db.js';
import { getPreferences } from '../models/preferences.js';
import { renderTaskCard } from '../components/taskCard.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { stagger, slideUp } from '../utils/animate.js';
import { parseNaturalLanguageTask, quickCaptureTask } from '../engine/quickCapture.js';
import { suggestTaskClarifications } from '../engine/aiService.js';
import { isTaskDueOn } from '../engine/recurrence.js';
import { today, formatTime } from '../utils/date.js';

let currentFilter = 'all';
let searchQuery = '';
let cachedBuckets = [];

async function hideTask(taskId) {
  await deleteTask(taskId);
  const plans = await db.dailyPlans.toArray();
  await Promise.all(plans.filter(plan => plan.date >= today()).map(async plan => {
    const plannedTasks = plan.plannedTasks.filter(item =>
      item.taskId !== taskId || item.status === 'in-progress' || item.status === 'completed'
    );
    if (plannedTasks.length !== plan.plannedTasks.length) {
      await updatePlan(plan.id, { plannedTasks });
    }
  }));
  showToast('Task hidden from your active list', 'success');
  await renderBucketView();
}

async function restoreTask(taskId) {
  await transitionTaskStatus(taskId, 'ready');
  showToast('Task restored', 'success');
  await renderBucketView();
}

function suggestedTimeForDate(dateStr, plan, prefs) {
  let minutes = 7 * 60;
  if (plan?.plannedTasks?.length) {
    minutes = Math.max(...plan.plannedTasks.map(item => {
      const [hours, mins] = (item.scheduledTime || '07:00').split(':').map(Number);
      return hours * 60 + mins + (item.estimatedMinutes || 30) + (prefs.bufferMinutes || 0);
    }));
  } else if (prefs.wakeTime) {
    const [hours, mins] = prefs.wakeTime.split(':').map(Number);
    minutes = hours * 60 + mins;
  }

  if (dateStr === today()) {
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    minutes = Math.max(minutes, Math.ceil(current / 15) * 15);
  }
  minutes = Math.min(23 * 60 + 45, Math.max(0, minutes));
  return formatTime(Math.floor(minutes / 60), minutes % 60);
}

async function scheduleTask(taskId) {
  const task = await getTask(taskId);
  if (!task) return;
  const prefs = await getPreferences();
  const content = document.createElement('form');
  content.className = 'schedule-task-form';
  content.innerHTML = `
    <p class="schedule-task-copy">Choose the day and start time. This task will stay in its bucket and also appear on that day.</p>
    <label class="form-label" for="schedule-task-date">Day</label>
    <input class="input" id="schedule-task-date" type="date" min="${today()}" value="${today()}" required>
    <label class="form-label" for="schedule-task-time">Start time</label>
    <input class="input" id="schedule-task-time" type="time" required>
    <p class="schedule-task-copy" id="schedule-day-summary" aria-live="polite"></p>
    <button class="btn btn-primary" type="submit" style="width:100%; margin-top:var(--spacing-md);">Add to day</button>
  `;
  const dateInput = content.querySelector('#schedule-task-date');
  const timeInput = content.querySelector('#schedule-task-time');
  const daySummary = content.querySelector('#schedule-day-summary');
  let selectedPlan = null;
  const refreshSuggestedTime = async () => {
    selectedPlan = await getPlanForDate(dateInput.value);
    timeInput.value = suggestedTimeForDate(dateInput.value, selectedPlan, prefs);
    const plannedMinutes = (selectedPlan?.plannedTasks || []).reduce((sum, item) => sum + (item.estimatedMinutes || 0), 0);
    const capacity = selectedPlan?.capacity || prefs.defaultCapacity || 300;
    daySummary.textContent = selectedPlan
      ? `${selectedPlan.plannedTasks.length} tasks · ${plannedMinutes} of ${capacity} focus minutes planned`
      : `New day plan · ${task.estimatedMinutes || 30} focus minutes`;
  };
  await refreshSuggestedTime();
  dateInput.addEventListener('change', refreshSuggestedTime);
  openModal(`Schedule “${task.title || task.name}”`, content);

  content.addEventListener('submit', async (event) => {
    event.preventDefault();
    const dateStr = dateInput.value;
    if (dateStr < today()) return;
    if (task.recurrence && !isTaskDueOn(task, dateStr)) {
      showToast('This recurring task is not due on that day', 'warning');
      return;
    }

    const entry = {
      taskId: task.id,
      title: task.title || task.name,
      name: task.name || task.title,
      bucket: task.bucket || task.categoryId,
      estimatedMinutes: task.estimatedMinutes || 30,
      scheduledTime: timeInput.value,
      isUnplanned: false
    };
    if (selectedPlan) {
      if (selectedPlan.plannedTasks.some(item => item.taskId === task.id)) {
        showToast('This task is already on that day', 'info');
        return;
      }
      const plannedMinutes = selectedPlan.plannedTasks.reduce((sum, item) => sum + (item.estimatedMinutes || 0), 0);
      const capacity = selectedPlan.capacity || prefs.defaultCapacity || 300;
      if (plannedMinutes + entry.estimatedMinutes > capacity && !confirm(`This adds ${entry.estimatedMinutes} minutes to ${plannedMinutes} of ${capacity} planned. Add it anyway?`)) return;
      await addTaskToPlan(selectedPlan.id, entry);
    } else {
      await createPlan(dateStr, prefs.defaultCapacity || 300, [entry]);
    }
    if (task.status === 'inbox') await transitionTaskStatus(task.id, 'ready');
    closeModal();
    showToast(`Added to ${dateStr === today() ? 'today' : dateStr}`, 'success');
    if (dateStr === today()) window.location.hash = '#today';
    else window.location.hash = `#plan?date=${dateStr}`;
  });
}

/**
 * Initializes listeners for search input, category filters, and quick capture composer.
 */
export function initBucketView() {
  getPreferences().then(prefs => {
    if (prefs && prefs.buckets) cachedBuckets = prefs.buckets;
  }).catch(() => {});

  const searchInput = document.getElementById('bucket-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderBucketView();
    });
  }

  // Floating Quick Add Composer input and submission
  const quickAddForm = document.getElementById('quick-add-form');
  const quickAddInput = document.getElementById('quick-add-input');
  const quickAddPreview = document.getElementById('quick-add-live-preview');

  if (quickAddInput && quickAddPreview) {
    // Real-time NLP parsing live preview chips
    quickAddInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (!val) {
        quickAddPreview.innerHTML = '';
        quickAddPreview.classList.add('hidden');
        return;
      }

      const parsed = parseNaturalLanguageTask(val, cachedBuckets);
      const matchedBucket = cachedBuckets.find(b => b.id === parsed.categoryId) || { emoji: '📁', name: parsed.categoryId };
      const energyEmoji = parsed.energy === 'high' ? '🚀' : parsed.energy === 'low' ? '🔋' : '⚡';

      quickAddPreview.innerHTML = `
        <span class="quick-add-preview-chip">🏷️ ${escapeHtml(parsed.title)}</span>
        <span class="quick-add-preview-chip">⏱️ ${parsed.estimatedMinutes}m</span>
        <span class="quick-add-preview-chip">${matchedBucket.emoji || '📁'} ${escapeHtml(matchedBucket.name)}</span>
        <span class="quick-add-preview-chip">${energyEmoji} ${parsed.energy}</span>
        ${parsed.deadline ? `<span class="quick-add-preview-chip">📅 ${parsed.deadline}</span>` : ''}
        ${parsed.status === 'inbox' ? `<span class="quick-add-preview-chip" style="color:#856404;background:#FFF3CD;">📥 AI Inbox</span>` : ''}
      `;
      quickAddPreview.classList.remove('hidden');
    });
  }

  if (quickAddForm && quickAddInput) {
    quickAddForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawText = quickAddInput.value.trim();
      if (!rawText) return;

      try {
        const createdTask = await quickCaptureTask(rawText, cachedBuckets);
        const matchedBucket = cachedBuckets.find(b => b.id === createdTask.categoryId) || { emoji: '📋', name: createdTask.categoryId };

        quickAddInput.value = '';
        if (quickAddPreview) {
          quickAddPreview.innerHTML = '';
          quickAddPreview.classList.add('hidden');
        }

        const statusNote = createdTask.status === 'inbox' ? ' (Review in AI Inbox)' : '';
        showToast(`Task "${createdTask.title}" added to bucket ✨${statusNote}`, 'success');
        
        await renderBucketView();
      } catch (err) {
        console.error('[QuickAdd] Failed to create task:', err);
        showToast('Failed to parse task', 'danger');
      }
    });
  }

  // Floating Action Button (FAB) interaction
  const addBtn = document.getElementById('bucket-add-task-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (quickAddInput) {
        quickAddInput.focus();
        quickAddInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        window.location.hash = '#add-task';
      }
    });
  }
}

/**
 * Renders the task bucket view.
 * Displays header stats, category filter chips, AI Inbox, and collapsible category sections.
 */
export async function renderBucketView() {
  const listContainer = document.getElementById('bucket-list');
  const chipContainer = document.getElementById('bucket-filter-chips');
  const inboxContainer = document.getElementById('bucket-inbox-section');
  const totalCountBadge = document.getElementById('bucket-total-count');

  if (!listContainer || !chipContainer) return;

  const prefs = await getPreferences();
  cachedBuckets = prefs.buckets || [];
  const allActiveTasks = currentFilter === 'hidden'
    ? (await getAllTasks()).filter(task => task.status === 'archived' || task.isArchived)
    : await getActiveTasks();

  const matchingTasks = allActiveTasks.filter(task => {
    if (!searchQuery) return true;
    const taskTitle = (task.title || task.name || '').toLowerCase();
    return taskTitle.includes(searchQuery);
  });

  const inboxTasks = currentFilter === 'hidden' ? [] : matchingTasks.filter(t => t.status === 'inbox');
  const readyTasks = matchingTasks.filter(t => t.status !== 'inbox');

  if (totalCountBadge) {
    const totalCount = searchQuery ? matchingTasks.length : allActiveTasks.length;
    const label = totalCount === 1 ? 'task' : 'tasks';
    totalCountBadge.textContent = searchQuery ? `${totalCount} found` : `${totalCount} ${label}`;
  }

  // 1. Render a calm single filter control instead of a row of colored tabs.
  renderFilterSelect(cachedBuckets, chipContainer, inboxTasks.length);

  // 2. Render AI Inbox section
  if (inboxContainer) {
    renderAIInboxSection(inboxTasks, inboxContainer);
  }

  // 3. Filter Tasks by selected Category Chip
  const filteredTasks = readyTasks.filter(task => {
    const taskCat = task.categoryId || task.bucket;
    const matchesChip = currentFilter === 'all' || taskCat === currentFilter;
    return matchesChip;
  });

  // Clear category list
  listContainer.innerHTML = '';

  // If filtered specifically to inbox, category list remains empty
  if (currentFilter === 'inbox') {
    if (inboxTasks.length === 0) {
      listContainer.innerHTML = `
        <div class="bucket-empty-state" style="padding: var(--spacing-xxl);">
          <h3>AI Inbox is clear! 🎉</h3>
          <p style="margin-top:8px;font-size:0.85rem;">All tasks are clarified and structured.</p>
        </div>`;
    }
    return;
  }

  if (currentFilter === 'hidden') {
    const section = document.createElement('div');
    section.className = 'bucket-section';
    const title = document.createElement('h2');
    title.className = 'bucket-title';
    title.textContent = 'Hidden tasks';
    section.appendChild(title);
    if (matchingTasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bucket-empty-state';
      empty.textContent = 'No hidden tasks.';
      section.appendChild(empty);
    } else {
      matchingTasks.forEach(task => section.appendChild(renderTaskCard(task, 'bucket', {
        onTap: taskId => { window.location.hash = `#add-task?id=${taskId}`; },
        onRestore: restoreTask
      })));
    }
    listContainer.appendChild(section);
    return;
  }

  // 4. Group and Render Buckets
  cachedBuckets.forEach(bucket => {
    // Check if this bucket matches the active chip filter
    if (currentFilter !== 'all' && bucket.id !== currentFilter) return;

    const bucketTasks = filteredTasks.filter(t => (t.categoryId === bucket.id || t.bucket === bucket.id));
    
    // Create bucket section
    const section = document.createElement('div');
    section.className = 'bucket-section';
    section.dataset.bucketId = bucket.id;

    // Header
    const header = document.createElement('div');
    header.className = 'bucket-header';
    
    const titleContainer = document.createElement('div');
    titleContainer.className = 'bucket-title-container';
    
    const emojiSpan = document.createElement('span');
    emojiSpan.style.fontSize = '1.3rem';
    emojiSpan.textContent = bucket.emoji;
    
    const titleText = document.createElement('span');
    titleText.className = 'bucket-title';
    titleText.textContent = bucket.name;

    const countBadge = document.createElement('span');
    countBadge.className = 'badge';
    countBadge.style.marginLeft = 'var(--spacing-sm)';
    countBadge.textContent = bucketTasks.length;

    titleContainer.appendChild(emojiSpan);
    titleContainer.appendChild(titleText);
    titleContainer.appendChild(countBadge);

    const toggleArrow = document.createElement('span');
    toggleArrow.className = 'bucket-toggle-arrow';
    toggleArrow.textContent = '▼';

    header.appendChild(titleContainer);
    header.appendChild(toggleArrow);
    section.appendChild(header);

    // Content container with compact task cards
    const content = document.createElement('div');
    content.className = 'bucket-content';

    if (bucketTasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bucket-empty-state';
      empty.textContent = 'No tasks in this category.';
      content.appendChild(empty);
    } else {
      bucketTasks.forEach(task => {
        const cardNode = renderTaskCard(task, 'bucket', {
          onTap: (taskId) => {
            window.location.hash = `#add-task?id=${taskId}`;
          },
          onSchedule: scheduleTask,
          onHide: hideTask
        });
        content.appendChild(cardNode);
      });
    }

    section.appendChild(content);
    listContainer.appendChild(section);

    // Collapsible click event
    header.addEventListener('click', () => {
      section.classList.toggle('collapsed');
    });
  });

  // 5. Render any tasks with custom/unmatched category IDs so none are lost
  const knownBucketIds = new Set(cachedBuckets.map(b => b.id));
  const otherTasks = filteredTasks.filter(t => !knownBucketIds.has(t.categoryId) && !knownBucketIds.has(t.bucket));

  if (otherTasks.length > 0 && currentFilter === 'all') {
    const section = document.createElement('div');
    section.className = 'bucket-section';
    section.dataset.bucketId = 'other';

    const header = document.createElement('div');
    header.className = 'bucket-header';

    const titleContainer = document.createElement('div');
    titleContainer.className = 'bucket-title-container';

    const emojiSpan = document.createElement('span');
    emojiSpan.style.fontSize = '1.3rem';
    emojiSpan.textContent = '📁';

    const titleText = document.createElement('span');
    titleText.className = 'bucket-title';
    titleText.textContent = 'Other';

    const countBadge = document.createElement('span');
    countBadge.className = 'badge';
    countBadge.style.marginLeft = 'var(--spacing-sm)';
    countBadge.textContent = otherTasks.length;

    titleContainer.appendChild(emojiSpan);
    titleContainer.appendChild(titleText);
    titleContainer.appendChild(countBadge);

    const toggleArrow = document.createElement('span');
    toggleArrow.className = 'bucket-toggle-arrow';
    toggleArrow.textContent = '▼';

    header.appendChild(titleContainer);
    header.appendChild(toggleArrow);
    section.appendChild(header);

    const content = document.createElement('div');
    content.className = 'bucket-content';
    otherTasks.forEach(task => {
      const cardNode = renderTaskCard(task, 'bucket', {
        onTap: (taskId) => {
          window.location.hash = `#add-task?id=${taskId}`;
        },
        onSchedule: scheduleTask,
        onHide: hideTask
      });
      content.appendChild(cardNode);
    });

    section.appendChild(content);
    listContainer.appendChild(section);

    header.addEventListener('click', () => {
      section.classList.toggle('collapsed');
    });
  }

  // If no tasks match search or filter
  if (filteredTasks.length === 0 && (currentFilter !== 'all' || inboxTasks.length === 0)) {
    const globalEmpty = document.createElement('div');
    globalEmpty.className = 'bucket-empty-state';
    globalEmpty.style.padding = 'var(--spacing-xxl)';
    globalEmpty.innerHTML = `<h3>No tasks found</h3><p style="margin-top:8px;font-size:0.85rem;">Try adjusting your filters or use Quick Add below.</p>`;
    listContainer.appendChild(globalEmpty);
  }

  // Stagger animate task cards
  const cards = listContainer.querySelectorAll('.task-card-container');
  stagger(cards, (el, delay) => slideUp(el, 15, 300, delay));
}

/**
 * Renders the AI Inbox collapsible section for ambiguous/unreviewed tasks.
 */
function renderAIInboxSection(inboxTasks, container) {
  const shouldShow = currentFilter === 'inbox' || (currentFilter === 'all' && inboxTasks.length > 0);

  if (!shouldShow || inboxTasks.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="bucket-inbox-header" id="inbox-header-toggle">
      <div>
        <div class="bucket-inbox-title">
          <span>📥 AI Inbox</span>
          <span class="badge" style="background-color: #8C5B0022; color: #8C5B00;">${inboxTasks.length}</span>
        </div>
        <p class="bucket-inbox-subtitle">Ambiguous tasks needing clarification before scheduling</p>
      </div>
      <span class="bucket-toggle-arrow">▼</span>
    </div>
    <div class="bucket-inbox-content" id="inbox-cards-list"></div>
  `;

  const cardsList = container.querySelector('#inbox-cards-list');
  const headerToggle = container.querySelector('#inbox-header-toggle');

  if (headerToggle) {
    headerToggle.addEventListener('click', () => {
      container.classList.toggle('collapsed');
      if (cardsList) cardsList.style.display = container.classList.contains('collapsed') ? 'none' : 'flex';
    });
  }

  inboxTasks.forEach(task => {
    const cardNode = renderTaskCard(task, 'bucket', {
      onTap: (taskId) => {
        window.location.hash = `#add-task?id=${taskId}`;
      },
      onSchedule: scheduleTask,
      onHide: hideTask
    });

    // Add action button group to inbox task cards (AI Clarify + Quick Approve)
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex; gap:6px; margin-top:var(--spacing-xs); flex-wrap:wrap;';

    const clarifyBtn = document.createElement('button');
    clarifyBtn.className = 'btn btn-primary';
    clarifyBtn.style.cssText = 'padding:4px 10px; font-size:0.75rem; border-radius:var(--radius-sm); font-weight:700;';
    clarifyBtn.textContent = '✨ AI Clarify';
    clarifyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAIClarifyModal(task, cachedBuckets);
    });

    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-ghost';
    approveBtn.style.cssText = 'padding:4px 10px; font-size:0.75rem; color:var(--secondary-color); border:1px solid var(--secondary-color); border-radius:var(--radius-sm);';
    approveBtn.textContent = '✓ Ready to Schedule';
    
    approveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await transitionTaskStatus(task.id, 'ready');
        showToast(`Task "${task.title}" approved to Ready!`, 'success');
        await renderBucketView();
      } catch (err) {
        showToast('Failed to update status', 'danger');
      }
    });

    btnGroup.appendChild(clarifyBtn);
    btnGroup.appendChild(approveBtn);

    const cardContent = cardNode.querySelector('.timeline-card-content');
    if (cardContent) {
      cardContent.appendChild(btnGroup);
    }

    cardsList.appendChild(cardNode);
  });
}

/**
 * Opens the interactive AI Clarification Assistant modal per Sections 4.4, 7.3, and 10.
 */
function openAIClarifyModal(task, cachedBuckets) {
  const proposal = suggestTaskClarifications(task, cachedBuckets);
  if (!proposal) return;

  const content = document.createElement('div');
  content.className = 'ai-clarify-dialog';

  const bucketOptions = cachedBuckets.map(b => 
    `<option value="${b.id}" ${b.id === proposal.suggestedCategory ? 'selected' : ''}>${b.emoji || '📁'} ${b.name}</option>`
  ).join('');

  const subtasksHtml = proposal.suggestedSubtasks.map((st, idx) => `
    <li style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-color);">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem; flex:1;">
        <input type="checkbox" class="clarify-subtask-check" data-idx="${idx}" checked>
        <span>${escapeHtml(st.title)}</span>
      </label>
      <span class="badge" style="font-size:0.75rem; background:rgba(0,0,0,0.05);">${st.estimatedMinutes}m</span>
    </li>
  `).join('');

  content.innerHTML = `
    <div style="margin-bottom:var(--spacing-md);">
      <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">Original Prompt</p>
      <div style="font-size:0.9rem; font-weight:700; background:rgba(0,0,0,0.03); padding:8px 12px; border-radius:var(--radius-sm); border-left:3px solid var(--primary-color);">
        "${escapeHtml(proposal.originalTitle)}"
      </div>
    </div>

    <div class="form-group" style="margin-bottom:var(--spacing-md);">
      <label class="form-label" for="clarify-title" style="font-size:0.85rem; font-weight:700;">Refined Title</label>
      <input type="text" id="clarify-title" class="input" value="${escapeHtml(proposal.refinedTitle)}" style="width:100%; box-sizing:border-box;">
    </div>

    <div class="form-group" style="margin-bottom:var(--spacing-md);">
      <label class="form-label" for="clarify-bucket" style="font-size:0.85rem; font-weight:700;">Category</label>
      <select id="clarify-bucket" class="select" style="width:100%; box-sizing:border-box;">
        ${bucketOptions}
      </select>
      <p style="font-size:0.75rem; color:var(--secondary-color); margin-top:4px;">💡 ${escapeHtml(proposal.categoryReasoning)}</p>
    </div>

    <div class="form-group" style="margin-bottom:var(--spacing-md);">
      <label class="form-label" style="font-size:0.85rem; font-weight:700;">Duration</label>
      <div class="segmented-control" id="clarify-duration-pills" style="display:flex; gap:6px;">
        ${[15, 30, 45, 60, 90].map(m => `
          <button type="button" class="segment-btn ${m === proposal.suggestedDuration ? 'active' : ''}" data-min="${m}" style="flex:1; padding:6px 0; border:1px solid var(--border-color); background:${m === proposal.suggestedDuration ? 'var(--primary-light)' : 'var(--surface-color)'}; color:${m === proposal.suggestedDuration ? 'var(--primary-color)' : 'var(--text-color)'}; border-radius:var(--radius-sm); font-size:0.8rem; font-weight:700; cursor:pointer;">${m}m</button>
        `).join('')}
      </div>
      <p style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">⏱️ ${escapeHtml(proposal.durationReasoning)}</p>
    </div>

    <div class="form-group" style="margin-bottom:var(--spacing-md);">
      <label class="form-label" style="font-size:0.85rem; font-weight:700;">Energy Profile</label>
      <div class="segmented-control" id="clarify-energy-pills" style="display:flex; gap:6px;">
        ${['low', 'medium', 'high'].map(e => `
          <button type="button" class="segment-btn ${e === proposal.suggestedEnergy ? 'active' : ''}" data-energy="${e}" style="flex:1; padding:6px 0; border:1px solid var(--border-color); background:${e === proposal.suggestedEnergy ? 'var(--primary-light)' : 'var(--surface-color)'}; color:${e === proposal.suggestedEnergy ? 'var(--primary-color)' : 'var(--text-color)'}; border-radius:var(--radius-sm); font-size:0.8rem; font-weight:700; text-transform:capitalize; cursor:pointer;">${e === 'high' ? '🚀' : e === 'low' ? '🔋' : '⚡'} ${e}</button>
        `).join('')}
      </div>
      <p style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">⚡ ${escapeHtml(proposal.energyReasoning)}</p>
    </div>

    ${proposal.suggestedSubtasks.length > 0 ? `
      <div style="margin-bottom:var(--spacing-lg);">
        <label class="form-label" style="font-size:0.85rem; font-weight:700;">Suggested Action Steps</label>
        <ul style="list-style:none; padding:0; margin:4px 0 0 0;">
          ${subtasksHtml}
        </ul>
      </div>
    ` : ''}

    <div style="display:flex; flex-direction:column; gap:8px; margin-top:var(--spacing-lg);">
      <button id="clarify-accept-btn" class="btn btn-primary" style="width:100%;">
        ✓ Accept & Promote to Ready
      </button>
      ${proposal.suggestedSubtasks.length > 0 ? `
        <button id="clarify-decompose-btn" class="btn btn-secondary" style="width:100%;">
          ⚡ Decompose into Multiple Tasks
        </button>
      ` : ''}
      <button id="clarify-cancel-btn" class="btn btn-ghost" style="width:100%;">
        Cancel
      </button>
    </div>
  `;

  openModal('AI Clarification Assistant ✨', content);

  let selectedDuration = proposal.suggestedDuration;
  let selectedEnergy = proposal.suggestedEnergy;

  // Duration pill clicks
  content.querySelectorAll('#clarify-duration-pills .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('#clarify-duration-pills .segment-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'var(--surface-color)';
        b.style.color = 'var(--text-color)';
      });
      btn.classList.add('active');
      btn.style.background = 'var(--primary-light)';
      btn.style.color = 'var(--primary-color)';
      selectedDuration = parseInt(btn.dataset.min, 10);
    });
  });

  // Energy pill clicks
  content.querySelectorAll('#clarify-energy-pills .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('#clarify-energy-pills .segment-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'var(--surface-color)';
        b.style.color = 'var(--text-color)';
      });
      btn.classList.add('active');
      btn.style.background = 'var(--primary-light)';
      btn.style.color = 'var(--primary-color)';
      selectedEnergy = btn.dataset.energy;
    });
  });

  // Cancel
  document.getElementById('clarify-cancel-btn')?.addEventListener('click', closeModal);

  // Accept and promote to ready
  document.getElementById('clarify-accept-btn')?.addEventListener('click', async () => {
    const refinedTitle = document.getElementById('clarify-title').value.trim() || proposal.refinedTitle;
    const selectedBucket = document.getElementById('clarify-bucket').value;

    const checkedSubtasks = [];
    content.querySelectorAll('.clarify-subtask-check:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.idx, 10);
      if (proposal.suggestedSubtasks[idx]) {
        checkedSubtasks.push(proposal.suggestedSubtasks[idx]);
      }
    });

    await updateTask(task.id, {
      title: refinedTitle,
      name: refinedTitle,
      categoryId: selectedBucket,
      bucket: selectedBucket,
      estimatedMinutes: selectedDuration,
      energy: selectedEnergy,
      energyLevel: selectedEnergy,
      status: 'ready',
      subtasks: checkedSubtasks
    });

    closeModal();
    showToast(`"${refinedTitle}" clarified and promoted to Ready! ✨`, 'success');
    await renderBucketView();
  });

  // Decompose into separate tasks
  document.getElementById('clarify-decompose-btn')?.addEventListener('click', async () => {
    const selectedBucket = document.getElementById('clarify-bucket').value;
    const checkedSubtasks = [];
    content.querySelectorAll('.clarify-subtask-check:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.idx, 10);
      if (proposal.suggestedSubtasks[idx]) {
        checkedSubtasks.push(proposal.suggestedSubtasks[idx]);
      }
    });

    if (checkedSubtasks.length === 0) {
      showToast('No subtasks selected for decomposition', 'warning');
      return;
    }

    for (const st of checkedSubtasks) {
      await createTask({
        title: st.title,
        name: st.title,
        categoryId: selectedBucket,
        bucket: selectedBucket,
        estimatedMinutes: st.estimatedMinutes,
        energy: st.energy || selectedEnergy,
        energyLevel: st.energy || selectedEnergy,
        priority: task.priority || 50,
        status: 'ready'
      });
    }

    // Archive original broad task
    await deleteTask(task.id);

    closeModal();
    showToast(`Decomposed into ${checkedSubtasks.length} actionable tasks! 🚀`, 'success');
    await renderBucketView();
  });
}

/**
 * Renders category and status filter chips.
 */
function renderFilterSelect(buckets, container, inboxCount = 0) {
  container.innerHTML = '';
  const select = document.createElement('select');
  select.className = 'select task-filter-select';
  select.setAttribute('aria-label', 'Filter tasks');
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All active tasks';
  select.appendChild(allOption);

  if (inboxCount > 0 || currentFilter === 'inbox') {
    const option = document.createElement('option');
    option.value = 'inbox';
    option.textContent = `AI Inbox (${inboxCount})`;
    select.appendChild(option);
  }
  const hiddenOption = document.createElement('option');
  hiddenOption.value = 'hidden';
  hiddenOption.textContent = 'Hidden tasks';
  select.appendChild(hiddenOption);
  buckets.forEach(bucket => {
    const option = document.createElement('option');
    option.value = bucket.id;
    option.textContent = `${bucket.emoji} ${bucket.name}`;
    select.appendChild(option);
  });
  select.value = currentFilter;
  select.addEventListener('change', () => {
    currentFilter = select.value;
    renderBucketView();
  });
  container.appendChild(select);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
