/* js/views/bucket.js */
import { getActiveTasks, transitionTaskStatus } from '../models/task.js';
import { getPreferences } from '../models/preferences.js';
import { renderTaskCard } from '../components/taskCard.js';
import { showToast } from '../components/toast.js';
import { stagger, slideUp } from '../utils/animate.js';
import { parseNaturalLanguageTask, quickCaptureTask } from '../engine/quickCapture.js';

let currentFilter = 'all';
let searchQuery = '';
let cachedBuckets = [];

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
  const allActiveTasks = await getActiveTasks();

  const matchingTasks = allActiveTasks.filter(task => {
    if (!searchQuery) return true;
    const taskTitle = (task.title || task.name || '').toLowerCase();
    return taskTitle.includes(searchQuery);
  });

  const inboxTasks = matchingTasks.filter(t => t.status === 'inbox');
  const readyTasks = matchingTasks.filter(t => t.status !== 'inbox');

  if (totalCountBadge) {
    const totalCount = searchQuery ? matchingTasks.length : allActiveTasks.length;
    const label = totalCount === 1 ? 'task' : 'tasks';
    totalCountBadge.textContent = searchQuery ? `${totalCount} found` : `${totalCount} ${label}`;
  }

  // 1. Render Filter Chips (All, AI Inbox, and categories)
  renderFilterChips(cachedBuckets, chipContainer, inboxTasks.length);

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
    countBadge.style.backgroundColor = bucket.color + '22';
    countBadge.style.color = bucket.color;
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
          }
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
    countBadge.style.backgroundColor = 'var(--text-muted)22';
    countBadge.style.color = 'var(--text-color)';
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
        }
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
      }
    });

    // Add quick approve button to inbox task cards
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-ghost';
    approveBtn.style.padding = '4px 10px';
    approveBtn.style.fontSize = '0.75rem';
    approveBtn.style.color = 'var(--secondary-color)';
    approveBtn.style.border = '1px solid var(--secondary-color)';
    approveBtn.style.borderRadius = 'var(--radius-sm)';
    approveBtn.style.marginTop = 'var(--spacing-xs)';
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

    const cardContent = cardNode.querySelector('.timeline-card-content');
    if (cardContent) {
      cardContent.appendChild(approveBtn);
    }

    cardsList.appendChild(cardNode);
  });
}

/**
 * Renders category and status filter chips.
 */
function renderFilterChips(buckets, container, inboxCount = 0) {
  container.innerHTML = '';

  // 1. "All" chip
  const allChip = document.createElement('button');
  allChip.className = `chip ${currentFilter === 'all' ? 'selected' : ''}`;
  allChip.style.cursor = 'pointer';
  allChip.style.whiteSpace = 'nowrap';
  allChip.textContent = '🌐 All';
  if (currentFilter === 'all') {
    allChip.style.backgroundColor = 'var(--primary-light)';
    allChip.style.borderColor = 'var(--primary-color)';
    allChip.style.color = 'var(--primary-color)';
  }
  allChip.addEventListener('click', () => {
    currentFilter = 'all';
    renderBucketView();
  });
  container.appendChild(allChip);

  // 2. "AI Inbox" chip
  if (inboxCount > 0 || currentFilter === 'inbox') {
    const inboxChip = document.createElement('button');
    inboxChip.className = `chip ${currentFilter === 'inbox' ? 'selected' : ''}`;
    inboxChip.style.cursor = 'pointer';
    inboxChip.style.whiteSpace = 'nowrap';
    inboxChip.textContent = `📥 AI Inbox (${inboxCount})`;
    if (currentFilter === 'inbox') {
      inboxChip.style.backgroundColor = '#FFF3CD';
      inboxChip.style.borderColor = '#856404';
      inboxChip.style.color = '#856404';
    }
    inboxChip.addEventListener('click', () => {
      currentFilter = 'inbox';
      renderBucketView();
    });
    container.appendChild(inboxChip);
  }

  // 3. Category bucket chips
  buckets.forEach(b => {
    const chip = document.createElement('button');
    chip.className = `chip ${currentFilter === b.id ? 'selected' : ''}`;
    chip.style.cursor = 'pointer';
    chip.style.whiteSpace = 'nowrap';
    chip.textContent = `${b.emoji} ${b.name}`;

    if (currentFilter === b.id) {
      chip.style.backgroundColor = b.color + '22';
      chip.style.borderColor = b.color;
      chip.style.color = b.color;
    }

    chip.addEventListener('click', () => {
      currentFilter = b.id;
      renderBucketView();
    });
    container.appendChild(chip);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
