/* js/components/onboarding.js */
import { resetDemoData } from '../seed.js';
import { updatePreferences } from '../models/preferences.js';
import { showToast } from './toast.js';

let onboardingCapacity = 180;

/**
 * Checks if onboarding is completed. If not, spawns the full-screen onboarding wizard overlay.
 */
export function checkOnboarding() {
  const completed = localStorage.getItem('onboarding-completed');
  if (completed === 'true') return;

  renderOnboardingOverlay();
}

function renderOnboardingOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'var(--bg-color)';
  overlay.style.zIndex = '10000';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = 'var(--spacing-xl)';

  const container = document.createElement('div');
  container.className = 'card';
  container.style.width = '100%';
  container.style.maxWidth = '360px';
  container.style.padding = 'var(--spacing-xl)';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = 'var(--spacing-lg)';
  container.style.boxShadow = 'var(--shadow-lg)';
  container.style.border = '1px solid var(--border-color)';
  overlay.appendChild(container);

  document.body.appendChild(overlay);

  // Load Screen 1
  showScreen1(container);
}

function showScreen1(container) {
  container.innerHTML = `
    <div style="text-align:center;font-size:3.5rem;">🧘‍♂️</div>
    <h2 style="text-align:center;font-weight:800;">Welcome to PlanFlow</h2>
    <p style="text-align:center;color:var(--text-muted);font-size:0.9rem;line-height:1.5;">
      Your adaptive, offline-first task planner designed for busy lives. Plan daily focus capacity instead of overwhelming todo lists.
    </p>
    <button id="onboard-next-1" class="btn btn-primary" style="margin-top:var(--spacing-sm);width:100%;">
      Next
    </button>
  `;

  document.getElementById('onboard-next-1').addEventListener('click', () => {
    // Transition slide/fade effect
    container.animate([
      { opacity: 1, transform: 'translateX(0)' },
      { opacity: 0, transform: 'translateX(-30px)' }
    ], { duration: 250, easing: 'ease-in' }).onfinish = () => {
      showScreen2(container);
    };
  });
}

function showScreen2(container) {
  container.innerHTML = `
    <div style="text-align:center;font-size:3.5rem;">⏱️</div>
    <h2 style="text-align:center;font-weight:800;">Daily Capacity</h2>
    <p style="text-align:center;color:var(--text-muted);font-size:0.9rem;line-height:1.4;">
      How much total focus time do you want to target each day? (Tasks are scheduled to fit this limit).
    </p>
    <div class="form-group" style="margin-top:var(--spacing-sm);">
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.1rem;margin-bottom:var(--spacing-xs);">
        <span>Capacity Target</span>
        <span id="onboard-capacity-display" style="color:var(--primary-color);">3h 0m</span>
      </div>
      <input type="range" id="onboard-capacity-slider" class="range" min="60" max="600" step="30" value="180" style="width:100%;">
    </div>
    <button id="onboard-next-2" class="btn btn-primary" style="width:100%;">
      Next
    </button>
  `;

  // Entrance slide-in/fade-in animation
  container.animate([
    { opacity: 0, transform: 'translateX(30px)' },
    { opacity: 1, transform: 'translateX(0)' }
  ], { duration: 250, easing: 'ease-out' });

  const slider = document.getElementById('onboard-capacity-slider');
  const display = document.getElementById('onboard-capacity-display');

  slider.addEventListener('input', (e) => {
    const min = parseInt(e.target.value, 10);
    onboardingCapacity = min;
    const h = Math.floor(min / 60);
    const m = min % 60;
    display.textContent = `${h}h ${m}m`;
  });

  document.getElementById('onboard-next-2').addEventListener('click', () => {
    container.animate([
      { opacity: 1, transform: 'translateX(0)' },
      { opacity: 0, transform: 'translateX(-30px)' }
    ], { duration: 250, easing: 'ease-in' }).onfinish = () => {
      showScreen3(container);
    };
  });
}

function showScreen3(container) {
  container.innerHTML = `
    <div style="text-align:center;font-size:3.5rem;">✨</div>
    <h2 style="text-align:center;font-weight:800;">Ready to Start?</h2>
    <p style="text-align:center;color:var(--text-muted);font-size:0.9rem;line-height:1.4;">
      Choose how you'd like to initialize your task bucket:
    </p>
    <div style="display:flex;flex-direction:column;gap:var(--spacing-sm);margin-top:var(--spacing-sm);width:100%;">
      <button id="onboard-demo" class="btn btn-primary" style="width:100%;">
        🚀 Explore with Demo Data
      </button>
      <button id="onboard-fresh" class="btn btn-secondary" style="width:100%;border:1px solid var(--border-color);">
        🌱 Start Fresh (Clean Slate)
      </button>
    </div>
  `;

  // Entrance slide-in/fade-in animation
  container.animate([
    { opacity: 0, transform: 'translateX(30px)' },
    { opacity: 1, transform: 'translateX(0)' }
  ], { duration: 250, easing: 'ease-out' });

  document.getElementById('onboard-demo').addEventListener('click', async () => {
    await updatePreferences({ defaultCapacity: onboardingCapacity });
    await resetDemoData();
    finishOnboarding();
  });

  document.getElementById('onboard-fresh').addEventListener('click', async () => {
    // Keep clean slate but apply capacity
    await updatePreferences({ defaultCapacity: onboardingCapacity });
    finishOnboarding();
  });
}

function finishOnboarding() {
  localStorage.setItem('onboarding-completed', 'true');
  const overlay = document.getElementById('onboarding-overlay');
  
  if (overlay) {
    overlay.animate([
      { opacity: 1 },
      { opacity: 0 }
    ], { duration: 350, easing: 'ease-in' }).onfinish = () => {
      overlay.remove();
      showToast('Welcome to PlanFlow! 🎉', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 500);
    };
  }
}
