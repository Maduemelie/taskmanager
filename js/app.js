/* js/app.js */
import { toReadableDate, today } from './utils/date.js';
import db from './db.js';
import { seedDatabase } from './seed.js';
import { getPreferences } from './models/preferences.js';
import { getPlanForDate, processEndOfDay, isStale } from './models/plan.js';

// Global App State
window.PlanFlow = {
  version: '1.0.0',
  state: {
    currentView: 'today',
    preferences: null
  }
};

// Route Mapping: hash -> section ID
const routes = {
  '': 'today-view',
  '#today': 'today-view',
  '#plan': 'plan-view',
  '#bucket': 'bucket-view',
  '#settings': 'settings-view',
  '#add-task': 'add-task-view'
};

// Bottom Navigation items mapping: section ID -> nav link ID
const navMapping = {
  'today-view': 'nav-today',
  'plan-view': 'nav-plan',
  'bucket-view': 'nav-bucket',
  'settings-view': 'nav-settings'
};

/**
 * Hash router function
 */
function handleRoute() {
  const hash = window.location.hash;
  const activeSectionId = routes[hash] || 'today-view';
  
  // Update state
  window.PlanFlow.state.currentView = activeSectionId.replace('-view', '');
  
  // Hide all views and show active view
  document.querySelectorAll('section.view').forEach(section => {
    section.classList.remove('active');
  });
  
  const activeSection = document.getElementById(activeSectionId);
  if (activeSection) {
    activeSection.classList.add('active');
  }
  
  // Update bottom navigation active tab
  document.querySelectorAll('.bottom-nav .nav-item').forEach(navLink => {
    navLink.classList.remove('active');
  });
  
  const activeNavId = navMapping[activeSectionId];
  if (activeNavId) {
    const activeNavLink = document.getElementById(activeNavId);
    if (activeNavLink) {
      activeNavLink.classList.add('active');
    }
  }

  // Debug log
  console.log(`[Router] Navigated to view: ${window.PlanFlow.state.currentView} (${activeSectionId})`);

  // Extra Phase 1 polish: Render readable date in Today subtitle
  if (activeSectionId === 'today-view') {
    const dateSubtitle = document.getElementById('today-view-subtitle');
    if (dateSubtitle) {
      dateSubtitle.textContent = toReadableDate(today());
    }
  }
}

/**
 * Initialize App and Data Layer
 */
async function init() {
  console.log('[App] Initializing data layer...');
  try {
    // 1. Initialize user preferences (creates defaults if empty)
    window.PlanFlow.state.preferences = await getPreferences();
    console.log('[App] Preferences loaded');

    // 2. Seed database with starter data if empty
    await seedDatabase();

    // 3. Process stale plans from previous days (midnight rollover / missed days)
    const plans = await db.dailyPlans.toArray();
    for (const plan of plans) {
      if (isStale(plan)) {
        const hasPending = plan.plannedTasks.some(t => t.status === 'pending' || t.status === 'in-progress');
        if (hasPending) {
          await processEndOfDay(plan.id);
        }
      }
    }
    console.log('[App] Stale plan checks completed.');
  } catch (err) {
    console.error('[App] Database initialization failed:', err);
  }

  // Listen for hash changes
  window.addEventListener('hashchange', handleRoute);
  
  // Initialize route on first load
  handleRoute();
  
  // Setup minor interactive elements for testing
  setupInteractivity();

  // Register PWA Service Worker
  registerServiceWorker();
}

/**
 * Setup basic button actions for Phase 1 testing
 */
function setupInteractivity() {
  // Plan Now button routing
  const planNowBtn = document.getElementById('timeline-plan-now-btn');
  if (planNowBtn) {
    planNowBtn.addEventListener('click', () => {
      window.location.hash = '#plan';
    });
  }

  // Today view Replan button routing
  const replanBtn = document.getElementById('today-replan-btn');
  if (replanBtn) {
    replanBtn.addEventListener('click', () => {
      window.location.hash = '#plan';
    });
  }

  // Interruption FAB click logs
  const interruptionFab = document.getElementById('interruption-fab');
  if (interruptionFab) {
    interruptionFab.addEventListener('click', () => {
      showToastMessage('Something Came Up clicked 🌊', 'info');
    });
  }

  // Bucket Add Task FAB routing
  const bucketAddTaskBtn = document.getElementById('bucket-add-task-btn');
  if (bucketAddTaskBtn) {
    bucketAddTaskBtn.addEventListener('click', () => {
      window.location.hash = '#add-task';
    });
  }

  // Add Task Cancel button routing back to bucket
  const taskCancelBtn = document.getElementById('task-cancel-btn');
  if (taskCancelBtn) {
    taskCancelBtn.addEventListener('click', () => {
      window.location.hash = '#bucket';
    });
  }
}

/**
 * Registers PWA Service Worker
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => {
          console.log('[PWA] Service Worker registered successfully:', reg.scope);
        })
        .catch(err => {
          console.error('[PWA] Service Worker registration failed:', err);
        });
    });
  }
}

/**
 * Helper to show toast messages (temporary mockup for Phase 1)
 */
function showToastMessage(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  // Trigger CSS transition
  setTimeout(() => {
    toast.classList.add('active');
  }, 10);

  // Remove toast
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

// Run init on load
document.addEventListener('DOMContentLoaded', init);
export { showToastMessage };
