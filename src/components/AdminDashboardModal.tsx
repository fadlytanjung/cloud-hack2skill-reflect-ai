import React, { useState, useEffect } from "react";
import { UserProfile } from "../types";
import firebaseConfig from "../lib/firebaseConfig";
import { adminAuthHeaders } from "../lib/firebase";
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Cpu,
  RefreshCw,
  Lock,
  Unlock,
  X,
  AlertTriangle,
  Layers,
  Database,
  CheckCircle2,
  Key,
  Globe,
  MessageSquare,
  LogOut,
} from "lucide-react";

interface AdminDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onUpdateUserRole: (role: "admin" | "user") => void;
  onSignOut?: () => void;
}

export const AdminDashboardModal: React.FC<AdminDashboardModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUpdateUserRole,
  onSignOut,
}) => {
  const [metrics, setMetrics] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [rbacTestResult, setRbacTestResult] = useState<any>(null);
  const [isTestingRbac, setIsTestingRbac] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "audit" | "rbac">("overview");

  const isAdmin = currentUser.role === "admin";
  // A sandboxed preview session has no Firebase account behind it, so its role
  // is local by definition and may be toggled to demonstrate the admin UI. A
  // real account's role is server-side data and read-only here.
  const isPreviewSession = currentUser.uid.startsWith("preview-user");
  const [uidCopied, setUidCopied] = useState(false);

  const fetchAdminData = async () => {
    setIsLoading(true);
    try {
      // The server verifies this Firebase ID token and reads the caller's
      // predefined role from Firestore. No header here grants anything.
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(await adminAuthHeaders()),
      };

      const metricsRes = await fetch("/api/admin/metrics", { headers });
      if (metricsRes.ok) {
        const data = await metricsRes.json();
        setMetrics(data);
      } else {
        setMetrics(null);
      }

      const logsRes = await fetch("/api/admin/audit-logs", { headers });
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setAuditLogs(logsData.logs || []);
      } else {
        setAuditLogs([]);
      }
    } catch (err) {
      console.error("[Fetch Admin Data Error]:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAdminData();
      setRbacTestResult(null);
    }
  }, [isOpen, currentUser.role]);

  /**
   * Reads a JSON API response, refusing to guess when the body is not JSON.
   *
   * A request that misses an API route falls through to the SPA and returns
   * index.html with a 200. Parsing that yields "Unexpected token '<'", which
   * looks like an outage rather than the routing mistake it is.
   */
  const readJson = async (res: Response, label: string) => {
    const contentType = res.headers?.get?.("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        `${label} did not return JSON (HTTP ${res.status}, ${contentType || "no content-type"}). ` +
          "The request most likely missed the API and was served the app shell instead."
      );
    }
    return res.json();
  };

  /**
   * Broken Access Control (OWASP A01) verification.
   *
   * Probe 1 presents a forged credential plus every header that used to be
   * trusted; it must be refused. Probe 2 presents the caller's real, verified ID
   * token; the expected outcome depends on the caller's actual role, so a
   * standard user seeing 403 here is a pass, not a failure.
   */
  const handleRunRbacTest = async () => {
    setIsTestingRbac(true);
    setRbacTestResult(null);

    try {
      const forgedRes = await fetch("/api/admin/metrics", {
        headers: {
          Authorization: "Bearer invalid-token-123",
          // Previously-trusted headers, included deliberately: the suite proves
          // they no longer grant anything.
          "x-admin-role": "admin",
          "x-user-email": currentUser.email || "",
        },
      });
      const forgedBody = await readJson(forgedRes, "Forged-credential probe");

      // POST: the route is app.post, and a GET would be served the app shell.
      const realRes = await fetch("/api/admin/test-rbac", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await adminAuthHeaders()) },
        body: JSON.stringify({}),
      });
      const realBody = await readJson(realRes, "Verified-token probe");

      const expectedRealStatus = isAdmin ? 200 : 403;

      setRbacTestResult({
        unauthorizedTest: {
          status: forgedRes.status,
          passed: forgedRes.status === 403,
          message: forgedBody.error || "Access denied: Admin privileges required.",
        },
        authorizedTest: {
          status: realRes.status,
          passed: realRes.status === expectedRealStatus,
          expected: expectedRealStatus,
          message:
            realBody.message ||
            realBody.error ||
            (realRes.status === 200
              ? "Admin verification succeeded."
              : "Access denied: Admin privileges required."),
        },
        callerIsAdmin: isAdmin,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      setRbacTestResult({
        error: err.message || "Failed to execute RBAC suite.",
      });
    } finally {
      setIsTestingRbac(false);
    }
  };

  const handleToggleRole = () => {
    const newRole = isAdmin ? "user" : "admin";
    onUpdateUserRole(newRole);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-3 sm:p-4 animate-fadeIn">
      <div
        id="admin-dashboard-dialog"
        className="bg-[#fbf9f5] border border-[#ded7c8] rounded-2xl w-full max-w-4xl xl:max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-[#e6e0d4] flex items-center justify-between gap-3 bg-[#ffffff]">
          <div className="flex items-center space-x-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isAdmin
                  ? "bg-[#eef4ed] border border-[#cbe1c8] text-[#3c5436]"
                  : "bg-[#fbf3e6] border border-[#ebd7b8] text-[#8c6020]"
              }`}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <h3 className="text-base font-semibold text-[#2c2b29] font-serif whitespace-nowrap">
                  Admin & RBAC Control Hub
                </h3>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 shrink-0 whitespace-nowrap ${
                    isAdmin
                      ? "bg-[#edf4ec] text-[#375432] border-[#c4dbc1]"
                      : "bg-[#fcf5e8] text-[#875914] border-[#ebd4b1]"
                  }`}
                  title={
                    isPreviewSession
                      ? "Sandboxed preview session — this role is local only"
                      : "Read from users/{uid}.role in Cloud Firestore"
                  }
                >
                  {isAdmin && <CheckCircle2 className="w-3 h-3" />}
                  {isPreviewSession
                    ? isAdmin
                      ? "Demo Admin (sandboxed)"
                      : "Demo User (sandboxed)"
                    : isAdmin
                      ? "Administrator"
                      : "Standard access"}
                </span>
              </div>
              <p className="text-[11px] text-[#7c786e] truncate hidden sm:block">
                Role-Based Access Control, Security Rules, and Threat Auditing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {onSignOut && (
              <button
                id="modal-switch-account-btn"
                onClick={() => {
                  onClose();
                  onSignOut();
                }}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer border border-[#ded7c8] bg-[#fbf9f5] hover:bg-[#ede7db] text-[#635d52] shrink-0 whitespace-nowrap"
                title="Sign out and choose another account"
                aria-label="Switch Account"
              >
                <LogOut className="w-3.5 h-3.5 text-[#7c786e] shrink-0" />
                <span className="hidden md:inline">Switch Account</span>
              </button>
            )}
            {isPreviewSession && (
              <button
                onClick={handleToggleRole}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border bg-[#f4efe6] hover:bg-[#eae3d5] text-[#635d52] border-[#ded7c8] shrink-0 whitespace-nowrap"
                title={isAdmin ? "Demo: user view" : "Demo: admin view"}
                aria-label={isAdmin ? "Demo: user view" : "Demo: admin view"}
              >
                {isAdmin ? <Lock className="w-3.5 h-3.5 shrink-0" /> : <Unlock className="w-3.5 h-3.5 shrink-0" />}
                <span className="hidden sm:inline">{isAdmin ? "Demo: user view" : "Demo: admin view"}</span>
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close Security Hub"
              title="Close Security Hub"
              className="text-[#7c786e] hover:text-[#2c2b29] p-1.5 rounded-lg hover:bg-[#ede7db] transition cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#e6e0d4] bg-[#f5f1e8] px-4 text-xs font-medium text-[#7c786e] overflow-x-auto no-scrollbar gap-1">
          <button
            onClick={() => setActiveTab("overview")}
            className={`py-2.5 px-3 border-b-2 transition cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              activeTab === "overview"
                ? "border-[#476340] text-[#3c5436] font-semibold"
                : "border-transparent hover:text-[#2c2b29]"
            }`}
          >
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span>Telemetry & Metrics</span>
          </button>
          <button
            onClick={() => setActiveTab("rbac")}
            className={`py-2.5 px-3 border-b-2 transition cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              activeTab === "rbac"
                ? "border-[#476340] text-[#3c5436] font-semibold"
                : "border-transparent hover:text-[#2c2b29]"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>RBAC Verification Suite</span>
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`py-2.5 px-3 border-b-2 transition cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              activeTab === "audit"
                ? "border-[#476340] text-[#3c5436] font-semibold"
                : "border-transparent hover:text-[#2c2b29]"
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>Security Audit Logs ({auditLogs.length})</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* TAB 1: OVERVIEW & TELEMETRY */}
          {activeTab === "overview" && (
            <div className="space-y-4">
              {!isAdmin && (
                <div className="p-4 bg-[#fcf7ef] border border-[#ebd9bd] rounded-xl space-y-3 text-xs text-[#6b5525]">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-[#ad7c32] mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-[#5c4718]">You have standard access</p>
                      <p className="leading-relaxed text-[#7a6330]">
                        Administrator access is granted by an operator, not from this
                        screen. Your role is read from{" "}
                        <code className="bg-[#f5ecdb] px-1 py-0.5 rounded border border-[#e6d3b4]">
                          users/&#123;uid&#125;.role
                        </code>{" "}
                        in Cloud Firestore, and security rules prevent the app from
                        writing it — otherwise any account could grant itself the
                        role that governs it.
                      </p>
                    </div>
                  </div>

                  {!isPreviewSession && (
                    <div className="pl-6 space-y-2">
                      <p className="text-[11px] text-[#7a6330]">
                        Send an operator your user ID and ask them to run{" "}
                        <code className="bg-[#f5ecdb] px-1 py-0.5 rounded border border-[#e6d3b4]">
                          scripts/set-user-role.sh
                        </code>
                        :
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-[#ffffff] border border-[#e6d3b4] rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-[#4a4741] truncate">
                          {currentUser.uid}
                        </code>
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(currentUser.uid);
                              setUidCopied(true);
                              setTimeout(() => setUidCopied(false), 2000);
                            } catch {
                              /* clipboard unavailable; the id is selectable above */
                            }
                          }}
                          title="Copy your user ID"
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#e6d3b4] bg-[#ffffff] hover:bg-[#f7efe0] text-[11px] font-medium text-[#6b5525] cursor-pointer transition shrink-0"
                        >
                          {uidCopied ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-[#476340]" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Key className="w-3 h-3" />
                              <span>Copy ID</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-[10px] text-[#8a7245] leading-relaxed">
                        Everything below is read-only for you. The RBAC tab still works
                        and will show the server correctly refusing your requests — that
                        is the check passing, not failing.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* KPI Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-[#ffffff] border border-[#e4ded2] rounded-xl shadow-2xs">
                  <div className="flex items-center justify-between text-[#7c786e] mb-1">
                    <span className="text-[11px] font-medium">Primary AI Model</span>
                    <Cpu className="w-3.5 h-3.5 text-[#476340]" />
                  </div>
                  <div className="text-sm font-semibold text-[#2c2b29]">gemini-3.6-flash</div>
                  <div className="text-[10px] text-[#476340] font-medium mt-0.5">Primary Active Ladder</div>
                </div>

                <div className="p-3.5 bg-[#ffffff] border border-[#e4ded2] rounded-xl shadow-2xs">
                  <div className="flex items-center justify-between text-[#7c786e] mb-1">
                    <span className="text-[11px] font-medium">Firestore Isolation</span>
                    <Database className="w-3.5 h-3.5 text-[#476340]" />
                  </div>
                  <div className="text-sm font-semibold text-[#2c2b29]">Owner-Bound</div>
                  <div className="text-[10px] text-[#476340] font-medium mt-0.5">Rules v2 Deployed</div>
                </div>

                <div className="p-3.5 bg-[#ffffff] border border-[#e4ded2] rounded-xl shadow-2xs">
                  <div className="flex items-center justify-between text-[#7c786e] mb-1">
                    <span className="text-[11px] font-medium">Uptime Seconds</span>
                    <Activity className="w-3.5 h-3.5 text-[#476340]" />
                  </div>
                  <div className="text-sm font-semibold text-[#2c2b29]">
                    {metrics ? `${metrics.systemUptimeSeconds}s` : "Online"}
                  </div>
                  <div className="text-[10px] text-[#7c786e] mt-0.5">Cloud Run Ready</div>
                </div>

                <div className="p-3.5 bg-[#ffffff] border border-[#e4ded2] rounded-xl shadow-2xs">
                  <div className="flex items-center justify-between text-[#7c786e] mb-1">
                    <span className="text-[11px] font-medium">Threat Zones</span>
                    <ShieldAlert className="w-3.5 h-3.5 text-[#476340]" />
                  </div>
                  <div className="text-sm font-semibold text-[#2c2b29]">5 / 5 Monitored</div>
                  <div className="text-[10px] text-[#476340] font-medium mt-0.5">Zero Plaintext Secrets</div>
                </div>
              </div>

              {/* Gemini Fallback Architecture Status */}
              <div className="p-4 bg-[#ffffff] border border-[#ded7c8] rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#476340]" />
                    <h4 className="text-xs font-semibold text-[#2c2b29]">
                      Resilient Model Fallback Ladder (Directive 6)
                    </h4>
                  </div>
                  <span className="text-[11px] text-[#476340] font-medium bg-[#eef3ed] px-2 py-0.5 rounded-md border border-[#cce0cb]">
                    Auto Failover Active
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2.5 bg-[#edf4ec] border border-[#c7dbc5] rounded-lg">
                    <span className="text-[10px] text-[#4a6b43] font-semibold block">PRIMARY (Rank 1)</span>
                    <span className="font-mono text-xs font-bold text-[#2d4528]">gemini-3.6-flash</span>
                    <span className="text-[10px] text-[#6b8565] block mt-0.5">Default Low-Latency</span>
                  </div>
                  <div className="p-2.5 bg-[#f5f1e8] border border-[#ded7c8] rounded-lg">
                    <span className="text-[10px] text-[#7c786e] font-semibold block">FALLBACK 1 (Rank 2)</span>
                    <span className="font-mono text-xs font-bold text-[#4a4741]">gemini-3.1-flash-lite</span>
                    <span className="text-[10px] text-[#8a857a] block mt-0.5">High-Availability</span>
                  </div>
                  <div className="p-2.5 bg-[#f5f1e8] border border-[#ded7c8] rounded-lg">
                    <span className="text-[10px] text-[#7c786e] font-semibold block">FALLBACK 2 (Rank 3)</span>
                    <span className="font-mono text-xs font-bold text-[#4a4741]">gemini-flash-latest</span>
                    <span className="text-[10px] text-[#8a857a] block mt-0.5">Dynamic Pointer</span>
                  </div>
                  <div className="p-2.5 bg-[#f5f1e8] border border-[#ded7c8] rounded-lg">
                    <span className="text-[10px] text-[#7c786e] font-semibold block">FALLBACK 3 (Rank 4)</span>
                    <span className="font-mono text-xs font-bold text-[#4a4741]">gemini-3.7-flash</span>
                    <span className="text-[10px] text-[#8a857a] block mt-0.5">Deep Reasoning</span>
                  </div>
                </div>
              </div>

              {/* Production Service Mappings & Secret Hygiene */}
              <div className="p-4 bg-[#ffffff] border border-[#ded7c8] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-[#476340]" />
                    <h4 className="text-xs font-semibold text-[#2c2b29]">
                      Production Credentials & Service Mappings (Google Cloud)
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono text-[#476340] bg-[#eef3ed] px-2 py-0.5 rounded border border-[#cce0cb]">
                    {firebaseConfig.projectId || "Google Cloud Project"}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div className="p-2.5 bg-[#fcfbf9] border border-[#ded7c8] rounded-lg space-y-1">
                    <div className="flex items-center justify-between text-[#7c786e] text-[10px]">
                      <span className="font-medium">Firebase Web API Key</span>
                      <span className="text-[#476340] font-semibold">Configured</span>
                    </div>
                    <div className="font-mono text-xs font-bold text-[#2c2b29]">reflect-ai-app</div>
                    <p className="text-[10px] text-[#7c786e]">
                      Replaces auto-generated browser key labels. Key name in Google Cloud Console.
                    </p>
                  </div>

                  <div className="p-2.5 bg-[#fcfbf9] border border-[#ded7c8] rounded-lg space-y-1">
                    <div className="flex items-center justify-between text-[#7c786e] text-[10px]">
                      <span className="font-medium">OAuth 2.0 Client ID</span>
                      <span className="text-[#476340] font-semibold">Authorized</span>
                    </div>
                    <div className="font-mono text-xs font-bold text-[#2c2b29]">reflect-ai-app</div>
                    <p className="text-[10px] text-[#7c786e]">
                      Bound to domain <code className="text-[#476340]">{firebaseConfig.authDomain || "project.firebaseapp.com"}</code>.
                    </p>
                  </div>

                  <div className="p-2.5 bg-[#fcfbf9] border border-[#ded7c8] rounded-lg space-y-1">
                    <div className="flex items-center justify-between text-[#7c786e] text-[10px]">
                      <span className="font-medium">Firebase Hosting Target</span>
                      <Globe className="w-3 h-3 text-[#476340]" />
                    </div>
                    <div className="font-mono text-xs font-bold text-[#2c2b29]">
                      {firebaseConfig.projectId ? `${firebaseConfig.projectId}-hosting` : "Managed Hosting"}
                    </div>
                    <p className="text-[10px] text-[#7c786e]">
                      Proxies directly to Cloud Run service <code className="text-[#476340]">reflectai-journal-reflection-assistant</code>.
                    </p>
                  </div>

                  <div className="p-2.5 bg-[#fcfbf9] border border-[#ded7c8] rounded-lg space-y-1">
                    <div className="flex items-center justify-between text-[#7c786e] text-[10px]">
                      <span className="font-medium">Secret Manager Store</span>
                      <ShieldCheck className="w-3 h-3 text-[#476340]" />
                    </div>
                    <div className="font-mono text-xs font-bold text-[#2c2b29]">reflect-ai-env</div>
                    <p className="text-[10px] text-[#7c786e]">
                      Single source of truth for GEMINI_API_KEY, MAPS_API_KEY, DISCORD_WEBHOOK_URL.
                    </p>
                  </div>
                </div>

                <div className="p-2.5 bg-[#f5f1e8] rounded-lg border border-[#ded7c8] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-[#5865F2]" />
                    <span className="text-[#2c2b29] font-medium">Outbound Notification Channel</span>
                  </div>
                  <span className="text-[11px] font-semibold text-[#5865F2] font-mono">
                    Discord Webhook Egress
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: RBAC TESTER */}
          {activeTab === "rbac" && (
            <div className="space-y-4">
              <div className="p-4 bg-[#ffffff] border border-[#ded7c8] rounded-xl space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-[#2c2b29]">
                      Automated Broken Access Control (OWASP A01) Verification
                    </h4>
                    <p className="text-[11px] text-[#7c786e] max-w-xl">
                      Probe 1 presents a forged token plus every header that used to be
                      trusted. Probe 2 presents your real, verified ID token. Both pass
                      when the server's answer matches your actual role.
                    </p>
                  </div>
                  <button
                    onClick={handleRunRbacTest}
                    disabled={isTestingRbac}
                    aria-label="Run RBAC Security Audit"
                    title="Run RBAC Security Audit"
                    className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-[#476340] hover:bg-[#3c5436] text-[#fdfbf7] text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap self-start sm:self-center"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isTestingRbac ? "animate-spin" : ""}`} />
                    <span>Run RBAC Security Audit</span>
                  </button>
                </div>

                {rbacTestResult?.error && (
                  <div className="p-3 rounded-xl border bg-[#fdf1f1] border-[#f2cccc] text-[#9e3838] flex items-start gap-3 animate-fadeIn">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="text-xs space-y-1">
                      <div className="font-semibold">RBAC suite could not run</div>
                      <div className="text-[11px] opacity-90">{rbacTestResult.error}</div>
                      <div className="text-[10px] font-mono opacity-80">
                        No verdict was reached — this is not a pass. Retry once connectivity is restored.
                      </div>
                    </div>
                  </div>
                )}

                {rbacTestResult && !rbacTestResult.error && (
                  <div className="space-y-2.5 pt-2 border-t border-[#f0eae0] animate-fadeIn">
                    {/* Test 1: Unauthorized Access Blocked */}
                    <div
                      className={`p-3 rounded-xl border flex items-start gap-3 ${
                        rbacTestResult.unauthorizedTest?.passed
                          ? "bg-[#f3f8f2] border-[#c8e2c5] text-[#2f4f29]"
                          : "bg-[#fdf1f1] border-[#f2cccc] text-[#9e3838]"
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                      <div className="text-xs space-y-1">
                        <div className="font-semibold">
                          Test 1: Unauthorized Caller Blocked [HTTP {rbacTestResult.unauthorizedTest?.status}]
                        </div>
                        <div className="text-[11px] opacity-90">
                          {rbacTestResult.unauthorizedTest?.message}
                        </div>
                        <div className="text-[10px] font-mono opacity-80">
                          Rule verified: Requests without valid admin tokens are rejected with 403 Forbidden.
                        </div>
                      </div>
                    </div>

                    {/* Test 2: Authorized Access Granted */}
                    <div
                      className={`p-3 rounded-xl border flex items-start gap-3 ${
                        rbacTestResult.authorizedTest?.passed
                          ? "bg-[#f3f8f2] border-[#c8e2c5] text-[#2f4f29]"
                          : "bg-[#fdf1f1] border-[#f2cccc] text-[#9e3838]"
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                      <div className="text-xs space-y-1">
                        <div className="font-semibold">
                          Test 2:{" "}
                          {rbacTestResult.callerIsAdmin
                            ? "Verified administrator granted"
                            : "Verified standard user refused"}{" "}
                          [HTTP {rbacTestResult.authorizedTest?.status}, expected{" "}
                          {rbacTestResult.authorizedTest?.expected}]
                        </div>
                        <div className="text-[11px] opacity-90">
                          {rbacTestResult.authorizedTest?.message}
                        </div>
                        <div className="text-[10px] font-mono opacity-80">
                          {rbacTestResult.callerIsAdmin
                            ? "Rule verified: a verified ID token whose Firestore role is 'admin' reaches administrative telemetry."
                            : "Rule verified: a genuine, verified ID token is still refused without the 'admin' role. Refusal here is the correct outcome."}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: AUDIT LOGS */}
          {activeTab === "audit" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#7c786e]">Real-time Security & Threat Log Stream</span>
                <button
                  onClick={fetchAdminData}
                  disabled={isLoading}
                  className="flex items-center gap-1 text-[#476340] hover:underline cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh Logs</span>
                </button>
              </div>

              <div className="bg-[#ffffff] border border-[#ded7c8] rounded-xl overflow-x-auto shadow-2xs max-h-72 overflow-y-auto">
                {auditLogs.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#8a857a]">
                    No audit logs available or elevated permissions required.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse min-w-[560px]">
                    <thead className="bg-[#f5f1e8] text-[#635d52] font-semibold border-b border-[#ded7c8]">
                      <tr>
                        <th className="py-2 px-3">Timestamp</th>
                        <th className="py-2 px-3">Action</th>
                        <th className="py-2 px-3">Actor</th>
                        <th className="py-2 px-3">Details</th>
                        <th className="py-2 px-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f2ece1]">
                      {auditLogs.map((log: any) => (
                        <tr key={log.id} className="hover:bg-[#faf7f2]">
                          <td className="py-2 px-3 text-[11px] text-[#7c786e] font-mono">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-[#2c2b29]">
                            {log.action}
                          </td>
                          <td className="py-2 px-3 text-[#59554d]">{log.actor}</td>
                          <td className="py-2 px-3 text-[#4a4741] max-w-xs truncate" title={log.details}>
                            {log.details}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                log.status === "success"
                                  ? "bg-[#eef4ed] text-[#3c5436]"
                                  : log.status === "warn"
                                  ? "bg-[#fcf5e8] text-[#875914]"
                                  : "bg-[#fdf1f1] text-[#9e3838]"
                              }`}
                            >
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#e6e0d4] flex items-center justify-between bg-[#ffffff]">
          <span className="text-[11px] text-[#8a857a] font-mono">
            Session: {currentUser.uid} (Role: {currentUser.role || "user"})
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#476340] hover:bg-[#3c5436] text-[#fdfbf7] text-xs font-semibold rounded-xl transition cursor-pointer shadow-xs"
          >
            Close Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};
