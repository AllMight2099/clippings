// Simple IndexedDB helpers to persist FileSystemHandle
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

document.getElementById("pick").addEventListener("click", async () => {
    const status = document.getElementById("status");
    try {
        const dirHandle = await window.showDirectoryPicker({
            mode: "readwrite",
        });
        // If user picked the Clippings folder itself, use it directly. Otherwise
        // create/use a `Clippings` subfolder inside the selected directory.
        let clippingsDir = dirHandle;
        try {
            if (dirHandle.name !== "Clippings") {
                // get or create subfolder
                clippingsDir = await dirHandle.getDirectoryHandle("Clippings", {
                    create: true,
                });
            }
        } catch (innerErr) {
            // If creating/getting subfolder fails, fall back to using the selected dir
            clippingsDir = dirHandle;
        }

        // store handle in IndexedDB (structured clone) and mark chosen in chrome.storage
        await idbPut("vaultClippingsDir", clippingsDir);
        await chrome.storage.local.set({
            vaultClippingsChosen: true,
            vaultClippingsName: clippingsDir.name,
        });
        status.textContent = "Clippings folder saved: " + clippingsDir.name;
        setTimeout(() => window.close(), 700);
    } catch (e) {
        status.textContent = "Selection cancelled or failed.";
        console.error(e);
    }
});
document
    .getElementById("close")
    .addEventListener("click", () => window.close());
