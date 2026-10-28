/**
 * Runs before paint (inline in <head>): applies a saved light/dark choice from the theme toggle.
 * The TV board (/board) ignores that choice: it opens in the owner's TV look (Settings), which the
 * root layout puts on <html data-board-theme>, dark when there is none. It decides here so the
 * board never flashes the other look first, and a browser that blocks storage (private mode)
 * still gets the TV look.
 */
export const THEME_SCRIPT = `try{var d=document.documentElement,t=null;try{t=localStorage.getItem("theme")}catch(e){}if(location.pathname==="/board")t=d.getAttribute("data-board-theme")==="light"?"light":"dark";if(t==="light"||t==="dark")d.setAttribute("data-theme",t)}catch(e){}`;
