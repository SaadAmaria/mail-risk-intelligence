import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigateTo } from "../lib/router";

/**
 * A real anchor (so open-in-new-tab, copy-link and middle-click work) that navigates in-app
 * through the History API on a plain left click.
 */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigateTo(href);
      }}
    />
  );
}
