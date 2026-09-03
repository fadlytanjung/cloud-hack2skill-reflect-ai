import React, { useState, useEffect } from "react";
import { JournalEntry } from "../types";
import firebaseConfig from "../lib/firebaseConfig";
import {
  Send,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  MessageSquare,
  Sparkles,
  ExternalLink,
  Bot,
} from "lucide-react";

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: JournalEntry;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  entry,
}) => {
  const [customWebhookUrl, setCustomWebhookUrl] = useState("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverDiscordConfigured, setServerDiscordConfigured] = useState<boolean | null>(null);

  const title = entry.title || "Personal Journal Reflection";
  const summary =
    entry.summary ||
    (entry.turns.length > 0 ? entry.turns[entry.turns.length - 1].content.slice(0, 200) : "Deep personal introspection.");

  // Fetch client config & notification history
  const fetchConfigAndHistory = async () => {
    try {
      const [configRes, historyRes] = await Promise.all([
        fetch("/api/config/client"),
        fetch("/api/notifications/history"),
      ]);

      if (configRes.ok) {
        const configData = await configRes.json();
        setServerDiscordConfigured(Boolean(configData.discordConfigured));
      }

      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setHistory(historyData.history || []);
      }
    } catch {
      // Non-blocking fallback
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchConfigAndHistory();
      setDispatchResult(null);
      setErrorMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Sanitized text preview (demonstrating OWASP LLM02 sanitization)
  const sanitizePreview = (str: string) => {
    return str
      .replace(/(?:ignore\s+all\s+previous\s+instructions|system\s*:\s*|you\s+are\s+now)/gi, "[REDACTED]")
      .replace(/<[^>]*>?/gm, "")
      .trim();
  };

  const handleDispatch = async () => {
    setIsDispatching(true);
    setErrorMessage(null);
    setDispatchResult(null);

    // Client-side validation if custom webhook URL entered
    if (customWebhookUrl.trim()) {
      const trimmed = customWebhookUrl.trim();
      if (!trimmed.startsWith("https://discord.com/api/webhooks/") && !trimmed.startsWith("https://discordapp.com/api/webhooks/")) {
        setErrorMessage("Discord Webhook URL must begin with https://discord.com/api/webhooks/");
        setIsDispatching(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/notifications/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "discord",
          entryId: entry.id,
          title,
          summary,
          customWebhookUrl: customWebhookUrl.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to dispatch notification to Discord.");
      }

      setDispatchResult(data);
      fetchConfigAndHistory();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to dispatch notification to Discord.");
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fadeIn">
      <div
        id="discord-dispatch-dialog"
        className="bg-[#fbf9f5] border border-[#ded7c8] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-[#e6e0d4] flex items-center justify-between bg-[#ffffff]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#5865F2]/10 border border-[#5865F2]/30 flex items-center justify-center text-[#5865F2]">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[#2c2b29] font-serif">
                  Dispatch Reflection to Discord
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20">
                  Discord Egress
                </span>
              </div>
              <p className="text-[11px] text-[#7c786e]">
                Relay synthesized takeaways to your Discord channel via webhook
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#7c786e] hover:text-[#2c2b29] p-1.5 rounded-lg hover:bg-[#ede7db] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Secret Manager Integration Status Banner */}
          <div className="p-3 bg-[#ffffff] border border-[#ded7c8] rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#476340] animate-pulse"></div>
              <span className="text-[#4a4741] font-medium">
                Target Environment: <span className="font-mono text-[#2c2b29]">reflect-ai-env</span> (Secret Manager)
              </span>
            </div>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                serverDiscordConfigured
                  ? "bg-[#eef4ed] text-[#3c5436] border-[#cbe1c8]"
                  : "bg-[#fbf3e6] text-[#8c6020] border-[#ebd7b8]"
              }`}
            >
              {serverDiscordConfigured ? "Webhook Active in Secret" : "Ready / Custom Override"}
            </span>
          </div>

          {/* Webhook Input Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-[#4a4741] font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#5865F2]" />
                <span>Discord Webhook URL</span>
              </label>
              <span className="text-[10px] text-[#8a857a]">
                {serverDiscordConfigured ? "Using DISCORD_WEBHOOK_URL from reflect-ai-env" : "Optional override if not in Secret Manager"}
              </span>
            </div>
            <input
              type="url"
              value={customWebhookUrl}
              onChange={(e) => setCustomWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/YOUR_CHANNEL_ID/YOUR_TOKEN"
              className="w-full bg-[#ffffff] border border-[#ded7c8] rounded-xl px-3 py-2 text-xs text-[#2c2b29] focus:outline-hidden focus:border-[#5865F2] font-mono shadow-2xs"
            />
            <p className="text-[10px] text-[#7c786e]">
              Stored securely in Google Cloud Secret Manager under key <code className="bg-[#f0ebe0] px-1 py-0.5 rounded text-[#444]">DISCORD_WEBHOOK_URL</code>.
            </p>
          </div>

          {/* Discord Message Live Preview (What Discord members will see) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#4a4741]">Discord Embed Preview</span>
              <span className="text-[10px] text-[#7c786e]">Rich Embed Card</span>
            </div>
            
            {/* Styled to resemble Discord's authentic dark UI */}
            <div className="bg-[#313338] text-[#dbdee1] p-3.5 rounded-xl border border-[#232428] font-sans text-xs shadow-md space-y-2.5">
              {/* Bot Header */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-[#476340] flex items-center justify-center text-white font-bold text-xs">
                  <Bot className="w-4 h-4 text-[#f0f7ef]" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[#f2f3f5] text-xs">ReflectAI</span>
                  <span className="bg-[#5865F2] text-white text-[9px] font-bold px-1 py-0.2 rounded">BOT</span>
                  <span className="text-[10px] text-[#949ba4]">Today at {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>

              {/* Bot Message Header */}
              <div className="text-[11px] text-[#dbdee1]">
                🌿 <strong>ReflectAI Synthesis: {sanitizePreview(title)}</strong>
              </div>

              {/* Discord Embed Container */}
              <div className="bg-[#2b2d31] border-l-4 border-[#476340] rounded-r-md p-3 space-y-2 text-xs">
                <div className="font-bold text-[#f2f3f5] text-xs">
                  {sanitizePreview(title)}
                </div>
                <div className="text-[11px] text-[#b5bac1] leading-relaxed italic">
                  "{sanitizePreview(summary)}"
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#383a40] text-[10px]">
                  <div>
                    <span className="text-[#949ba4] block uppercase font-bold text-[9px]">Entry ID</span>
                    <span className="font-mono text-[#dbdee1]">{entry.id.slice(0, 16)}...</span>
                  </div>
                  <div>
                    <span className="text-[#949ba4] block uppercase font-bold text-[9px]">Cloud Project</span>
                    <span className="font-mono text-[#dbdee1]">{firebaseConfig.projectId || "Google Cloud"}</span>
                  </div>
                </div>

                <div className="text-[9px] text-[#80848e] pt-1 flex items-center justify-between border-t border-[#383a40]/60">
                  <span>ReflectAI Journal Assistant • Powered by Gemini & Cloud Run</span>
                </div>
              </div>
            </div>
          </div>

          {/* Security & Sanitization Notice (Directive C / OWASP LLM02) */}
          <div className="p-3 bg-[#ffffff] border border-[#ded7c8] rounded-xl space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#2c2b29] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#476340]" />
                SSRF Defense & Payload Hygiene
              </span>
              <span className="text-[10px] bg-[#eef4ed] text-[#405f3a] font-medium px-2 py-0.5 rounded-full border border-[#cce0cb]">
                OWASP LLM02
              </span>
            </div>
            <p className="text-[11px] text-[#7c786e]">
              Dispatches use server-side SSRF validation against loopback addresses and private cloud IP ranges, with indirect prompt injection sanitization.
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-2.5 bg-[#fdf1f1] border border-[#f2cccc] rounded-xl flex items-center gap-2 text-xs text-[#9e3838]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Success Banner */}
          {dispatchResult && (
            <div className="p-3 bg-[#f3f8f2] border border-[#c8e2c5] rounded-xl flex items-start gap-2.5 text-xs text-[#2f4f29] animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#476340]" />
              <div className="space-y-0.5">
                <div className="font-semibold">{dispatchResult.message}</div>
                <div className="text-[11px] opacity-80">
                  Status: <span className="font-semibold">{dispatchResult.record?.status}</span> • Destination: {dispatchResult.record?.recipientOrWebhook}
                </div>
              </div>
            </div>
          )}

          {/* Outbound Dispatch History */}
          <div className="space-y-2 pt-2 border-t border-[#eee7db]">
            <span className="text-xs font-semibold text-[#635d52] flex items-center gap-1">
              <Clock className="w-3 h-3 text-[#7c786e]" />
              Recent Discord Egress History
            </span>
            <div className="space-y-1.5 max-h-28 overflow-y-auto">
              {history.length === 0 ? (
                <div className="text-[11px] text-[#8a857a] italic p-2 bg-[#ffffff] border border-[#ded7c8] rounded-lg text-center">
                  No previous Discord dispatches in this session.
                </div>
              ) : (
                history
                  .filter((item) => item.channel === "discord" || item.channel === "webhook")
                  .map((item) => (
                    <div
                      key={item.id}
                      className="p-2 bg-[#ffffff] border border-[#ded7c8] rounded-lg text-xs flex items-center justify-between"
                    >
                      <div className="space-y-0.5 max-w-[320px] truncate">
                        <span className="font-medium text-[#2c2b29] mr-2 text-[10px] font-mono bg-[#5865F2]/10 text-[#5865F2] px-1.5 py-0.5 rounded border border-[#5865F2]/20">
                          DISCORD
                        </span>
                        <span className="text-[#4a4741]">{item.title}</span>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          item.status === "delivered"
                            ? "bg-[#eef4ed] text-[#3c5436]"
                            : "bg-[#fbf5eb] text-[#875914]"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#e6e0d4] flex items-center justify-between bg-[#ffffff]">
          <span className="text-[11px] text-[#8a857a]">
            {firebaseConfig.projectId ? `Target: ${firebaseConfig.projectId}` : "Managed Cloud Target"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-[#6b665c] hover:bg-[#ede7db] transition cursor-pointer"
            >
              Close
            </button>
            <button
              id="send-discord-btn"
              onClick={handleDispatch}
              disabled={isDispatching}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#5865F2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded-xl transition cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isDispatching ? "Dispatching..." : "Send to Discord"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
