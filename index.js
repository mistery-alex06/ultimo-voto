/**
 * AETHER PORTFOLIO - DYNAMIC LOGIC & INTERACTIONS
 */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initMobileMenu();
  initScrollReveal();
  initCardTilt();
  initFormValidation();
});

/**
 * 1. Chromatic Scroll Theme Handler (Red -> Yellow -> Blue)
 */
let scrollListenerActive = false;

function handleScrollColors() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (maxScroll <= 0) return;
  const scrollPercent = window.scrollY / maxScroll;

  let hue, bgHue, bgSat, bgLight;
  let r, g, b;

  if (scrollPercent <= 0.5) {
    const t = scrollPercent / 0.5; // normalized 0 -> 1
    
    // Hue: Red (355 / -5) to Yellow (45)
    hue = -5 + (45 - (-5)) * t;
    bgHue = -5 + (45 - (-5)) * t;
    bgSat = 30 + (22 - 30) * t;
    bgLight = 7 + (5 - 7) * t;

    // Glass color (RGB): Red glass (35, 12, 15) to Yellow glass (28, 22, 12)
    r = Math.round(35 + (28 - 35) * t);
    g = Math.round(12 + (22 - 12) * t);
    b = Math.round(15 + (12 - 15) * t);
  } else {
    const t = (scrollPercent - 0.5) / 0.5; // normalized 0 -> 1
    
    // Hue: Yellow (45) to Blue (210)
    hue = 45 + (210 - 45) * t;
    bgHue = 45 + (210 - 45) * t;
    bgSat = 22 + (28 - 22) * t;
    bgLight = 5 + (6 - 5) * t;

    // Glass color (RGB): Yellow glass (28, 22, 12) to Blue glass (12, 18, 28)
    r = Math.round(28 + (12 - 28) * t);
    g = Math.round(22 + (18 - 22) * t);
    b = Math.round(12 + (28 - 12) * t);
  }

  // Normalize hue
  hue = (Math.round(hue) + 360) % 360;
  bgHue = (Math.round(bgHue) + 360) % 360;
  bgSat = Math.round(bgSat);
  bgLight = Math.round(bgLight);

  const root = document.documentElement;
  root.style.setProperty('--accent-primary', `hsl(${hue}, 95%, 55%)`);
  root.style.setProperty('--accent-secondary', `hsl(${(hue + 35) % 360}, 95%, 50%)`);
  root.style.setProperty('--accent-glow', `hsla(${hue}, 95%, 55%, 0.18)`);
  
  root.style.setProperty('--bg-primary', `hsl(${bgHue}, ${bgSat}%, ${bgLight}%)`);
  root.style.setProperty('--bg-secondary', `hsl(${bgHue}, ${bgSat}%, ${bgLight + 3}%)`);
  root.style.setProperty('--bg-tertiary', `hsl(${bgHue}, ${bgSat}%, ${bgLight + 6}%)`);
  
  root.style.setProperty('--glass-bg', `rgba(${r}, ${g}, ${b}, 0.65)`);
  root.style.setProperty('--glass-border', `hsla(${hue}, 95%, 70%, 0.1)`);
  root.style.setProperty('--glass-border-hover', `hsla(${hue}, 95%, 70%, 0.18)`);
  root.style.setProperty('--glass-shadow', `0 8px 32px 0 hsla(${hue}, 95%, 15%, 0.3)`);
}

function enableScrollTheme() {
  if (!scrollListenerActive) {
    window.addEventListener('scroll', handleScrollColors);
    scrollListenerActive = true;
  }
  handleScrollColors();
  document.getElementById('theme-toggle').classList.add('active');
}

function disableScrollTheme() {
  if (scrollListenerActive) {
    window.removeEventListener('scroll', handleScrollColors);
    scrollListenerActive = false;
  }
  document.getElementById('theme-toggle').classList.remove('active');
  
  const root = document.documentElement;
  root.style.removeProperty('--accent-primary');
  root.style.removeProperty('--accent-secondary');
  root.style.removeProperty('--accent-glow');
  root.style.removeProperty('--bg-primary');
  root.style.removeProperty('--bg-secondary');
  root.style.removeProperty('--bg-tertiary');
  root.style.removeProperty('--glass-bg');
  root.style.removeProperty('--glass-border');
  root.style.removeProperty('--glass-border-hover');
  root.style.removeProperty('--glass-shadow');
}

function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  
  // Chromatic scroll theme is enabled by default
  let scrollThemeActive = localStorage.getItem('scroll-theme') !== 'disabled';
  
  if (scrollThemeActive) {
    enableScrollTheme();
  } else {
    disableScrollTheme();
  }

  themeToggle.addEventListener('click', () => {
    scrollThemeActive = !scrollThemeActive;
    if (scrollThemeActive) {
      localStorage.setItem('scroll-theme', 'enabled');
      enableScrollTheme();
      showToast('Effetto Scorrimento Cromatico attivato!');
    } else {
      localStorage.setItem('scroll-theme', 'disabled');
      disableScrollTheme();
      showToast('Tema classico Aether (Viola/Ciano) ripristinato!');
    }
  });
}

/**
 * 2. Mobile Menu Toggle
 */
function initMobileMenu() {
  const navToggle = document.getElementById('nav-toggle');
  const navMenu = document.getElementById('nav-menu');
  const navLinks = document.querySelectorAll('.nav-link');

  navToggle.addEventListener('click', () => {
    const isOpen = navToggle.classList.toggle('open');
    navMenu.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', isOpen);
  });

  // Close menu when clicking on a nav link
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      navToggle.classList.remove('open');
      navMenu.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

/**
 * 3. Scroll Reveal Animation using IntersectionObserver
 */
function initScrollReveal() {
  const revealElements = document.querySelectorAll('.reveal');
  
  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        // Once revealed, we don't need to observe it anymore
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px'
  });

  revealElements.forEach(el => {
    observer.observe(el);
  });
}

/**
 * 4. Premium Mouse Hover Tilt Effect for Hero Card
 */
function initCardTilt() {
  const card = document.querySelector('.hero-visual-card');
  const wrapper = document.querySelector('.hero-visual');
  
  if (!card || !wrapper) return;

  wrapper.addEventListener('mousemove', (e) => {
    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left; // Mouse position X within wrapper
    const y = e.clientY - rect.top;  // Mouse position Y within wrapper
    
    // Normalize coordinates (from -0.5 to 0.5)
    const normalizedX = (x / rect.width) - 0.5;
    const normalizedY = (y / rect.height) - 0.5;
    
    // Set max tilt angle (degrees)
    const maxTilt = 15;
    const tiltX = (normalizedY * maxTilt).toFixed(2);
    const tiltY = -(normalizedX * maxTilt).toFixed(2);
    
    // Apply transform and slight shift
    card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.02, 1.02, 1.02)`;
  });

  wrapper.addEventListener('mouseleave', () => {
    // Reset back smoothly
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    card.style.transition = 'transform 0.5s ease-out';
  });
  
  wrapper.addEventListener('mouseenter', () => {
    // Remove transition when mouse is moving so tilting is responsive
    card.style.transition = 'none';
  });
}

/**
 * 5. Interactive Form Validation and Submission
 */
function initFormValidation() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const inputs = form.querySelectorAll('.form-input');

  // Validate on blur/input
  inputs.forEach(input => {
    input.addEventListener('blur', () => validateInput(input));
    input.addEventListener('input', () => {
      // If error is currently displayed, validate in real time
      const errorSpan = document.getElementById(`${input.id}-error`);
      if (errorSpan && errorSpan.style.display === 'block') {
        validateInput(input);
      }
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    
    let isFormValid = true;
    inputs.forEach(input => {
      if (!validateInput(input)) {
        isFormValid = false;
      }
    });

    if (isFormValid) {
      // Create a premium notification toast
      showToast('Messaggio inviato con successo! Ti risponderò al più presto.');
      form.reset();
      
      // Reset inputs state
      inputs.forEach(input => {
        input.classList.remove('valid');
        const errorSpan = document.getElementById(`${input.id}-error`);
        if (errorSpan) errorSpan.style.display = 'none';
      });
    }
  });
}

function validateInput(input) {
  const errorSpan = document.getElementById(`${input.id}-error`);
  let isValid = true;

  if (input.type === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    isValid = emailRegex.test(input.value.trim());
  } else if (input.id === 'name') {
    isValid = input.value.trim().length >= 3;
  } else if (input.id === 'message') {
    isValid = input.value.trim().length >= 10;
  }

  if (!isValid) {
    if (errorSpan) errorSpan.style.display = 'block';
    input.style.borderColor = 'hsl(0, 85%, 60%)';
    return false;
  } else {
    if (errorSpan) errorSpan.style.display = 'none';
    input.style.borderColor = 'var(--glass-border)';
    return true;
  }
}

/**
 * Helper: Floating Toast Notification
 */
function showToast(message) {
  // Check if a toast already exists
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.innerText = message;
  
  // Style toast dynamically
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '30px',
    right: '30px',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(10px)',
    webkitBackdropFilter: 'blur(10px)',
    border: '1px solid var(--accent-primary)',
    color: 'var(--text-primary)',
    padding: '16px 28px',
    borderRadius: '12px',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.35)',
    zIndex: '1000',
    fontFamily: 'var(--font-heading)',
    fontWeight: '600',
    opacity: '0',
    transform: 'translateY(20px)',
    transition: 'opacity 0.4s ease, transform 0.4s ease'
  });

  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 50);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
