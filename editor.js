function qs() {
    return new URLSearchParams(location.search);
}

function formatISO(d) {
    return new Date(d).toISOString();
}

// IndexedDB helpers
function idbGet(key) {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open("clippings-db", 1);
        r.onupgradeneeded = (e) => {
            e.target.result.createObjectStore("store");
        };
        r.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction("store", "readonly");
            const req = tx.objectStore("store").get(key);
            req.onsuccess = () => {
                resolve(req.result);
                db.close();
            };
            req.onerror = () => {
                reject(req.error);
                db.close();
            };
        };
        r.onerror = () => reject(r.error);
    });
}

function idbDelete(key) {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open("clippings-db", 1);
        r.onupgradeneeded = (e) => {
            e.target.result.createObjectStore("store");
        };
        r.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction("store", "readwrite");
            tx.objectStore("store").delete(key);
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error);
            };
        };
        r.onerror = () => reject(r.error);
    });
}

async function ensureWritePermission(handle) {
    try {
        if (typeof handle.queryPermission === "function") {
            const q = await handle.queryPermission({ mode: "readwrite" });
            if (q === "granted") return true;
        }
    } catch (e) {}
    return false;
}

async function tryWriteToHandle(dirHandle, md) {
    if (typeof dirHandle.getFileHandle !== "function")
        throw new Error("Not a directory handle");
    const fh = await dirHandle.getFileHandle("clippings.md", { create: true });
    const w = await fh.createWritable();
    await w.write(md);
    await w.close();
}

async function writeSitesToVault(originatingTabId) {
    try {
        const res = await new Promise((r) =>
            chrome.storage.local.get(["sites"], r)
        );
        const sites = (res && res.sites) || {};
        const md = generateMarkdown(sites);
        const dirHandle = await idbGet("vaultClippingsDir");
        if (!dirHandle) {
            // no handle - nothing to do
            return { ok: false, reason: "no-handle" };
        }
        const has = await ensureWritePermission(dirHandle);
        if (!has) {
            // render permission UI
            document.body.innerHTML = "";
            const container = document.createElement("div");
            container.style.padding = "12px";
            container.style.fontFamily = "system-ui, Roboto, Arial";
            const msg = document.createElement("div");
            msg.textContent =
                "Clippings needs permission to write into the chosen folder.";
            msg.style.marginBottom = "8px";
            const grant = document.createElement("button");
            grant.textContent = "Grant write permission";
            const cancel = document.createElement("button");
            cancel.textContent = "Cancel";
            grant.style.marginRight = "8px";
            grant.addEventListener("click", async () => {
                try {
                    if (typeof dirHandle.requestPermission === "function") {
                        const r = await dirHandle.requestPermission({
                            mode: "readwrite",
                        });
                        if (r === "granted") {
                            try {
                                // perform the write now that permission was granted
                                await tryWriteToHandle(dirHandle, md);
                                try {
                                    await chrome.storage.local.set({
                                        lastVaultWrite:
                                            new Date().toISOString(),
                                    });
                                } catch (e) {}
                                // success UI
                                container.innerHTML = "";
                                const s = document.createElement("div");
                                s.textContent = "Saved to vault ✔";
                                container.appendChild(s);
                                const closeBtn =
                                    document.createElement("button");
                                closeBtn.textContent = "Close";
                                closeBtn.style.display = "block";
                                closeBtn.style.marginTop = "8px";
                                closeBtn.addEventListener("click", () =>
                                    window.close()
                                );
                                container.appendChild(closeBtn);
                                // notify originating tab
                                if (originatingTabId) {
                                    try {
                                        chrome.tabs.sendMessage(
                                            originatingTabId,
                                            { action: "vault-write-success" }
                                        );
                                    } catch (e) {}
                                }
                                return { ok: true };
                            } catch (we) {
                                console.error("write retry failed", we);
                                // fallthrough to error handling below
                            }
                        }
                    }
                    // if not supported or not granted, fallback
                    try {
                        await chrome.storage.local.set({
                            vaultClippingsChosen: false,
                        });
                    } catch (e) {}
                    try {
                        await idbDelete("vaultClippingsDir");
                    } catch (e) {}
                    return { ok: false, reason: "permission-denied" };
                } catch (err) {
                    console.error("requestPermission error", err);
                    return { ok: false, reason: "request-error" };
                }
            });
            cancel.addEventListener("click", () => window.close());
            container.appendChild(msg);
            container.appendChild(grant);
            container.appendChild(cancel);
            document.body.appendChild(container);
            return { ok: false, reason: "needs-permission" };
        }
        // has permission, write
        try {
            await tryWriteToHandle(dirHandle, md);
            // success
            try {
                await chrome.storage.local.set({
                    lastVaultWrite: new Date().toISOString(),
                });
            } catch (e) {}
            if (originatingTabId) {
                try {
                    chrome.tabs.sendMessage(originatingTabId, {
                        action: "vault-write-success",
                    });
                } catch (e) {}
            }
            // show success UI
            document.body.innerHTML = "";
            const s = document.createElement("div");
            s.style.padding = "12px";
            s.style.color = "#060";
            s.textContent = "Saved to vault ✔";
            const closeBtn = document.createElement("button");
            closeBtn.textContent = "Close";
            closeBtn.style.display = "block";
            closeBtn.style.marginTop = "8px";
            closeBtn.addEventListener("click", () => window.close());
            document.body.appendChild(s);
            document.body.appendChild(closeBtn);
            return { ok: true };
        } catch (e) {
            console.error("write failed", e);
            try {
                await chrome.storage.local.set({ vaultClippingsChosen: false });
            } catch (er) {}
            try {
                await idbDelete("vaultClippingsDir");
            } catch (er) {}
            // fallback to download
            try {
                const dataUrl =
                    "data:text/markdown;charset=utf-8," +
                    encodeURIComponent(md);
                chrome.downloads.download(
                    {
                        filename: "Clippings/clippings.md",
                        conflictAction: "overwrite",
                        url: dataUrl,
                    },
                    () => {}
                );
            } catch (er) {}
            if (originatingTabId) {
                try {
                    chrome.tabs.sendMessage(originatingTabId, {
                        action: "vault-write-failed",
                        error: String(e),
                    });
                } catch (er) {}
            }
            // show error UI
            document.body.innerHTML = "";
            const errEl = document.createElement("div");
            errEl.style.padding = "12px";
            errEl.style.color = "#900";
            errEl.textContent =
                "Failed to write to vault: " + ((e && e.message) || String(e));
            const repick = document.createElement("button");
            repick.textContent = "Re-pick folder";
            repick.style.display = "block";
            repick.style.marginTop = "8px";
            repick.addEventListener("click", () => {
                try {
                    chrome.runtime.sendMessage({ action: "open-editor-popup" });
                } catch (er) {}
            });
            document.body.appendChild(errEl);
            document.body.appendChild(repick);
            return { ok: false, reason: "write-error" };
        }
    } catch (e) {
        console.error("writeSitesToVault outer failed", e);
        return { ok: false, reason: "outer-failure" };
    }
}

// Simple IndexedDB helper to persist FileSystemHandle
function idbPut(key, value) {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open("clippings-db", 1);
        r.onupgradeneeded = (e) => {
            e.target.result.createObjectStore("store");
        };
        r.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction("store", "readwrite");
            tx.objectStore("store").put(value, key);
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    // popup script active
    const params = qs();
    const text = params.get("text") || "";
    const url = params.get("url") || "";
    const title = params.get("title") || "";

    document.getElementById("selection").value = text;
    const pageUrlEl = document.getElementById("pageUrl");
    pageUrlEl.textContent = url || "unknown";
    pageUrlEl.href = url || "#";
    document.getElementById("pageTitle").textContent = title || "Untitled";
    document.getElementById("createdAt").textContent = formatISO(new Date());

    // Populate tag suggestions from stored clippings
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
        const datalist = document.getElementById("tags_suggestions");
        if (datalist) {
            datalist.innerHTML = "";
            suggestions.forEach((s) => {
                const opt = document.createElement("option");
                opt.value = s;
                datalist.appendChild(opt);
            });
        }
        // Also prepare custom suggestion box items
        const suggestionBox = document.getElementById("tags_suggestion_box");
        if (suggestionBox) {
            suggestionBox.innerHTML = "";
            suggestions.forEach((s) => {
                const div = document.createElement("div");
                div.className = "item";
                div.textContent = s;
                suggestionBox.appendChild(div);
            });
        }
        // suggestions prepared
    });

    // Custom suggestion UI: show filtered suggestions for the last comma-separated token
    (function wireTagsAutocomplete() {
        const input = document.getElementById("tags");
        const box = document.getElementById("tags_suggestion_box");
        if (!input || !box) return;

        function getLastToken(value) {
            const parts = value.split(",");
            return parts[parts.length - 1].trim();
        }

        function filterAndShow() {
            const token = getLastToken(input.value).toLowerCase();
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

        input.addEventListener("input", filterAndShow);
        input.addEventListener("focus", filterAndShow);

        input.addEventListener("blur", () =>
            setTimeout(() => {
                box.style.display = "none";
                box.setAttribute("aria-hidden", "true");
            }, 150)
        );

        box.addEventListener("mousedown", (ev) => {
            ev.preventDefault(); // keep focus on input
            const target = ev.target.closest(".item");
            if (!target) return;
            const tag = target.textContent.trim();
            // Insert tag into last token position
            const parts = input.value.split(",");
            parts[parts.length - 1] = " " + tag; // replace last part
            const newVal = parts
                .map((p) => p.trim())
                .filter(Boolean)
                .join(", ");
            input.value = newVal;
            // hide box
            box.style.display = "none";
            box.setAttribute("aria-hidden", "true");
            input.focus();
        });
    })();

    document
        .getElementById("cancelBtn")
        .addEventListener("click", () => window.close());
    document.getElementById("saveBtn").addEventListener("click", onSave);

    // If opened with autoWrite flag (from background after a content-script save), perform vault write
    const autoWrite = params.get("autoWrite");
    const originatingTabId = params.get("tabId")
        ? parseInt(params.get("tabId"), 10)
        : null;
    if (autoWrite) {
        // perform write of stored sites to vault
        setTimeout(() => {
            writeSitesToVault(originatingTabId).then((res) => {
                // nothing further here; UI handled in writeSitesToVault
            });
        }, 150);
    }

    // Wire directory picker for Clippings folder
    const chooseBtn = document.getElementById("choose_clippings_dir");
    const statusEl = document.getElementById("clippings_dir_status");
    async function refreshDirStatus() {
        try {
            const res = await chrome.storage.local.get([
                "vaultClippingsChosen",
                "vaultClippingsName",
            ]);
            if (res && res.vaultClippingsChosen) {
                const name = res.vaultClippingsName || "Clippings";
                statusEl.textContent = "Folder chosen: " + name;
            } else {
                statusEl.textContent = "No folder chosen";
            }
        } catch (e) {
            statusEl.textContent = "No folder chosen";
        }
    }
    refreshDirStatus();

    if (chooseBtn) {
        chooseBtn.addEventListener("click", async () => {
            try {
                if (!window.showDirectoryPicker) {
                    statusEl.textContent =
                        "Directory picker not supported in this context";
                    return;
                }
                const dirHandle = await window.showDirectoryPicker({
                    mode: "readwrite",
                });
                // If user picked the Clippings folder itself, use it; otherwise create/use a Clippings subfolder
                let clippingsDir = dirHandle;
                try {
                    if (dirHandle.name !== "Clippings") {
                        clippingsDir = await dirHandle.getDirectoryHandle(
                            "Clippings",
                            { create: true }
                        );
                    }
                } catch (innerErr) {
                    clippingsDir = dirHandle;
                }
                // persist handle in IndexedDB (structured-clone) and mark chosen
                await idbPut("vaultClippingsDir", clippingsDir);
                await chrome.storage.local.set({
                    vaultClippingsChosen: true,
                    vaultClippingsName: clippingsDir.name,
                });
                statusEl.textContent = "Folder chosen: " + clippingsDir.name;
            } catch (e) {
                // user cancelled or an error occurred; show friendly message
                statusEl.textContent = "Folder selection cancelled or failed";
            }
        });
    }
});

function generateMarkdown(sites) {
    let md = "# Clippings\n\n";
    const origins = Object.keys(sites).sort();
    origins.forEach((origin) => {
        const site = sites[origin];
        md += `## ${site.title || origin}\n\n`;
        md += `- Address: ${site.url || origin}\n`;
        md += `- Created: ${site.created || ""}\n\n`;
        (site.clippings || []).forEach((c) => {
            const text = String(c.text || "");
            md += `> ${text.replace(/\n/g, "\n> ")}\n\n`;
            if (c.note) md += `- Note: ${c.note}\n`;
            if (c.tags && c.tags.length) md += `- Tags: ${c.tags.join(", ")}\n`;
            // ensure a blank line after each clipping block
            md += `\n`;
        });
    });
    return md;
}

function onSave() {
    const text = document.getElementById("selection").value.trim();
    const note = document.getElementById("note").value.trim();
    const tagsRaw =
        (document.getElementById("tags") &&
            document.getElementById("tags").value) ||
        "";
    const tags = tagsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const title = document.getElementById("pageTitle").textContent || "";
    const url = document.getElementById("pageUrl").href || "";
    const date = new Date().toISOString();

    try {
        const origin = new URL(url).origin || url || "unknown";
        chrome.storage.local.get({ sites: {} }, (res) => {
            const sites = res.sites || {};
            if (!sites[origin]) {
                sites[origin] = {
                    title: title,
                    url: origin,
                    created: date,
                    clippings: [],
                };
            }
            sites[origin].clippings.push({ text, note, tags, date });
            chrome.storage.local.set({ sites }, async () => {
                // perform vault write directly from popup if configured
                try {
                    await writeSitesToVault(null);
                } catch (e) {
                    // ignore, UI will show any errors
                }
                window.close();
            });
        });
    } catch (e) {
        console.error(e);
        alert("Failed to save clipping");
    }
}
