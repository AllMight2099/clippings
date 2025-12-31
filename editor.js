function qs() {
    return new URLSearchParams(location.search);
}

function formatISO(d) {
    return new Date(d).toISOString();
}

document.addEventListener("DOMContentLoaded", () => {
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
        });
    });
    return md;
}

function onSave() {
    const text = document.getElementById("selection").value.trim();
    const note = document.getElementById("note").value.trim();
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
            sites[origin].clippings.push({ text, note, date });
            chrome.storage.local.set({ sites }, () => {
                const md = generateMarkdown(sites);
                // use data URL to trigger download of the aggregated file
                const dataUrl =
                    "data:text/markdown;charset=utf-8," +
                    encodeURIComponent(md);
                chrome.downloads.download(
                    {
                        filename: "clippings.md",
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
