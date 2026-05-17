export function createNotifier(toastElement) {
  let timerId = null;

  return {
    show(message, timeout = 2300) {
      if (!toastElement) {
        return;
      }

      toastElement.textContent = message;
      toastElement.classList.remove("hidden");

      if (timerId) {
        clearTimeout(timerId);
      }

      timerId = setTimeout(() => {
        toastElement.classList.add("hidden");
      }, timeout);
    }
  };
}
