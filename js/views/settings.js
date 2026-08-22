/* js/views/settings.js */
import { getPreferences, updatePreferences, addBucket, updateBucket, deleteBucket, reorderBuckets } from '../models/preferences.js';
import { resetDemoData } from '../seed.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import db from '../db.js';

/**
 * Initializes settings event listeners (inputs, exports, import file trigger, demo reset).
 */
export function initSettingsView() {
  const wakeInput = document.getElementById('settings-wake-time');
  const sleepInput = document.getElementById('settings-sleep-time');
  const capacityInput = document.getElementById('settings-default-capacity');
  const capacityDisplay = document.getElementById('settings-capacity-display');
  
  const addBucketBtn = document.getElementById('settings-add-bucket-btn');
  const exportBtn = document.getElementById('settings-export-btn');
  const importBtn = document.getElementById('settings-import-btn');
  const importFile = document.getElementById('settings-import-file');
  const resetBtn = document.getElementById('settings-reset-demo-btn');

  if (!resetBtn) return;

  // 1. Wake & Sleep times changes
  wakeInput.addEventListener('change', async (e) => {
    await updatePreferences({ wakeTime: e.target.value });
    showToast('Wake time updated', 'success');
  });

  sleepInput.addEventListener('change', async (e) => {
    await updatePreferences({ sleepTime: e.target.value });
    showToast('Sleep time updated', 'success');
  });

  // 2. Capacity Slider
  capacityInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    updateCapacityLabel(val, capacityDisplay);
  });

  capacityInput.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    await updatePreferences({ defaultCapacity: val });
    showToast('Default daily capacity updated', 'success');
  });

  // 3. Add Custom Bucket
  addBucketBtn.addEventListener('click', () => {
    showAddBucketModal();
  });

  // 4. Data Operations: Export JSON
  exportBtn.addEventListener('click', async () => {
    try {
      const tasks = await db.tasks.toArray();
      const plans = await db.dailyPlans.toArray();
      const prefs = await db.preferences.toArray();
      
      const backup = { tasks, dailyPlans: plans, preferences: prefs };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `planflow-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      showToast('Data exported successfully 📤', 'success');
    } catch (err) {
      console.error(err);
      showToast('Data export failed', 'danger');
    }
  });

  // Data Operations: Import JSON
  importBtn.addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        
        if (!data.tasks || !data.dailyPlans || !data.preferences) {
          throw new Error('Invalid backup file schema');
        }

        if (confirm('Importing data will overwrite all current tasks, plans, and settings. Continue?')) {
          await db.tasks.clear();
          await db.dailyPlans.clear();
          await db.preferences.clear();

          // Bulk add
          await db.tasks.bulkAdd(data.tasks);
          await db.dailyPlans.bulkAdd(data.dailyPlans);
          await db.preferences.bulkAdd(data.preferences);

          showToast('Data imported successfully! Reloading...', 'success');
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        }
      } catch (err) {
        console.error(err);
        showToast('Invalid backup JSON file', 'danger');
      }
    };
    reader.readAsText(file);
  });

  // Reset Demo Data
  resetBtn.addEventListener('click', async () => {
    if (confirm('This will wipe all existing data and reset the app with default demo tasks. Continue?')) {
      await resetDemoData();
      showToast('Demo data reset successfully 🔄', 'success');
      setTimeout(() => {
        window.location.hash = '#today';
        window.location.reload();
      }, 1000);
    }
  });
}

/**
 * Renders preferences values and the category bucket items list.
 */
export async function renderSettingsView() {
  const wakeInput = document.getElementById('settings-wake-time');
  const sleepInput = document.getElementById('settings-sleep-time');
  const capacityInput = document.getElementById('settings-default-capacity');
  const capacityDisplay = document.getElementById('settings-capacity-display');
  const bucketList = document.getElementById('settings-buckets-list');

  if (!wakeInput || !bucketList) return;

  const prefs = await getPreferences();

  // Populate basic configurations
  wakeInput.value = prefs.wakeTime || '07:00';
  sleepInput.value = prefs.sleepTime || '23:00';
  
  const capVal = prefs.defaultCapacity || 300;
  capacityInput.value = capVal;
  updateCapacityLabel(capVal, capacityDisplay);

  // Populate Bucket Categories List
  bucketList.innerHTML = '';
  prefs.buckets.forEach((bucket, index) => {
    const row = document.createElement('div');
    row.className = 'settings-row card';
    row.style.padding = 'var(--spacing-sm) var(--spacing-md)';
    row.style.marginBottom = 'var(--spacing-xs)';
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';

    const info = document.createElement('div');
    info.style.display = 'flex';
    info.style.alignItems = 'center';
    info.style.gap = 'var(--spacing-sm)';
    info.innerHTML = `
      <span style="font-size: 1.3rem;">${bucket.emoji}</span>
      <span style="font-weight: 700;">${bucket.name}</span>
      <div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${bucket.color}; border: 1px solid var(--border-color);"></div>
    `;
    row.appendChild(info);

    // Control buttons container
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = 'var(--spacing-xs)';

    // Move Up
    const upBtn = document.createElement('button');
    upBtn.className = 'btn btn-ghost';
    upBtn.style.padding = '4px 8px';
    upBtn.disabled = index === 0;
    upBtn.textContent = '▲';
    upBtn.addEventListener('click', async () => {
      const orderedIds = prefs.buckets.map(b => b.id);
      // Swap with previous
      const temp = orderedIds[index];
      orderedIds[index] = orderedIds[index - 1];
      orderedIds[index - 1] = temp;
      await reorderBuckets(orderedIds);
      renderSettingsView();
    });

    // Move Down
    const downBtn = document.createElement('button');
    downBtn.className = 'btn btn-ghost';
    downBtn.style.padding = '4px 8px';
    downBtn.disabled = index === prefs.buckets.length - 1;
    downBtn.textContent = '▼';
    downBtn.addEventListener('click', async () => {
      const orderedIds = prefs.buckets.map(b => b.id);
      // Swap with next
      const temp = orderedIds[index];
      orderedIds[index] = orderedIds[index + 1];
      orderedIds[index + 1] = temp;
      await reorderBuckets(orderedIds);
      renderSettingsView();
    });

    // Delete
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost';
    delBtn.style.padding = '4px 8px';
    delBtn.style.color = 'var(--color-danger)';
    delBtn.textContent = '🗑️';
    // Prevent deleting the default buckets if list size <= 1
    delBtn.disabled = prefs.buckets.length <= 1;
    delBtn.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete the "${bucket.name}" bucket? Tasks in this bucket will remain but will lack category labels.`)) {
        await deleteBucket(bucket.id);
        showToast(`Bucket "${bucket.name}" deleted`, 'success');
        renderSettingsView();
      }
    });

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(delBtn);
    row.appendChild(controls);

    bucketList.appendChild(row);
  });
}

function updateCapacityLabel(minutes, displayEl) {
  if (!displayEl) return;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  displayEl.textContent = `${hours}h ${mins}m`;
}

function showAddBucketModal() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="new-bucket-name">Bucket Name</label>
      <input type="text" id="new-bucket-name" class="input" placeholder="e.g. Wellness" required>
    </div>
    <div class="form-group">
      <label class="form-label" for="new-bucket-emoji">Emoji Icon</label>
      <input type="text" id="new-bucket-emoji" class="input" placeholder="e.g. 🧘‍♂️" style="max-width: 100px; text-align: center;" required>
    </div>
    <div class="form-group">
      <label class="form-label" for="new-bucket-color">Theme Color</label>
      <input type="color" id="new-bucket-color" class="input" value="#E8703A" style="padding: 4px; height: 44px; width: 80px; border-radius: 8px;">
    </div>
    <div style="display:flex;gap:var(--spacing-md);margin-top:var(--spacing-xl);">
      <button id="add-bucket-cancel" class="btn btn-secondary" style="flex:1;">Cancel</button>
      <button id="add-bucket-save" class="btn btn-primary" style="flex:1;">Create Bucket</button>
    </div>
  `;

  openModal('Create Bucket Category', content);

  document.getElementById('add-bucket-cancel').addEventListener('click', closeModal);
  document.getElementById('add-bucket-save').addEventListener('click', async () => {
    const nameInput = document.getElementById('new-bucket-name');
    const emojiInput = document.getElementById('new-bucket-emoji');
    const colorInput = document.getElementById('new-bucket-color');

    if (!nameInput.value.trim() || !emojiInput.value.trim()) {
      showToast('Bucket name and emoji are required', 'warning');
      return;
    }

    const name = nameInput.value.trim();
    const emoji = emojiInput.value.trim();
    const color = colorInput.value;

    await addBucket(name, emoji, color);
    closeModal();
    showToast(`Bucket "${name}" created!`, 'success');
    renderSettingsView();
  });
}
