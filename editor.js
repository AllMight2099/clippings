function qs() {
    return new URLSearchParams(location.search);
}

function formatISO(d) {
    return new Date(d).toISOString();
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
});

function generateMarkdown(sites) {
    let md = "# Clippings\n\n";
    const origins = Object.keys(sites).sort();
    origins.forEach((origin) => {
        const site = sites[origin];
        md += `## ${site.title || origin}\n\n`;
        md += `- Address: ${site.url || origin}\n`;
        md += `- Created: ${site.created || ""}\n\n`;
        site.clippings.forEach((c, i) => {
            md += `${i + 1}. > ${c.text.replace(/\n/g, "\n> ")}\n\n`;
            if (c.note) md += `   - Note: ${c.note}\n`;
            if (c.tags && c.tags.length)
                md += `   - Tags: ${c.tags.join(", ")}\n`;
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
            chrome.storage.local.set({ sites }, () => {
                const md = generateMarkdown(sites);
                // use data URL to trigger download of the aggregated file
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
                        window.close();
                    }
                );
            });
        });
    } catch (e) {
        console.error(e);
        alert("Failed to save clipping");
    }
}
