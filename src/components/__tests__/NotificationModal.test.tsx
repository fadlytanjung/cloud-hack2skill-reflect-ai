// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationModal } from "../NotificationModal";
import type { JournalEntry } from "../../types";

const ENTRY: JournalEntry = {
  id: "entry-1",
  userId: "user-1",
  title: "River Walk Clarity",
  category: "Wellbeing",
  mode: "thoughtful",
  turns: [{ id: "t1", role: "user", content: "I walked by the river.", timestamp: 1 }],
  summary: "A steady morning by the water.",
  createdAt: 1,
  updatedAt: 1,
};

/** Routes each endpoint the modal talks to, so no real network is used. */
function stubFetch(overrides: Record<string, unknown> = {}) {
  const dispatch = vi.fn();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/config/client") {
      return jsonResponse({ discordConfigured: true, ...(overrides.config as object) });
    }
    if (url === "/api/notifications/history") {
      return jsonResponse({ history: (overrides.history as unknown[]) ?? [] });
    }
    if (url === "/api/notifications/dispatch") {
      dispatch(JSON.parse(String(init?.body)));
      const spec = (overrides.dispatch as { status?: number; body?: unknown }) ?? {};
      return jsonResponse(
        spec.body ?? { success: true, record: { status: "delivered", channel: "discord" } },
        spec.status ?? 200
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, dispatch };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotificationModal", () => {
  it("renders nothing while closed and makes no requests", () => {
    const { fetchMock } = stubFetch();
    const { container } = render(
      <NotificationModal isOpen={false} onClose={vi.fn()} entry={ENTRY} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads client config and history when opened", async () => {
    const { fetchMock } = stubFetch();
    render(<NotificationModal isOpen onClose={vi.fn()} entry={ENTRY} />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/config/client");
      expect(fetchMock).toHaveBeenCalledWith("/api/notifications/history");
    });
  });

  it("stays usable when the config and history requests fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<NotificationModal isOpen onClose={vi.fn()} entry={ENTRY} />);
    // The dialog still renders; the fetch failure is deliberately non-blocking.
    expect(await screen.findByText(ENTRY.title)).toBeInTheDocument();
  });

  it("dispatches to the discord channel with the entry's title and summary", async () => {
    const { dispatch } = stubFetch();
    render(<NotificationModal isOpen onClose={vi.fn()} entry={ENTRY} />);

    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      channel: "discord",
      entryId: "entry-1",
      title: "River Walk Clarity",
      summary: "A steady morning by the water.",
    });
  });

  it("rejects a non-Discord webhook URL client-side, without any request", async () => {
    const { dispatch } = stubFetch();
    render(<NotificationModal isOpen onClose={vi.fn()} entry={ENTRY} />);

    await userEvent.type(
      screen.getByPlaceholderText(/discord\.com\/api\/webhooks/i),
      "https://evil.example.com/webhook"
    );
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/must begin with https:\/\/discord\.com\/api\/webhooks/i))
      .toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("accepts a well-formed Discord webhook URL and forwards it", async () => {
    const { dispatch } = stubFetch();
    render(<NotificationModal isOpen onClose={vi.fn()} entry={ENTRY} />);

    const url = "https://discord.com/api/webhooks/123/token-abc";
    await userEvent.type(screen.getByPlaceholderText(/discord\.com\/api\/webhooks/i), url);
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(dispatch.mock.calls[0][0].customWebhookUrl).toBe(url);
  });

  it("surfaces a server-side rejection to the user", async () => {
    stubFetch({ dispatch: { status: 400, body: { error: "Webhook URL rejected: SSRF defense." } } });
    render(<NotificationModal isOpen onClose={vi.fn()} entry={ENTRY} />);

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/Webhook URL rejected/)).toBeInTheDocument();
  });

  it("falls back to the last turn when the entry has no summary", async () => {
    const { dispatch } = stubFetch();
    render(
      <NotificationModal
        isOpen
        onClose={vi.fn()}
        entry={{ ...ENTRY, summary: undefined }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(dispatch.mock.calls[0][0].summary).toBe("I walked by the river.");
  });

  it("falls back to placeholder text when there is neither a summary nor a turn", async () => {
    const { dispatch } = stubFetch();
    render(
      <NotificationModal
        isOpen
        onClose={vi.fn()}
        entry={{ ...ENTRY, summary: undefined, turns: [] }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(dispatch.mock.calls[0][0].summary).toBe("Deep personal introspection.");
  });

  it("refreshes history after a successful dispatch", async () => {
    const { fetchMock } = stubFetch();
    render(<NotificationModal isOpen onClose={vi.fn()} entry={ENTRY} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/notifications/history"));
    const before = fetchMock.mock.calls.filter((c) => c[0] === "/api/notifications/history").length;

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => {
      const after = fetchMock.mock.calls.filter((c) => c[0] === "/api/notifications/history").length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
