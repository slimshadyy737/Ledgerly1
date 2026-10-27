/**
 * Inline theme bootstrap. Runs before first paint (injected in <head> by
 * app/layout.tsx) so the correct palette is applied without a flash of the
 * wrong theme. Kept in its own non-client module so a server component can
 * render it as a string.
 */
export const THEME_STORAGE_KEY = "ledgerly.theme";

export const THEME_INIT_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}";var s=localStorage.getItem(k)||"dark";var m=window.matchMedia("(prefers-color-scheme: light)").matches;var r=s==="system"?(m?"light":"dark"):s;var e=document.documentElement;e.classList.remove("light","dark");e.classList.add(r);e.dataset.theme=s;e.style.colorScheme=r;}catch(e){document.documentElement.classList.add("dark");}})();`;
