/**
 * The demo's line icons (24px grid, a 1.8 stroke in currentColor), for the shell and the pages.
 * <Icon name="home" size={19} /> draws one; the paths are fixed constants (never user text).
 */
const PATHS = {
  "home": '<path d="M3.5 10.6 12 3.9l8.5 6.7"/><path d="M5.6 9.1v10.4h12.8V9.1"/><path d="M10 19.5v-5.2h4v5.2"/>',
  "chart": '<path d="M4 20h16"/><rect x="5.2" y="11.5" width="3.4" height="6" rx="1"/><rect x="10.3" y="5.5" width="3.4" height="12" rx="1"/><rect x="15.4" y="13.8" width="3.4" height="3.7" rx="1"/>',
  "plus": '<path d="M12 5v14M5 12h14"/>',
  "file": '<path d="M7 3.5h7.2l4.3 4.3v12.7H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.7V8h4.3"/><path d="M9 12.5h6M9 16h6"/>',
  "people": '<circle cx="9" cy="8.6" r="3.2"/><path d="M3.4 19.6c.6-3.3 2.8-5.1 5.6-5.1s5 1.8 5.6 5.1"/><path d="M15.3 5.7a3.1 3.1 0 0 1 0 5.8"/><path d="M17.3 14.8c1.7.7 2.9 2.3 3.2 4.8"/>',
  "user": '<circle cx="12" cy="8.4" r="3.7"/><path d="M4.8 20c.8-3.7 3.6-5.8 7.2-5.8s6.4 2.1 7.2 5.8"/>',
  "tv": '<rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 17v3.5"/>',
  "gear": '<path d="M4 7h9M17.5 7H20M4 17h3.5M12 17h8"/><circle cx="15.2" cy="7" r="2.2"/><circle cx="9.7" cy="17" r="2.2"/>',
  "check": '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  "check-circle": '<circle cx="12" cy="12" r="8.6"/><path d="M8.3 12.3l2.6 2.6 4.9-5.2"/>',
  "search": '<circle cx="11" cy="11" r="6.4"/><path d="M20 20l-4.3-4.3"/>',
  "filter": '<path d="M4 6.5h16M7 12h10M10 17.5h4"/>',
  "chevron-down": '<path d="M6.5 9.5 12 15l5.5-5.5"/>',
  "chevron-up": '<path d="M6.5 14.5 12 9l5.5 5.5"/>',
  "chevron-right": '<path d="M9.5 6.5 15 12l-5.5 5.5"/>',
  "chevron-left": '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
  "arrow-left": '<path d="M19 12H5.5M11 6.2 5.2 12l5.8 5.8"/>',
  "arrow-right": '<path d="M5 12h13.5M13 6.2l5.8 5.8-5.8 5.8"/>',
  "arrow-up": '<path d="M12 19V5.5M6.2 11 12 5.2l5.8 5.8"/>',
  "arrow-down": '<path d="M12 5v13.5M6.2 13 12 18.8l5.8-5.8"/>',
  "up": '<path d="M12 20V5M5.6 11.4 12 5l6.4 6.4"/>',
  "down": '<path d="M12 4v15M5.6 12.6 12 19l6.4-6.4"/>',
  "sort": '<path d="M8 4.5v15M4.6 8 8 4.5 11.4 8M16 19.5v-15M12.6 16 16 19.5l3.4-3.5"/>',
  "sort-down": '<path d="M12 5v14M6.6 13.6 12 19l5.4-5.4"/>',
  "sort-up": '<path d="M12 19V5M6.6 10.4 12 5l5.4 5.4"/>',
  "close": '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  "calendar": '<rect x="4" y="5.5" width="16" height="14.5" rx="2.2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  "lock": '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  "trash": '<path d="M4.5 7h15M10 4h4M6.6 7l.9 12.2a1 1 0 0 0 1 .8h7a1 1 0 0 0 1-.8L17.4 7"/><path d="M10 11v5.5M14 11v5.5"/>',
  "pencil": '<path d="M15.2 4.8l4 4L8.4 19.6H4.4v-4z"/><path d="M12.8 7.2l4 4"/>',
  "copy": '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  "download": '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  "more": '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  "logout": '<path d="M14 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
  "clock": '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6V12l3 2"/>',
  "info": '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4M12 8h.01"/>',
  "alert": '<path d="M12 4.2 2.9 19.5h18.2z"/><path d="M12 10v4.4M12 17.2h.01"/>',
  "columns": '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9.5 5v14M14.5 5v14"/>',
  "laptop": '<rect x="5" y="5.5" width="14" height="9.5" rx="1.6"/><path d="M3 18.5h18"/>',
  "phone": '<rect x="7" y="3" width="10" height="18" rx="2.6"/><path d="M11 17.5h2"/>',
  "trend-up": '<path d="M3.5 16.5 9.2 10.8l4 4L20.5 7.5"/><path d="M15 7.5h5.5V13"/>',
  "trend-down": '<path d="M3.5 7.5 9.2 13.2l4-4 7.3 7.3"/><path d="M15 16.5h5.5V11"/>',
  "play": '<path d="M8.5 5.8v12.4l9.6-6.2z"/>',
  "refresh": '<path d="M4.6 12a7.4 7.4 0 0 1 12.7-5.2L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.4 12a7.4 7.4 0 0 1-12.7 5.2L4.5 15"/><path d="M4.5 19.5V15H9"/>',
  "mail": '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4.2 7.2 12 13l7.8-5.8"/>',
  "call": '<path d="M6.6 3.8h2.6l1.4 4-2 1.3a10.5 10.5 0 0 0 6.3 6.3l1.3-2 4 1.4v2.6a1.8 1.8 0 0 1-2 1.8A15.6 15.6 0 0 1 4.8 5.8a1.8 1.8 0 0 1 1.8-2z"/>',
  "pin": '<path d="M12 21s-6.4-5.6-6.4-11a6.4 6.4 0 0 1 12.8 0c0 5.4-6.4 11-6.4 11z"/><circle cx="12" cy="10" r="2.3"/>',
  "user-plus": '<circle cx="10" cy="8.4" r="3.4"/><path d="M3.5 19.6c.7-3.4 3.3-5.3 6.5-5.3 1.5 0 2.9.4 4 1.1"/><path d="M18 13v6M15 16h6"/>',
  "shield": '<path d="M12 3.5l7 2.8v5.3c0 4.4-3 7.9-7 8.9-4-1-7-4.5-7-8.9V6.3z"/><path d="M9 12l2 2 4-4.2"/>',
  "note": '<path d="M5.5 4.5h13v10.2l-4.8 4.8H5.5z"/><path d="M13.7 19.5v-4.8h4.8"/><path d="M8.5 9h7M8.5 12h4"/>',
  "undo": '<path d="M9 7.5 4.5 12 9 16.5"/><path d="M4.5 12h10a4.5 4.5 0 0 1 0 9h-2"/>',
  "send": '<path d="M20 4 9.6 14.4M20 4l-6.4 16-4-5.6L4 10.4z"/>',
  "building": '<path d="M4.5 20.5V6.2l7.5-2.7v17M12 9h7.5v11.5M3.5 20.5h17"/><path d="M7.6 9h1.2M7.6 12.5h1.2M7.6 16h1.2M15 12.5h1.5M15 16h1.5"/>',
  "star": '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 15.9l-4.9 2.7 1.1-5.3-4-3.7 5.4-.6z"/>',
  "dot": '<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
  "minus": '<path d="M6 12h12"/>',
  "eye": '<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  "history": '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.7h3.7"/><path d="M12 8v4.2l2.8 1.8"/>',
  "flag": '<path d="M5.5 20.5V4.5M5.5 5h11l-2.2 4 2.2 4h-11"/>',
  "sound": '<path d="M4.5 9.5h3.2l4.3-3.8v12.6l-4.3-3.8H4.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/>',
  "trophy": '<path d="M7 3.5h10V9a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.6a.6.6 0 0 0-.6.6v.9A3.5 3.5 0 0 0 7.3 10.5"/><path d="M17 5.5h2.4a.6.6 0 0 1 .6.6v.9a3.5 3.5 0 0 1-3.3 3.5"/><path d="M12 14v3.5"/><path d="M8.5 20.5h7"/><path d="M9.5 20.5c0-1.7 1.1-3 2.5-3s2.5 1.3 2.5 3"/>',
  "medal": '<circle cx="12" cy="8.5" r="5.5"/><circle cx="12" cy="8.5" r="2.4"/><path d="M8.6 12.8 7.3 21l4.7-2.7 4.7 2.7-1.3-8.2"/>',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, size = 18, stroke = 1.8, className, title }: { name: IconName; size?: number; stroke?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `block shrink-0 ${className}` : "block shrink-0"}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
