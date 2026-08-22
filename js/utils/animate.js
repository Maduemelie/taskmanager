/* js/utils/animate.js */

/**
 * Animates an element by fading it in.
 * @param {HTMLElement} el The element to animate
 * @param {number} [duration] Duration in milliseconds (default 300)
 * @param {number} [delay] Delay before starting in milliseconds (default 0)
 */
export function fadeIn(el, duration = 300, delay = 0) {
  if (!el) return;
  el.animate([
    { opacity: 0 },
    { opacity: 1 }
  ], {
    duration,
    delay,
    fill: 'forwards',
    easing: 'ease-out'
  });
}

/**
 * Animates an element by sliding it up and fading it in.
 * Uses a smooth spring-feel easing curve.
 * @param {HTMLElement} el The element to animate
 * @param {number} [distance] Starting Y offset in pixels (default 20)
 * @param {number} [duration] Duration in milliseconds (default 350)
 * @param {number} [delay] Delay in milliseconds (default 0)
 */
export function slideUp(el, distance = 20, duration = 350, delay = 0) {
  if (!el) return;
  el.animate([
    { opacity: 0, transform: `translateY(${distance}px)` },
    { opacity: 1, transform: 'translateY(0)' }
  ], {
    duration,
    delay,
    fill: 'forwards',
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' // Spring easing
  });
}

/**
 * Runs a list of element animations with a staggered delay.
 * @param {Array<HTMLElement>|NodeList} elements Elements to animate
 * @param {Function} animFn Animation function (e.g. slideUp)
 * @param {number} [staggerDelay] Delay between each elements in ms (default 50)
 */
export function stagger(elements, animFn, staggerDelay = 50) {
  const arr = Array.from(elements);
  arr.forEach((el, index) => {
    animFn(el, index * staggerDelay);
  });
}

/**
 * Triggers a spring scale animation (pop effect) on an element.
 * @param {HTMLElement} el 
 * @param {number} [duration] (default 300)
 */
export function popEffect(el, duration = 300) {
  if (!el) return;
  el.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(1.08)' },
    { transform: 'scale(0.97)' },
    { transform: 'scale(1)' }
  ], {
    duration,
    easing: 'ease-in-out'
  });
}
