import React, { useState } from "react";
import { signInWithGoogle, signInAsGuest, signInAsDemoUser } from "../lib/firebase";
import { ReflectMascot } from "./ReflectMascot";
import { motion } from "motion/react";
import {
  Sparkles,
  Shield,
  Lock,
  ArrowRight,
  CheckCircle2,
  UserCheck,
  ShieldAlert,
  ExternalLink,
  Info,
  X,
  HeartHandshake,
} from "lucide-react";

interface AuthLandingProps {
  onAuthSuccess?: () => void;
}

export const AuthLanding: React.FC<AuthLandingProps> = () => {
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const isInIframe = typeof window !== "undefined" && window.self !== window.top;

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      setNoticeMessage(null);
      await signInWithGoogle();
    } catch (err: any) {
      if (
        err?.isCancelled ||
        err?.code === "auth/popup-closed-by-user" ||
        err?.code === "auth/cancelled-popup-request"
      ) {
        console.info("Google sign-in popup closed by user or browser policy.");
        setNoticeMessage(
          "Sign-in window was closed. Click Continue with Google to try again, or open in a new tab if your browser limits iframe popups."
        );
      } else {
        console.error("Sign in failure:", err);
        setErrorMessage(err?.message || "Failed to sign in with Google.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    try {
      setGuestLoading(true);
      setErrorMessage(null);
      setNoticeMessage(null);
      await signInAsGuest();
    } catch (err: any) {
      console.error("Guest sign in failure:", err);
      setErrorMessage(err?.message || "Failed to sign in anonymously.");
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <div id="auth-landing" className="min-h-screen bg-[#fdfbf7] text-[#2c2b29] flex flex-col justify-between selection:bg-[#91a38a]/30 selection:text-[#2c2b29]">
      {/* Top bar */}
      <header className="border-b border-[#e6e0d4] px-6 py-4 bg-[#fbf9f5]/90 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <ReflectMascot size="sm" />
            <span className="text-lg font-semibold tracking-tight font-serif text-[#2c2b29]">ReflectAI</span>
          </div>

          <div className="flex items-center space-x-2 text-xs text-[#6e695e]">
            <span className="w-2 h-2 rounded-full bg-[#52804b]"></span>
            <span>A Mindful Sanctuary for Your Thoughts</span>
          </div>
        </div>
      </header>

      {/* Hero & Authentication Card */}
      <main className="max-w-6xl mx-auto px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center flex-1">
        {/* Left column: Value Proposition */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="lg:col-span-7 space-y-6"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#eef3ed] border border-[#c9d8c6] text-[#476340] text-xs font-medium shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-[#597852]" />
            Mindful Journaling &amp; Personal Clarity
          </div>

          <h1 className="text-4xl sm:text-5xl font-serif tracking-tight text-[#2c2b29] leading-tight">
            Reflect deeply, find <span className="text-[#476340] italic">clarity</span>, and nurture your inner growth.
          </h1>

          <p className="text-[#67635a] text-base sm:text-lg leading-relaxed max-w-xl font-light">
            A calm, safe haven to untangle your thoughts, navigate life choices, and gain fresh perspectives.
            Explore your mind with a thoughtful AI partner and keep your reflections sealed with complete privacy.
          </p>

          {/* Key Value & Human-Centric Features */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <motion.div
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2 }}
              className="p-4 rounded-xl bg-[#ffffff] border border-[#e6e0d4] shadow-[0_2px_8px_rgba(44,43,41,0.03)] space-y-2"
            >
              <div className="flex items-center gap-2 text-[#2c2b29] text-sm font-medium">
                <Shield className="w-4 h-4 text-[#476340]" />
                <span>Completely Private to You</span>
              </div>
              <p className="text-xs text-[#67635a] leading-normal">
                Your entries belong solely to you. Locked securely in your personal vault with zero outside access.
              </p>
            </motion.div>

            <motion.div
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2 }}
              className="p-4 rounded-xl bg-[#ffffff] border border-[#e6e0d4] shadow-[0_2px_8px_rgba(44,43,41,0.03)] space-y-2"
            >
              <div className="flex items-center gap-2 text-[#2c2b29] text-sm font-medium">
                <HeartHandshake className="w-4 h-4 text-[#8a6328]" />
                <span>Empathetic AI Partner</span>
              </div>
              <p className="text-xs text-[#67635a] leading-normal">
                Reflective dialogue tailored to your mood: compassionate contemplation, analytical clarity, or creative inspiration.
              </p>
            </motion.div>

            <motion.div
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2 }}
              className="p-4 rounded-xl bg-[#ffffff] border border-[#e6e0d4] shadow-[0_2px_8px_rgba(44,43,41,0.03)] space-y-2"
            >
              <div className="flex items-center gap-2 text-[#2c2b29] text-sm font-medium">
                <Lock className="w-4 h-4 text-[#466a7c]" />
                <span>Effortless &amp; Safe Sign-In</span>
              </div>
              <p className="text-xs text-[#67635a] leading-normal">
                One-tap sign-in with your Google account. Quick, effortless, and you never have to remember another password.
              </p>
            </motion.div>

            <motion.div
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2 }}
              className="p-4 rounded-xl bg-[#ffffff] border border-[#e6e0d4] shadow-[0_2px_8px_rgba(44,43,41,0.03)] space-y-2"
            >
              <div className="flex items-center gap-2 text-[#2c2b29] text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#476340]" />
                <span>Meaningful Takeaways</span>
              </div>
              <p className="text-xs text-[#67635a] leading-normal">
                Receive auto-generated heartfelt summaries, mood highlights, and gentle actionable steps forward.
              </p>
            </motion.div>
          </div>
        </motion.div>

        {/* Right column: Authentication Box */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="lg:col-span-5"
        >
          <div className="bg-[#ffffff] border border-[#e6e0d4] rounded-2xl p-6 sm:p-8 shadow-[0_12px_36px_rgba(44,43,41,0.06)] relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-[#91a38a]/10 rounded-full blur-3xl pointer-events-none -mr-16 -mt-16"></div>

            <div className="relative space-y-6">
              <div className="text-center sm:text-left flex flex-col sm:flex-row items-center sm:items-start gap-4">
                <ReflectMascot size="md" className="shrink-0" />
                <div>
                  <h2 className="text-xl font-serif font-semibold text-[#2c2b29]">Welcome to ReflectAI</h2>
                  <p className="text-sm text-[#67635a] mt-0.5">
                    Open your personal reflection space to begin.
                  </p>
                </div>
              </div>

              {noticeMessage && (
                <div className="p-3 bg-[#fdfaf3] border border-[#eee4cc] text-[#7d5622] rounded-xl text-xs leading-relaxed flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#9e7030]" />
                    <div>
                      <p>{noticeMessage}</p>
                      {isInIframe && (
                        <button
                          type="button"
                          onClick={() => window.open(window.location.href, "_blank")}
                          className="mt-1.5 inline-flex items-center gap-1 font-semibold text-[#573d17] hover:underline cursor-pointer"
                        >
                          <span>Open in Standalone Window</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setNoticeMessage(null)}
                    className="text-[#9e7030] hover:text-[#573d17] p-0.5 cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {errorMessage && (
                <div className="p-3.5 bg-[#fdf1f1] border border-[#f2cccc] text-[#9e3838] rounded-xl text-xs leading-relaxed flex items-start justify-between gap-2">
                  <p>{errorMessage}</p>
                  <button
                    onClick={() => setErrorMessage(null)}
                    className="text-[#9e3838] hover:text-[#5c1c1c] p-0.5 cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Primary Google Sign-in */}
              <div className="space-y-3 pt-2">
                <button
                  id="google-signin-btn"
                  onClick={handleGoogleSignIn}
                  disabled={loading || guestLoading}
                  className="w-full flex items-center justify-center gap-3 bg-[#2c2b29] hover:bg-[#3d3b37] text-[#fdfbf7] font-medium py-3 px-4 rounded-xl transition duration-150 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>{loading ? "Connecting to Google..." : "Continue with Google"}</span>
                </button>

                {/* Account Switch Helper */}
                <p className="text-[11px] text-[#7c786e] text-center">
                  Always prompts account chooser so you can log in or switch to any Google account.
                </p>

                {/* Standalone Window helper for iframe previews */}
                {isInIframe && (
                  <div className="p-2.5 bg-[#f6f8f5] border border-[#d6e2d4] rounded-xl text-xs flex items-center justify-between gap-2">
                    <span className="text-[#3c5436] text-[11px] leading-tight">
                      Previewing inside iframe. If Google Auth popup is blocked, open in a standalone tab.
                    </span>
                    <button
                      type="button"
                      onClick={() => window.open(window.location.href, "_blank")}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-[#ffffff] border border-[#c3d6c0] text-[#3c5436] rounded-lg font-medium text-[11px] hover:bg-[#eef4ed] transition cursor-pointer"
                    >
                      <span>Open Tab</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Secondary Sandbox / RBAC Testing section */}
                <div className="pt-2 space-y-2.5">
                  <div className="relative flex py-1 items-center">
                    <div className="flex-grow border-t border-[#e6e0d4]"></div>
                    <span className="flex-shrink mx-3 text-[#8a857a] text-[11px] uppercase tracking-wider">or test access roles</span>
                    <div className="flex-grow border-t border-[#e6e0d4]"></div>
                  </div>

                  <button
                    id="guest-signin-btn"
                    onClick={handleGuestSignIn}
                    disabled={loading || guestLoading}
                    className="w-full flex items-center justify-center gap-2 bg-[#f4f1ea] hover:bg-[#ebe6dc] text-[#3d3b37] text-sm font-medium py-2.5 px-4 rounded-xl border border-[#ded7c8] transition cursor-pointer disabled:opacity-50"
                  >
                    <span>{guestLoading ? "Opening Demo..." : "Enter as Guest Explorer"}</span>
                    <ArrowRight className="w-4 h-4 text-[#7c786e]" />
                  </button>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => signInAsDemoUser("user")}
                      className="flex items-center justify-center gap-1.5 py-2 px-2.5 bg-[#ffffff] hover:bg-[#f8f6f0] border border-[#ded7c8] text-[#555046] text-xs font-medium rounded-xl transition cursor-pointer"
                      title="Quick test as a regular user with standard permissions"
                    >
                      <UserCheck className="w-3.5 h-3.5 text-[#597852]" />
                      <span>Test Standard Role</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => signInAsDemoUser("admin")}
                      className="flex items-center justify-center gap-1.5 py-2 px-2.5 bg-[#ffffff] hover:bg-[#f8f6f0] border border-[#ded7c8] text-[#555046] text-xs font-medium rounded-xl transition cursor-pointer"
                      title="Quick test as an administrator with elevated RBAC"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-[#9e5d1b]" />
                      <span>Test Admin Role</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Security guarantee footnote */}
              <div className="border-t border-[#eee9df] pt-4 text-[11px] text-[#7c786e] space-y-1">
                <p className="flex items-center gap-1.5 text-[#476340] font-medium">
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                  Zero-credential exposure guarantee
                </p>
                <p className="leading-relaxed text-[#7c786e]">
                  Your reflections remain encrypted and locked strictly to your authenticated session.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e6e0d4] py-6 px-6 text-center text-xs text-[#8a857a]">
        <p>ReflectAI &bull; Mindful Journaling &amp; Personal Clarity Companion</p>
      </footer>
    </div>
  );
};
