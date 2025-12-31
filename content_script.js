(() => {
  // Avoid double-injection
  if (window.__clippings_injected) return;
  window.__clippings_injected = true;

  let shadowHost = null;

  function createModal() {
    shadowHost = document.createElement('div');
    shadowHost.id = '__clippings_host_' + Math.random().toString(36).slice(2);
    shadowHost.style.all = 'initial';
    document.documentElement.appendChild(shadowHost);
    const shadow = shadowHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      /* overlay is visual only and won't block clicks on the page */
      .clippings-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.12);z-index:2147483646;pointer-events:none}
      .clippings-panel{position:fixed;max-width:520px;width:min(92vw,520px);left:50%;top:20%;transform:translateX(-50%);background:#fff;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);padding:12px;font-family:system-ui,Segoe UI,Roboto,Arial;z-index:2147483647}
      .clippings-title{cursor:move;user-select:none}
      .clippings-panel h3{margin:0 0 8px;font-size:14px}
      .clippings-meta{font-size:12px;color:#444;margin-bottom:8px}
      .clippings-text, .clippings-comment{width:100%;min-height:60px;border:1px solid #ddd;border-radius:6px;padding:8px;margin-bottom:8px;resize:vertical}
      .clippings-actions{display:flex;gap:8px;justify-content:flex-end}
      .clippings-btn{padding:8px 12px;border-radius:6px;border:1px solid #ccc;background:#f2f2f2;cursor:pointer}
      .clippings-save{background:#0b66ff;color:#fff;border-color:#0758d1}
      .clippings-close{position:absolute;right:8px;top:6px;border:none;background:transparent;font-size:18px;cursor:pointer}
    `;

    const overlay = document.createElement('div');
    overlay.className = 'clippings-overlay';
    // overlay is non-interactive so it won't capture clicks; close button provided on panel

    const panel = document.createElement('div');
    panel.className = 'clippings-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    panel.innerHTML = `
      <h3 id="clippings_title" class="clippings-title">Create clipping</h3>
      <button id="clippings_close" class="clippings-close" aria-label="Close">×</button>
      <div class="clippings-meta"><a id="clippings_url" href="#" target="_blank"></a></div>
      <label>Selection</label>
      <div id="clippings_text" class="clippings-text" contenteditable="true" aria-label="selection"></div>
      <label>Note (optional)</label>
      <div id="clippings_note" class="clippings-comment" contenteditable="true" aria-label="note" placeholder="Add a note..."></div>
      <div class="clippings-actions">
        <button class="clippings-btn" id="clippings_cancel">Cancel</button>
        <button class="clippings-btn clippings-save" id="clippings_save">Save</button>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(overlay);
    shadow.appendChild(panel);

    // attach elements for later access
    return { shadow, overlay, panel, get el() {
      return {
        title: shadow.querySelector('#clippings_title'),
        url: shadow.querySelector('#clippings_url'),
        text: shadow.querySelector('#clippings_text'),
        note: shadow.querySelector('#clippings_note'),
        cancel: shadow.querySelector('#clippings_cancel'),
        save: shadow.querySelector('#clippings_save')
      };
    }};
  }

  function removeModal() {
    try {
      if (shadowHost) shadowHost.remove();
    } catch (e) {}
    window.__clippings_injected = false;
    shadowHost = null;
  }

  function showModal({ text = '', title = document.title || '', url = location.href || '' } = {}) {
    const ctx = createModal();
    const els = ctx.el;
    els.title.textContent = title || 'Create clipping';
    els.url.textContent = url;
    els.url.href = url;
    // put selection into text (escape textContent)
    els.text.textContent = text || '';
    els.note.textContent = '';

    els.cancel.addEventListener('click', removeModal);
    const closeBtn = ctx.shadow.querySelector('#clippings_close');
    if (closeBtn) closeBtn.addEventListener('click', removeModal);

    // make the panel draggable by its title (mouse + touch)
    const panelNode = ctx.panel;
    const handle = els.title;
    if (handle && panelNode) {
      let isDragging = false;
      let offsetX = 0;
      let offsetY = 0;

      function onMouseMove(e) {
        if (!isDragging) return;
        panelNode.style.left = (e.clientX - offsetX) + 'px';
        panelNode.style.top = (e.clientY - offsetY) + 'px';
      }

      function onMouseUp() {
        isDragging = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const rect = panelNode.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        panelNode.style.left = rect.left + 'px';
        panelNode.style.top = rect.top + 'px';
        panelNode.style.transform = 'none';
        isDragging = true;
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });

      // touch support
      function onTouchMove(e) {
        if (!isDragging) return;
        const t = e.touches[0];
        panelNode.style.left = (t.clientX - offsetX) + 'px';
        panelNode.style.top = (t.clientY - offsetY) + 'px';
      }

      function onTouchEnd() {
        isDragging = false;
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
      }

      handle.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        e.preventDefault();
        const rect = panelNode.getBoundingClientRect();
        offsetX = t.clientX - rect.left;
        offsetY = t.clientY - rect.top;
        panelNode.style.left = rect.left + 'px';
        panelNode.style.top = rect.top + 'px';
        panelNode.style.transform = 'none';
        isDragging = true;
        window.addEventListener('touchmove', onTouchMove);
        window.addEventListener('touchend', onTouchEnd);
      });
    }
    els.save.addEventListener('click', () => {
      const payload = {
        text: els.text.textContent.trim(),
        note: els.note.textContent.trim(),
        title,
        url,
        date: new Date().toISOString()
      };
      // send to background to persist and export
      try {
        chrome.runtime.sendMessage({ action: 'save-clipping', payload }, (resp) => {
          // ignore response
        });
      } catch (e) {
        console.error('Failed to send clipping', e);
      }
      removeModal();
    });
  }

  // Respond to messages from the background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.action === 'show-clipping') {
      showModal(msg.data || {});
      sendResponse({ ok: true });
    }
  });

  // If injected without message, auto-open using current selection
  try {
    const sel = window.getSelection ? window.getSelection().toString() : '';
    showModal({ text: sel });
  } catch (e) {}

})();
