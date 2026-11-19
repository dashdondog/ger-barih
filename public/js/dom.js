// ── dom helpers ─────────────────────────────────────────────────────────────

export const $ = (s) => document.querySelector(s);

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** An icon from the sprite in index.html, coloured by the surrounding text. */
export const icon = (name) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ico");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
};

/** A button with a leading icon (or a trailing one when `after` is set). */
export const iconButton = (cls, name, text, after = false) => {
  const b = el("button", cls);
  b.type = "button";
  const label = document.createTextNode(text);
  if (after) b.append(label, icon(name));
  else b.append(icon(name), label);
  return b;
};
