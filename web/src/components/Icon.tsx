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
