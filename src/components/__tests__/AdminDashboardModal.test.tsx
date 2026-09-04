// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminDashboardModal } from "../AdminDashboardModal";
import type { UserProfile } from "../../types";

const USER: UserProfile = {
  uid: "uid-1",
  email: "reflector@example.com",
  displayName: "Ada Reflector",
  photoURL: null,
};
const ADMIN: UserProfile = { ...USER, role: "admin" };

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

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

/** Routes the admin endpoints, honouring the RBAC headers the modal sends. */
function stubFetch(options: { adminAllowed?: boolean; failAll?: boolean } = {}) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });

    if (options.failAll) throw new Error("Network down");

    const authorized =
      headers["x-admin-role"] === "admin" ||
      headers.Authorization === "Bearer admin-session-token";

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

  it("loads metrics and audit logs when opened as an admin", async () => {
    const { calls } = stubFetch();
    renderModal();
    await waitFor(() => {
      expect(calls.map((c) => c.url)).toEqual([
        "/api/admin/metrics",
        "/api/admin/audit-logs",
      ]);
    });
    // Both requests carry the elevation headers.
    for (const call of calls) {
      expect(call.headers["x-admin-role"]).toBe("admin");
      expect(call.headers.Authorization).toBe("Bearer admin-session-token");
    }
  });

  it("omits the elevation headers for a standard user, so the server denies it", async () => {
    const { calls } = stubFetch();
    renderModal({ currentUser: USER });
    await waitFor(() => expect(calls).toHaveLength(2));
    for (const call of calls) {
      expect(call.headers["x-admin-role"]).toBeUndefined();
      expect(call.headers.Authorization).toBeUndefined();
    }
  });

  it("warns a standard user that admin endpoints will return 403", async () => {
    stubFetch();
    renderModal({ currentUser: USER });
    expect(
      await screen.findByText(/Admin endpoints return 403 Forbidden until elevated/)
    ).toBeInTheDocument();
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
    it("offers elevation to a standard user and reports the target role", async () => {
      stubFetch();
      const { props } = renderModal({ currentUser: USER });
      await userEvent.click(screen.getByRole("button", { name: /Elevate to Admin/ }));
      expect(props.onUpdateUserRole).toHaveBeenCalledWith("admin");
    });

    it("offers de-escalation to an admin", async () => {
      stubFetch();
      const { props } = renderModal({ currentUser: ADMIN });
      await userEvent.click(screen.getByRole("button", { name: /Switch to User View/ }));
      expect(props.onUpdateUserRole).toHaveBeenCalledWith("user");
    });

    it("elevates from the inline warning banner too", async () => {
      stubFetch();
      const { props } = renderModal({ currentUser: USER });
      await userEvent.click(await screen.findByRole("button", { name: "Enable Admin Mode" }));
      expect(props.onUpdateUserRole).toHaveBeenCalledWith("admin");
    });

    it("reloads admin data when the role changes", async () => {
      stubFetch();
      const { rerender, calls } = { ...renderModal({ currentUser: USER }), ...stubFetch() };
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
        screen.getByText(/Test 2: Elevated Admin Privileges Granted \[HTTP 200\]/)
      ).toBeInTheDocument();

      // The negative probe deliberately sends an invalid bearer token.
      const probe = calls.find((c) => c.headers.Authorization === "Bearer invalid-token-123");
      expect(probe?.url).toBe("/api/admin/metrics");
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
      expect(screen.queryByText(/Test 2: Elevated Admin Privileges Granted/)).not.toBeInTheDocument();
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

    it("shows the session identity and role in the footer", async () => {
      stubFetch();
      renderModal({ currentUser: USER });
      expect(screen.getByText(/Session: uid-1 \(Role: user\)/)).toBeInTheDocument();
    });
  });
});
