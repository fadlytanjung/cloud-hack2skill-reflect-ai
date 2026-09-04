// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const adminAuthHeaders = vi.fn(async () => ({ Authorization: "Bearer verified-id-token" }));
vi.mock("../../lib/firebase", () => ({
  adminAuthHeaders: () => adminAuthHeaders(),
}));

const { AdminDashboardModal } = await import("../AdminDashboardModal");
import type { UserProfile } from "../../types";

const USER: UserProfile = {
  uid: "uid-1",
  email: "reflector@example.com",
  displayName: "Ada Reflector",
  photoURL: null,
};
const ADMIN: UserProfile = { ...USER, role: "admin" };
const PREVIEW_USER: UserProfile = { ...USER, uid: "preview-user-abc", role: "user" };
const PREVIEW_ADMIN: UserProfile = { ...PREVIEW_USER, role: "admin" };

const METRICS = {
  activeUsers: 1,
  totalInteractions: 14,
  geminiModelLadder: ["gemini-3.6-flash", "gemini-3.1-flash-lite"],
  primaryModel: "gemini-3.6-flash",
  systemUptimeSeconds: 4242,
  databaseStatus: "connected",
  securityRulesEnforced: true,
  rbacEngine: "active",
  threatZonesAudited: 5,
};

const AUDIT_LOGS = [
  {
    id: "a1",
    timestamp: 1_700_000_000_000,
    action: "RBAC_ACCESS_GRANTED",
    actor: "admin",
    details: "Authorized GET /api/admin/metrics",
    status: "success",
  },
  {
    id: "a2",
    timestamp: 1_699_999_000_000,
    action: "RBAC_ACCESS_DENIED",
    actor: "unauthorized_caller",
    details: "Denied access to /api/admin/set-role",
    status: "warn",
  },
];

/** Models a real Response closely enough for the content-type guard to work. */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json; charset=utf-8" }),
    json: async () => body,
  } as Response;
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** What the SPA fallback returns when no API route matches. */
function spaFallback() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    json: async () => {
      throw new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`);
    },
  } as unknown as Response;
}

/** Routes the admin endpoints, honouring the RBAC headers the modal sends. */
/**
 * @param options.callerIsAdmin whether the *token bearer's* Firestore role is
 *   admin. The real server decides from that, not from the client's local role,
 *   so a standard user's genuine token is refused.
 */
function stubFetch(
  options: { adminAllowed?: boolean; failAll?: boolean; callerIsAdmin?: boolean } = {}
) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, headers });

    if (options.failAll) throw new Error("Network down");

    // Express routes on method as well as path. Getting this wrong is how a GET
    // to a POST-only route silently returned the SPA's index.html.
    const ROUTES: Record<string, string> = {
      "/api/admin/metrics": "GET",
      "/api/admin/audit-logs": "GET",
      "/api/admin/test-rbac": "POST",
      "/api/admin/set-role": "POST",
    };
    if (ROUTES[url] && ROUTES[url] !== method) return spaFallback();

    // Only a verified ID token authorizes, and only when the uid it proves has
    // the admin role. The previously-trusted headers are ignored here exactly as
    // the real server ignores them.
    const verified = headers.Authorization === "Bearer verified-id-token";
    const authorized = verified && options.callerIsAdmin !== false;

    if (url === "/api/admin/metrics") {
      if (!authorized || options.adminAllowed === false) {
        return jsonResponse({ error: "Access denied: Admin privileges required." }, 403);
      }
      return jsonResponse(METRICS);
    }
    if (url === "/api/admin/audit-logs") {
      if (!authorized) return jsonResponse({ error: "Access denied." }, 403);
      return jsonResponse({ logs: AUDIT_LOGS, total: AUDIT_LOGS.length });
    }
    if (url === "/api/admin/test-rbac") {
      if (!authorized) return jsonResponse({ error: "Access denied." }, 403);
      return jsonResponse({
        authorized: true,
        message: "Admin verification succeeded. Caller holds elevated role.",
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderModal(overrides: Partial<React.ComponentProps<typeof AdminDashboardModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    currentUser: ADMIN,
    onUpdateUserRole: vi.fn(),
    ...overrides,
  };
  return { ...render(<AdminDashboardModal {...props} />), props };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminDashboardModal", () => {
  it("renders nothing and requests nothing while closed", () => {
    const { fetchMock } = stubFetch();
    const { container } = renderModal({ isOpen: false });
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads metrics and audit logs when opened, carrying a verified ID token", async () => {
    const { calls } = stubFetch();
    renderModal();
    await waitFor(() => {
      expect(calls.map((c) => c.url)).toEqual([
        "/api/admin/metrics",
        "/api/admin/audit-logs",
      ]);
    });
    for (const call of calls) {
      expect(call.headers.Authorization).toBe("Bearer verified-id-token");
      // No role or email headers: the server would ignore them anyway.
      expect(call.headers["x-admin-role"]).toBeUndefined();
      expect(call.headers["x-user-email"]).toBeUndefined();
    }
  });

  it("sends the same token regardless of the local role, letting the server decide", async () => {
    const { calls } = stubFetch();
    renderModal({ currentUser: USER });
    await waitFor(() => expect(calls).toHaveLength(2));
    for (const call of calls) {
      expect(call.headers.Authorization).toBe("Bearer verified-id-token");
    }
  });

  it("sends no Authorization header when signed out", async () => {
    adminAuthHeaders.mockResolvedValueOnce({} as any);
    const { calls } = stubFetch();
    renderModal();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("tells a standard user they have standard access, and why", async () => {
    stubFetch();
    renderModal({ currentUser: USER });
    expect(await screen.findByText("You have standard access")).toBeInTheDocument();
    // It names the real mechanism rather than implying a button could change it.
    expect(screen.getByText(/granted by an operator, not from this/)).toBeInTheDocument();
    expect(screen.getByText(/set-user-role\.sh/)).toBeInTheDocument();
  });

  it("shows a standard user their uid, which is what an operator needs", async () => {
    stubFetch();
    renderModal({ currentUser: USER });
    await screen.findByText("You have standard access");
    expect(screen.getByText(USER.uid)).toBeInTheDocument();
  });

  it("copies the uid to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    stubFetch();
    renderModal({ currentUser: USER });
    await userEvent.click(await screen.findByTitle("Copy your user ID"));
    expect(writeText).toHaveBeenCalledWith(USER.uid);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("does not show that panel to an admin", async () => {
    stubFetch();
    renderModal();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText("You have standard access")).not.toBeInTheDocument();
  });

  it("labels the role from server truth, with no privileged email special case", async () => {
    const { unmount } = renderModal({ currentUser: ADMIN });
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    unmount();

    // Previously this address alone produced a "Designated Master Admin" badge,
    // hardcoded in the client bundle.
    renderModal({ currentUser: { ...USER, email: "fadlysyah96@gmail.com" } });
    expect(screen.getByText("Standard access")).toBeInTheDocument();
    expect(screen.queryByText(/Designated Master Admin/)).not.toBeInTheDocument();
  });

  it("does not show that warning to an admin", async () => {
    stubFetch();
    renderModal();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText(/return 403 Forbidden until elevated/)).not.toBeInTheDocument();
  });

  it("survives a total request failure without crashing", async () => {
    stubFetch({ failAll: true });
    renderModal();
    // The dialog still renders its shell.
    expect(await screen.findByRole("button", { name: /Telemetry & Metrics/ })).toBeInTheDocument();
  });

  describe("role elevation", () => {
    it("offers no elevation control to a real account", async () => {
      // The old control set role:"admin" in local state only, so the UI announced
      // "Elevated Admin View" while every API call returned 403.
      stubFetch();
      renderModal({ currentUser: USER });
      await screen.findByText("You have standard access");
      for (const name of [/Elevate to Admin/, /Enable Admin Mode/, /Switch to User View/]) {
        expect(screen.queryByRole("button", { name }), String(name)).not.toBeInTheDocument();
      }
    });

    it("offers no de-escalation control to a real admin either", async () => {
      stubFetch();
      renderModal({ currentUser: ADMIN });
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: /Demo:/ })).not.toBeInTheDocument();
    });

    it("keeps a local demo toggle for a sandboxed preview session", async () => {
      stubFetch();
      const { props } = renderModal({ currentUser: PREVIEW_USER });
      await userEvent.click(screen.getByRole("button", { name: /Demo: admin view/ }));
      expect(props.onUpdateUserRole).toHaveBeenCalledWith("admin");
    });

    it("toggles the preview session back to the user view", async () => {
      stubFetch();
      const { props } = renderModal({ currentUser: PREVIEW_ADMIN });
      await userEvent.click(screen.getByRole("button", { name: /Demo: user view/ }));
      expect(props.onUpdateUserRole).toHaveBeenCalledWith("user");
    });

    it("marks a preview session's badge as sandboxed, not as a real role", async () => {
      const { unmount } = renderModal({ currentUser: PREVIEW_ADMIN });
      expect(screen.getByText("Demo Admin (sandboxed)")).toBeInTheDocument();
      unmount();
      renderModal({ currentUser: PREVIEW_USER });
      expect(screen.getByText("Demo User (sandboxed)")).toBeInTheDocument();
    });

    it("does not show a preview session the operator instructions", async () => {
      stubFetch();
      renderModal({ currentUser: PREVIEW_USER });
      await screen.findByText("You have standard access");
      // There is no uid for an operator to act on.
      expect(screen.queryByTitle("Copy your user ID")).not.toBeInTheDocument();
    });

    it("reloads admin data when the role changes", async () => {
      const { calls } = stubFetch();
      const { rerender } = renderModal({ currentUser: USER });
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      const before = calls.length;
      rerender(
        <AdminDashboardModal
          isOpen
          onClose={vi.fn()}
          currentUser={ADMIN}
          onUpdateUserRole={vi.fn()}
        />
      );
      await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    });
  });

  describe("tabs", () => {
    it("opens on the telemetry tab", async () => {
      stubFetch();
      renderModal();
      expect(await screen.findByText("4242s")).toBeInTheDocument();
      expect(screen.queryByText(/Real-time Security & Threat Log Stream/)).not.toBeInTheDocument();
    });

    it("shows the audit log count on the tab label", async () => {
      stubFetch();
      renderModal();
      expect(
        await screen.findByRole("button", { name: `Security Audit Logs (${AUDIT_LOGS.length})` })
      ).toBeInTheDocument();
    });

    it("switches to the RBAC suite", async () => {
      stubFetch();
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /RBAC Verification Suite/ }));
      expect(
        screen.getByRole("button", { name: /Run RBAC Security Audit/ })
      ).toBeInTheDocument();
    });

    it("switches to the audit log and lists each entry", async () => {
      stubFetch();
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /Security Audit Logs/ }));

      expect(await screen.findByText("RBAC_ACCESS_GRANTED")).toBeInTheDocument();
      expect(screen.getByText("RBAC_ACCESS_DENIED")).toBeInTheDocument();
      expect(screen.getByText("unauthorized_caller")).toBeInTheDocument();
    });

    it("says so when there are no audit logs to show", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url === "/api/admin/audit-logs"
            ? jsonResponse({ logs: [] })
            : jsonResponse(METRICS)
        )
      );
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /Security Audit Logs/ }));
      expect(
        await screen.findByText(/No audit logs available or elevated permissions required/)
      ).toBeInTheDocument();
    });

    it("refetches on demand from the audit tab", async () => {
      const { calls } = stubFetch();
      renderModal();
      await waitFor(() => expect(calls).toHaveLength(2));
      await userEvent.click(screen.getByRole("button", { name: /Security Audit Logs/ }));
      await userEvent.click(screen.getByRole("button", { name: /Refresh Logs/ }));
      await waitFor(() => expect(calls).toHaveLength(4));
    });
  });

  describe("RBAC verification suite", () => {
    it("probes with a bad token and with a good one, and reports both as passing", async () => {
      const { calls } = stubFetch();
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /RBAC Verification Suite/ }));
      await userEvent.click(screen.getByRole("button", { name: /Run RBAC Security Audit/ }));

      expect(
        await screen.findByText(/Test 1: Unauthorized Caller Blocked \[HTTP 403\]/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Test 2: Verified administrator granted \[HTTP 200, expected 200\]/)
      ).toBeInTheDocument();

      // The negative probe sends a forged token *and* the previously-trusted
      // headers, proving none of them grant anything any more.
      const probe = calls.find((c) => c.headers.Authorization === "Bearer invalid-token-123");
      expect(probe?.url).toBe("/api/admin/metrics");
      expect(probe?.headers["x-admin-role"]).toBe("admin");
    });

    it("reports a failure when an unauthorized probe is NOT blocked", async () => {
      // A server that wrongly returns 200 to an invalid token must be flagged.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === "/api/admin/metrics") return jsonResponse(METRICS, 200);
          if (url === "/api/admin/audit-logs") return jsonResponse({ logs: [] });
          return jsonResponse({ message: "ok" }, 200);
        })
      );
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /RBAC Verification Suite/ }));
      await userEvent.click(screen.getByRole("button", { name: /Run RBAC Security Audit/ }));

      const heading = await screen.findByText(
        /Test 1: Unauthorized Caller Blocked \[HTTP 200\]/
      );
      // The failing card is styled as an error rather than a pass.
      expect(heading.closest("div.p-3")).toHaveClass("border-[#f2cccc]");
    });

    it("POSTs the verified-token probe — a GET would be served the app shell", async () => {
      // This is the exact production failure: fetch() defaults to GET, the route
      // is app.post, so the SPA fallback returned index.html and the UI showed
      // "Unexpected token '<', \"<!doctype \"... is not valid JSON".
      const { calls } = stubFetch();
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /RBAC Verification Suite/ }));
      await userEvent.click(screen.getByRole("button", { name: /Run RBAC Security Audit/ }));

      await waitFor(() =>
        expect(calls.some((c) => c.url === "/api/admin/test-rbac")).toBe(true)
      );
      const probe = calls.find((c) => c.url === "/api/admin/test-rbac");
      expect(probe?.method).toBe("POST");
    });

    it("reports a non-JSON response as a routing problem, not an outage", async () => {
      stubFetch();
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /RBAC Verification Suite/ }));

      // Force the app-shell response the misrouted GET used to produce.
      vi.stubGlobal("fetch", vi.fn(async () => spaFallback()));
      await userEvent.click(screen.getByRole("button", { name: /Run RBAC Security Audit/ }));

      expect(await screen.findByText("RBAC suite could not run")).toBeInTheDocument();
      expect(screen.getByText(/did not return JSON/)).toBeInTheDocument();
      expect(screen.getByText(/served the app shell instead/)).toBeInTheDocument();
    });

    it("treats a refusal as a pass for a standard user", async () => {
      // A verified but non-admin caller *should* get 403. Calling that a failure
      // would train the operator to ignore the suite.
      stubFetch({ callerIsAdmin: false });
      renderModal({ currentUser: USER });
      await userEvent.click(screen.getByRole("button", { name: /RBAC Verification Suite/ }));
      await userEvent.click(screen.getByRole("button", { name: /Run RBAC Security Audit/ }));

      // The heading is assembled from several JSX expressions, so assert against
      // the card's text content rather than a single text node.
      const rationale = await screen.findByText(/Refusal here is the correct outcome/);
      const card = rationale.closest("div.p-3")!;
      expect(card.textContent).toContain("Test 2: Verified standard user refused");
      // JSX inserts no space around the interpolated status values.
      expect(card.textContent).toMatch(/\[HTTP\s*403,\s*expected\s*403\]/);
      // Styled as a pass, not an error.
      expect(card).toHaveClass("border-[#c8e2c5]");
    });

    it("shows no results until the suite is run", async () => {
      stubFetch();
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /RBAC Verification Suite/ }));
      expect(screen.queryByText(/Test 1: Unauthorized Caller Blocked/)).not.toBeInTheDocument();
    });

    it("reports a transport failure instead of a false pass", async () => {
      stubFetch();
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /RBAC Verification Suite/ }));

      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network down"); }));
      await userEvent.click(screen.getByRole("button", { name: /Run RBAC Security Audit/ }));

      expect(await screen.findByText("RBAC suite could not run")).toBeInTheDocument();
      expect(screen.getByText("Network down")).toBeInTheDocument();
      expect(screen.getByText(/this is not a pass/)).toBeInTheDocument();
      // No verdict cards, which would otherwise show blank HTTP codes.
      expect(screen.queryByText(/Test 1: Unauthorized Caller Blocked/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Test 2: Verified/)).not.toBeInTheDocument();
    });
  });

  describe("closing", () => {
    it("closes from the header's icon button", async () => {
      stubFetch();
      const { props } = renderModal();
      await userEvent.click(screen.getByRole("button", { name: "Close Security Hub" }));
      expect(props.onClose).toHaveBeenCalledOnce();
    });

    it("closes from the footer button", async () => {
      stubFetch();
      const { props } = renderModal();
      await userEvent.click(screen.getByRole("button", { name: "Close Dashboard" }));
      expect(props.onClose).toHaveBeenCalledOnce();
    });

    it("offers a Switch Account action that closes the hub then signs out", async () => {
      stubFetch();
      const onSignOut = vi.fn();
      const { props } = renderModal({ onSignOut });
      await userEvent.click(screen.getByRole("button", { name: /Switch Account/ }));
      expect(props.onClose).toHaveBeenCalledOnce();
      expect(onSignOut).toHaveBeenCalledOnce();
    });

    it("hides Switch Account when no handler is supplied", async () => {
      stubFetch();
      renderModal();
      expect(screen.queryByRole("button", { name: /Switch Account/ })).not.toBeInTheDocument();
    });

    it("shows the session identity and role in the footer", async () => {
      stubFetch();
      renderModal({ currentUser: USER });
      expect(screen.getByText(/Session: uid-1 \(Role: user\)/)).toBeInTheDocument();
    });
  });
});
