import { getDomRefs } from "./ui/dom.js";
import { createNotifier } from "./ui/notifications.js";
import { EditorController } from "./logic/editorController.js";

const dom = getDomRefs();
const notifier = createNotifier(dom.toast);
const editorController = new EditorController(dom, notifier);

editorController.init();
