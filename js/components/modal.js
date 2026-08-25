/* js/components/modal.js */

let activeCloseCallback = null;
let isInitialized = false;

// Swipe-to-dismiss gesture state
let startY = 0;
let currentY = 0;

/**
 * Initializes the modal event listeners once on startup.
 */
export function initModal() {
  if (isInitialized) return;

  const overlay = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('bottom-sheet-close');
  const sheet = document.getElementById('bottom-sheet');

  if (!overlay || !sheet) return;

  // Static click handlers (bound once)
  overlay.addEventListener('click', closeModal);
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  // Pointer swipe-to-dismiss drag handler
  sheet.addEventListener('pointerdown', handlePointerDown);

  isInitialized = true;
}

/**
 * Opens the bottom sheet modal with specified title and content.
 * @param {string} title Modal header title
 * @param {HTMLElement|string} content HTML element or string of content to insert
 * @param {Function} [onClose] Callback executed when modal is closed
 */
export function openModal(title, content, onClose = null) {
  // Ensure event listeners are bound
  initModal();

  const overlay = document.getElementById('modal-overlay');
  const sheet = document.getElementById('bottom-sheet');
  const titleEl = document.getElementById('bottom-sheet-title');
  const contentEl = document.getElementById('bottom-sheet-content');

  if (!overlay || !sheet || !titleEl || !contentEl) return;

  titleEl.textContent = title;
  
  if (content instanceof HTMLElement) {
    contentEl.innerHTML = '';
    contentEl.appendChild(content);
  } else {
    contentEl.innerHTML = content;
  }

  activeCloseCallback = onClose;

  // Reset any leftover gesture offsets/transitions
  sheet.style.transform = '';
  sheet.style.transition = '';

  // Animate in
  overlay.classList.add('active');
  sheet.classList.add('active');
}

/**
 * Closes the active bottom sheet modal.
 */
export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  const sheet = document.getElementById('bottom-sheet');

  if (!overlay || !sheet) return;

  overlay.classList.remove('active');
  sheet.classList.remove('active');

  if (activeCloseCallback) {
    activeCloseCallback();
    activeCloseCallback = null;
  }
}

function handlePointerDown(e) {
  // CRITICAL: Do not capture pointer if clicking button, input, select, link, or textarea
  if (
    e.target.closest('button') || 
    e.target.closest('input') || 
    e.target.closest('select') || 
    e.target.closest('textarea') || 
    e.target.closest('a')
  ) {
    return;
  }

  // Only allow drag starting from the handle or header container
  if (
    !e.target.classList.contains('bottom-sheet-handle') && 
    !e.target.closest('.bottom-sheet-header')
  ) {
    return;
  }

  const sheet = document.getElementById('bottom-sheet');
  startY = e.clientY;
  sheet.setPointerCapture(e.pointerId);
  sheet.addEventListener('pointermove', handlePointerMove);
  sheet.addEventListener('pointerup', handlePointerUp);
  sheet.addEventListener('pointercancel', handlePointerCancel);
  sheet.style.transition = 'none';
}

function handlePointerMove(e) {
  const sheet = document.getElementById('bottom-sheet');
  currentY = e.clientY - startY;
  if (currentY > 0) {
    sheet.style.transform = `translateY(${currentY}px)`;
  }
}

function handlePointerUp(e) {
  const sheet = document.getElementById('bottom-sheet');
  sheet.releasePointerCapture(e.pointerId);
  cleanupPointerListeners();
  
  sheet.style.transition = 'transform var(--transition-slow)';
  
  if (currentY > 100) {
    closeModal();
  } else {
    sheet.style.transform = 'translateY(0)';
  }
  currentY = 0;
}

function handlePointerCancel(e) {
  const sheet = document.getElementById('bottom-sheet');
  sheet.releasePointerCapture(e.pointerId);
  cleanupPointerListeners();
  sheet.style.transition = 'transform var(--transition-slow)';
  sheet.style.transform = 'translateY(0)';
  currentY = 0;
}

function cleanupPointerListeners() {
  const sheet = document.getElementById('bottom-sheet');
  sheet.removeEventListener('pointermove', handlePointerMove);
  sheet.removeEventListener('pointerup', handlePointerUp);
  sheet.removeEventListener('pointercancel', handlePointerCancel);
}
