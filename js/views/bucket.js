/* js/views/bucket.js */
import { getActiveTasks } from '../models/task.js';
import { getPreferences } from '../models/preferences.js';
import { renderTaskCard } from '../components/taskCard.js';

let currentFilter = 'all';
let searchQuery = '';

/**
 * Initializes listeners for search input and filter chips in bucket view.
 */
export function initBucketView() {
  const searchInput = document.getElementById('bucket-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderBucketView();
    });
  }

  // Fabric Add Task button wire-up
  const addBtn = document.getElementById('bucket-add-task-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      window.location.hash = '#add-task';
    });
  }
}

/**
 * Renders the task bucket view.
 * Groups active tasks under collapsible bucket sections.
 */
export async function renderBucketView() {
  const listContainer = document.getElementById('bucket-list');
  const chipContainer = document.getElementById('bucket-filter-chips');
  if (!listContainer || !chipContainer) return;

  const prefs = await getPreferences();
  const tasks = await getActiveTasks();

  // 1. Render Filter Chips
  renderFilterChips(prefs.buckets, chipContainer);

  // 2. Filter Tasks
  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.name.toLowerCase().includes(searchQuery);
    const matchesChip = currentFilter === 'all' || task.bucket === currentFilter;
    return matchesSearch && matchesChip;
  });

  // Clear list
  listContainer.innerHTML = '';

  // 3. Group and Render Buckets
  prefs.buckets.forEach(bucket => {
    // Check if this bucket matches the active chip filter
    if (currentFilter !== 'all' && bucket.id !== currentFilter) return;

    const bucketTasks = filteredTasks.filter(t => t.bucket === bucket.id);
    
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
    countBadge.style.backgroundColor = bucket.color + '22'; // Light opacity background
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

    // Content container
    const content = document.createElement('div');
    content.className = 'bucket-content';

    if (bucketTasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bucket-empty-state';
      empty.textContent = 'No tasks in this bucket.';
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

  // If absolutely no tasks match search queries
  if (filteredTasks.length === 0) {
    const globalEmpty = document.createElement('div');
    globalEmpty.className = 'bucket-empty-state';
    globalEmpty.style.padding = 'var(--spacing-xxl)';
    globalEmpty.innerHTML = `<h3>No tasks found</h3><p style="margin-top:8px;font-size:0.85rem;">Try adjusting your filters or add a new task.</p>`;
    listContainer.appendChild(globalEmpty);
  }
}

function renderFilterChips(buckets, container) {
  // Clear chips
  container.innerHTML = '';

  // "All" chip
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

  // Specific bucket chips
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
