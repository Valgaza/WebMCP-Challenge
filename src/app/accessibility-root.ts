import { DEFAULT_ACCESSIBILITY, rootAttributes, type AccessibilityPreferences } from "../domain/accessibility";

/**
 * Puts the resolved accessibility state on the root element, and keeps it there.
 *
 * The preference model, the resolver, and the whole `[data-motion]` / `[data-contrast]` /
 * `[data-focus]` stylesheet already existed and were tested. Nothing ever called
 * `rootAttributes`, so none of it applied to a single pixel: reduced motion worked only where
 * a bare `prefers-reduced-motion` query happened to cover it, and high contrast did not work
 * at all. This is the missing wire.
 *
 * The media queries are watched rather than read once, because a person can turn either
 * setting on while Estro is open — which is exactly when they need it.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const HIGH_CONTRAST = "(prefers-contrast: more)";

export function applyAccessibilityRoot(
  preferences: AccessibilityPreferences = DEFAULT_ACCESSIBILITY,
  root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
): () => void {
  if (!root || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const motion = window.matchMedia(REDUCED_MOTION);
  const contrast = window.matchMedia(HIGH_CONTRAST);

  const apply = () => {
    const attributes = rootAttributes(preferences, {
      reducedMotion: motion.matches,
      highContrast: contrast.matches,
    });
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
  };

  apply();
  motion.addEventListener("change", apply);
  contrast.addEventListener("change", apply);
  return () => {
    motion.removeEventListener("change", apply);
    contrast.removeEventListener("change", apply);
  };
}
