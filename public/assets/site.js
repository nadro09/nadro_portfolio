'use strict';
// Public site interactions: sticky header shadow, mobile navigation, reveal on scroll.
(function () {
  const header = document.getElementById('siteHeader');
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('siteNav');

  function onScroll() {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });
  }

  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('visible'); });
  }

  // Booking form: keep the selected center consistent with the chosen wilaya.
  const wilayaSelect = document.querySelector('[data-booking-wilaya]');
  const centerSelect = document.querySelector('[data-booking-center]');
  if (wilayaSelect && centerSelect) {
    const syncCenters = function () {
      const wilaya = wilayaSelect.value;
      Array.prototype.forEach.call(centerSelect.options, function (opt) {
        if (!opt.value) return;
        const match = !wilaya || opt.dataset.wilaya === wilaya;
        opt.hidden = !match;
        opt.disabled = !match;
      });
      if (centerSelect.selectedOptions[0] && centerSelect.selectedOptions[0].hidden) centerSelect.value = '';
    };
    wilayaSelect.addEventListener('change', syncCenters);
    syncCenters();
  }

  // Hero gallery: dots switch between the uploaded images, auto-rotate slowly.
  document.querySelectorAll('[data-gallery]').forEach(function (gallery) {
    const slides = gallery.querySelectorAll('[data-slide]');
    const dots = gallery.querySelectorAll('[data-goto]');
    if (!slides.length) return;
    function show(index) {
      slides.forEach(function (img, i) { img.classList.toggle('is-active', i === index); });
      dots.forEach(function (dot, i) { dot.classList.toggle('is-active', i === index); });
    }
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () { show(parseInt(dot.dataset.goto, 10) || 0); });
    });
    if (slides.length > 1) {
      let current = 0;
      setInterval(function () { current = (current + 1) % slides.length; show(current); }, 6000);
    }
  });

  // Coverage map: clicking a covered wilaya opens its centres.
  document.querySelectorAll('.dz-shape[data-wilaya]').forEach(function (shape) {
    function go() {
      const lang = document.documentElement.lang || 'ar';
      window.location.href = '/centers?wilaya=' + encodeURIComponent(shape.dataset.wilaya) + '&lang=' + lang;
    }
    shape.addEventListener('click', go);
    shape.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  // Minimum date = today (local).
  const dateInput = document.querySelector('input[type="date"][data-min-today]');
  if (dateInput && !dateInput.value) {
    const now = new Date();
    const iso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    dateInput.min = iso;
  }
})();
