import type { SVGProps } from 'react';

// Inline brand SVG icons — pulled individually so we don't ship an entire
// icon library for 5 logos. Each component accepts {className, style} so
// the existing ICON_MAP color/sizing flow keeps working.

export const IconCursor = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    aria-hidden
  >
    <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
  </svg>
);

export const IconAntigravity = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    aria-hidden
  >
    <path d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z" />
  </svg>
);

export const IconCodex = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    aria-hidden
  >
    <path
      clipRule="evenodd"
      d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
    />
  </svg>
);

export const IconMcp = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    aria-hidden
  >
    <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
    <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" />
  </svg>
);

// WebSocket — iconify logos:websocket (Gil Barbara, free for OSS use)
// Brand-color baked in (#231f20 of the spec mark); ignores style color so it
// always looks like the WebSocket spec logo, not the surrounding text.
export const IconWebsocket = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    width="1.33em"
    height="1em"
    viewBox="0 0 256 193"
    aria-hidden
  >
    <path
      fill="currentColor"
      d="M192.44 144.645h31.78V68.339l-35.805-35.804l-22.472 22.472l26.497 26.497zm31.864 15.931H113.452L86.954 134.08l11.237-11.236l21.885 21.885h45.028l-44.357-44.441l11.32-11.32l44.357 44.358v-45.03l-21.801-21.801l11.152-11.153L110.685 0H0l31.696 31.696v.084h65.74l23.227 23.227l-33.96 33.96L63.476 65.74V47.712h-31.78v31.193l55.007 55.007L64.314 156.3l35.805 35.805H256z"
    />
  </svg>
);

// Playwright — iconify simple-icons:playwright. Single-color so it picks up
// brand green (#2EAD33) from inline style like other react-icons brand chips.
export const IconPlaywright = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      fill="currentColor"
      d="M23.996 7.462c-.056.837-.257 2.135-.716 3.85c-.995 3.715-4.27 10.874-10.42 9.227c-6.15-1.65-5.407-9.487-4.412-13.201c.46-1.716.934-2.94 1.305-3.694c.42-.853.846-.289 1.815.523c.684.573 2.41 1.791 5.011 2.488s4.706.506 5.583.352c1.245-.219 1.897-.494 1.834.455m-9.807 3.863s-.127-1.819-1.773-2.286c-1.644-.467-2.613 1.04-2.613 1.04Zm4.058 4.539l-7.769-2.172s.446 2.306 3.338 3.153c2.862.836 4.43-.98 4.43-.981Zm2.701-2.51s-.13-1.818-1.773-2.286c-1.644-.469-2.612 1.038-2.612 1.038ZM8.57 18.23c-4.749 1.279-7.261-4.224-8.021-7.08C.197 9.831.044 8.832.003 8.188c-.047-.73.455-.52 1.415-.354c.677.118 2.3.261 4.308-.28a11.3 11.3 0 0 0 2.41-.956q-.087.295-.17.61c-.433 1.618-.827 4.055-.632 6.426c-1.976.732-2.267 2.423-2.267 2.423l2.524-.715c.227 1.002.6 1.987 1.15 2.838zm-4.188-6.298c1.265-.333 1.363-1.631 1.363-1.631l-3.374.888s.745 1.076 2.01.743Z"
    />
  </svg>
);

// JSON — iconify codicon:json. Monochrome braces, picks up color prop.
export const IconJson = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    width="1em"
    height="1em"
    viewBox="0 0 16 16"
    aria-hidden
  >
    <path
      fill="currentColor"
      d="M5 2a2 2 0 0 0-2 2v2.005c0 .53-.008.794-.09.997c-.062.156-.194.331-.634.55a.5.5 0 0 0 0 .895c.44.22.572.395.635.551c.081.204.089.47.089 1.002v2a2 2 0 0 0 2 2a.5.5 0 0 0 0-1a1 1 0 0 1-1-1V9.941c0-.449 0-.91-.16-1.314A1.7 1.7 0 0 0 3.4 8c.196-.18.342-.384.44-.626C4 6.971 4 6.51 4 6.063V4a1 1 0 0 1 1-1a.5.5 0 0 0 0-1m6 0a2 2 0 0 1 2 2v2.005c0 .53.008.794.09.997c.062.156.194.331.634.55a.5.5 0 0 1 0 .895c-.44.22-.572.395-.635.551c-.081.204-.089.47-.089 1.002v2a2 2 0 0 1-2 2a.5.5 0 0 1 0-1a1 1 0 0 0 1-1V9.941c0-.449 0-.91.16-1.314A1.7 1.7 0 0 1 12.6 8a1.7 1.7 0 0 1-.44-.626C12 6.971 12 6.51 12 6.063V4a1 1 0 0 0-1-1a.5.5 0 0 1 0-1"
    />
  </svg>
);

// DNS — iconify iconoir:dns. Stroke-based; uses currentColor for stroke.
export const IconDns = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <g
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    >
      <path d="M22 13v-1c0-5.523-4.477-10-10-10S2 6.477 2 12c0 2.251.744 4.329 2 6" />
      <path d="M13 2.049s3 3.95 3 9.95v1m-5-10.95s-3 3.95-3 9.95v1M2.63 15.5H4m-1.37-7h18.74M7 22v-6h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2zm6 0v-6l3 6v-6m3 6h2a1.5 1.5 0 0 0 1.5-1.5v0A1.5 1.5 0 0 0 21 19h-.5a1.5 1.5 0 0 1-1.5-1.5v0a1.5 1.5 0 0 1 1.5-1.5H22" />
    </g>
  </svg>
);

// CDN — custom: cloud outline + "CDN" label baked into the middle.
// Stroke uses currentColor so it picks up the ICON_MAP brand color.
export const IconCdn = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    width="1em"
    height="1em"
    viewBox="0 0 64 48"
    aria-hidden
  >
    <path
      d="M16 38h32a10 10 0 0 0 1.4-19.9A14 14 0 0 0 22 18.2 9 9 0 0 0 16 38z"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <text
      x="32"
      y="32"
      textAnchor="middle"
      fontSize="13"
      fontWeight="700"
      fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
      fill="currentColor"
    >
      CDN
    </text>
  </svg>
);

// VS Code uses Microsoft brand blues — keep them baked in, color prop
// is ignored (icon stays VS-Code-blue regardless of inline color).
// Stripped of the dropshadow filters from the original devicon SVG to
// keep payload light; visually identical at icon scales.
export const IconVscode = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    viewBox="0 0 128 128"
    width="1em"
    height="1em"
    aria-hidden
  >
    <mask id="vscode-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128" style={{ maskType: 'alpha' }}>
      <path
        fill="#fff"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M90.767 127.126a7.968 7.968 0 0 0 6.35-.244l26.353-12.681a8 8 0 0 0 4.53-7.209V21.009a8 8 0 0 0-4.53-7.21L97.117 1.12a7.97 7.97 0 0 0-9.093 1.548l-50.45 46.026L15.6 32.013a5.328 5.328 0 0 0-6.807.302l-7.048 6.411a5.335 5.335 0 0 0-.006 7.888L20.796 64 1.74 81.387a5.336 5.336 0 0 0 .006 7.887l7.048 6.411a5.327 5.327 0 0 0 6.807.303l21.974-16.68 50.45 46.025a7.96 7.96 0 0 0 2.743 1.793Zm5.252-92.183L57.74 64l38.28 29.058V34.943Z"
      />
    </mask>
    <g mask="url(#vscode-mask)">
      <path fill="#0065A9" d="M123.471 13.82 97.097 1.12A7.973 7.973 0 0 0 88 2.668L1.662 81.387a5.333 5.333 0 0 0 .006 7.887l7.052 6.411a5.333 5.333 0 0 0 6.811.303l103.971-78.875c3.488-2.646 8.498-.158 8.498 4.22v-.306a8.001 8.001 0 0 0-4.529-7.208Z" />
      <path fill="#007ACC" d="m123.471 114.181-26.374 12.698A7.973 7.973 0 0 1 88 125.333L1.662 46.613a5.333 5.333 0 0 1 .006-7.887l7.052-6.411a5.333 5.333 0 0 1 6.811-.303l103.971 78.874c3.488 2.647 8.498.159 8.498-4.219v.306a8.001 8.001 0 0 1-4.529 7.208Z" />
      <path fill="#1F9CF0" d="M97.098 126.882A7.977 7.977 0 0 1 88 125.333c2.952 2.952 8 .861 8-3.314V5.98c0-4.175-5.048-6.266-8-3.313a7.977 7.977 0 0 1 9.098-1.549L123.467 13.8A8 8 0 0 1 128 21.01v85.982a8 8 0 0 1-4.533 7.21l-26.369 12.681Z" />
    </g>
  </svg>
);
