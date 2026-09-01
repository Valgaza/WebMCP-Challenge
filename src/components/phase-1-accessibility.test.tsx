import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectError } from "../domain/project-error";
import { webMcpActivityStore } from "../webmcp/activity-store";
import { TransactionProposalDialog } from "./TransactionProposalDialog";
import { WebMcpActivityCenter } from "./WebMcpActivityCenter";

beforeEach(() => {
  webMcpActivityStore.clearActivity();
});

describe("Phase 1 accessibility contracts", () => {
  it("associates proposal validation feedback with the exact affected field", async () => {
    const user = userEvent.setup();
    render(
      <TransactionProposalDialog
        open
        currentName="Draft"
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => {
          throw new ProjectError("INVALID_INPUT", "Enter a snapshot name.", { fieldPath: "operations.1.name" });
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Prepare proposal" }));

    const error = await screen.findByText("Enter a snapshot name.");
    const projectName = screen.getByLabelText("New project name");
    const snapshotName = screen.getByLabelText("Snapshot name");
    expect(projectName).not.toHaveAttribute("aria-invalid");
    expect(snapshotName).toHaveAttribute("aria-invalid", "true");
    expect(projectName).toHaveAccessibleDescription("The proposal expires after ten minutes and only applies to the current source revision.");
    expect(snapshotName).toHaveAccessibleDescription("Enter a snapshot name.");
    expect(error).toHaveAttribute("id", "proposal-error");
    expect(snapshotName).toHaveFocus();
  });

  it("keeps a stable polite region for WebMCP activity updates", async () => {
    render(<WebMcpActivityCenter />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");

    act(() => {
      webMcpActivityStore.show({
        id: "activity-1",
        stage: "complete",
        title: "Project inspected",
        detail: "Revision revision-1 is current.",
      });
    });

    await waitFor(() => expect(status).toHaveTextContent("Project inspected. Revision revision-1 is current."));
  });
});
