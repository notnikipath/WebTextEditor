import { HistoryManager } from "./historyManager.js";
import { getTextStats } from "../utils/textStats.js";
import { plainTextToRtf, rtfToPlainText } from "../utils/rtf.js";

const FILE_TYPES = [
  {
    description: "Text documents",
    accept: {
      "text/plain": [".txt"],
      "application/rtf": [".rtf"],
      "text/rtf": [".rtf"]
    }
  }
];

const AUTOSAVE_INTERVAL_MS = 30000;
const AUTOSAVE_STORAGE_KEY = "task2_editor_autosave";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseInlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function markdownToHtml(markdown) {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];

  let inCode = false;
  let codeBuffer = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      closeList();
      if (!inCode) {
        inCode = true;
        codeBuffer = [];
      } else {
        html.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (trimmed.length === 0) {
      closeList();
      html.push("<br />");
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${parseInlineMarkdown(escapeHtml(headingMatch[2]))}</h${level}>`);
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${parseInlineMarkdown(escapeHtml(listMatch[1]))}</li>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      closeList();
      html.push(`<blockquote>${parseInlineMarkdown(escapeHtml(quoteMatch[1]))}</blockquote>`);
      continue;
    }

    closeList();
    html.push(`<p>${parseInlineMarkdown(escapeHtml(line))}</p>`);
  }

  if (inCode && codeBuffer.length > 0) {
    html.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
  }

  closeList();
  return html.join("\n");
}

function extensionFromName(fileName) {
  const value = fileName.toLowerCase();
  return value.endsWith(".rtf") ? "rtf" : "txt";
}

function ensureExtension(fileName, format) {
  const cleanName = fileName.trim();
  if (!cleanName) {
    return format === "rtf" ? "document.rtf" : "document.txt";
  }

  if (cleanName.toLowerCase().endsWith(".txt") || cleanName.toLowerCase().endsWith(".rtf")) {
    return cleanName;
  }

  return `${cleanName}.${format}`;
}

export class EditorController {
  constructor(dom, notifier) {
    this.dom = dom;
    this.notifier = notifier;
    this.history = new HistoryManager(150);

    this.currentFileHandle = null;
    this.currentFileName = "Безымянный.txt";
    this.currentFormat = "txt";

    this.lastSavedSnapshot = "";
    this.isDirty = false;

    this.clockTimerId = null;
    this.autosaveTimerId = null;
  }

  init() {
    this.bindEvents();
    this.restoreAutosaveDraft();
    this.applyFontSettings();
    this.applyTheme(this.dom.themeToggle.checked);
    this.togglePreview(this.dom.previewToggle.checked);

    this.history.reset(this.dom.editor.value);
    this.lastSavedSnapshot = this.dom.editor.value;
    this.updateAllStatuses();
    this.startClock();
    this.toggleAutosave(this.dom.autosaveToggle.checked);
  }

  bindEvents() {
    this.dom.editor.addEventListener("input", () => {
      this.history.push(this.dom.editor.value);
      this.refreshDirtyState();
      this.updateCounts();
      this.renderPreview();
      this.updateFindResult();
    });

    this.dom.fileInput.addEventListener("change", async (event) => {
      const [file] = Array.from(event.target.files || []);
      if (!file) {
        return;
      }

      await this.loadFile(file, null);
      this.dom.fileInput.value = "";
    });

    this.dom.findInput.addEventListener("input", () => {
      this.updateFindResult();
    });

    this.dom.findInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.findNext();
      }
    });

    this.dom.previewToggle.addEventListener("change", (event) => {
      this.togglePreview(event.target.checked);
    });

    this.dom.themeToggle.addEventListener("change", (event) => {
      this.applyTheme(event.target.checked);
      this.saveAutosaveDraft();
    });

    this.dom.fontFamilySelect.addEventListener("change", () => {
      this.applyFontSettings();
      this.saveAutosaveDraft();
    });

    this.dom.fontSizeInput.addEventListener("change", () => {
      this.applyFontSettings();
      this.saveAutosaveDraft();
    });

    this.dom.autosaveToggle.addEventListener("change", (event) => {
      this.toggleAutosave(event.target.checked);
    });

    this.dom.actionButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        await this.handleAction(button.dataset.action);
        this.closeMenus();
      });
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".menu")) {
        this.closeMenus();
      }
    });

    document.addEventListener("keydown", async (event) => {
      await this.handleHotkeys(event);
    });

    window.addEventListener("beforeunload", (event) => {
      if (this.isDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  async handleAction(action) {
    switch (action) {
      case "new":
        await this.newFile();
        break;
      case "open":
        await this.openFile();
        break;
      case "save":
        await this.saveFile();
        break;
      case "save-as":
        await this.saveAsFile();
        break;
      case "undo":
        this.undo();
        break;
      case "find":
        this.openFindPanel();
        break;
      case "find-next":
        this.findNext();
        break;
      case "find-prev":
        this.findPrevious();
        break;
      case "find-close":
        this.closeFindPanel();
        break;
      case "copy":
        await this.copySelection();
        break;
      case "cut":
        await this.cutSelection();
        break;
      case "paste":
        await this.pasteFromClipboard();
        break;
      case "print":
        this.printDocument();
        break;
      case "hotkeys":
        this.dom.hotkeysDialog.showModal();
        break;
      case "about":
        this.dom.aboutDialog.showModal();
        break;
      case "close-hotkeys":
        this.dom.hotkeysDialog.close();
        break;
      case "close-about":
        this.dom.aboutDialog.close();
        break;
      default:
        break;
    }
  }

  async handleHotkeys(event) {
    const isModifierPressed = event.ctrlKey || event.metaKey;
    if (!isModifierPressed) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "n") {
      event.preventDefault();
      await this.newFile();
      return;
    }

    if (key === "o") {
      event.preventDefault();
      await this.openFile();
      return;
    }

    if (key === "s" && event.shiftKey) {
      event.preventDefault();
      await this.saveAsFile();
      return;
    }

    if (key === "s") {
      event.preventDefault();
      await this.saveFile();
      return;
    }

    if (key === "f") {
      event.preventDefault();
      this.openFindPanel();
      return;
    }

    if (key === "z") {
      event.preventDefault();
      this.undo();
      return;
    }

    if (key === "p") {
      event.preventDefault();
      this.printDocument();
    }
  }

  closeMenus() {
    this.dom.menus.forEach((menu) => {
      menu.removeAttribute("open");
    });
  }

  updateAllStatuses() {
    this.updateCounts();
    this.updateFileLabel();
    this.updateAutosaveLabel();
    this.updateTimeLabel();
    this.renderPreview();
    this.updateFindResult();
  }

  updateCounts() {
    const stats = getTextStats(this.dom.editor.value);
    this.dom.statusCounts.textContent = `Слова: ${stats.words} | Символы: ${stats.chars} | Строки: ${stats.lines}`;
  }

  updateFileLabel() {
    const suffix = this.isDirty ? " *" : "";
    this.dom.statusFile.textContent = `Файл: ${this.currentFileName}${suffix}`;
  }

  updateAutosaveLabel() {
    this.dom.statusAutosave.textContent = `Автосохранение: ${this.dom.autosaveToggle.checked ? "вкл" : "выкл"}`;
  }

  updateTimeLabel() {
    const now = new Date();
    const timeText = now.toLocaleTimeString("ru-RU", { hour12: false });
    this.dom.statusTime.textContent = `Время: ${timeText}`;
  }

  startClock() {
    this.updateTimeLabel();
    if (this.clockTimerId) {
      clearInterval(this.clockTimerId);
    }

    this.clockTimerId = setInterval(() => {
      this.updateTimeLabel();
    }, 1000);
  }

  refreshDirtyState() {
    this.isDirty = this.dom.editor.value !== this.lastSavedSnapshot;
    this.updateFileLabel();
  }

  setDocumentState({ fileName, format, handle }) {
    this.currentFileName = fileName;
    this.currentFormat = format;
    this.currentFileHandle = handle;
    this.updateFileLabel();
  }

  setEditorText(value, markAsSaved = false) {
    this.dom.editor.value = value;
    this.history.reset(value);

    if (markAsSaved) {
      this.lastSavedSnapshot = value;
    }

    this.refreshDirtyState();
    this.updateCounts();
    this.renderPreview();
    this.updateFindResult();
  }

  async confirmDiscardIfNeeded() {
    if (!this.isDirty) {
      return true;
    }

    return window.confirm("Есть несохраненные изменения. Продолжить?");
  }

  async newFile() {
    const canProceed = await this.confirmDiscardIfNeeded();
    if (!canProceed) {
      return;
    }

    this.setDocumentState({
      fileName: "Безымянный.txt",
      format: "txt",
      handle: null
    });

    this.setEditorText("", true);
    this.notifier.show("Создан новый документ");
  }

  async openFile() {
    const canProceed = await this.confirmDiscardIfNeeded();
    if (!canProceed) {
      return;
    }

    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: FILE_TYPES,
          multiple: false,
          excludeAcceptAllOption: false
        });

        if (!handle) {
          return;
        }

        const file = await handle.getFile();
        await this.loadFile(file, handle);
      } catch (error) {
        if (error && error.name !== "AbortError") {
          this.notifier.show("Не удалось открыть файл");
        }
      }
      return;
    }

    this.dom.fileInput.click();
  }

  async loadFile(file, handle) {
    const format = extensionFromName(file.name);
    const rawContent = await file.text();
    const parsed = format === "rtf" ? rtfToPlainText(rawContent) : rawContent;

    this.setDocumentState({
      fileName: file.name,
      format,
      handle
    });

    this.setEditorText(parsed, true);
    this.notifier.show(`Открыт файл: ${file.name}`);
  }

  getSerializedContent(format = this.currentFormat) {
    const content = this.dom.editor.value;
    return format === "rtf" ? plainTextToRtf(content) : content;
  }

  async writeToHandle(handle, content) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  downloadContent(fileName, content, format) {
    const mime = format === "rtf" ? "application/rtf" : "text/plain;charset=utf-8";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  markSaved() {
    this.lastSavedSnapshot = this.dom.editor.value;
    this.refreshDirtyState();
    this.saveAutosaveDraft();
  }

  async saveFile() {
    const content = this.getSerializedContent(this.currentFormat);

    if (this.currentFileHandle && this.currentFileHandle.createWritable) {
      try {
        await this.writeToHandle(this.currentFileHandle, content);
        this.markSaved();
        this.notifier.show("Файл сохранен");
      } catch (_error) {
        this.notifier.show("Ошибка сохранения через системный доступ. Выполнено сохранение как загрузка.");
        this.downloadContent(this.currentFileName, content, this.currentFormat);
        this.markSaved();
      }
      return;
    }

    this.downloadContent(this.currentFileName, content, this.currentFormat);
    this.markSaved();
    this.notifier.show("Файл сохранен (скачивание)");
  }

  async saveAsFile() {
    let targetFormat = this.currentFormat;
    let targetName = this.currentFileName;
    const currentContent = this.dom.editor.value;

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: targetName,
          types: FILE_TYPES,
          excludeAcceptAllOption: false
        });

        if (!handle) {
          return;
        }

        targetName = ensureExtension(handle.name || targetName, extensionFromName(handle.name || targetName));
        targetFormat = extensionFromName(targetName);

        await this.writeToHandle(handle, this.getSerializedContent(targetFormat));

        this.setDocumentState({
          fileName: targetName,
          format: targetFormat,
          handle
        });

        this.lastSavedSnapshot = currentContent;
        this.refreshDirtyState();
        this.saveAutosaveDraft();
        this.notifier.show("Файл сохранен как...");
      } catch (error) {
        if (error && error.name !== "AbortError") {
          this.notifier.show("Сохранение отменено или недоступно");
        }
      }
      return;
    }

    const nameFromPrompt = window.prompt("Введите имя файла (.txt или .rtf)", targetName);
    if (!nameFromPrompt) {
      return;
    }

    targetFormat = extensionFromName(nameFromPrompt);
    targetName = ensureExtension(nameFromPrompt, targetFormat);

    this.downloadContent(targetName, this.getSerializedContent(targetFormat), targetFormat);
    this.setDocumentState({
      fileName: targetName,
      format: targetFormat,
      handle: null
    });

    this.lastSavedSnapshot = currentContent;
    this.refreshDirtyState();
    this.saveAutosaveDraft();
    this.notifier.show("Файл сохранен как... (скачивание)");
  }

  undo() {
    const previousState = this.history.undo();
    if (previousState === null) {
      return;
    }

    this.dom.editor.value = previousState;
    this.refreshDirtyState();
    this.updateCounts();
    this.renderPreview();
    this.updateFindResult();
  }

  openFindPanel() {
    this.dom.findPanel.classList.remove("hidden");
    this.dom.findInput.focus();
    this.dom.findInput.select();
    this.updateFindResult();
  }

  closeFindPanel() {
    this.dom.findPanel.classList.add("hidden");
    this.dom.editor.focus();
  }

  updateFindResult() {
    const query = this.dom.findInput.value;
    if (!query) {
      this.dom.findResult.textContent = "Совпадений: 0";
      return;
    }

    const regex = new RegExp(escapeRegExp(query), "gi");
    const matches = this.dom.editor.value.match(regex);
    const count = matches ? matches.length : 0;
    this.dom.findResult.textContent = `Совпадений: ${count}`;
  }

  findNext() {
    this.findByDirection(1);
  }

  findPrevious() {
    this.findByDirection(-1);
  }

  findByDirection(direction) {
    const query = this.dom.findInput.value;
    if (!query) {
      this.notifier.show("Введите текст для поиска");
      return;
    }

    const haystack = this.dom.editor.value.toLowerCase();
    const needle = query.toLowerCase();

    let startIndex;
    let foundIndex;

    if (direction > 0) {
      startIndex = this.dom.editor.selectionEnd;
      foundIndex = haystack.indexOf(needle, startIndex);
      if (foundIndex === -1) {
        foundIndex = haystack.indexOf(needle, 0);
      }
    } else {
      startIndex = Math.max(0, this.dom.editor.selectionStart - 1);
      foundIndex = haystack.lastIndexOf(needle, startIndex);
      if (foundIndex === -1) {
        foundIndex = haystack.lastIndexOf(needle);
      }
    }

    if (foundIndex === -1) {
      this.notifier.show("Совпадения не найдены");
      return;
    }

    this.dom.editor.focus();
    this.dom.editor.setSelectionRange(foundIndex, foundIndex + query.length);
  }

  async copySelection() {
    const { selectionStart, selectionEnd, value } = this.dom.editor;
    const selection = value.slice(selectionStart, selectionEnd);

    if (!selection) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selection);
      this.notifier.show("Текст скопирован");
    } catch (_error) {
      document.execCommand("copy");
      this.notifier.show("Текст скопирован");
    }
  }

  async cutSelection() {
    const { selectionStart, selectionEnd, value } = this.dom.editor;
    const selection = value.slice(selectionStart, selectionEnd);

    if (!selection) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selection);
    } catch (_error) {
      document.execCommand("cut");
      return;
    }

    this.dom.editor.setRangeText("", selectionStart, selectionEnd, "start");
    this.history.push(this.dom.editor.value);
    this.refreshDirtyState();
    this.updateCounts();
    this.renderPreview();
    this.notifier.show("Текст вырезан");
  }

  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }
      const start = this.dom.editor.selectionStart;
      const end = this.dom.editor.selectionEnd;
      this.dom.editor.setRangeText(text, start, end, "end");
      this.history.push(this.dom.editor.value);
      this.refreshDirtyState();
      this.updateCounts();
      this.renderPreview();
      this.notifier.show("Текст вставлен");
    } catch (_error) {
      document.execCommand("paste");
    }
  }

  togglePreview(enabled) {
    this.dom.previewPane.classList.toggle("hidden", !enabled);
    this.renderPreview();
  }

  renderPreview() {
    if (this.dom.previewPane.classList.contains("hidden")) {
      return;
    }

    const html = markdownToHtml(this.dom.editor.value);
    this.dom.previewContent.innerHTML = html;
  }

  applyFontSettings() {
    const family = this.dom.fontFamilySelect.value;
    const size = Number(this.dom.fontSizeInput.value) || 16;

    this.dom.editor.style.fontFamily = family;
    this.dom.editor.style.fontSize = `${size}px`;
    this.dom.previewContent.style.fontFamily = family;
    this.dom.previewContent.style.fontSize = `${Math.max(12, size - 1)}px`;
  }

  applyTheme(isDark) {
    document.body.classList.toggle("theme-dark", Boolean(isDark));
    document.body.classList.toggle("theme-light", !isDark);
  }

  toggleAutosave(enabled) {
    if (this.autosaveTimerId) {
      clearInterval(this.autosaveTimerId);
      this.autosaveTimerId = null;
    }

    if (enabled) {
      this.autosaveTimerId = setInterval(() => {
        if (this.isDirty) {
          this.saveAutosaveDraft();
          this.notifier.show("Черновик автосохранен", 1000);
        }
      }, AUTOSAVE_INTERVAL_MS);
    }

    this.updateAutosaveLabel();
  }

  saveAutosaveDraft() {
    const draft = {
      fileName: this.currentFileName,
      format: this.currentFormat,
      content: this.dom.editor.value,
      isDarkTheme: this.dom.themeToggle.checked,
      fontFamily: this.dom.fontFamilySelect.value,
      fontSize: this.dom.fontSizeInput.value,
      previewEnabled: this.dom.previewToggle.checked,
      autosaveEnabled: this.dom.autosaveToggle.checked,
      updatedAt: new Date().toISOString()
    };

    try {
      localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(draft));
    } catch (_error) {
      this.notifier.show("Не удалось записать автосохранение");
    }
  }

  restoreAutosaveDraft() {
    try {
      const rawDraft = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
      if (!rawDraft) {
        return;
      }

      const draft = JSON.parse(rawDraft);
      if (!draft || typeof draft.content !== "string") {
        return;
      }

      this.setDocumentState({
        fileName: draft.fileName || "Безымянный.txt",
        format: draft.format || "txt",
        handle: null
      });

      this.dom.editor.value = draft.content;
      this.dom.themeToggle.checked = Boolean(draft.isDarkTheme);
      this.dom.previewToggle.checked = draft.previewEnabled !== false;
      this.dom.autosaveToggle.checked = draft.autosaveEnabled !== false;

      if (draft.fontFamily) {
        this.dom.fontFamilySelect.value = draft.fontFamily;
      }

      if (draft.fontSize) {
        this.dom.fontSizeInput.value = Number(draft.fontSize);
      }

      this.notifier.show("Восстановлен черновик из автосохранения");
    } catch (_error) {
      this.notifier.show("Автосохранение повреждено и было пропущено");
    }
  }

  printDocument() {
    window.print();
  }
}
