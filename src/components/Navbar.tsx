import React from "react";
import { UserProfile } from "../types";
import { Sparkles, LogOut, ShieldCheck, Shield } from "lucide-react";
import { ReflectMascot } from "./ReflectMascot";

interface NavbarProps {
  user: UserProfile;
  onSignOut: () => void;
  syncStatus: "saved" | "saving" | "error";
  onRetrySync?: () => void;
  onOpenAdmin?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onSignOut,
  syncStatus,
  onRetrySync,
  onOpenAdmin,
}) => {
  return (
    <header id="app-navbar" className="w-full bg-[#fbf9f5] border-b border-[#e6e0d4] text-[#2c2b29] sticky top-0 z-30 shadow-[0_1px_3px_rgba(44,43,41,0.03)]">
      <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <ReflectMascot size="sm" />
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold tracking-tight text-lg text-[#2c2b29] font-serif">ReflectAI</span>
              <span className="text-xs bg-[#eef4ed] text-[#405f3a] font-medium px-2 py-0.5 rounded-md flex items-center gap-1 border border-[#cde0ca]">
                <Sparkles className="w-3 h-3 text-[#597852]" />
                Gemini 3.6
              </span>
            </div>
            <p className="text-xs text-[#7c786e] hidden sm:block">Mindful Personal Journal & Thought Companion</p>
          </div>
        </div>

        {/* Status and User controls */}
        <div className="flex items-center space-x-4">
          {/* Firestore sync status */}
          <div className="hidden md:flex items-center text-xs">
            {user.uid.startsWith("preview-user") ? (
              <span
                className="flex items-center gap-1.5 text-[#375432] bg-[#edf4ec] border border-[#c7dcc5] px-2.5 py-1 rounded-full"
                title="All features including Gemini reflections, sentiment analysis, and synthesis are fully active."
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#52804b]"></span>
                <ShieldCheck className="w-3.5 h-3.5" />
                Sandboxed Session
              </span>
            ) : syncStatus === "saved" ? (
              <span className="flex items-center gap-1.5 text-[#375432] bg-[#edf4ec] border border-[#c7dcc5] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#52804b] animate-pulse"></span>
                <ShieldCheck className="w-3.5 h-3.5" />
                Firestore Isolated
              </span>
            ) : syncStatus === "saving" ? (
              <span className="flex items-center gap-1.5 text-[#7c5620] bg-[#fbf5eb] border border-[#ebdabe] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ad7c32] animate-ping"></span>
                Syncing securely...
              </span>
            ) : (
              <button
                onClick={onRetrySync}
                className="flex items-center gap-1.5 text-[#9e3838] bg-[#fdf1f1] border border-[#f2cccc] px-2.5 py-1 rounded-full hover:bg-[#fae6e6] transition cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#c24444]"></span>
                Save Failed (Click to retry)
              </button>
            )}
          </div>

          {/* Admin & RBAC Hub Button */}
          {onOpenAdmin && (
            <button
              id="admin-hub-nav-btn"
              onClick={onOpenAdmin}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border ${
                user.role === "admin"
                  ? "bg-[#edf4ec] hover:bg-[#e4ede3] text-[#375432] border-[#c4dbc1]"
                  : "bg-[#f5f1e8] hover:bg-[#eae4d8] text-[#635d52] border-[#ded7c8]"
              }`}
              title="Open Admin & RBAC Security Hub"
            >
              <Shield className="w-3.5 h-3.5 text-[#476340]" />
              <span>{user.role === "admin" ? "Admin Hub" : "RBAC Hub"}</span>
            </button>
          )}

          {/* User profile card */}
          <div className="flex items-center space-x-3 pl-3 border-l border-[#e6e0d4]">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || "User avatar"}
                className="w-8 h-8 rounded-full border border-[#d6cebf] object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#eee9df] border border-[#d6cebf] flex items-center justify-center text-sm font-medium text-[#504a3e]">
                {(user.displayName || user.email || "U").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="hidden lg:block text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-[#2c2b29] truncate max-w-[120px]">
                  {user.displayName || "Active User"}
                </span>
                <span
                  className={`text-[9px] font-semibold px-1.5 py-0.2 rounded-md uppercase tracking-wider ${
                    user.role === "admin"
                      ? "bg-[#edf4ec] text-[#375432] border border-[#c4dbc1]"
                      : "bg-[#f4efe6] text-[#787265] border border-[#ded7c8]"
                  }`}
                >
                  {user.role === "admin" ? "Admin" : "User"}
                </span>
              </div>
              <div className="text-[11px] text-[#7c786e] truncate max-w-[140px]">
                {user.email || "Secure Session"}
              </div>
            </div>

            {/* Switch Account / Logout button */}
            <button
              id="logout-button"
              onClick={onSignOut}
              title="Sign Out"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#7c786e] hover:text-[#2c2b29] hover:bg-[#ede7db] transition cursor-pointer border border-transparent hover:border-[#ded7c8]"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
