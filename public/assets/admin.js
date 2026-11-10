'use strict';
(function () {
  const sidebar = document.getElementById('adminSidebar');
  const toggle = document.getElementById('sidebarToggle');
  const overlay = document.getElementById('sidebarOverlay');

  function close() {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      const open = !sidebar.classList.contains('open');
      sidebar.classList.toggle('open', open);
      if (overlay) overlay.classList.toggle('show', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  if (overlay) overlay.addEventListener('click', close);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  // Confirmation before sensitive actions.
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Auto-hide success/info messages.
  document.querySelectorAll('.alert-success').forEach(function (el) {
    setTimeout(function () {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 450);
    }, 6000);
  });

  // Copy-to-clipboard for temporary passwords / references.
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const text = btn.getAttribute('data-copy');
      if (navigator.clipboard) navigator.clipboard.writeText(text);
    });
  });

  // Keep the employee center select consistent with the chosen role scope.
  document.querySelectorAll('input[data-role-all-centers]').forEach(function (input) {
    const form = input.closest('form');
    if (!form) return;
    const centerField = form.querySelector('[data-center-field]');
    const sync = function () {
      const anyAll = Array.prototype.some.call(form.querySelectorAll('input[data-role-all-centers]:checked'), function (el) {
        return el.getAttribute('data-role-all-centers') === 'true';
      });
      if (centerField) centerField.style.opacity = anyAll ? '.65' : '1';
    };
    form.querySelectorAll('input[data-role-all-centers]').forEach(function (el) {
      el.addEventListener('change', sync);
    });
    sync();
  });

  // ---------- AI assistant ----------
  const aiWidget = document.getElementById('aiWidget');
  const chatBody = document.getElementById('chatBody');
  if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;

  if (aiWidget) {
    const fab = document.getElementById('aiFab');
    const panel = document.getElementById('aiPanel');
    const closeBtn = document.getElementById('aiClose');
    const log = document.getElementById('aiLog');
    const form = document.getElementById('aiForm');
    const input = document.getElementById('aiInput');
    const csrf = aiWidget.getAttribute('data-csrf');
    const fr = aiWidget.getAttribute('data-lang') === 'fr';
    const history = [];

    const togglePanel = function (open) {
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && input) input.focus();
    };
    const push = function (text, cls) {
      const el = document.createElement('div');
      el.className = 'ai-msg ' + cls;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    };
    const failure = function (code) {
      if (code === 'not_configured') {
        return fr ? 'Assistant non activé : ajoutez la clé AI_API_KEY dans les paramètres.'
                  : 'المساعد غير مفعّل: أضف المفتاح AI_API_KEY من صفحة الإعدادات.';
      }
      return fr ? 'Réponse indisponible pour le moment.' : 'تعذّر الحصول على رد الآن.';
    };

    fab.addEventListener('click', function () { togglePanel(panel.hidden); });
    if (closeBtn) closeBtn.addEventListener('click', function () { togglePanel(false); });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      input.value = '';
      push(message, 'user');
      const pending = push('…', 'bot pending');
      try {
        const res = await fetch('/admin/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ message: message, history: history, context: location.pathname }),
        });
        const data = await res.json().catch(function () { return {}; });
        pending.remove();
        if (!res.ok || !data.reply) {
          push(failure(data.error), 'bot');
          return;
        }
        push(data.reply, 'bot');
        history.push({ role: 'user', content: message }, { role: 'assistant', content: data.reply });
      } catch (err) {
        pending.remove();
        push(failure('provider'), 'bot');
      }
    });

    // AI draft for the reply box of an internal conversation.
    const aiReplyBtn = document.getElementById('aiReplyBtn');
    const bodyField = document.getElementById('body');
    if (aiReplyBtn && bodyField) {
      aiReplyBtn.addEventListener('click', async function () {
        const rows = Array.prototype.slice.call(document.querySelectorAll('.chat-row'), -12).map(function (row) {
          const who = row.querySelector('.who');
          const txt = row.querySelector('.txt');
          return (who ? who.textContent.trim() : '') + ': ' + (txt ? txt.textContent.trim() : '');
        });
        aiReplyBtn.disabled = true;
        try {
          const res = await fetch('/admin/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': aiReplyBtn.getAttribute('data-csrf') },
            body: JSON.stringify({ mode: 'reply', message: rows.join('\n') }),
          });
          const data = await res.json().catch(function () { return {}; });
          if (res.ok && data.reply) {
            bodyField.value = data.reply;
            bodyField.focus();
          } else if (!res.ok) {
            window.alert(failure(data.error));
          }
        } finally {
          aiReplyBtn.disabled = false;
        }
      });
    }
  }
})();
