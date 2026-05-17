export class HistoryManager {
  constructor(limit = 120) {
    this.limit = limit;
    this.stack = [""];
    this.index = 0;
  }

  reset(state = "") {
    this.stack = [state];
    this.index = 0;
  }

  push(state) {
    if (this.stack[this.index] === state) {
      return;
    }

    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(state);

    if (this.stack.length > this.limit) {
      this.stack.shift();
    }

    this.index = this.stack.length - 1;
  }

  undo() {
    if (!this.canUndo()) {
      return null;
    }

    this.index -= 1;
    return this.stack[this.index];
  }

  canUndo() {
    return this.index > 0;
  }
}
