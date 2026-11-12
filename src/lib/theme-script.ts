/**
 * Runs before paint (inline in <head>): applies the saved look from the initials menu. Dark is the
 * default for everyone (owner, 2026-11-12: the "Agency dark" look), so no saved choice means dark;
 * "light" picks light and "auto" follows the phone (globals.css reads data-theme="auto" under
 * prefers-color-scheme). The TV board (/board) ignores that choice: it opens in the owner's TV look
 * (Settings), which the root layout puts on <html data-board-theme>, dark when there is none. It
 * decides here so the board never flashes the other look first, and a browser that blocks storage
 * (private mode) still gets the right look.
 */
export const THEME_SCRIPT = `try{var d=document.documentElement,t=null;try{t=localStorage.getItem("theme")}catch(e){}if(location.pathname==="/board")t=d.getAttribute("data-board-theme")==="light"?"light":"dark";if(t==="light"||t==="dark"||t==="auto")d.setAttribute("data-theme",t)}catch(e){}`;
