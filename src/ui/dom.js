export function getDomRefs() {
  return {
    editor: document.getElementById("editor"),
    fileInput: document.getElementById("file-input"),
    findInput: document.getElementById("find-input"),
    findPanel: document.getElementById("search-panel"),
    findResult: document.getElementById("find-result"),
    previewPane: document.getElementById("preview-pane"),
    previewContent: document.getElementById("preview-content"),
    previewToggle: document.getElementById("preview-toggle"),
    fontFamilySelect: document.getElementById("font-family-select"),
    fontSizeInput: document.getElementById("font-size-input"),
    themeToggle: document.getElementById("theme-toggle"),
    autosaveToggle: document.getElementById("autosave-toggle"),
    statusFile: document.getElementById("status-file"),
    statusCounts: document.getElementById("status-counts"),
    statusAutosave: document.getElementById("status-autosave"),
    statusTime: document.getElementById("status-time"),
    aboutDialog: document.getElementById("about-dialog"),
    hotkeysDialog: document.getElementById("hotkeys-dialog"),
    toast: document.getElementById("toast"),
    actionButtons: Array.from(document.querySelectorAll("[data-action]")),
    menus: Array.from(document.querySelectorAll(".menu"))
  };
}
