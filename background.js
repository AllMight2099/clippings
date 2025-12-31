chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "create-clipping",
        title: "Create clipping",
        contexts: ["selection"],
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "create-clipping") {
        const selection = info.selectionText || "";
        const pageUrl = tab && tab.url ? tab.url : info.pageUrl || "";
        const title = tab && tab.title ? tab.title : "";
        // Inject content script and message it to show a modal
        if (tab && tab.id) {
            chrome.scripting.executeScript(
                { target: { tabId: tab.id }, files: ["content_script.js"] },
                () => {
                    chrome.tabs.sendMessage(
                        tab.id,
                        {
                            action: "show-clipping",
                            data: { text: selection, title, url: pageUrl },
                        },
                        () => {}
                    );
                }
            );
        } else {
            // fallback: open editor popup
            const params = new URLSearchParams({
                text: selection,
                url: pageUrl,
                title: title,
            });
            chrome.windows.create({
                url:
                    chrome.runtime.getURL("editor.html") +
                    "?" +
                    params.toString(),
                type: "popup",
                width: 520,
                height: 560,
            });
        }
    }
});

// Keyboard shortcut handler: capture selection from active tab then open editor/modal
chrome.commands.onCommand.addListener((command) => {
    if (command !== "create-clipping") return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) {
            chrome.windows.create({
                url: chrome.runtime.getURL("editor.html"),
                type: "popup",
                width: 520,
                height: 560,
            });
            return;
        }

        // Inject modal content script and message the selection
        chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ["content_script.js"] },
            () => {
                // try to pull selection and page info then message the content script
                chrome.scripting.executeScript(
                    {
                        target: { tabId: tab.id },
                        func: () => ({
                            selection: window.getSelection
                                ? window.getSelection().toString()
                                : "",
                            title: document.title || "",
                            url: location.href || "",
                        }),
                    },
                    (results) => {
                        let data = {
                            text: "",
                            title: tab.title || "",
                            url: tab.url || "",
                        };
                        if (
                            !chrome.runtime.lastError &&
                            results &&
                            results[0] &&
                            results[0].result
                        ) {
                            const r = results[0].result;
                            data = {
                                text: r.selection || "",
                                title: r.title || tab.title || "",
                                url: r.url || tab.url || "",
                            };
                        }
                        chrome.tabs.sendMessage(
                            tab.id,
                            { action: "show-clipping", data },
                            () => {}
                        );
                    }
                );
            }
        );
    });
});

// Listen for requests to open directory picker helper
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    // removed legacy open-dir-picker handling — use editor popup instead
    if (msg.action === "open-editor-popup") {
        try {
            if (chrome.action && chrome.action.openPopup) {
                chrome.action
                    .openPopup()
                    .then(() => sendResponse({ ok: true }))
                    .catch((err) => {
                        // fallback to creating a popup window
                        try {
                            chrome.windows.create(
                                {
                                    url: chrome.runtime.getURL("editor.html"),
                                    type: "popup",
                                    width: 520,
                                    height: 560,
                                },
                                () => sendResponse({ ok: true })
                            );
                        } catch (e) {
                            console.error(
                                "failed to open editor popup fallback",
                                e
                            );
                            sendResponse({ ok: false });
                        }
                    });
            } else {
                // older chromium: fallback
                chrome.windows.create(
                    {
                        url: chrome.runtime.getURL("editor.html"),
                        type: "popup",
                        width: 520,
                        height: 560,
                    },
                    () => sendResponse({ ok: true })
                );
            }
        } catch (e) {
            console.error("failed to open editor popup", e);
            sendResponse({ ok: false });
        }
        return true;
    }
});

// Handle save messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== "save-clipping" || !msg.payload) return;
    const p = msg.payload;
    try {
        const key = (() => {
            try {
                return new URL(p.url || "").href || p.url || "unknown";
            } catch (e) {
                return p.url || "unknown";
            }
        })();
        chrome.storage.local.get({ sites: {} }, (res) => {
            const sites = res.sites || {};
            if (!sites[key]) {
                sites[key] = {
                    title: p.title || p.url || key,
                    url: p.url || key,
                    created: p.date || new Date().toISOString(),
                    clippings: [],
                };
            }
            sites[key].clippings.push({
                text: p.text || "",
                note: p.note || "",
                tags: Array.isArray(p.tags) ? p.tags : [],
                date: p.date || new Date().toISOString(),
            });
            chrome.storage.local.set({ sites }, () => {
                const md = generateMarkdown(sites);
                // Check whether a vault Clippings directory has been chosen.
                // If present, skip the Downloads export and invoke the helper to write
                // directly into the chosen folder. Otherwise, fall back to Downloads.
                chrome.storage.local.get(["vaultClippingsChosen"], (r) => {
                    if (r && r.vaultClippingsChosen) {
                        // Try to write directly using persisted directory handle (silent if permission exists).
                        (async () => {
                            try {
                                // helper to read IndexedDB stored handle
                                function idbGet(key) {
                                    return new Promise((resolve, reject) => {
                                        const rq = indexedDB.open(
                                            "clippings-db",
                                            1
                                        );
                                        rq.onupgradeneeded = (ev) =>
                                            ev.target.result.createObjectStore(
                                                "store"
                                            );
                                        rq.onsuccess = (ev) => {
                                            const db = ev.target.result;
                                            const tx = db.transaction(
                                                "store",
                                                "readonly"
                                            );
                                            const req = tx
                                                .objectStore("store")
                                                .get(key);
                                            req.onsuccess = () => {
                                                resolve(req.result);
                                                db.close();
                                            };
                                            req.onerror = () => {
                                                reject(req.error);
                                                db.close();
                                            };
                                        };
                                        rq.onerror = () => reject(rq.error);
                                    });
                                }

                                const dirHandle = await idbGet(
                                    "vaultClippingsDir"
                                );
                                if (
                                    dirHandle &&
                                    typeof dirHandle.getFileHandle ===
                                        "function"
                                ) {
                                    // attempt a write without prompting; if permission is granted this should succeed
                                    const fileHandle =
                                        await dirHandle.getFileHandle(
                                            "clippings.md",
                                            { create: true }
                                        );
                                    const writable =
                                        await fileHandle.createWritable();
                                    await writable.write(md);
                                    await writable.close();
                                    sendResponse({
                                        ok: true,
                                        writtenToVault: true,
                                    });
                                    return;
                                }
                            } catch (err) {
                                // writing failed; fallthrough to opening popup as fallback
                                console.warn(
                                    "direct vault write failed, opening popup fallback",
                                    err
                                );
                            }

                            // Vault exists but direct write failed — open the popup to request permission and write there
                            try {
                                let url =
                                    chrome.runtime.getURL("editor.html") +
                                    "?autoWrite=1";
                                try {
                                    if (
                                        sender &&
                                        sender.tab &&
                                        typeof sender.tab.id !== "undefined"
                                    ) {
                                        url +=
                                            "&tabId=" +
                                            encodeURIComponent(sender.tab.id);
                                    }
                                } catch (e) {}
                                chrome.windows.create(
                                    {
                                        url,
                                        type: "popup",
                                        width: 480,
                                        height: 220,
                                        focused: true,
                                    },
                                    () => {}
                                );
                            } catch (e) {
                                console.error("failed to open write helper", e);
                            }
                            sendResponse({ ok: true, writtenToVault: true });
                        })();
                        return true; // indicate async response
                    } else {
                        // No vault folder — continue to download to Downloads as before.
                        const dataUrl =
                            "data:text/markdown;charset=utf-8," +
                            encodeURIComponent(md);
                        chrome.downloads.download(
                            {
                                filename: "Clippings/clippings.md",
                                conflictAction: "overwrite",
                                url: dataUrl,
                            },
                            () => {
                                sendResponse({
                                    ok: true,
                                    writtenToDownloads: true,
                                });
                            }
                        );
                    }
                });
            });
        });
    } catch (e) {
        console.error("save-clipping error", e);
        sendResponse({ ok: false, error: e && e.message });
    }
    // indicate async response
    return true;
});

function generateMarkdown(sites) {
    // let md = "# Clippings\n\n";
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
            md += `- Saved: ${c.date}\n\n`;
        });
    });
    return md;
}

// Listen for fallback download requests from helper pages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== "fallback-download" || !msg.md) return;
    try {
        const dataUrl =
            "data:text/markdown;charset=utf-8," + encodeURIComponent(msg.md);
        chrome.downloads.download(
            {
                filename: "Clippings/clippings.md",
                conflictAction: "overwrite",
                url: dataUrl,
            },
            () => {}
        );
    } catch (e) {
        console.error("fallback-download failed", e);
    }
});
