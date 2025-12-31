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

// Handle save messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== "save-clipping" || !msg.payload) return;
    const p = msg.payload;
    try {
        const origin = new URL(p.url || "").origin || p.url || "unknown";
        chrome.storage.local.get({ sites: {} }, (res) => {
            const sites = res.sites || {};
            if (!sites[origin]) {
                sites[origin] = {
                    title: p.title || origin,
                    url: origin,
                    created: p.date || new Date().toISOString(),
                    clippings: [],
                };
            }
            sites[origin].clippings.push({
                text: p.text || "",
                note: p.note || "",
                tags: Array.isArray(p.tags) ? p.tags : [],
                date: p.date || new Date().toISOString(),
            });
            chrome.storage.local.set({ sites }, () => {
                const md = generateMarkdown(sites);
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
                        sendResponse({ ok: true });
                    }
                );
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
    let md = "# Clippings\n\n";
    const origins = Object.keys(sites).sort();
    origins.forEach((origin) => {
        const site = sites[origin];
        md += `## ${site.title || origin}\n\n`;
        md += `- Address: ${site.url || origin}\n`;
        md += `- Created: ${site.created || ""}\n\n`;
        (site.clippings || []).forEach((c, i) => {
            md += `${i + 1}. > ${String(c.text || "").replace(
                /\n/g,
                "\n> "
            )}\n\n`;
            if (c.note) md += `   - Note: ${c.note}\n`;
            if (c.tags && c.tags.length)
                md += `   - Tags: ${c.tags.join(", ")}\n`;
            md += `   - Saved: ${c.date}\n\n`;
        });
    });
    return md;
}
