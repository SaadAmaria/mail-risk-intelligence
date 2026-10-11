/**
 * Where the "LLM setup guide" lives, once it exists.
 *
 * The "Live LLM setup" section of the project README on GitHub (the repository is private, so the
 * link opens for people who have access to it). It can be `null`: the interface then shows the
 * guide as plain, non-clickable text instead of a link that leads nowhere, and the panel still
 * names the README section.
 */
export const LLM_SETUP_GUIDE_URL: string | null =
  "https://github.com/SaadAmaria/mail-risk-intelligence/blob/main/README.md#live-llm-setup";

/** The heading in README.md that this anchor must keep matching (a test enforces it). */
export const LLM_SETUP_GUIDE_HEADING = "Live LLM setup";
