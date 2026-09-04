// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistorySidebar } from "../HistorySidebar";
import type { JournalEntry } from "../../types";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "e1",
    userId: "user-1",
    title: "River Walk",
    category: "Daily Reflection",
    mode: "thoughtful",
    turns: [{ id: "t1", role: "user", content: "I walked by the river.", timestamp: 1 }],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof HistorySidebar>> = {}) {
  const props = {
    entries: [entry()],
    selectedEntryId: null,
    onSelectEntry: vi.fn(),
    onNewEntry: vi.fn(),
    onDeleteEntry: vi.fn(),
    ...overrides,
  };
  return { ...render(<HistorySidebar {...props} />), props };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HistorySidebar", () => {
  it("shows the entry count and each entry's title", () => {
    renderSidebar({
      entries: [entry({ id: "a", title: "First" }), entry({ id: "b", title: "Second" })],
    });
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("prompts the user to start when the vault is empty", () => {
    renderSidebar({ entries: [] });
    expect(screen.getByText("No reflections found")).toBeInTheDocument();
    expect(screen.getByText(/start your first journal with Gemini/)).toBeInTheDocument();
  });

  it("distinguishes an empty vault from an empty filter result", async () => {
    renderSidebar({ entries: [entry({ title: "River Walk" })] });
    await userEvent.type(screen.getByPlaceholderText(/Search entries/), "zzzz");
    expect(screen.getByText(/adjusting your search query or category filter/)).toBeInTheDocument();
    expect(screen.queryByText(/start your first journal/)).not.toBeInTheDocument();
  });

  it("names an untitled entry rather than rendering a blank row", () => {
    renderSidebar({ entries: [entry({ title: "" })] });
    expect(screen.getByText("Untitled Reflection")).toBeInTheDocument();
  });

  it("starts a new entry on click", async () => {
    const { props } = renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: /New Entry/ }));
    expect(props.onNewEntry).toHaveBeenCalledOnce();
  });

  it("selects the clicked entry, passing the whole record back", async () => {
    const target = entry({ id: "b", title: "Second" });
    const { props } = renderSidebar({ entries: [entry({ id: "a", title: "First" }), target] });
    await userEvent.click(screen.getByText("Second"));
    expect(props.onSelectEntry).toHaveBeenCalledWith(target);
  });

  describe("search", () => {
    const entries = [
      entry({ id: "a", title: "River Walk", summary: "Steady morning" }),
      entry({
        id: "b",
        title: "Career Planning",
        summary: "Weighing options",
        turns: [{ id: "t", role: "user", content: "A promotion came up.", timestamp: 1 }],
      }),
    ];

    it("matches on title, case-insensitively", async () => {
      renderSidebar({ entries });
      await userEvent.type(screen.getByPlaceholderText(/Search entries/), "river");
      expect(screen.getByText("River Walk")).toBeInTheDocument();
      expect(screen.queryByText("Career Planning")).not.toBeInTheDocument();
    });

    it("matches on the summary", async () => {
      renderSidebar({ entries });
      await userEvent.type(screen.getByPlaceholderText(/Search entries/), "weighing");
      expect(screen.getByText("Career Planning")).toBeInTheDocument();
      expect(screen.queryByText("River Walk")).not.toBeInTheDocument();
    });

    it("matches on the text inside a conversation turn", async () => {
      renderSidebar({ entries });
      await userEvent.type(screen.getByPlaceholderText(/Search entries/), "promotion");
      expect(screen.getByText("Career Planning")).toBeInTheDocument();
      expect(screen.queryByText("River Walk")).not.toBeInTheDocument();
    });

    it("shows everything again when the query is cleared", async () => {
      renderSidebar({ entries });
      const search = screen.getByPlaceholderText(/Search entries/);
      await userEvent.type(search, "river");
      await userEvent.clear(search);
      expect(screen.getByText("River Walk")).toBeInTheDocument();
      expect(screen.getByText("Career Planning")).toBeInTheDocument();
    });
  });

  describe("category filter", () => {
    const entries = [
      entry({ id: "a", title: "Daily One", category: "Daily Reflection" }),
      entry({ id: "b", title: "Grateful One", category: "Gratitude" }),
    ];

    it("shows every entry under 'All' by default", () => {
      renderSidebar({ entries });
      expect(screen.getByText("Daily One")).toBeInTheDocument();
      expect(screen.getByText("Grateful One")).toBeInTheDocument();
    });

    it("narrows to the picked category", async () => {
      renderSidebar({ entries });
      await userEvent.click(screen.getByRole("button", { name: "Gratitude" }));
      expect(screen.getByText("Grateful One")).toBeInTheDocument();
      expect(screen.queryByText("Daily One")).not.toBeInTheDocument();
    });

    it("combines with the search query rather than replacing it", async () => {
      renderSidebar({
        entries: [
          ...entries,
          entry({ id: "c", title: "Grateful Two", category: "Gratitude" }),
        ],
      });
      await userEvent.click(screen.getByRole("button", { name: "Gratitude" }));
      await userEvent.type(screen.getByPlaceholderText(/Search entries/), "Two");
      expect(screen.getByText("Grateful Two")).toBeInTheDocument();
      expect(screen.queryByText("Grateful One")).not.toBeInTheDocument();
      expect(screen.queryByText("Daily One")).not.toBeInTheDocument();
    });
  });

  describe("delete", () => {
    it("asks for confirmation and deletes when the user confirms", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { props } = renderSidebar({ entries: [entry({ id: "a", title: "River Walk" })] });
      await userEvent.click(screen.getByTitle("Delete Entry"));
      expect(window.confirm).toHaveBeenCalledWith('Delete "River Walk"?');
      expect(props.onDeleteEntry).toHaveBeenCalledWith("a");
    });

    it("does nothing when the user cancels", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const { props } = renderSidebar();
      await userEvent.click(screen.getByTitle("Delete Entry"));
      expect(props.onDeleteEntry).not.toHaveBeenCalled();
    });

    it("does not also select the entry — the click must not bubble", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { props } = renderSidebar();
      await userEvent.click(screen.getByTitle("Delete Entry"));
      expect(props.onSelectEntry).not.toHaveBeenCalled();
    });
  });

  describe("entry card metadata", () => {
    it("shows the category, sentiment and turn count", () => {
      renderSidebar({
        entries: [
          entry({
            category: "Gratitude",
            sentiment: "Grounded",
            turns: [
              { id: "t1", role: "user", content: "a", timestamp: 1 },
              { id: "t2", role: "model", content: "b", timestamp: 2 },
            ],
          }),
        ],
      });
      const card = document.getElementById("entry-card-e1")!;
      expect(within(card).getByText("Gratitude")).toBeInTheDocument();
      expect(within(card).getByText("Grounded")).toBeInTheDocument();
      expect(within(card).getByText("2")).toBeInTheDocument();
    });

    it("shows only the first part of a pinned location, with the full address as a tooltip", () => {
      renderSidebar({
        entries: [
          entry({
            location: {
              latitude: 1,
              longitude: 2,
              formattedAddress: "Jakarta, Special Capital Region, Indonesia",
            },
          }),
        ],
      });
      expect(screen.getByText("Jakarta")).toBeInTheDocument();
      expect(
        screen.getByTitle("Jakarta, Special Capital Region, Indonesia")
      ).toBeInTheDocument();
    });

    it("labels a location with no address as 'Pinned'", () => {
      renderSidebar({
        entries: [entry({ location: { latitude: 1, longitude: 2 } })],
      });
      expect(screen.getByText("Pinned")).toBeInTheDocument();
    });

    it("falls back to the last turn, then to a placeholder, for the excerpt", () => {
      const { unmount } = renderSidebar({
        entries: [
          entry({
            summary: undefined,
            turns: [
              { id: "t1", role: "user", content: "first", timestamp: 1 },
              { id: "t2", role: "model", content: "last turn text", timestamp: 2 },
            ],
          }),
        ],
      });
      expect(screen.getByText("last turn text")).toBeInTheDocument();
      unmount();

      renderSidebar({ entries: [entry({ summary: undefined, turns: [] })] });
      expect(screen.getByText("Empty reflection entry...")).toBeInTheDocument();
    });

    it("defaults a missing category label to 'General'", () => {
      renderSidebar({ entries: [entry({ category: "" })] });
      expect(screen.getByText("General")).toBeInTheDocument();
    });

    it("falls back to createdAt when updatedAt is absent", () => {
      // Both timestamps render through the same formatter; the point is that a
      // missing updatedAt must not produce "Invalid Date".
      renderSidebar({ entries: [entry({ updatedAt: 0, createdAt: 1_700_000_000_000 })] });
      const card = document.getElementById("entry-card-e1")!;
      expect(card.textContent).not.toContain("Invalid Date");
      expect(card.textContent).not.toContain("NaN");
    });
  });
});
