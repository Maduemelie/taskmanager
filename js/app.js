/* js/app.js */
import { toReadableDate, today } from './utils/date.js';
import db from './db.js';
import { seedDatabase } from './seed.js';
import { getPreferences } from './models/preferences.js';
import { getPlanForDate, processEndOfDay, isStale } from './models/plan.js';
import { runPipelineTests } from './engine/test-pipeline.js';

// Import views
import { initTodayView, renderTodayView } from './views/today.js';
import { initPlanDayView, renderPlanDayView } from './views/planDay.js';
import { initBucketView, renderBucketView } from './views/bucket.js';
import { initAddTaskView, renderAddTaskView } from './views/addTask.js';
import { initSettingsView, renderSettingsView } from './views/settings.js';
import { initNavigation } from './components/nav.js';

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

// Map of view renderers
const viewRenderers = {
  'today-view': renderTodayView,
  'plan-view': renderPlanDayView,
  'bucket-view': renderBucketView,
  'settings-view': renderSettingsView,
  'add-task-view': renderAddTaskView
};

/**
 * Hash router function
 */
function handleRoute() {
  // Strip query parameters for routing logic
  const hash = window.location.hash.split('?')[0];
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

  // Render view-specific content
  const renderFn = viewRenderers[activeSectionId];
  if (renderFn) {
    renderFn();
  }

  // Polish: Render readable date in Today subtitle
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

  // Initialize navigation & view managers
  initNavigation();
  initTodayView();
  initPlanDayView();
  initBucketView();
  initAddTaskView();
  initSettingsView();

  // Listen for hash changes
  window.addEventListener('hashchange', handleRoute);
  
  // Initialize route on first load
  handleRoute();

  // Visibility change listener to auto-refresh view if user switches back to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[App] App resumed from background. Re-rendering view.');
      handleRoute();
    }
  });

  // Run planning engine pipeline tests in console (Phase 3 validation)
  runPipelineTests();

  // Register PWA Service Worker
  registerServiceWorker();
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

// Run init on load
document.addEventListener('DOMContentLoaded', init);
