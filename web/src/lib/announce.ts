/** Politely announce a change to screen-reader users through the app's single live region. */
export function announce(message: string): void {
  const el = document.getElementById("announcer");
  if (!el) return;
  el.textContent = "";
  // A change of text is what triggers the announcement; clear first so repeats are read.
  window.setTimeout(() => {
    el.textContent = message;
  }, 30);
}
