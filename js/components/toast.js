/* js/components/toast.js */

/**
 * Shows a toast notification on the screen.
 * @param {string} message The text to display
 * @param {"success" | "warning" | "danger" | "info"} [type] The status styling (default "info")
 * @param {number} [duration] How long to show in ms (default 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  // Set icons based on status type
  let emoji = 'ℹ️';
  if (type === 'success') emoji = '✅';
  else if (type === 'warning') emoji = '⚠️';
  else if (type === 'danger') emoji = '🚨';
  
  toast.innerHTML = `<span style="font-size: 1.1rem;">${emoji}</span> <span style="flex: 1;">${message}</span>`;
  container.appendChild(toast);

  // Trigger entering animation
  setTimeout(() => {
    toast.classList.add('active');
  }, 10);

  // Animate exit and remove
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}
