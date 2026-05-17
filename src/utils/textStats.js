export function getTextStats(text) {
  const safeText = typeof text === "string" ? text : "";
  const words = (safeText.match(/\S+/g) || []).length;
  const chars = safeText.length;
  const lines = safeText.length === 0 ? 1 : safeText.split(/\r\n|\r|\n/).length;

  return { words, chars, lines };
}
