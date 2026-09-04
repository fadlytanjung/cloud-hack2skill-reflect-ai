// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalEntry, UserProfile } from "./types";

/**
 * The Firebase layer is mocked at the module boundary so App's orchestration —
 * auth gating, subscription wiring, entry selection, save status — can be driven
 * deterministically. `src/lib/firebase.test.ts` covers that layer itself.
 */
type AuthCallback = (user: UserProfile | null) => void;
type EntriesCallback = (entries: JournalEntry[]) => void;
type ErrorCallback = (error: Error) => void;

let emitAuth: AuthCallback;
let emitEntries: EntriesCallback;
let emitSubscriptionError: ErrorCallback;

const unsubscribeAuth = vi.fn();
const unsubscribeEntries = vi.fn();
const logoutUser = vi.fn();
const saveJournalEntry = vi.fn();
const deleteJournalEntry = vi.fn();
const syncOfflineEntries = vi.fn();
const confetti = vi.fn();

vi.mock("./lib/firebase", () => ({
  onAuthUserChanged: (cb: AuthCallback) => {
    emitAuth = cb;
    return unsubscribeAuth;
  },
  subscribeToUserInteractions: (_uid: string, onData: EntriesCallback, onError: ErrorCallback) => {
    emitEntries = onData;
    emitSubscriptionError = onError;
    return unsubscribeEntries;
  },
  logoutUser: (...a: unknown[]) => logoutUser(...a),
  saveJournalEntry: (...a: unknown[]) => saveJournalEntry(...a),
  deleteJournalEntry: (...a: unknown[]) => deleteJournalEntry(...a),
  syncOfflineEntries: (...a: unknown[]) => syncOfflineEntries(...a),
}));

vi.mock("canvas-confetti", () => ({ default: (...a: unknown[]) => confetti(...a) }));

const App = (await import("./App")).default;

const USER: UserProfile = {
  uid: "uid-1",
  email: "reflector@example.com",
  displayName: "Ada Reflector",
  photoURL: null,
};

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "e1",
    userId: "uid-1",
    title: "River Walk",
    category: "Daily Reflection",
    mode: "thoughtful",
    turns: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Renders App and signs the given user in, settling the initial effects. */
async function signIn(user: UserProfile | null = USER, entries: JournalEntry[] = []) {
  const result = render(<App />);
  await waitFor(() => expect(emitAuth).toBeDefined());
  await userEvent.setup();
  await waitFor(async () => {
    emitAuth(user);
  });
  if (user) {
    await waitFor(() => expect(emitEntries).toBeDefined());
    emitEntries(entries);
  }
  return result;
}

beforeEach(() => {
  for (const fn of [
    unsubscribeAuth, unsubscribeEntries, logoutUser,
    saveJournalEntry, deleteJournalEntry, syncOfflineEntries, confetti,
  ]) fn.mockReset();
  saveJournalEntry.mockResolvedValue(undefined);
  deleteJournalEntry.mockResolvedValue(undefined);
  syncOfflineEntries.mockResolvedValue(0);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App — auth gating", () => {
  it("shows a loading state until Firebase reports the auth state", () => {
    render(<App />);
    expect(screen.getByText(/Initializing ReflectAI & Firestore/)).toBeInTheDocument();
  });

  it("shows the landing page when nobody is signed in", async () => {
    await signIn(null);
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    // No workspace chrome leaks through to an unauthenticated visitor.
    expect(screen.queryByText("Reflection Vault")).not.toBeInTheDocument();
  });

  it("shows the workspace once a user is signed in", async () => {
    await signIn();
    expect(await screen.findByText("Reflection Vault")).toBeInTheDocument();
    expect(screen.getByText("Ada Reflector")).toBeInTheDocument();
  });

  it("flushes any offline buffer for the signed-in user", async () => {
    syncOfflineEntries.mockResolvedValue(3);
    await signIn();
    await waitFor(() => expect(syncOfflineEntries).toHaveBeenCalledWith("uid-1"));
  });

  it("stays usable when the offline flush fails", async () => {
    syncOfflineEntries.mockRejectedValue(new Error("offline"));
    await signIn();
    expect(await screen.findByText("Reflection Vault")).toBeInTheDocument();
  });

  it("signs the user out through the navbar", async () => {
    await signIn();
    await userEvent.click(await screen.findByTitle("Sign Out"));
    expect(logoutUser).toHaveBeenCalledOnce();
  });

  it("tears down both subscriptions on unmount", async () => {
    const { unmount } = await signIn();
    unmount();
    expect(unsubscribeAuth).toHaveBeenCalled();
    expect(unsubscribeEntries).toHaveBeenCalled();
  });
});

describe("App — entries", () => {
  it("auto-creates a first entry for a user with an empty vault", async () => {
    await signIn(USER, []);
    // The editor opens on a fresh, untitled reflection rather than a blank screen.
    expect(await screen.findByDisplayValue("New Reflection")).toBeInTheDocument();
  });

  it("opens the most recent entry when the vault is not empty", async () => {
    await signIn(USER, [entry({ id: "e1", title: "Newest" }), entry({ id: "e2", title: "Older" })]);
    expect(await screen.findByDisplayValue("Newest")).toBeInTheDocument();
  });

  it("switches the editor to a clicked entry", async () => {
    await signIn(USER, [entry({ id: "e1", title: "Newest" }), entry({ id: "e2", title: "Older" })]);
    await screen.findByDisplayValue("Newest");
    await userEvent.click(screen.getByText("Older"));
    expect(await screen.findByDisplayValue("Older")).toBeInTheDocument();
  });

  it("starts a new reflection on demand", async () => {
    await signIn(USER, [entry({ title: "Existing" })]);
    await screen.findByDisplayValue("Existing");
    await userEvent.click(screen.getByRole("button", { name: /New Entry/ }));
    expect(await screen.findByDisplayValue("New Reflection")).toBeInTheDocument();
  });

  it("keeps the open entry in step with an incoming Firestore update", async () => {
    await signIn(USER, [entry({ id: "e1", title: "Before" })]);
    await screen.findByDisplayValue("Before");

    emitEntries([entry({ id: "e1", title: "After", summary: "Synced from another device" })]);
    expect(await screen.findByDisplayValue("After")).toBeInTheDocument();
  });

  describe("deletion", () => {
    beforeEach(() => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
    });

    it("deletes through the Firebase layer", async () => {
      await signIn(USER, [entry({ id: "e1", title: "Doomed" })]);
      await screen.findByDisplayValue("Doomed");
      await userEvent.click(screen.getByTitle("Delete Entry"));
      expect(deleteJournalEntry).toHaveBeenCalledWith("uid-1", "e1");
    });

    it("falls back to the next remaining entry when the open one is deleted", async () => {
      await signIn(USER, [entry({ id: "e1", title: "Open" }), entry({ id: "e2", title: "Other" })]);
      await screen.findByDisplayValue("Open");
      await userEvent.click(screen.getAllByTitle("Delete Entry")[0]);
      expect(await screen.findByDisplayValue("Other")).toBeInTheDocument();
    });

    it("opens a fresh entry when the last one is deleted", async () => {
      await signIn(USER, [entry({ id: "e1", title: "Only One" })]);
      await screen.findByDisplayValue("Only One");
      await userEvent.click(screen.getByTitle("Delete Entry"));
      expect(await screen.findByDisplayValue("New Reflection")).toBeInTheDocument();
    });

    it("keeps the workspace usable when the delete fails", async () => {
      deleteJournalEntry.mockRejectedValue(new Error("permission-denied"));
      await signIn(USER, [entry({ id: "e1", title: "Stubborn" })]);
      await screen.findByDisplayValue("Stubborn");
      await userEvent.click(screen.getByTitle("Delete Entry"));
      expect(await screen.findByDisplayValue("Stubborn")).toBeInTheDocument();
    });
  });
});

describe("App — save status", () => {
  it("reports a save failure in the navbar with a retry", async () => {
    saveJournalEntry.mockRejectedValue(
      new Error("Firestore save failed: permission-denied. Local copy preserved.")
    );
    await signIn(USER, [entry({ id: "e1", title: "Draft" })]);
    const title = await screen.findByDisplayValue("Draft");

    await userEvent.click(title);
    await userEvent.tab();

    expect(await screen.findByRole("button", { name: /Save Failed/ })).toBeInTheDocument();
    expect(screen.getByText(/permission-denied/)).toBeInTheDocument();
  });

  it("retries the failed save and recovers", async () => {
    saveJournalEntry.mockRejectedValueOnce(new Error("transient failure"));
    await signIn(USER, [entry({ id: "e1", title: "Draft" })]);
    const title = await screen.findByDisplayValue("Draft");
    await userEvent.click(title);
    await userEvent.tab();

    const retry = await screen.findByRole("button", { name: /Save Failed/ });
    saveJournalEntry.mockResolvedValue(undefined);
    await userEvent.click(retry);

    await waitFor(() => expect(screen.getByText("Firestore Isolated")).toBeInTheDocument());
  });

  it("marks the sync as failed when the Firestore subscription errors", async () => {
    await signIn(USER, [entry()]);
    emitSubscriptionError(new Error("permission-denied"));
    expect(await screen.findByRole("button", { name: /Save Failed/ })).toBeInTheDocument();
  });

  it("celebrates a newly synthesized summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          insights: {
            title: "River Walk Clarity",
            summary: "A steady morning.",
            takeaways: ["Move daily"],
            sentiment: "Grounded",
          },
        }),
      }))
    );
    const withTurns = entry({
      id: "e1",
      title: "Draft",
      summary: undefined,
      turns: [{ id: "t1", role: "user", content: "I walked by the river.", timestamp: 1 }],
    });
    await signIn(USER, [withTurns]);
    await screen.findByDisplayValue("Draft");

    await userEvent.click(screen.getByRole("button", { name: /Synthesize Takeaways/ }));

    await waitFor(() => expect(saveJournalEntry).toHaveBeenCalled());
    expect(saveJournalEntry.mock.calls[0][1]).toMatchObject({ summary: "A steady morning." });
    expect(confetti).toHaveBeenCalledOnce();
  });

  it("does not celebrate again for an entry that already had a summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ insights: { summary: "A revised summary." } }),
      }))
    );
    const alreadySummarized = entry({
      id: "e1",
      title: "Draft",
      summary: "An earlier summary.",
      turns: [{ id: "t1", role: "user", content: "I walked by the river.", timestamp: 1 }],
    });
    await signIn(USER, [alreadySummarized]);
    await screen.findByDisplayValue("Draft");

    await userEvent.click(screen.getByRole("button", { name: /Synthesize Takeaways/ }));
    await waitFor(() => expect(saveJournalEntry).toHaveBeenCalled());
    expect(confetti).not.toHaveBeenCalled();
  });
});

describe("App — admin hub", () => {
  it("opens and closes the RBAC hub", async () => {
    await signIn();
    await userEvent.click(await screen.findByRole("button", { name: "RBAC Hub" }));
    expect(document.getElementById("admin-dashboard-dialog")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Close Dashboard" }));
    expect(document.getElementById("admin-dashboard-dialog")).toBeNull();
  });

  it("elevates the session role, which the navbar then reflects", async () => {
    await signIn();
    await userEvent.click(await screen.findByRole("button", { name: "RBAC Hub" }));
    await userEvent.click(screen.getByRole("button", { name: /Elevate to Admin/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Admin Hub" })).toBeInTheDocument()
    );
  });
});

describe("App — sidebar", () => {
  it("collapses and expands the history sidebar", async () => {
    await signIn();
    await screen.findByText("Reflection Vault");

    await userEvent.click(screen.getByTitle("Collapse Sidebar"));
    expect(await screen.findByTitle("Expand Sidebar")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Expand Sidebar"));
    expect(await screen.findByTitle("Collapse Sidebar")).toBeInTheDocument();
  });
});
