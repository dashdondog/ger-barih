import { $, icon } from "./dom.js";
import { room } from "./net.js";

let toastTimer = 0;
export function toast(text, isError = false, iconName = null) {
  const t = $("#toast");
  t.textContent = text;
  if (iconName) t.prepend(icon(iconName));
  t.classList.toggle("err", isError);
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), isError ? 3200 : 2600);
}

const shareUrl = () => `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl());
    toast("Урилгын линк хуулагдлаа. Найздаа илгээгээрэй!");
  } catch {
    toast(shareUrl());
  }
}
$("#copy-link").addEventListener("click", copyLink);
$("#share-copy").addEventListener("click", copyLink);
$("#share-url").textContent = shareUrl();
