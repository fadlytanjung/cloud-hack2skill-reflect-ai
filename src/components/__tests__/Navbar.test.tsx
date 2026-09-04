// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Navbar } from "../Navbar";
import type { UserProfile } from "../../types";

const USER: UserProfile = {
  uid: "uid-1",
  email: "reflector@example.com",
  displayName: "Ada Reflector",
  photoURL: null,
};

function renderNavbar(overrides: Partial<React.ComponentProps<typeof Navbar>> = {}) {
  const props = {
    user: USER,
    onSignOut: vi.fn(),
    syncStatus: "saved" as const,
    ...overrides,
  };
  return { ...render(<Navbar {...props} />), props };
}

describe("Navbar", () => {
  it("shows the signed-in user's name and email", () => {
    renderNavbar();
    expect(screen.getByText("Ada Reflector")).toBeInTheDocument();
    expect(screen.getByText("reflector@example.com")).toBeInTheDocument();
  });

  it("falls back to an initial avatar when the user has no photo", () => {
    renderNavbar();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders the avatar image with no-referrer when a photo is present", () => {
    renderNavbar({ user: { ...USER, photoURL: "https://example.com/a.png" } });
    const avatar = screen.getByRole("img", { name: "Ada Reflector" });
    expect(avatar).toHaveAttribute("src", "https://example.com/a.png");
    // Google profile URLs reject requests carrying a referrer.
    expect(avatar).toHaveAttribute("referrerPolicy", "no-referrer");
  });

  it("uses placeholders when the profile has no name or email", () => {
    renderNavbar({ user: { ...USER, displayName: null, email: null } });
    expect(screen.getByText("Active User")).toBeInTheDocument();
    expect(screen.getByText("Secure Session")).toBeInTheDocument();
    expect(screen.getByText("U")).toBeInTheDocument();
  });

  describe("sync status", () => {
    it("reports Firestore isolation when saved", () => {
      renderNavbar({ syncStatus: "saved" });
      expect(screen.getByText("Firestore Isolated")).toBeInTheDocument();
    });

    it("reports progress while saving", () => {
      renderNavbar({ syncStatus: "saving" });
      expect(screen.getByText("Syncing securely...")).toBeInTheDocument();
    });

    it("offers a retry the user can click when saving failed", async () => {
      const onRetrySync = vi.fn();
      renderNavbar({ syncStatus: "error", onRetrySync });
      const retry = screen.getByRole("button", { name: /Save Failed/ });
      await userEvent.click(retry);
      expect(onRetrySync).toHaveBeenCalledOnce();
    });

    it("marks a preview session as sandboxed rather than cloud-synced", () => {
      renderNavbar({ user: { ...USER, uid: "preview-user-abc" }, syncStatus: "saved" });
      expect(screen.getByText("Sandboxed Session")).toBeInTheDocument();
      expect(screen.queryByText("Firestore Isolated")).not.toBeInTheDocument();
    });
  });

  describe("admin hub entry point", () => {
    it("is hidden when no handler is supplied", () => {
      renderNavbar();
      expect(screen.queryByRole("button", { name: /Hub/ })).not.toBeInTheDocument();
    });

    it("reads 'RBAC Hub' for a standard user and 'Admin Hub' for an admin", () => {
      const { unmount } = renderNavbar({ onOpenAdmin: vi.fn() });
      expect(screen.getByRole("button", { name: "RBAC Hub" })).toBeInTheDocument();
      unmount();

      renderNavbar({ user: { ...USER, role: "admin" }, onOpenAdmin: vi.fn() });
      expect(screen.getByRole("button", { name: "Admin Hub" })).toBeInTheDocument();
    });

    it("invokes the handler on click", async () => {
      const onOpenAdmin = vi.fn();
      renderNavbar({ onOpenAdmin });
      await userEvent.click(screen.getByRole("button", { name: "RBAC Hub" }));
      expect(onOpenAdmin).toHaveBeenCalledOnce();
    });
  });

  it("signs the user out on click", async () => {
    const onSignOut = vi.fn();
    renderNavbar({ onSignOut });
    await userEvent.click(screen.getByTitle("Sign Out"));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
