# clippings

browser extension to save snippets of pages I like

Load the extension unpacked in Chrome for development:

## Installation

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this project folder (the folder containing `manifest.json`).

## Usage:

-   Highlight text on any page, right-click and choose "Create clipping".
-   An editor popup will appear showing the page title, URL, selection, and a comment box.
-   An editor popup will appear showing the page title, URL, selection, and a note box.
-   Click Save to store the clipping and export `clippings.md` to your Downloads folder (it will overwrite the existing `clippings.md`).

## Notes:

-   Clippings are stored in `chrome.storage.local` and grouped by site origin.
-   To avoid automatic overwrite, we can change the `conflictAction` or provide an explicit Export flow.
