/**
 * Keeps a sign-in redirect on this site: a path that starts with one slash and holds no
 * backslash, tab, line break or second leading slash (a browser would read "//x.com" or "/\x.com"
 * as another site). Anything else goes home. Pure, browser-safe. The same rule as Sales Coach.
 */
export function safeNextPath(input: string | null | undefined): string {
  if (!input || input.length > 2000) return "/";
  if (!input.startsWith("/") || input.startsWith("//") || /[\\\t\r\n]/.test(input)) return "/";
  try {
    const url = new URL(input, "https://example.invalid");
    if (url.origin !== "https://example.invalid") return "/";
    const path = url.pathname + url.search;
    if (path.startsWith("//")) return "/";
    return path;
  } catch {
    return "/";
  }
}
