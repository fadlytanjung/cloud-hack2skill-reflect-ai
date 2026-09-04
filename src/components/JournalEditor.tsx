import React, { useState, useRef, useEffect } from "react";
import { JournalEntry, ReflectionMode, InteractionTurn } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { LocationPickerModal } from "./LocationPickerModal";
import { NotificationModal } from "./NotificationModal";
import { ReflectMascot } from "./ReflectMascot";
import { motion } from "motion/react";
import {
  Sparkles,
  Send,
  Loader2,
  Check,
  Copy,
  AlertCircle,
  MapPin,
  MessageSquare,
} from "lucide-react";

interface JournalEditorProps {
  entry: JournalEntry;
  onUpdateEntry: (updated: JournalEntry) => void;
  onSaveToFirestore: (entry: JournalEntry) => Promise<void>;
  syncStatus: "saved" | "saving" | "error";
  syncErrorMessage?: string | null;
  onRetrySync: () => void;
}

const REFLECTION_MODES: {
  id: ReflectionMode;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: "thoughtful",
    label: "Thoughtful",
    icon: "🌿",
    description: "Warm, compassionate introspection and open-ended curiosity",
  },
  {
    id: "analytical",
    label: "Analytical",
    icon: "🔍",
    description: "Deconstructs assumptions, trade-offs, and logical structure",
  },
  {
    id: "creative",
    label: "Creative",
    icon: "✨",
    description: "Expansive brainstorming, fresh metaphors, and lateral ideas",
  },
  {
    id: "actionable",
    label: "Actionable",
    icon: "🎯",
    description: "Pragmatic next steps, habit design, and prioritized takeaways",
  },
];

const PROMPT_SUGGESTIONS = [
  "What is one challenge that consumed my energy today, and what did it teach me?",
  "I am contemplating a decision between two paths. Help me unpack the trade-offs.",
  "Brainstorm 3 unconventional perspectives on a creative bottleneck I am facing.",
  "What is a personal belief or assumption I might need to re-examine?",
];

export const JournalEditor: React.FC<JournalEditorProps> = ({
  entry,
  onUpdateEntry,
  onSaveToFirestore,
  syncStatus,
  syncErrorMessage,
  onRetrySync,
}) => {
  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingModelUsed, setStreamingModelUsed] = useState("gemini-3.6-flash");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const turnsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entry.turns, streamingText]);

  const handleCopy = (turnId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTurnId(turnId);
    setTimeout(() => setCopiedTurnId(null), 2000);
  };

  // Submit a new reflection turn to Gemini with real-time SSE streaming and Firestore persistence
  const handleSubmitReflection = async (customPrompt?: string) => {
    const promptToSend = (customPrompt || inputText).trim();
    if (!promptToSend || isSubmitting || isStreaming) return;

    setErrorMessage(null);
    setIsSubmitting(true);
    setIsStreaming(true);
    setStreamingText("");
    setStreamingModelUsed("gemini-3.6-flash");

    const userTurn: InteractionTurn = {
      id: `turn-user-${Date.now()}`,
      role: "user",
      content: promptToSend,
      timestamp: Date.now(),
    };

    // Construct optimistic update
    const updatedTurns = [...(entry.turns || []), userTurn];
    const optimisticEntry: JournalEntry = {
      ...entry,
      turns: updatedTurns,
      updatedAt: Date.now(),
      // Auto-title if still default
      title:
        entry.title === "New Reflection" || !entry.title
          ? promptToSend.slice(0, 40) + (promptToSend.length > 40 ? "..." : "")
          : entry.title,
    };

    onUpdateEntry(optimisticEntry);
    setInputText("");

    let accumulatedText = "";

    try {
      // Call secure server-side Gemini streaming endpoint with resilient fallback ladder
      const response = await fetch("/api/gemini/reflect-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptToSend,
          history: entry.turns || [],
          mode: entry.mode,
          category: entry.category,
        }),
      });

      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Gemini streaming connection failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const rawData = trimmed.slice(6).trim();
            if (rawData === "[DONE]") {
              break;
            }
            let parsed: any = null;
            try {
              parsed = JSON.parse(rawData);
            } catch (e: any) {
              // A partial frame is normal mid-stream; anything else is worth a note.
              if (e.message && !e.message.includes("Unexpected end of JSON")) {
                console.warn("Parse warning:", e);
              }
            }

            if (parsed) {
              // Must be raised outside the parse catch, or the server's actual
              // failure reason is swallowed as a parse warning.
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                accumulatedText += parsed.text;
                setStreamingText(accumulatedText);
              }
              if (parsed.modelUsed) {
                setStreamingModelUsed(parsed.modelUsed);
              }
            }
          }
        }
      }

      if (!accumulatedText.trim()) {
        throw new Error("No response received from Gemini AI stream.");
      }

      const modelTurn: InteractionTurn = {
        id: `turn-model-${Date.now()}`,
        role: "model",
        content: accumulatedText,
        timestamp: Date.now(),
      };

      const finalEntry: JournalEntry = {
        ...optimisticEntry,
        turns: [...updatedTurns, modelTurn],
        updatedAt: Date.now(),
      };

      onUpdateEntry(finalEntry);
      setIsStreaming(false);
      setStreamingText("");

      // Guaranteed Transaction Verification (Persist both user & Gemini turn to Firestore)
      await onSaveToFirestore(finalEntry);
    } catch (err: any) {
      console.error("Streaming reflection error:", err);
      setErrorMessage(
        err?.message || "Failed to receive streamed response from Gemini. Please retry."
      );
      setIsStreaming(false);
      setStreamingText("");
      // Retain prompt in input if it failed before optimistic save
      if (entry.turns.length === 0) {
        setInputText(promptToSend);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Generate automated summary, title, and key takeaways
  const handleGenerateSummary = async () => {
    if (entry.turns.length === 0 || isSummarizing) return;

    setIsSummarizing(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/gemini/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turns: entry.turns,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to synthesize summary.");
      }

      const data = await response.json();
      const insights = data.insights;

      const updatedEntry: JournalEntry = {
        ...entry,
        title: insights.title || entry.title,
        summary: insights.summary || entry.summary,
        takeaways: Array.isArray(insights.takeaways) ? insights.takeaways : entry.takeaways,
        sentiment: insights.sentiment || entry.sentiment,
        updatedAt: Date.now(),
      };

      onUpdateEntry(updatedEntry);
      await onSaveToFirestore(updatedEntry);
    } catch (err: any) {
      console.error("Summarization error:", err);
      setErrorMessage(err?.message || "Could not generate summary.");
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmitReflection();
    }
  };

  return (
    <div id="journal-editor" className="flex-1 flex flex-col h-full bg-[#fdfbf7] text-[#2c2b29] overflow-hidden">
      {/* Top Configuration & Title Bar */}
      <div className="p-4 border-b border-[#e6e0d4] bg-[#fbf9f5] shrink-0 space-y-3 shadow-[0_1px_2px_rgba(44,43,41,0.02)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Title Editor */}
          <div className="flex-1">
            <input
              id="entry-title-input"
              type="text"
              value={entry.title}
              onChange={(e) => {
                const updated = { ...entry, title: e.target.value };
                onUpdateEntry(updated);
              }}
              onBlur={() => onSaveToFirestore(entry)}
              placeholder="Untitled Reflection..."
              className="w-full bg-transparent font-serif text-xl sm:text-2xl font-semibold text-[#2c2b29] placeholder:text-[#9e998f] focus:outline-hidden"
            />
          </div>

          {/* Action Bar: Summarize & Category Selector */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Category Dropdown */}
            <select
              id="category-selector"
              value={entry.category}
              onChange={(e) => {
                const updated = { ...entry, category: e.target.value };
                onUpdateEntry(updated);
                onSaveToFirestore(updated);
              }}
              className="bg-[#ffffff] border border-[#ded7c8] text-[#3d3a33] text-xs rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-[#476340] cursor-pointer shadow-2xs"
            >
              <option value="Daily Reflection">Daily Reflection</option>
              <option value="Brainstorming">Brainstorming</option>
              <option value="Decision Making">Decision Making</option>
              <option value="Gratitude">Gratitude</option>
              <option value="Goal Setting">Goal Setting</option>
            </select>

            {/* Pin Location Button / Active Location Badge */}
            <button
              id="pin-location-btn"
              onClick={() => setIsLocationModalOpen(true)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition cursor-pointer shadow-2xs ${
                entry.location
                  ? "bg-[#eef4ed] border-[#c6d7c3] text-[#3c5436] font-medium"
                  : "bg-[#ffffff] border-[#ded7c8] text-[#6b665c] hover:bg-[#f5f0e6]"
              }`}
              title={entry.location ? `Pinned: ${entry.location.formattedAddress || "Coordinates"}` : "Attach Google Maps location to this entry"}
            >
              <MapPin className="w-3.5 h-3.5 text-[#476340]" />
              <span className="max-w-[130px] truncate">
                {entry.location ? entry.location.formattedAddress?.split(",")[0] || "Pinned Spot" : "Pin Location"}
              </span>
            </button>

            {/* External Discord Dispatch Button */}
            <button
              id="dispatch-discord-btn"
              onClick={() => setIsNotificationModalOpen(true)}
              className="flex items-center gap-1.5 bg-[#ffffff] hover:bg-[#f5f0e6] text-[#6b665c] text-xs px-2.5 py-1.5 rounded-lg border border-[#ded7c8] transition cursor-pointer shadow-2xs"
              title="Dispatch reflection summary and takeaways to Discord"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#5865F2]" />
              <span className="hidden sm:inline font-medium">Discord</span>
            </button>

            {/* Synthesize / Summarize Button */}
            <button
              id="generate-summary-btn"
              onClick={handleGenerateSummary}
              disabled={isSummarizing || entry.turns.length === 0}
              className="flex items-center gap-1.5 bg-[#eef3ed] hover:bg-[#e2ebe0] text-[#3c5436] text-xs font-medium px-3 py-1.5 rounded-lg border border-[#c6d7c3] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
              title="Auto-generate reflection summary, takeaways, and sentiment"
            >
              {isSummarizing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#476340]" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-[#597852]" />
                  <span>Synthesize Takeaways</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Reflection Mode Persona Selector */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar text-xs">
          <span className="text-[11px] text-[#7c786e] uppercase tracking-wider font-semibold mr-1 shrink-0">
            Gemini Persona:
          </span>
          {REFLECTION_MODES.map((mode) => {
            const isSelected = entry.mode === mode.id;
            return (
              <button
                key={mode.id}
                onClick={() => {
                  const updated = { ...entry, mode: mode.id };
                  onUpdateEntry(updated);
                  onSaveToFirestore(updated);
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs transition cursor-pointer shrink-0 border ${
                  isSelected
                    ? "bg-[#eef3ed] text-[#3c5436] border-[#476340]/60 font-semibold shadow-2xs"
                    : "bg-[#f3eee5] text-[#6b665c] border-[#ded7c8] hover:bg-[#eae4d8] hover:text-[#2c2b29]"
                }`}
                title={mode.description}
              >
                <span>{mode.icon}</span>
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error / Sync Alert Banner */}
      {errorMessage && (
        <div className="bg-[#fdf1f1] border-b border-[#f2cccc] px-4 py-2.5 flex items-center justify-between text-xs text-[#9e3838] shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#c24444] shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-[#9e3838] hover:text-[#5e1e1e] text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {syncStatus === "error" && (
        <div className="bg-[#fdf1f1] border-b border-[#f2cccc] px-4 py-2.5 flex items-center justify-between text-xs text-[#9e3838] shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#c24444] shrink-0" />
            <span>{syncErrorMessage || "Changes have not persisted to Cloud Firestore. A local copy has been preserved."}</span>
          </div>
          <button
            onClick={onRetrySync}
            className="font-semibold underline hover:text-[#5e1e1e] cursor-pointer px-2.5 py-1 rounded bg-[#fae3e3] hover:bg-[#f5d3d3] transition"
          >
            Retry Save to Firestore
          </button>
        </div>
      )}

      {/* Main Conversation & Turn Stream */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {/* Synthesized Insights Box (if generated) */}
        {(entry.summary || (entry.takeaways && entry.takeaways.length > 0)) && (
          <div
            id="synthesized-insights-box"
            className="bg-[#ffffff] border border-[#c6d7c3] rounded-2xl p-5 space-y-3 relative overflow-hidden shadow-[0_4px_20px_rgba(44,43,41,0.05)]"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#476340] text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-[#597852]" />
                <span>Synthesized Reflection Digest</span>
              </div>
              {entry.sentiment && (
                <span className="text-xs bg-[#eef3ed] text-[#405f3a] px-2.5 py-0.5 rounded-full border border-[#cde0ca] font-medium">
                  Mood: {entry.sentiment}
                </span>
              )}
            </div>

            {entry.summary && (
              <p className="text-sm text-[#3d3a34] leading-relaxed font-serif italic">
                "{entry.summary}"
              </p>
            )}

            {entry.takeaways && entry.takeaways.length > 0 && (
              <div className="pt-2 border-t border-[#eee9df] space-y-1.5">
                <span className="text-xs text-[#7c786e] font-medium">Core Takeaways:</span>
                <ul className="space-y-1">
                  {entry.takeaways.map((takeaway, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-[#4a4741]">
                      <span className="text-[#476340] font-bold mt-0.5">•</span>
                      <span>{takeaway}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Empty State / Welcome to this Reflection */}
        {entry.turns.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="py-10 max-w-xl mx-auto text-center space-y-6"
          >
            <div className="flex justify-center">
              <ReflectMascot size="lg" />
            </div>

            <div className="space-y-2">
              <h3 className="font-serif text-xl text-[#2c2b29]">What reflection is on your mind?</h3>
              <p className="text-xs text-[#67635a] leading-relaxed">
                Write freely. ReflectAI listens with empathy and gentle clarity, asking thoughtful questions to help you unpack and organize your thoughts.
              </p>
            </div>

            {/* Suggestion Chips */}
            <div className="space-y-2 text-left pt-2">
              <div className="text-[11px] uppercase tracking-wider text-[#8a857a] font-medium text-center">
                Reflection Sparks to Begin
              </div>
              <div className="grid grid-cols-1 gap-2">
                {PROMPT_SUGGESTIONS.map((prompt, idx) => (
                  <motion.button
                    key={idx}
                    whileHover={{ y: -1, scale: 1.005 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => handleSubmitReflection(prompt)}
                    className="p-3 bg-[#ffffff] hover:bg-[#f8f5ee] border border-[#ded7c8] hover:border-[#476340]/40 rounded-xl text-xs text-[#3d3a34] text-left transition flex items-center justify-between group cursor-pointer shadow-2xs"
                  >
                    <span>{prompt}</span>
                    <Sparkles className="w-3.5 h-3.5 text-[#948f85] group-hover:text-[#476340] transition shrink-0 ml-2" />
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Multi-turn Interaction Stream */}
        {entry.turns.map((turn) => {
          const isUser = turn.role === "user";
          return (
            <div
              key={turn.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1.5`}
            >
              {/* Speaker Label */}
              <div className="flex items-center gap-1.5 text-[11px] text-[#8a857a] px-1">
                {isUser ? (
                  <span className="font-medium text-[#5e594e]">You</span>
                ) : (
                  <span className="flex items-center gap-1 text-[#476340] font-medium">
                    <Sparkles className="w-3 h-3 text-[#597852]" />
                    Gemini 3.6 Flash ({entry.mode})
                  </span>
                )}
                <span>&bull;</span>
                <span>
                  {new Date(turn.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-2xl rounded-2xl p-4 text-sm leading-relaxed relative group ${
                  isUser
                    ? "bg-[#476340] text-[#fdfbf7] border border-[#3c5436] rounded-tr-xs shadow-xs"
                    : "bg-[#ffffff] text-[#2c2b29] border border-[#e6e0d4] rounded-tl-xs shadow-[0_2px_8px_rgba(44,43,41,0.03)]"
                }`}
              >
                {isUser ? (
                  <div className="whitespace-pre-wrap font-sans text-[#fdfbf7]">
                    {turn.content}
                  </div>
                ) : (
                  <MarkdownRenderer content={turn.content} />
                )}

                {/* Quick Copy Button */}
                <button
                  onClick={() => handleCopy(turn.id, turn.content)}
                  title="Copy text"
                  className={`absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition cursor-pointer ${
                    isUser
                      ? "bg-[#3c5436] text-[#e8f0e6] hover:text-[#ffffff]"
                      : "bg-[#f4f1ea] text-[#67635a] hover:text-[#2c2b29]"
                  }`}
                >
                  {copiedTurnId === turn.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          );
        })}

        {/* Real-time Streaming Response Animation */}
        {isStreaming && (
          <div className="flex flex-col items-start space-y-1.5 animate-fadeIn">
            {/* Live Streaming Badge */}
            <div className="flex items-center gap-2 text-[11px] text-[#476340] font-medium px-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#476340] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#476340]"></span>
              </span>
              <span className="flex items-center gap-1 font-semibold text-[#3c5436]">
                <Sparkles className="w-3.5 h-3.5 text-[#476340] animate-spin" />
                Gemini ({streamingModelUsed}) streaming live...
              </span>
            </div>

            {/* Streaming Message Bubble with Professional Chatbot AI Cursor Animation */}
            <div className="max-w-2xl w-full rounded-2xl p-4 text-sm leading-relaxed bg-[#ffffff] border border-[#c6d7c3] rounded-tl-xs shadow-[0_4px_16px_rgba(71,99,64,0.08)] ring-1 ring-[#476340]/20 relative">
              {streamingText ? (
                <MarkdownRenderer content={streamingText} isStreaming={true} />
              ) : (
                <div className="flex items-center space-x-2 py-1 text-[#67635a] text-xs">
                  <span className="w-2 h-2 rounded-full bg-[#476340] animate-bounce"></span>
                  <span className="w-2 h-2 rounded-full bg-[#476340] animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-2 h-2 rounded-full bg-[#476340] animate-bounce [animation-delay:0.4s]"></span>
                  <span className="text-xs text-[#7c786e] ml-1">Connecting to Gemini streaming ladder...</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={turnsEndRef} />
      </div>

      {/* Bottom Reflection Input Workspace */}
      <div className="p-4 border-t border-[#e6e0d4] bg-[#fbf9f5] shrink-0">
        <div className="max-w-4xl mx-auto space-y-2">
          <div className="relative bg-[#ffffff] border border-[#ded7c8] rounded-2xl p-3 focus-within:border-[#476340] focus-within:ring-1 focus-within:ring-[#476340]/30 shadow-xs transition">
            <textarea
              id="reflection-input"
              rows={3}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
              placeholder={`Write your thought, journal entry, or follow-up reflection... (Press ${
                typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl"
              } + Enter to send)`}
              className="w-full bg-transparent text-sm text-[#2c2b29] placeholder:text-[#948f85] resize-none focus:outline-hidden leading-relaxed"
            />

            <div className="flex items-center justify-between pt-2 border-t border-[#f2ede4] text-xs">
              <div className="flex items-center gap-2 text-[11px] text-[#8a857a]">
                <span>{inputText.length} / 8000 characters</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="submit-reflection-btn"
                  onClick={() => handleSubmitReflection()}
                  disabled={isSubmitting || !inputText.trim()}
                  className="flex items-center gap-1.5 bg-[#476340] hover:bg-[#3c5436] text-[#fdfbf7] font-semibold px-4 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-xs shadow-xs"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{isStreaming ? "Streaming..." : "Reflecting..."}</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Reflect with Gemini</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Location Picker Dialog (Directive A) */}
      <LocationPickerModal
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
        currentLocation={entry.location}
        onSaveLocation={(loc) => {
          const updated = { ...entry, location: loc };
          onUpdateEntry(updated);
          onSaveToFirestore(updated);
        }}
      />

      {/* External Notification Dialog (Directive C) */}
      <NotificationModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
        entry={entry}
      />
    </div>
  );
};
