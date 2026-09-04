// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalEditor } from "../JournalEditor";
import type { JournalEntry } from "../../types";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "e1",
    userId: "user-1",
    title: "New Reflection",
    category: "Daily Reflection",
    mode: "thoughtful",
    turns: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

/** Builds a fetch Response whose body streams the given SSE frames. */
function sseResponse(frames: string[], status = 200) {
  const encoder = new TextEncoder();
  const queue = [...frames];
  return {
    ok: status < 400,
    status,
    json: async () => ({}),
    body: {
      getReader: () => ({
        async read() {
          const next = queue.shift();
          return next === undefined
            ? { done: true, value: undefined }
            : { done: false, value: encoder.encode(next) };
        },
      }),
    },
  } as unknown as Response;
}

function frame(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Renders the editor with fresh callback mocks. The mocks are returned
 * separately from the props so their `.mock` history stays typed even when a
 * test overrides other props.
 */
function renderEditor(overrides: Partial<React.ComponentProps<typeof JournalEditor>> = {}) {
  const mocks = {
    onUpdateEntry: vi.fn(),
    onSaveToFirestore: vi.fn().mockResolvedValue(undefined),
    onRetrySync: vi.fn(),
  };
  const props: React.ComponentProps<typeof JournalEditor> = {
    entry: entry(),
    syncStatus: "saved",
    ...mocks,
    ...overrides,
  };
  return { ...render(<JournalEditor {...props} />), props: mocks };
}

const input = () => screen.getByPlaceholderText(/Write your thought/);
const submit = () => screen.getByRole("button", { name: /Reflect with Gemini/ });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => sseResponse([frame({ text: "ok" }), "data: [DONE]\n\n"])));
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  // jsdom does not implement scrollIntoView, which the turn list calls on update.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JournalEditor — entry metadata", () => {
  it("edits the title, saving on blur", async () => {
    const { props } = renderEditor();
    const title = screen.getByPlaceholderText("Untitled Reflection...");
    // fireEvent.change, because the input is controlled by the `entry` prop the
    // parent owns; typing into it here would append to the unchanged value.
    fireEvent.change(title, { target: { value: "River Walk Clarity" } });
    expect(props.onUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ title: "River Walk Clarity" })
    );

    fireEvent.blur(title);
    expect(props.onSaveToFirestore).toHaveBeenCalled();
  });

  it("changes the category and persists immediately", async () => {
    const { props } = renderEditor();
    await userEvent.selectOptions(screen.getByRole("combobox"), "Gratitude");
    expect(props.onUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Gratitude" })
    );
  });

  it("offers all four reflection personas and switches between them", async () => {
    const { props } = renderEditor();
    for (const label of ["Thoughtful", "Analytical", "Creative", "Actionable"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("button", { name: /Analytical/ }));
    expect(props.onUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "analytical" })
    );
    // A mode change is persisted right away, not just held in local state.
    expect(props.onSaveToFirestore).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "analytical" })
    );
  });

  it("labels the location button by the pinned place, or invites a pin", () => {
    const { unmount } = renderEditor();
    expect(screen.getByRole("button", { name: /Pin Location/ })).toBeInTheDocument();
    unmount();

    renderEditor({
      entry: entry({
        location: { latitude: 1, longitude: 2, formattedAddress: "Jakarta, Indonesia" },
      }),
    });
    expect(screen.getByRole("button", { name: "Jakarta" })).toBeInTheDocument();
  });
});

describe("JournalEditor — streaming a reflection", () => {
  it("shows prompt sparks on an empty entry and submits one on click", async () => {
    const { props } = renderEditor();
    const spark = screen.getByText(/What is one challenge that consumed my energy today/);
    await userEvent.click(spark);

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.prompt).toMatch(/What is one challenge/);
    expect(props.onUpdateEntry).toHaveBeenCalled();
  });

  it("posts the prompt, history, mode and category to the streaming endpoint", async () => {
    const existing = entry({
      turns: [{ id: "t1", role: "user", content: "earlier", timestamp: 1 }],
      mode: "creative",
      category: "Brainstorming",
    });
    renderEditor({ entry: existing });

    await userEvent.type(input(), "Tell me more");
    await userEvent.click(submit());

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/gemini/reflect-stream", expect.anything()));
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      prompt: "Tell me more",
      mode: "creative",
      category: "Brainstorming",
    });
    expect(body.history).toHaveLength(1);
  });

  it("adds the user's turn optimistically and clears the input", async () => {
    const { props } = renderEditor();
    await userEvent.type(input(), "I felt scattered today");
    await userEvent.click(submit());

    const optimistic = props.onUpdateEntry.mock.calls[0][0];
    expect(optimistic.turns).toHaveLength(1);
    expect(optimistic.turns[0]).toMatchObject({ role: "user", content: "I felt scattered today" });
    await waitFor(() => expect(input()).toHaveValue(""));
  });

  it("auto-titles a still-default entry from the first prompt", async () => {
    const { props } = renderEditor({ entry: entry({ title: "New Reflection" }) });
    await userEvent.type(input(), "A quiet morning by the river");
    await userEvent.click(submit());
    expect(props.onUpdateEntry.mock.calls[0][0].title).toBe("A quiet morning by the river");
  });

  it("truncates a long auto-title with an ellipsis", async () => {
    const { props } = renderEditor({ entry: entry({ title: "" }) });
    await userEvent.type(input(), "x".repeat(60));
    await userEvent.click(submit());
    const title = props.onUpdateEntry.mock.calls[0][0].title;
    expect(title).toHaveLength(43);
    expect(title.endsWith("...")).toBe(true);
  });

  it("leaves a user-chosen title alone", async () => {
    const { props } = renderEditor({ entry: entry({ title: "My Own Title" }) });
    await userEvent.type(input(), "anything");
    await userEvent.click(submit());
    expect(props.onUpdateEntry.mock.calls[0][0].title).toBe("My Own Title");
  });

  it("accumulates streamed chunks into one model turn and persists it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          frame({ text: "A gentle ", modelUsed: "gemini-3.6-flash" }),
          frame({ text: "reflection." }),
          "data: [DONE]\n\n",
        ])
      )
    );
    const { props } = renderEditor();
    await userEvent.type(input(), "hello");
    await userEvent.click(submit());

    await waitFor(() => expect(props.onSaveToFirestore).toHaveBeenCalled());
    const saved = props.onSaveToFirestore.mock.calls[0][0];
    expect(saved.turns).toHaveLength(2);
    expect(saved.turns[1]).toMatchObject({ role: "model", content: "A gentle reflection." });
  });

  it("handles a chunk split across two reads", async () => {
    const whole = frame({ text: "split across reads" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([whole.slice(0, 12), whole.slice(12), "data: [DONE]\n\n"])
      )
    );
    const { props } = renderEditor();
    await userEvent.type(input(), "hello");
    await userEvent.click(submit());

    await waitFor(() => expect(props.onSaveToFirestore).toHaveBeenCalled());
    expect(props.onSaveToFirestore.mock.calls[0][0].turns[1].content).toBe("split across reads");
  });

  it("ignores an empty prompt and does not call the API", async () => {
    renderEditor();
    await userEvent.type(input(), "   ");
    await userEvent.click(submit());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("submits on Ctrl+Enter", async () => {
    renderEditor();
    await userEvent.type(input(), "keyboard submit");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });

  it("does not submit on a bare Enter, so the textarea keeps newlines", async () => {
    renderEditor();
    await userEvent.type(input(), "line one{Enter}line two");
    expect(fetch).not.toHaveBeenCalled();
    expect(input()).toHaveValue("line one\nline two");
  });
});

describe("JournalEditor — streaming failures", () => {
  it("surfaces the server's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Input exceeds maximum character length of 8000." }, 400))
    );
    renderEditor();
    await userEvent.type(input(), "hello");
    await userEvent.click(submit());
    expect(await screen.findByText(/Input exceeds maximum character length/)).toBeInTheDocument();
  });

  it("surfaces an error delivered inside the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([frame({ error: "All models in the ladder failed." })]))
    );
    renderEditor();
    await userEvent.type(input(), "hello");
    await userEvent.click(submit());
    expect(await screen.findByText(/All models in the ladder failed/)).toBeInTheDocument();
  });

  it("reports an empty stream rather than saving a blank turn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(["data: [DONE]\n\n"])));
    const { props } = renderEditor();
    await userEvent.type(input(), "hello");
    await userEvent.click(submit());

    expect(await screen.findByText(/No response received from Gemini AI stream/)).toBeInTheDocument();
    expect(props.onSaveToFirestore).not.toHaveBeenCalled();
  });

  it("restores the prompt into the input when the very first turn fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network down"); }));
    renderEditor({ entry: entry({ turns: [] }) });
    await userEvent.type(input(), "do not lose this");
    await userEvent.click(submit());

    // The user's words must never be silently dropped.
    await waitFor(() => expect(input()).toHaveValue("do not lose this"));
  });

  it("lets the user dismiss the error banner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network down"); }));
    renderEditor();
    await userEvent.type(input(), "hello");
    await userEvent.click(submit());

    await screen.findByText("Network down");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Network down")).not.toBeInTheDocument();
  });
});

describe("JournalEditor — synthesis", () => {
  const withTurns = entry({
    turns: [
      { id: "t1", role: "user", content: "I walked by the river.", timestamp: 1 },
      { id: "t2", role: "model", content: "What did you notice?", timestamp: 2 },
    ],
  });

  it("is disabled until the entry has at least one turn", () => {
    const { unmount } = renderEditor();
    expect(screen.getByRole("button", { name: /Synthesize Takeaways/ })).toBeDisabled();
    unmount();

    renderEditor({ entry: withTurns });
    expect(screen.getByRole("button", { name: /Synthesize Takeaways/ })).toBeEnabled();
  });

  it("applies the returned insights and persists them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          insights: {
            title: "River Walk Clarity",
            summary: "A steady morning.",
            takeaways: ["Move daily", "Notice steadiness"],
            sentiment: "Grounded",
          },
        })
      )
    );
    const { props } = renderEditor({ entry: withTurns });
    await userEvent.click(screen.getByRole("button", { name: /Synthesize Takeaways/ }));

    await waitFor(() => expect(props.onSaveToFirestore).toHaveBeenCalled());
    expect(props.onUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "River Walk Clarity",
        summary: "A steady morning.",
        sentiment: "Grounded",
        takeaways: ["Move daily", "Notice steadiness"],
      })
    );
  });

  it("keeps the existing values for any field the model omits", async () => {
    const existing = entry({ ...withTurns, title: "Kept Title", sentiment: "Calm" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ insights: {} })));
    const { props } = renderEditor({ entry: existing });
    await userEvent.click(screen.getByRole("button", { name: /Synthesize Takeaways/ }));

    await waitFor(() => expect(props.onUpdateEntry).toHaveBeenCalled());
    expect(props.onUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Kept Title", sentiment: "Calm" })
    );
  });

  it("surfaces a synthesis failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Failed to generate entry summary." }, 500))
    );
    renderEditor({ entry: withTurns });
    await userEvent.click(screen.getByRole("button", { name: /Synthesize Takeaways/ }));
    expect(await screen.findByText("Failed to generate entry summary.")).toBeInTheDocument();
  });

  it("renders the digest once a summary exists", () => {
    renderEditor({
      entry: entry({
        summary: "A steady morning by the water.",
        takeaways: ["Move daily"],
        sentiment: "Grounded",
      }),
    });
    const digest = document.getElementById("synthesized-insights-box")!;
    // The summary is rendered in typographic quotes.
    expect(within(digest).getByText(/A steady morning by the water\./)).toBeInTheDocument();
    expect(within(digest).getByText("Move daily")).toBeInTheDocument();
    expect(within(digest).getByText(/Mood: Grounded/)).toBeInTheDocument();
  });

  it("hides the digest when there is nothing synthesized yet", () => {
    renderEditor();
    expect(document.getElementById("synthesized-insights-box")).toBeNull();
  });
});

describe("JournalEditor — conversation turns", () => {
  const withTurns = entry({
    turns: [
      { id: "t1", role: "user", content: "I walked by the river.", timestamp: 1 },
      { id: "t2", role: "model", content: "**What** did you notice?", timestamp: 2 },
    ],
  });

  it("renders both speakers, with the model's reply as markdown", () => {
    renderEditor({ entry: withTurns });
    expect(screen.getByText("I walked by the river.")).toBeInTheDocument();
    expect(screen.getByText("What").tagName).toBe("STRONG");
  });

  it("hides the prompt sparks once a conversation has started", () => {
    renderEditor({ entry: withTurns });
    expect(screen.queryByText(/Reflection Sparks to Begin/)).not.toBeInTheDocument();
  });

  it("copies a turn to the clipboard, preserving its raw markdown", async () => {
    renderEditor({ entry: withTurns });
    // One copy button per turn, in turn order.
    const copyButtons = screen.getAllByTitle("Copy text");
    expect(copyButtons).toHaveLength(2);

    await userEvent.click(copyButtons[1]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("**What** did you notice?");

    await userEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("I walked by the river.");
  });
});

describe("JournalEditor — sync status", () => {
  it("shows nothing while saved", () => {
    renderEditor({ syncStatus: "saved" });
    expect(screen.queryByRole("button", { name: /Retry Save to Firestore/ })).not.toBeInTheDocument();
  });

  it("offers a retry with the specific error when a save failed", async () => {
    const { props } = renderEditor({
      syncStatus: "error",
      syncErrorMessage: "Firestore save failed: permission-denied. Local copy preserved.",
    });
    expect(screen.getByText(/permission-denied/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retry Save to Firestore/ }));
    expect(props.onRetrySync).toHaveBeenCalledOnce();
  });

  it("falls back to a reassuring default message", () => {
    renderEditor({ syncStatus: "error", syncErrorMessage: null });
    expect(screen.getByText(/A local copy has been preserved/)).toBeInTheDocument();
  });
});

describe("JournalEditor — modals", () => {
  it("opens and closes the location picker", async () => {
    renderEditor();
    expect(document.getElementById("location-picker-dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Pin Location/ }));
    expect(document.getElementById("location-picker-dialog")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.getElementById("location-picker-dialog")).toBeNull();
  });

  it("saves a picked location onto the entry", async () => {
    const { props } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: /Pin Location/ }));
    await userEvent.click(screen.getByRole("button", { name: /Pin to Journal/ }));

    expect(props.onUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ location: expect.objectContaining({ latitude: 3.139 }) })
    );
  });

  it("opens the Discord dispatch dialog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ discordConfigured: true, history: [] })));
    renderEditor({ entry: entry({ summary: "A steady morning." }) });
    await userEvent.click(screen.getByRole("button", { name: /Discord/ }));
    expect(document.getElementById("discord-dispatch-dialog")).not.toBeNull();
  });
});
