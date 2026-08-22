/* js/components/modal.js */

let activeCloseCallback = null;

/**
 * Opens the bottom sheet modal with specified title and content.
 * @param {string} title Modal header title
 * @param {HTMLElement|string} content HTML element or string of content to insert
 * @param {Function} [onClose] Callback executed when modal is closed
 */
export function openModal(title, content, onClose = null) {
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

  // Animate in
  overlay.classList.add('active');
  sheet.classList.add('active');

  // Wire up close events once
  setupModalCloseListeners();
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

function setupModalCloseListeners() {
  const overlay = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('bottom-sheet-close');
  const sheet = document.getElementById('bottom-sheet');

  const handleClose = (e) => {
    e.preventDefault();
    closeModal();
    removeListeners();
  };

  const removeListeners = () => {
    overlay.removeEventListener('click', handleClose);
    if (closeBtn) closeBtn.removeEventListener('click', handleClose);
    sheet.removeEventListener('pointerdown', handlePointerDown);
  };

  overlay.addEventListener('click', handleClose);
  if (closeBtn) closeBtn.addEventListener('click', handleClose);

  // Swipe-to-dismiss gesture handling using pointer events
  let startY = 0;
  let currentY = 0;
  
  function handlePointerDown(e) {
    // Only drag from sheet handle or header
    if (!e.target.classList.contains('bottom-sheet-handle') && 
        !e.target.closest('.bottom-sheet-header')) return;
        
    startY = e.clientY;
    sheet.setPointerCapture(e.pointerId);
    sheet.addEventListener('pointermove', handlePointerMove);
    sheet.addEventListener('pointerup', handlePointerUp);
    sheet.style.transition = 'none';
  }

  function handlePointerMove(e) {
    currentY = e.clientY - startY;
    if (currentY > 0) {
      sheet.style.transform = `translateY(${currentY}px)`;
    }
  }

  function handlePointerUp(e) {
    sheet.releasePointerCapture(e.pointerId);
    sheet.removeEventListener('pointermove', handlePointerMove);
    sheet.removeEventListener('pointerup', handlePointerUp);
    
    sheet.style.transition = 'transform var(--transition-slow)';
    
    if (currentY > 100) {
      closeModal();
    } else {
      sheet.style.transform = 'translateY(0)';
    }
    currentY = 0;
  }

  sheet.addEventListener('pointerdown', handlePointerDown);
}
