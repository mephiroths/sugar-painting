import { messages } from './locales.js';

export const locales = ['zh-CN', 'zh-TW', 'en', 'ja'];
const storageKey = 'sugar-painting-language';
const reverse = new Map();
for (const [source, translations] of Object.entries(messages)) {
  reverse.set(source, source);
  for (const value of Object.values(translations)) reverse.set(value, source);
}
let locale = 'zh-CN';
let requested, saved;
try { requested = new URL(location.href).searchParams.get('lang'); } catch { /* Non-browser imports use Chinese. */ }
try { saved = localStorage.getItem(storageKey); } catch { /* Browser storage is optional. */ }
locale = locales.includes(requested) ? requested : locales.includes(saved) ? saved : locale;

export function getLocale() { return locale; }
export function t(source, values = {}) {
  const key = reverse.get(source) || source;
  const message = messages[key]?.[locale] ?? key;
  return message.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

// Bind text nodes rather than replacing HTML, preserving icons, inputs and focus.
// Resolvers keep state-dependent captions current without rebuilding the scene.
const bindings = new Map();
function bind(node, attribute, value) {
  if (!bindings.has(node)) bindings.set(node, new Map());
  const render = () => {
    const message = t(typeof value === 'function' ? value() : value);
    if (attribute) node.setAttribute(attribute, message);
    else node.textContent = message;
  };
  bindings.get(node).set(attribute, render);
  render();
}
export function setText(node, value) { bind(node, null, value); }
export function setLabel(node, attribute, value) { bind(node, attribute, value); }
export function releaseTranslations(root) {
  for (const node of bindings.keys()) if (root.contains(node)) bindings.delete(node);
}

export function setLocale(next, persist = true) {
  if (!locales.includes(next)) return false;
  locale = next;
  document.documentElement.lang = locale;
  const select = document.getElementById('language');
  if (select) select.value = locale;
  if (persist) { try { localStorage.setItem(storageKey, locale); } catch { /* Optional preference. */ } }
  for (const [node, renders] of bindings) {
    if (!node.isConnected) bindings.delete(node);
    else for (const render of renders.values()) render();
  }
  return true;
}

export function localize(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest('script, style, noscript, [data-i18n-ignore]')) continue;
    const source = node.textContent.trim();
    if (Object.hasOwn(messages, source)) {
      const leading = node.textContent.match(/^\s*/)[0], trailing = node.textContent.match(/\s*$/)[0];
      setText(node, () => leading + t(source) + trailing);
    }
  }
  for (const node of root.querySelectorAll('[aria-label], [title], meta[name="description"]')) {
    for (const attribute of ['aria-label', 'title', 'content']) {
      const source = node.getAttribute(attribute);
      if (Object.hasOwn(messages, source)) setLabel(node, attribute, source);
    }
  }
  const select = document.getElementById('language');
  if (select) select.addEventListener('change', () => setLocale(select.value));
  setLocale(locale, false);
}
