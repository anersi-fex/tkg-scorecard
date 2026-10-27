/**
 * Runs before paint (inline in <head>): applies a saved light/dark choice from the theme toggle.
 * The TV board (/board) is dark unless the address says ?theme=light or this browser saved a
 * choice, and it decides here so the board never flashes light first.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(location.pathname==="/board"){var q=new URLSearchParams(location.search).get("theme");if(q==="light"||q==="dark")t=q;else if(t!=="light"&&t!=="dark")t="dark"}if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
