import type * as React from "react";

/**
 * WAI-ARIA radio-group keyboard behaviour for the custom `role="radio"` pickers in the authoring area:
 * one tab stop per group (the checked radio, else the first) and Arrow / Home / End keys that move
 * focus and select (selection follows focus, as with native radios).
 *
 *   <div role="radiogroup" aria-label="Kind" {...rovingRadio}>…<button role="radio" aria-checked …/></div>
 */
function radiosOf(group: HTMLElement): HTMLElement[] {
  return Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
    (el) => el.closest('[role="radiogroup"]') === group && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true",
  );
}

function syncTabStops(group: HTMLElement) {
  const radios = radiosOf(group);
  const checked = radios.find((r) => r.getAttribute("aria-checked") === "true");
  radios.forEach((r, i) => {
    const stop = checked ? r === checked : i === 0;
    const want = stop ? "0" : "-1";
    if (r.getAttribute("tabindex") !== want) r.setAttribute("tabindex", want);
  });
}

const KEYS: Record<string, number | "first" | "last"> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  Home: "first",
  End: "last",
};

export const rovingRadio = {
  ref: (el: HTMLElement | null) => {
    if (!el) return;
    syncTabStops(el);
    const mo = new MutationObserver(() => syncTabStops(el));
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-checked", "disabled", "aria-disabled"] });
    return () => mo.disconnect();
  },
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
    const step = KEYS[e.key];
    if (step === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") !== "radio") return;
    const radios = radiosOf(e.currentTarget);
    const at = radios.indexOf(target);
    if (at < 0 || !radios.length) return;
    e.preventDefault();
    e.stopPropagation();
    const next =
      step === "first" ? radios[0]! : step === "last" ? radios[radios.length - 1]! : radios[(at + step + radios.length) % radios.length]!;
    next.focus();
    next.click();
  },
};
