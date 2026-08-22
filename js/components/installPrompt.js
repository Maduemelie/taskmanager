/* js/components/installPrompt.js */
import { showToast } from './toast.js';

/**
 * Checks if the device is iOS and not running in standalone mode,
 * then displays an install instructions banner at the top of the page.
 */
export function initInstallPrompt() {
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = ('standalone' in window.navigator) && window.navigator.standalone;
  const dismissed = localStorage.getItem('ios-prompt-dismissed');

  if (isiOS && !isStandalone && dismissed !== 'true') {
    renderInstallBanner();
  }

  // Handle standard Android A2HS (Add to Home Screen) install trigger logs
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent default Chrome banner if desired, but we'll let Chrome handle it natively.
    console.log('[PWA] Android install prompt detected.');
  });
}

function renderInstallBanner() {
  const banner = document.createElement('div');
  banner.id = 'ios-install-banner';
  banner.style.position = 'fixed';
  banner.style.top = 'calc(var(--spacing-lg) + env(safe-area-inset-top, 0px))';
  banner.style.left = '50%';
  banner.style.transform = 'translateX(-50%)';
  banner.style.width = '90%';
  banner.style.maxWidth = '400px';
  banner.style.backgroundColor = 'var(--surface-color)';
  banner.style.color = 'var(--text-color)';
  banner.style.borderRadius = 'var(--radius-lg)';
  banner.style.boxShadow = 'var(--shadow-lg)';
  banner.style.border = '1px solid var(--border-color)';
  banner.style.padding = 'var(--spacing-lg)';
  banner.style.zIndex = '9999';
  banner.style.display = 'flex';
  banner.style.flexDirection = 'column';
  banner.style.gap = 'var(--spacing-sm)';

  banner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h3 style="font-size:1rem;font-weight:800;">Install PlanFlow</h3>
      <button id="ios-prompt-close" class="btn btn-ghost" style="padding:0;font-size:1.1rem;color:var(--text-light);">✖</button>
    </div>
    <p style="font-size:0.85rem;line-height:1.4;margin:0;">
      Add PlanFlow to your home screen for quick offline access:
    </p>
    <div style="font-size:0.85rem;display:flex;align-items:center;gap:var(--spacing-sm);background-color:var(--bg-color);padding:8px;border-radius:var(--radius-sm);">
      <span style="font-size:1.2rem;">Share 📤</span>
      <span style="line-height:1.2;">Tap the Share icon at the bottom of Safari, then choose <strong>'Add to Home Screen'</strong>.</span>
    </div>
  `;

  document.body.appendChild(banner);

  // Animate banner entry
  banner.style.opacity = '0';
  banner.style.transform = 'translate(-50%, -20px)';
  banner.animate([
    { opacity: 0, transform: 'translate(-50%, -20px)' },
    { opacity: 1, transform: 'translate(-50%, 0)' }
  ], {
    duration: 350,
    easing: 'ease-out',
    fill: 'forwards'
  });

  // Wire up close
  document.getElementById('ios-prompt-close').addEventListener('click', () => {
    localStorage.setItem('ios-prompt-dismissed', 'true');
    banner.animate([
      { opacity: 1, transform: 'translate(-50%, 0)' },
      { opacity: 0, transform: 'translate(-50%, -20px)' }
    ], {
      duration: 300,
      easing: 'ease-in',
      fill: 'forwards'
    }).onfinish = () => {
      banner.remove();
      showToast('Install prompt dismissed', 'info');
    };
  });
}
