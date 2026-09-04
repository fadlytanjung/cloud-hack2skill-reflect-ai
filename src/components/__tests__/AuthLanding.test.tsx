// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithGoogle = vi.fn();
const signInAsGuest = vi.fn();

vi.mock("../../lib/firebase", () => ({
  signInWithGoogle: (...args: unknown[]) => signInWithGoogle(...args),
  signInAsGuest: (...args: unknown[]) => signInAsGuest(...args),
}));

const { AuthLanding } = await import("../AuthLanding");

beforeEach(() => {
  signInWithGoogle.mockReset().mockResolvedValue({ uid: "uid-1" });
  signInAsGuest.mockReset().mockResolvedValue({ uid: "anon-1" });
});

describe("AuthLanding", () => {
  it("offers both a Google and a guest route in", () => {
    render(<AuthLanding />);
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enter as Guest Explorer/ })).toBeInTheDocument();
  });

  it("shows no error before the user tries to sign in", () => {
    render(<AuthLanding />);
    expect(screen.queryByText(/Failed to sign in/)).not.toBeInTheDocument();
  });

  it("starts the Google popup flow on click", async () => {
    render(<AuthLanding />);
    await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(signInWithGoogle).toHaveBeenCalledOnce();
    expect(signInAsGuest).not.toHaveBeenCalled();
  });

  it("starts the anonymous flow on click", async () => {
    render(<AuthLanding />);
    await userEvent.click(screen.getByRole("button", { name: /Enter as Guest Explorer/ }));
    expect(signInAsGuest).toHaveBeenCalledOnce();
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it("disables both buttons while a sign-in is in flight, so it cannot be double-submitted", async () => {
    let release!: () => void;
    signInWithGoogle.mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; })
    );

    render(<AuthLanding />);
    const google = screen.getByRole("button", { name: /Continue with Google/ });
    await userEvent.click(google);

    expect(screen.getByRole("button", { name: /Connecting to Google/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Enter as Guest Explorer/ })).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeEnabled()
    );
  });

  it("shows the loading label while the guest flow is pending", async () => {
    let release!: () => void;
    signInAsGuest.mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; })
    );

    render(<AuthLanding />);
    await userEvent.click(screen.getByRole("button", { name: /Enter as Guest Explorer/ }));
    expect(screen.getByRole("button", { name: /Opening Demo/ })).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Enter as Guest Explorer/ })).toBeEnabled()
    );
  });

  it("surfaces the actionable message from a failed Google sign-in", async () => {
    // These messages tell the user exactly which console setting to change.
    signInWithGoogle.mockRejectedValue(
      new Error("Domain 'example.com' is not authorized in Firebase Auth.")
    );
    render(<AuthLanding />);
    await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(await screen.findByText(/is not authorized in Firebase Auth/)).toBeInTheDocument();
  });

  it("surfaces the message from a failed guest sign-in", async () => {
    signInAsGuest.mockRejectedValue(
      new Error("Anonymous sign-in is not enabled in Firebase.")
    );
    render(<AuthLanding />);
    await userEvent.click(screen.getByRole("button", { name: /Enter as Guest Explorer/ }));
    expect(await screen.findByText(/Anonymous sign-in is not enabled/)).toBeInTheDocument();
  });

  it("falls back to a generic message when the error carries none", async () => {
    signInWithGoogle.mockRejectedValue({});
    render(<AuthLanding />);
    await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(await screen.findByText("Failed to sign in with Google.")).toBeInTheDocument();
  });

  it("re-enables the buttons after a failure so the user can retry", async () => {
    signInWithGoogle.mockRejectedValue(new Error("popup blocked"));
    render(<AuthLanding />);
    await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await screen.findByText("popup blocked");
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeEnabled();
  });

  it("clears a previous error when a new attempt starts", async () => {
    signInWithGoogle.mockRejectedValueOnce(new Error("first failure"));
    render(<AuthLanding />);

    await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await screen.findByText("first failure");

    await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await waitFor(() => expect(screen.queryByText("first failure")).not.toBeInTheDocument());
  });

  describe("popup cancellation", () => {
    // A closed popup is not a failure the user needs to see in red; it gets a
    // notice with a route out of the iframe instead.
    const CANCELLED = [
      { isCancelled: true },
      { code: "auth/popup-closed-by-user" },
      { code: "auth/cancelled-popup-request" },
    ];

    it("shows a recoverable notice, not an error, when the popup is closed", async () => {
      for (const err of CANCELLED) {
        signInWithGoogle.mockRejectedValueOnce(err);
        const { unmount } = render(<AuthLanding />);
        await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));

        expect(
          await screen.findByText(/Sign-in window was closed/),
          JSON.stringify(err)
        ).toBeInTheDocument();
        expect(screen.queryByText(/Failed to sign in/)).not.toBeInTheDocument();
        unmount();
      }
    });

    it("lets the user dismiss the notice", async () => {
      signInWithGoogle.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" });
      render(<AuthLanding />);
      await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
      await screen.findByText(/Sign-in window was closed/);

      await userEvent.click(screen.getByTitle("Dismiss"));
      expect(screen.queryByText(/Sign-in window was closed/)).not.toBeInTheDocument();
    });

    it("lets the user dismiss a hard error too", async () => {
      signInWithGoogle.mockRejectedValueOnce(new Error("popup blocked"));
      render(<AuthLanding />);
      await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
      await screen.findByText("popup blocked");

      await userEvent.click(screen.getByTitle("Dismiss"));
      expect(screen.queryByText("popup blocked")).not.toBeInTheDocument();
    });

    it("offers a standalone window only when running inside an iframe", async () => {
      signInWithGoogle.mockRejectedValue({ code: "auth/popup-closed-by-user" });

      // Top-level: no escape hatch needed.
      const { unmount } = render(<AuthLanding />);
      await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
      await screen.findByText(/Sign-in window was closed/);
      expect(
        screen.queryByRole("button", { name: /Open in Standalone Window/ })
      ).not.toBeInTheDocument();
      unmount();

      // Embedded: window.top !== window.self, so the browser may block popups.
      const originalTop = window.top;
      Object.defineProperty(window, "top", { value: {}, configurable: true });
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      try {
        render(<AuthLanding />);
        await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
        await screen.findByText(/Sign-in window was closed/);

        await userEvent.click(screen.getByRole("button", { name: /Open in Standalone Window/ }));
        expect(openSpy).toHaveBeenCalledWith(window.location.href, "_blank");
      } finally {
        openSpy.mockRestore();
        Object.defineProperty(window, "top", { value: originalTop, configurable: true });
      }
    });
  });
});
