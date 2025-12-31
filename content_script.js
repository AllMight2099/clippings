(() => {
    // Avoid double-injection
    if (window.__clippings_injected) return;
    window.__clippings_injected = true;

    let shadowHost = null;
    let currentModal = null;

    function createModal() {
        shadowHost = document.createElement("div");
        shadowHost.id =
            "__clippings_host_" + Math.random().toString(36).slice(2);
        shadowHost.style.all = "initial";
        document.documentElement.appendChild(shadowHost);
        const shadow = shadowHost.attachShadow({ mode: "closed" });

        const style = document.createElement("style");
        style.textContent = `
      /* overlay is visual only and won't block clicks on the page */
      .clippings-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.12);z-index:2147483646;pointer-events:none}
      .clippings-panel{position:fixed;max-width:520px;width:min(92vw,520px);left:50%;top:20%;transform:translateX(-50%);background:#fff;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);padding:12px;font-family:system-ui,Segoe UI,Roboto,Arial;z-index:2147483647}
    .clippings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
    .clippings-title{cursor:move;user-select:none;display:block;padding-right:8px;white-space:normal;overflow:visible;word-break:break-word}
    .clippings-panel h3{margin:0 0 8px;font-size:14px;line-height:1.2}
      .clippings-meta{font-size:12px;color:#444;margin-bottom:8px}
      .clippings-text, .clippings-comment{width:100%;min-height:60px;border:1px solid #ddd;border-radius:6px;padding:8px;margin-bottom:8px;resize:vertical;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;max-width:100%;overflow:auto}
      .clippings-actions{display:flex;gap:8px;justify-content:flex-end}
      .clippings-btn{padding:8px 12px;border-radius:6px;border:1px solid #ccc;background:#f2f2f2;cursor:pointer}
      .clippings-save{background:#0b66ff;color:#fff;border-color:#0758d1}
    .clippings-close{border:none;background:transparent;font-size:18px;cursor:pointer;padding:4px}
            /* suggestion box */
            .clippings-tags-wrap{position:relative}
            .clippings-suggestion-box{position:absolute;left:0;right:0;top:calc(100% + 6px);background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,0.08);max-height:160px;overflow:auto;z-index:2147483648;display:none}
            .clippings-suggestion-box .item{padding:8px 10px;font-size:13px;color:#111;cursor:pointer}
            .clippings-suggestion-box .item:hover{background:#f2f8ff}
    `;

        const overlay = document.createElement("div");
        overlay.className = "clippings-overlay";
        // overlay is non-interactive so it won't capture clicks; close button provided on panel

        const panel = document.createElement("div");
        panel.className = "clippings-panel";
        panel.addEventListener("click", (e) => e.stopPropagation());

        panel.innerHTML = `
            <div class="clippings-header">
                <h3 id="clippings_title" class="clippings-title">Create clipping</h3>
                <button id="clippings_close" class="clippings-close" aria-label="Close">×</button>
            </div>
            <div class="clippings-meta"><a id="clippings_url" href="#" target="_blank"></a></div>
      <label>Selection</label>
      <div id="clippings_text" class="clippings-text" contenteditable="false" aria-label="selection"></div>
    <label>Note (optional)</label>
    <div id="clippings_note" class="clippings-comment" contenteditable="true" aria-label="note" placeholder="Add a note..."></div>
    <label>Tags (comma-separated)</label>
        <div class="clippings-tags-wrap">
            <input id="clippings_tags" type="text" placeholder="e.g. research,design" />
            <div id="clippings_tags_box" class="clippings-suggestion-box" aria-hidden="true"></div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
            <button id="clippings_choose_dir">Choose Clippings folder</button>
            <div id="clippings_dir_status" style="font-size:12px;color:#666">No folder chosen</div>
        </div>
      <div class="clippings-actions">
        <button class="clippings-btn" id="clippings_cancel">Cancel</button>
        <button class="clippings-btn clippings-save" id="clippings_save">Save</button>
      </div>
    `;

        shadow.appendChild(style);
        shadow.appendChild(overlay);
        shadow.appendChild(panel);

        // attach elements for later access
        return {
            shadow,
            overlay,
            panel,
            get el() {
                return {
                    title: shadow.querySelector("#clippings_title"),
                    url: shadow.querySelector("#clippings_url"),
                    text: shadow.querySelector("#clippings_text"),
                    note: shadow.querySelector("#clippings_note"),
                    cancel: shadow.querySelector("#clippings_cancel"),
                    save: shadow.querySelector("#clippings_save"),
                };
            },
        };
    }

    function removeModal() {
        try {
            if (shadowHost) shadowHost.remove();
        } catch (e) {}
        shadowHost = null;
        currentModal = null;
    }

    function showModal({
        text = "",
        title = document.title || "",
        url = location.href || "",
    } = {}) {
        const ctx = createModal();
        const els = ctx.el;
        els.title.textContent = title || "Create clipping";
        els.url.textContent = url;
        els.url.href = url;
        // put selection into text (escape textContent)
        els.text.textContent = text || "";
        els.note.textContent = "";

        els.cancel.addEventListener("click", removeModal);
        const closeBtn = ctx.shadow.querySelector("#clippings_close");
        if (closeBtn) closeBtn.addEventListener("click", removeModal);

        // make the panel draggable by its title (mouse + touch)
        const panelNode = ctx.panel;
        const handle = els.title;
        if (handle && panelNode) {
            let isDragging = false;
            let offsetX = 0;
            let offsetY = 0;

            function onMouseMove(e) {
                if (!isDragging) return;
                panelNode.style.left = e.clientX - offsetX + "px";
                panelNode.style.top = e.clientY - offsetY + "px";
            }

            function onMouseUp() {
                isDragging = false;
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            }

            handle.addEventListener("mousedown", (e) => {
                e.preventDefault();
                const rect = panelNode.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                panelNode.style.left = rect.left + "px";
                panelNode.style.top = rect.top + "px";
                panelNode.style.transform = "none";
                isDragging = true;
                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
            });

            // touch support
            function onTouchMove(e) {
                if (!isDragging) return;
                const t = e.touches[0];
                panelNode.style.left = t.clientX - offsetX + "px";
                panelNode.style.top = t.clientY - offsetY + "px";
            }

            function onTouchEnd() {
                isDragging = false;
                window.removeEventListener("touchmove", onTouchMove);
                window.removeEventListener("touchend", onTouchEnd);
            }

            handle.addEventListener("touchstart", (e) => {
                const t = e.touches[0];
                e.preventDefault();
                const rect = panelNode.getBoundingClientRect();
                offsetX = t.clientX - rect.left;
                offsetY = t.clientY - rect.top;
                panelNode.style.left = rect.left + "px";
                panelNode.style.top = rect.top + "px";
                panelNode.style.transform = "none";
                isDragging = true;
                window.addEventListener("touchmove", onTouchMove);
                window.addEventListener("touchend", onTouchEnd);
            });
        }
        // Load tag suggestions and wire autocomplete for the tags input
        (function wireModalTagSuggestions() {
            const tagsInput = ctx.shadow.querySelector("#clippings_tags");
            const box = ctx.shadow.querySelector("#clippings_tags_box");
            if (!tagsInput || !box) return;

            function getLastToken(value) {
                const parts = value.split(",");
                return parts[parts.length - 1].trim();
            }

            // populate suggestion items from storage
            chrome.storage.local.get({ sites: {} }, (res) => {
                const sites = res.sites || {};
                const tagSet = new Set();
                Object.values(sites).forEach((site) => {
                    (site.clippings || []).forEach((c) => {
                        (c.tags || []).forEach((t) => {
                            if (t && typeof t === "string") tagSet.add(t);
                        });
                    });
                });
                const suggestions = Array.from(tagSet).sort();
                box.innerHTML = "";
                suggestions.forEach((s) => {
                    const it = document.createElement("div");
                    it.className = "item";
                    it.textContent = s;
                    box.appendChild(it);
                });
            });

            function filterAndShow() {
                const token = getLastToken(tagsInput.value).toLowerCase();
                if (!token) {
                    box.style.display = "none";
                    box.setAttribute("aria-hidden", "true");
                    return;
                }
                const items = Array.from(box.querySelectorAll(".item"));
                let any = false;
                items.forEach((it) => {
                    const txt = it.textContent.toLowerCase();
                    if (txt.indexOf(token) !== -1) {
                        it.style.display = "block";
                        any = true;
                    } else {
                        it.style.display = "none";
                    }
                });
                if (any) {
                    box.style.display = "block";
                    box.setAttribute("aria-hidden", "false");
                } else {
                    box.style.display = "none";
                    box.setAttribute("aria-hidden", "true");
                }
            }

            tagsInput.addEventListener("input", filterAndShow);
            tagsInput.addEventListener("focus", filterAndShow);
            tagsInput.addEventListener("blur", () =>
                setTimeout(() => {
                    box.style.display = "none";
                    box.setAttribute("aria-hidden", "true");
                }, 150)
            );

            box.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                const target = ev.target.closest(".item");
                if (!target) return;
                const tag = target.textContent.trim();
                const parts = tagsInput.value.split(",");
                parts[parts.length - 1] = " " + tag;
                const newVal = parts
                    .map((p) => p.trim())
                    .filter(Boolean)
                    .join(", ");
                tagsInput.value = newVal;
                box.style.display = "none";
                box.setAttribute("aria-hidden", "true");
                tagsInput.focus();
            });
        })();

        // Wire Choose Clippings folder button in injected modal — request picker in extension context
        (function wireModalDirPicker() {
            const chooseBtn = ctx.shadow.querySelector("#clippings_choose_dir");
            const statusEl = ctx.shadow.querySelector("#clippings_dir_status");
            if (!chooseBtn || !statusEl) return;

            function refreshStatus() {
                try {
                    chrome.storage.local.get(
                        ["vaultClippingsChosen", "vaultClippingsName"],
                        (r) => {
                            if (r && r.vaultClippingsChosen) {
                                const name =
                                    r.vaultClippingsName || "Clippings";
                                statusEl.textContent = "Folder chosen: " + name;
                            } else statusEl.textContent = "No folder chosen";
                        }
                    );
                } catch (e) {
                    statusEl.textContent = "No folder chosen";
                }
            }
            refreshStatus();

            chooseBtn.addEventListener("click", () => {
                try {
                    // Ask background to open the extension popup which hosts the directory picker.
                    chrome.runtime.sendMessage({ action: "open-editor-popup" });
                    // update status after a short delay (user completes pick in the popup)
                    setTimeout(refreshStatus, 1200);
                } catch (e) {
                    console.error("failed to request editor popup", e);
                }
            });
        })();

        // track current modal context so runtime messages can modify it
        currentModal = ctx;

        els.save.addEventListener("click", () => {
            const tagsVal =
                (ctx.shadow.querySelector("#clippings_tags") &&
                    ctx.shadow.querySelector("#clippings_tags").value) ||
                "";
            const tags = tagsVal
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            const payload = {
                text: els.text.textContent.trim(),
                note: els.note.textContent.trim(),
                tags,
                title,
                url,
                date: new Date().toISOString(),
            };
            // send to background to persist and export
            try {
                chrome.runtime.sendMessage(
                    { action: "save-clipping", payload },
                    (resp) => {
                        if (chrome.runtime.lastError) {
                            // background may have unloaded; ignore
                        }
                    }
                );
            } catch (e) {
                console.error("Failed to send clipping", e);
            }
            removeModal();
        });
    }

    // Listen for vault write failures and show a visible banner in the open modal
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.action !== "vault-write-failed") return;
        try {
            if (!currentModal) return;
            const shadow = currentModal.shadow;
            const panel = currentModal.panel;
            if (!panel || !shadow) return;
            // remove existing banner
            const existing = shadow.querySelector("#clippings_failure_banner");
            if (existing) existing.remove();
            const banner = document.createElement("div");
            banner.id = "clippings_failure_banner";
            banner.style.background = "#fee";
            banner.style.color = "#900";
            banner.style.padding = "8px";
            banner.style.border = "1px solid #f2c0c0";
            banner.style.borderRadius = "6px";
            banner.style.marginBottom = "8px";
            banner.style.fontSize = "13px";
            banner.textContent =
                "Failed to save to vault. " +
                (msg.error || "Permission denied.");
            const btn = document.createElement("button");
            btn.textContent = "Re-pick folder";
            btn.style.marginLeft = "8px";
            btn.addEventListener("click", () => {
                try {
                    chrome.runtime.sendMessage(
                        { action: "open-editor-popup" },
                        (resp) => {
                            if (chrome.runtime.lastError) {
                                // ignore
                            }
                        }
                    );
                } catch (e) {}
            });
            banner.appendChild(btn);
            // insert banner at top of panel content (before meta)
            const meta = shadow.querySelector(".clippings-meta");
            if (meta && meta.parentNode)
                meta.parentNode.insertBefore(banner, meta.nextSibling);
        } catch (e) {}
    });

    // Respond to messages from the background
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg) return;
        if (msg.action === "show-clipping") {
            showModal(msg.data || {});
            sendResponse({ ok: true });
        }
    });

    // Do not auto-open on injection; rely on background messages to show the modal
})();
