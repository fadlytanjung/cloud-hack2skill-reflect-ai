import React, { useState } from "react";
import { JournalEntry } from "../types";
import {
  Plus,
  Search,
  MessageSquare,
  Trash2,
  Tag,
  Clock,
  BookMarked,
  MapPin,
} from "lucide-react";

interface HistorySidebarProps {
  entries: JournalEntry[];
  selectedEntryId: string | null;
  onSelectEntry: (entry: JournalEntry) => void;
  onNewEntry: () => void;
  onDeleteEntry: (entryId: string) => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  entries,
  selectedEntryId,
  onSelectEntry,
  onNewEntry,
  onDeleteEntry,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const categories = [
    "All",
    "Daily Reflection",
    "Brainstorming",
    "Decision Making",
    "Gratitude",
    "Goal Setting",
  ];

  const filteredEntries = entries.filter((entry) => {
    const matchesCategory =
      selectedCategory === "All" || entry.category === selectedCategory;
    const matchesSearch =
      (entry.title && entry.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (entry.summary && entry.summary.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (entry.turns &&
        entry.turns.some((t) =>
          t.content.toLowerCase().includes(searchQuery.toLowerCase())
        ));
    return matchesCategory && matchesSearch;
  });

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <aside
      id="history-sidebar"
      className="w-full lg:w-80 xl:w-96 flex flex-col bg-[#f4f1ea] border-r border-[#e6e0d4] text-[#2c2b29] h-full overflow-hidden"
    >
      {/* Header & New Entry CTA */}
      <div className="p-4 border-b border-[#e6e0d4] space-y-3 shrink-0 bg-[#f8f5ee]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BookMarked className="w-4 h-4 text-[#476340]" />
            <h2 className="font-semibold text-sm font-serif text-[#2c2b29]">Reflection Vault</h2>
            <span className="text-xs bg-[#e8e2d5] text-[#5e594e] font-medium px-2 py-0.5 rounded-full">
              {entries.length}
            </span>
          </div>

          <button
            id="new-reflection-btn"
            onClick={onNewEntry}
            className="flex items-center gap-1.5 bg-[#476340] hover:bg-[#3c5436] text-[#fdfbf7] text-xs font-semibold px-3 py-1.5 rounded-lg transition shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Entry</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#948f85] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="search-entries-input"
            type="text"
            placeholder="Search entries or insights..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#ffffff] border border-[#ded7c8] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#2c2b29] placeholder:text-[#948f85] focus:outline-hidden focus:border-[#476340] transition shadow-2xs"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-md whitespace-nowrap transition cursor-pointer ${
                selectedCategory === cat
                  ? "bg-[#eef3ed] text-[#3c5436] font-medium border border-[#c6d7c3]"
                  : "bg-[#ece6dc] text-[#6b665c] hover:text-[#2c2b29] border border-transparent"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Entries List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredEntries.length === 0 ? (
          <div className="text-center py-12 px-4 space-y-3 text-[#8a857a]">
            <MessageSquare className="w-8 h-8 mx-auto stroke-[1.5] text-[#b8b1a3]" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-[#4a4740]">No reflections found</p>
              <p className="text-[11px] text-[#7c786e]">
                {entries.length === 0
                  ? "Click 'New Entry' above to start your first journal with Gemini."
                  : "Try adjusting your search query or category filter."}
              </p>
            </div>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isSelected = entry.id === selectedEntryId;
            const turnCount = entry.turns ? entry.turns.length : 0;
            const lastTurn = entry.turns && entry.turns.length > 0 ? entry.turns[entry.turns.length - 1] : null;

            return (
              <div
                key={entry.id}
                id={`entry-card-${entry.id}`}
                onClick={() => onSelectEntry(entry)}
                className={`group relative p-3 rounded-xl border transition-all cursor-pointer text-left ${
                  isSelected
                    ? "bg-[#ffffff] border-[#476340]/60 shadow-[0_2px_12px_rgba(44,43,41,0.06)] ring-1 ring-[#476340]/20"
                    : "bg-[#faf8f3] border-[#e6e0d4] hover:bg-[#ffffff] hover:border-[#ded7c8]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#2c2b29] line-clamp-1 group-hover:text-[#476340] transition">
                    {entry.title || "Untitled Reflection"}
                  </h3>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${entry.title || "Untitled"}"?`)) {
                        onDeleteEntry(entry.id);
                      }
                    }}
                    title="Delete Entry"
                    className="opacity-0 group-hover:opacity-100 text-[#948f85] hover:text-[#b33939] p-1 rounded transition shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Excerpt */}
                <p className="text-[11px] text-[#67635a] mt-1 line-clamp-2 leading-relaxed">
                  {entry.summary ||
                    (lastTurn ? lastTurn.content : "Empty reflection entry...")}
                </p>

                {/* Tags and Meta */}
                <div className="mt-2.5 pt-2 border-t border-[#eee9df] flex items-center justify-between text-[10px] text-[#8a857a]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="flex items-center gap-1 bg-[#f0ebe1] px-1.5 py-0.5 rounded border border-[#ded7c8] text-[#5e594f]">
                      <Tag className="w-2.5 h-2.5 text-[#5a7b51]" />
                      {entry.category || "General"}
                    </span>
                    {entry.location && (
                      <span
                        className="flex items-center gap-1 bg-[#edf4ec] text-[#3c5436] px-1.5 py-0.5 rounded border border-[#c6d7c3] font-medium truncate max-w-[85px]"
                        title={entry.location.formattedAddress}
                      >
                        <MapPin className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{entry.location.formattedAddress?.split(",")[0] || "Pinned"}</span>
                      </span>
                    )}
                    {entry.sentiment && (
                      <span className="bg-[#eef3ed] text-[#405f3a] px-1.5 py-0.5 rounded border border-[#cde0ca] font-medium">
                        {entry.sentiment}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-2.5 h-2.5" />
                      {turnCount}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {formatDate(entry.updatedAt || entry.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
