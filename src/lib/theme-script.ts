/** Runs before paint (inline in <head>): applies a saved light/dark choice from the theme toggle. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
