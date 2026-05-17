function signedCodeUnit(code) {
  return code > 32767 ? code - 65536 : code;
}

function encodeToRtfUnicode(text) {
  let result = "";

  for (const char of text) {
    const code = char.charCodeAt(0);

    if (char === "\\") {
      result += "\\\\";
      continue;
    }

    if (char === "{") {
      result += "\\{";
      continue;
    }

    if (char === "}") {
      result += "\\}";
      continue;
    }

    if (char === "\t") {
      result += "\\tab ";
      continue;
    }

    if (code >= 32 && code <= 126) {
      result += char;
      continue;
    }

    result += `\\u${signedCodeUnit(code)}?`;
  }

  return result;
}

export function plainTextToRtf(text) {
  const normalized = (text || "").replace(/\r\n|\r|\n/g, "\n");
  const body = normalized
    .split("\n")
    .map((line) => encodeToRtfUnicode(line))
    .join("\\par\n");

  return `{\\rtf1\\ansi\\deff0\\uc1\n${body}\n}`;
}

export function rtfToPlainText(raw) {
  if (typeof raw !== "string") {
    return "";
  }

  let text = raw;

  text = text.replace(/\\u(-?\d+)\??/g, (_, code) => {
    let numeric = Number(code);
    if (Number.isNaN(numeric)) {
      return "";
    }
    if (numeric < 0) {
      numeric += 65536;
    }
    return String.fromCharCode(numeric);
  });

  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  text = text.replace(/\\par[d]?/g, "\n");
  text = text.replace(/\\line/g, "\n");
  text = text.replace(/\\tab/g, "\t");
  text = text.replace(/\\\\/g, "\\");
  text = text.replace(/\\([{}])/g, "$1");
  text = text.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  text = text.replace(/[{}]/g, "");

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}
