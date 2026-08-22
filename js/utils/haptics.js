/* js/utils/haptics.js */

/**
 * Triggers a short vibration on mobile devices (Android) that support the Vibration API.
 * Gracefully ignores on unsupported devices/browsers (like iOS Safari).
 * @param {number|Array<number>} duration Duration of the pulse in milliseconds (default 10)
 */
export function triggerHaptic(duration = 15) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(duration);
    } catch (e) {
      console.log('[Haptics] Failed to vibrate:', e);
    }
  }
}
