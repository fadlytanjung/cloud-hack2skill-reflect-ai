import { useState, useEffect, useCallback } from "react";
import { UserProfile, JournalEntry } from "./types";
import {
  onAuthUserChanged,
  logoutUser,
  saveJournalEntry,
  deleteJournalEntry,
  subscribeToUserInteractions,
  syncOfflineEntries,
} from "./lib/firebase";
import { AuthLanding } from "./components/AuthLanding";
import { Navbar } from "./components/Navbar";
import { HistorySidebar } from "./components/HistorySidebar";
import { JournalEditor } from "./components/JournalEditor";
import { AdminDashboardModal } from "./components/AdminDashboardModal";
import { PanelLeftClose, PanelLeftOpen, Loader2 } from "lucide-react";
import confetti from "canvas-confetti";

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  // Distinguishes "this user has no entries" from "the first snapshot has not
  // arrived yet". Without it the auto-create effect fires before Firestore
  // responds, and the blank entry it creates then wins over the real most
  // recent one.
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [syncStatus, setSyncStatus] = useState<"saved" | "saving" | "error">("saved");
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  // Monitor Firebase Authentication state and automatically sync cached entries
  useEffect(() => {
    const unsubscribe = onAuthUserChanged(async (user) => {
      setCurrentUser(user);
      setAuthInitialized(true);
      if (user?.uid) {
        try {
          const count = await syncOfflineEntries(user.uid);
          if (count > 0) {
            console.log(`[Firestore Sync] Successfully uploaded ${count} locally cached entries into Cloud Firestore.`);
          }
        } catch (e) {
          console.warn("[Firestore Sync Notice]:", e);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to user's isolated Firestore interactions
  useEffect(() => {
    if (!currentUser?.uid) {
      setEntries([]);
      setEntriesLoaded(false);
      setActiveEntry(null);
      setSelectedEntryId(null);
      return;
    }

    setEntriesLoaded(false);

    const unsubscribe = subscribeToUserInteractions(
      currentUser.uid,
      (fetchedEntries) => {
        setEntries(fetchedEntries);
        setEntriesLoaded(true);
        // If there is no active entry, initialize with the most recent or create a new one
        setActiveEntry((prev) => {
          if (!prev && fetchedEntries.length > 0) {
            setSelectedEntryId(fetchedEntries[0].id);
            return fetchedEntries[0];
          }
          if (prev) {
            // Keep active entry synchronized with latest Firestore document
            const match = fetchedEntries.find((e) => e.id === prev.id);
            if (match) {
              return match;
            }
          }
          return prev;
        });
      },
      (error) => {
        console.error("Firestore subscription error:", error);
        // The read failed, so no entry will arrive; unblock the auto-create
        // effect rather than leaving the user on a spinner.
        setEntriesLoaded(true);
        setSyncStatus("error");
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid]);

  // Create a brand new journal reflection entry
  const handleNewEntry = useCallback(() => {
    if (!currentUser?.uid) return;

    const newId = `entry-${Date.now()}`;
    const newEntry: JournalEntry = {
      id: newId,
      userId: currentUser.uid,
      title: "New Reflection",
      category: "Daily Reflection",
      mode: "thoughtful",
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setActiveEntry(newEntry);
    setSelectedEntryId(newId);
  }, [currentUser?.uid]);

  // Once the vault has actually loaded and is genuinely empty, open a first entry
  useEffect(() => {
    if (authInitialized && currentUser && entriesLoaded && entries.length === 0 && !activeEntry) {
      handleNewEntry();
    }
  }, [authInitialized, currentUser, entriesLoaded, entries.length, activeEntry, handleNewEntry]);

  // Select an existing entry from history
  const handleSelectEntry = (entry: JournalEntry) => {
    setSelectedEntryId(entry.id);
    setActiveEntry(entry);
  };

  // Delete an entry
  const handleDeleteEntry = async (entryId: string) => {
    if (!currentUser?.uid) return;
    try {
      await deleteJournalEntry(currentUser.uid, entryId);
      if (activeEntry?.id === entryId) {
        const remaining = entries.filter((e) => e.id !== entryId);
        if (remaining.length > 0) {
          setActiveEntry(remaining[0]);
          setSelectedEntryId(remaining[0].id);
        } else {
          handleNewEntry();
        }
      }
    } catch (err) {
      console.error("Failed to delete entry:", err);
    }
  };

  // Persist entry to Firestore with guaranteed transaction verification
  const handleSaveToFirestore = async (entryToSave: JournalEntry) => {
    if (!currentUser?.uid) return;
    setSyncStatus("saving");
    setSyncErrorMessage(null);
    try {
      await saveJournalEntry(currentUser.uid, entryToSave);
      setSyncStatus("saved");

      // Celebrate if summary was just synthesized
      if (entryToSave.summary && !activeEntry?.summary) {
        confetti({
          particleCount: 40,
          spread: 50,
          origin: { y: 0.8 },
          colors: ["#f59e0b", "#fbbf24", "#d97706"],
        });
      }
    } catch (err: any) {
      console.error("Save to Firestore failed:", err);
      setSyncStatus("error");
      setSyncErrorMessage(err?.message || "Failed to persist to Cloud Firestore.");
    }
  };

  // Update in-memory entry state
  const handleUpdateEntry = (updated: JournalEntry) => {
    setActiveEntry(updated);
  };

  const handleRetrySync = () => {
    if (activeEntry) {
      handleSaveToFirestore(activeEntry);
    }
  };

  // Loading initial auth state
  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-[#fdfbf7] flex flex-col items-center justify-center text-[#2c2b29] space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-[#476340]" />
        <p className="text-xs text-[#7c786e] uppercase tracking-wider font-medium">Initializing ReflectAI & Firestore...</p>
      </div>
    );
  }

  // Not logged in -> Show Landing Page
  if (!currentUser) {
    return <AuthLanding />;
  }

  return (
    <div className="h-screen flex flex-col bg-[#fdfbf7] text-[#2c2b29] overflow-hidden select-none">
      {/* Top Navigation */}
      <Navbar
        user={currentUser}
        onSignOut={logoutUser}
        syncStatus={syncStatus}
        onRetrySync={handleRetrySync}
        onOpenAdmin={() => setIsAdminModalOpen(true)}
      />

      {/* Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Toggle Sidebar Button for compact screens */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
          className="lg:hidden absolute bottom-5 left-5 z-40 bg-[#ffffff] text-[#2c2b29] p-2.5 rounded-full shadow-lg border border-[#ded7c8] cursor-pointer hover:bg-[#f4f1ea]"
        >
          {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </button>

        {/* History Sidebar */}
        <div
          className={`${
            sidebarOpen ? "block" : "hidden"
          } lg:block absolute lg:relative z-20 h-full w-full sm:w-80 lg:w-84 xl:w-96 shadow-2xl lg:shadow-none shrink-0`}
        >
          <HistorySidebar
            entries={entries}
            selectedEntryId={selectedEntryId}
            onSelectEntry={(entry) => {
              handleSelectEntry(entry);
              if (window.innerWidth < 1024) {
                setSidebarOpen(false);
              }
            }}
            onNewEntry={() => {
              handleNewEntry();
              if (window.innerWidth < 1024) {
                setSidebarOpen(false);
              }
            }}
            onDeleteEntry={handleDeleteEntry}
          />
        </div>

        {/* Main Journal Editor */}
        <main className="flex-1 flex flex-col h-full overflow-hidden">
          {activeEntry ? (
            <JournalEditor
              entry={activeEntry}
              onUpdateEntry={handleUpdateEntry}
              onSaveToFirestore={handleSaveToFirestore}
              syncStatus={syncStatus}
              syncErrorMessage={syncErrorMessage}
              onRetrySync={handleRetrySync}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#8a857a] text-xs">
              <Loader2 className="w-5 h-5 animate-spin mr-2 text-[#476340]" />
              Loading reflection workspace...
            </div>
          )}
        </main>
      </div>

      {/* Admin Dashboard & RBAC Modal (Directive B) */}
      <AdminDashboardModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        currentUser={currentUser}
        onUpdateUserRole={(role) =>
          setCurrentUser((prev) => (prev ? { ...prev, role } : null))
        }
      />
    </div>
  );
}
