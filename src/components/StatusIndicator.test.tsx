import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STATUS_KINDS } from "../domain/accessibility";
import { StatusIndicator } from "./StatusIndicator";

/**
 * `SH-088`. Colour is the least of the three signals rather than the only one: a red tint is
 * unreadable to a significant fraction of editors, flattened in forced-colours mode, and gone
 * in a printed screenshot.
 */
describe("StatusIndicator", () => {
  it("shows a shape and a word, not only a colour", () => {
    render(<StatusIndicator kind="offline" />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveTextContent("◌");
  });

  it("names what the status is about, and what to do about it", () => {
    render(<StatusIndicator kind="missing" subject="take1.mp4" />);
    const indicator = screen.getByRole("img");
    expect(indicator).toHaveAccessibleName(/take1\.mp4: Missing/);
    expect(indicator).toHaveAccessibleName(/Relink it/);
  });

  /** "Red" tells nobody anything they can act on. */
  it("never names the colour", () => {
    for (const kind of STATUS_KINDS) {
      const { unmount } = render(<StatusIndicator kind={kind} />);
      const name = screen.getByRole("img").getAttribute("aria-label")!.toLowerCase();
      for (const colour of ["red", "green", "amber", "blue", "grey"]) {
        expect(name).not.toMatch(new RegExp(`\\b${colour}\\b`));
      }
      unmount();
    }
  });

  /** Hiding the word visually must not hide it from a screen reader. */
  it("keeps the meaning available when the label is hidden", () => {
    render(<StatusIndicator kind="failed" showLabel={false} />);
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(/Failed/);
  });

  it("marks the glyph decorative, so it is not read twice", () => {
    const { container } = render(<StatusIndicator kind="available" />);
    expect(container.querySelector(".status-indicator__glyph")).toHaveAttribute("aria-hidden", "true");
  });

  /** A timeline of forty of these announcing themselves would talk over everything else. */
  it("is a label rather than an announcement", () => {
    const { container } = render(<StatusIndicator kind="processing" />);
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("renders every state without needing to know about any of them individually", () => {
    for (const kind of STATUS_KINDS) {
      const { unmount } = render(<StatusIndicator kind={kind} />);
      expect(screen.getByRole("img")).toBeInTheDocument();
      unmount();
    }
  });
});
