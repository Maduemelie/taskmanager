/* js/components/nav.js */

/**
 * Initializes and wires bottom navigation tab click events.
 * Triggers route hash change which activates the router in app.js.
 */
export function initNavigation() {
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');
  
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Allow default hash routing
      // Optional: Add active click feedback classes/animations
      item.classList.add('nav-clicked');
      setTimeout(() => {
        item.classList.remove('nav-clicked');
      }, 300);
    });
  });

  // Inject navigation styling for click animation if not already injected
  if (!document.getElementById('nav-click-animation-style')) {
    const style = document.createElement('style');
    style.id = 'nav-click-animation-style';
    style.textContent = `
      .bottom-nav .nav-item {
        position: relative;
        overflow: hidden;
      }
      .bottom-nav .nav-item::after {
        content: '';
        position: absolute;
        width: 40px;
        height: 40px;
        background: rgba(232, 112, 58, 0.1);
        border-radius: 50%;
        transform: scale(0);
        opacity: 0;
        pointer-events: none;
        transition: transform 0.3s ease, opacity 0.3s ease;
      }
      .bottom-nav .nav-item.nav-clicked::after {
        transform: scale(1.5);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }
}
