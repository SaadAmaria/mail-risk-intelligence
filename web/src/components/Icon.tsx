import type { SVGProps } from "react";

/** A small, consistent 24px stroke icon set (no icon library). Decorative unless `title` is set. */
const PATHS: Record<string, string> = {
  logo: "M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z M4 7.5l8 4.5 8-4.5 M12 12v9",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.3-4.3",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h6",
  paperclip: "m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7",
  "alert-triangle": "M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01",
  "alert-circle": "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-13v5m0 3h.01",
  "circle-dot": "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  "check-circle": "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm-4-9 3 3 5-6",
  "dashed-circle": "M12 3a9 9 0 0 1 3.5.7M20.3 8.5A9 9 0 0 1 21 12M20 16a9 9 0 0 1-3.5 3.3M12 21a9 9 0 0 1-3.5-.7M5 17.5A9 9 0 0 1 3 12M4 8.5A9 9 0 0 1 8.5 4M12 8v4m0 3h.01",
  "chevron-left": "m15 6-6 6 6 6",
  "chevron-right": "m9 6 6 6-6 6",
  x: "M6 6l12 12M18 6 6 18",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 13 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z",
  shield: "M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  info: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-10v6m0-9h.01",
  clock: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-14v5l3 2",
  flag: "M5 21V4m0 1h11l-1.5 4L16 13H5",
  mail: "M4 6h16v12H4V6Zm0 1 8 6 8-6",
  filter: "M4 5h16l-6 7v6l-4 2v-8L4 5Z",
  quote: "M7 7h4v4a4 4 0 0 1-4 4M15 7h4v4a4 4 0 0 1-4 4",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8.5c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5",
  building: "M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h3a1 1 0 0 1 1 1v10M3 21h18M9 8h2M9 12h2M9 16h2",
  ledger: "M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Zm0 0v14a2 2 0 0 0 2 2M10 9h5M10 13h5",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  coin: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm2.5-12.2c-.5-.6-1.4-1-2.5-1-1.5 0-2.5.8-2.5 1.9 0 2.7 5 1.3 5 4 0 1.1-1 1.9-2.5 1.9-1.1 0-2-.4-2.5-1M12 6.5V8m0 8v1.5",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  map: "M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5ZM9 4v13.5M15 6.5V20",
  zoomIn: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.3-4.3M11 8v6M8 11h6",
  zoomOut: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.3-4.3M8 11h6",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};

export type IconName = keyof typeof PATHS | string;

interface Props extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  title?: string;
}

export function Icon({ name, size = 16, title, ...rest }: Props) {
  const d = PATHS[name] ?? PATHS.info!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}
