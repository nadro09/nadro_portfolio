'use strict';
// Customer-facing assistant widget. Talks to POST /api/assistant and keeps the
// last few turns so follow-up questions stay in context.
(function () {
  var root = document.getElementById('assistant');
  if (!root) return;

  var launcher = document.getElementById('assistantLauncher');
  var panel = document.getElementById('assistantPanel');
  var closeBtn = document.getElementById('assistantClose');
  var form = document.getElementById('assistantForm');
  var input = document.getElementById('assistantInput');
  var sendBtn = document.getElementById('assistantSend');
  var log = document.getElementById('assistantLog');

  var history = [];
  var started = false;
  var busy = false;

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function addMessage(text, kind, extraClass) {
    var node = document.createElement('div');
    node.className = 'assistant-msg is-' + kind + (extraClass ? ' ' + extraClass : '');
    if (extraClass === 'is-thinking') {
      node.innerHTML = '<span></span><span></span><span></span>';
      node.setAttribute('aria-label', root.dataset.thinking || '');
    } else {
      node.textContent = text;
    }
    log.appendChild(node);
    scrollDown();
    return node;
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    if (!started) {
      started = true;
      addMessage(root.dataset.greeting || '', 'bot');
    }
    input.focus();
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  launcher.addEventListener('click', function () {
    if (panel.hidden) open(); else close();
  });
  closeBtn.addEventListener('click', close);
  root.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) close();
  });

  async function ask(text) {
    history.push({ role: 'user', content: text });
    busy = true;
    sendBtn.disabled = true;
    var thinking = addMessage('', 'thinking', 'is-thinking');
    try {
      var res = await fetch('/api/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': root.dataset.csrf || ''
        },
        body: JSON.stringify({ message: text, history: history.slice(-6) })
      });
      var data = await res.json().catch(function () { return {}; });
      thinking.remove();
      if (res.ok && data.reply) {
        addMessage(data.reply, 'bot');
        history.push({ role: 'assistant', content: data.reply });
      } else if (res.status === 503) {
        addMessage(root.dataset.unavailable, 'bot', 'is-error');
      } else {
        addMessage(root.dataset.error, 'bot', 'is-error');
      }
    } catch (err) {
      thinking.remove();
      addMessage(root.dataset.error, 'bot', 'is-error');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    addMessage(text, 'user');
    ask(text);
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
})();
