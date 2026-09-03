import React, { useState } from "react";
import { signInWithGoogle, signInAsGuest } from "../lib/firebase";
import { BookOpen, Sparkles, Shield, Lock, BrainCircuit, ArrowRight, CheckCircle2 } from "lucide-react";

interface AuthLandingProps {
  onAuthSuccess?: () => void;
}

export const AuthLanding: React.FC<AuthLandingProps> = () => {
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      await signInWithGoogle();
    } catch (err: any) {
      console.error("Sign in failure:", err);
      setErrorMessage(err?.message || "Failed to sign in with Google.");
    } finally {
      setLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    try {
      setGuestLoading(true);
      setErrorMessage(null);
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
            <div className="w-9 h-9 rounded-xl bg-[#eef3ed] border border-[#c9d8c6] flex items-center justify-center text-[#476340]">
              <BookOpen className="w-5 h-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight font-serif text-[#2c2b29]">ReflectAI</span>
          </div>

          <div className="flex items-center space-x-2 text-xs text-[#6e695e]">
            <span className="w-2 h-2 rounded-full bg-[#52804b]"></span>
            <span>Gemini 3.6 Flash & Firestore Active</span>
          </div>
        </div>
      </header>

      {/* Hero & Authentication Card */}
      <main className="max-w-6xl mx-auto px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center flex-1">
        {/* Left column: Value Proposition */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#eef3ed] border border-[#c9d8c6] text-[#476340] text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-[#597852]" />
            AI-Augmented Personal Journaling & Introspection
          </div>

          <h1 className="text-4xl sm:text-5xl font-serif tracking-tight text-[#2c2b29] leading-tight">
            Reflect deeply with <span className="text-[#476340] italic">Gemini 3.6</span>, stored with strict user isolation.
          </h1>

          <p className="text-[#67635a] text-base sm:text-lg leading-relaxed max-w-xl font-light">
            A private sanctuary for daily thoughts, brainstorming, and life decisions.
            Converse multi-turn with an empathetic AI thought partner, generate synthesized takeaways,
            and store everything in Firestore where only you hold the keys.
          </p>

          {/* Key Security & Architectural Features */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-[#ffffff] border border-[#e6e0d4] shadow-[0_2px_8px_rgba(44,43,41,0.03)] space-y-2">
              <div className="flex items-center gap-2 text-[#2c2b29] text-sm font-medium">
                <Shield className="w-4 h-4 text-[#476340]" />
                <span>Isolated Firestore DB</span>
              </div>
              <p className="text-xs text-[#67635a] leading-normal">
                Strict security rules lock entries to <code className="text-[#7d5622] bg-[#f5efe3] px-1 py-0.5 rounded">/users/{`{userId}`}</code> so no user can ever access another’s reflections.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#ffffff] border border-[#e6e0d4] shadow-[0_2px_8px_rgba(44,43,41,0.03)] space-y-2">
              <div className="flex items-center gap-2 text-[#2c2b29] text-sm font-medium">
                <BrainCircuit className="w-4 h-4 text-[#8a6328]" />
                <span>Gemini 3.6 Flash</span>
              </div>
              <p className="text-xs text-[#67635a] leading-normal">
                Multi-turn reflective dialogue with specialized personas: Thoughtful, Analytical, Creative, or Actionable.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#ffffff] border border-[#e6e0d4] shadow-[0_2px_8px_rgba(44,43,41,0.03)] space-y-2">
              <div className="flex items-center gap-2 text-[#2c2b29] text-sm font-medium">
                <Lock className="w-4 h-4 text-[#466a7c]" />
                <span>Passwordless Auth</span>
              </div>
              <p className="text-xs text-[#67635a] leading-normal">
                Sign in with Google OAuth directly. No raw passwords stored in application code.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#ffffff] border border-[#e6e0d4] shadow-[0_2px_8px_rgba(44,43,41,0.03)] space-y-2">
              <div className="flex items-center gap-2 text-[#2c2b29] text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#476340]" />
                <span>Synthesis Engine</span>
              </div>
              <p className="text-xs text-[#67635a] leading-normal">
                Auto-generate reflective titles, concise executive summaries, sentiment mood tags, and action takeaways.
              </p>
            </div>
          </div>
        </div>

        {/* Right column: Authentication Box */}
        <div className="lg:col-span-5">
          <div className="bg-[#ffffff] border border-[#e6e0d4] rounded-2xl p-6 sm:p-8 shadow-[0_12px_36px_rgba(44,43,41,0.06)] relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-[#91a38a]/10 rounded-full blur-3xl pointer-events-none -mr-16 -mt-16"></div>

            <div className="relative space-y-6">
              <div>
                <h2 className="text-xl font-serif font-semibold text-[#2c2b29]">Welcome to ReflectAI</h2>
                <p className="text-sm text-[#67635a] mt-1">
                  Authenticate to enter your personal, encrypted journal workspace.
                </p>
              </div>

              {errorMessage && (
                <div className="p-3.5 bg-[#fdf1f1] border border-[#f2cccc] text-[#9e3838] rounded-xl text-xs leading-relaxed">
                  <p>{errorMessage}</p>
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

                {/* Secondary Guest / Sandbox Demo button */}
                <div className="pt-2 space-y-2">
                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-[#e6e0d4]"></div>
                    <span className="flex-shrink mx-3 text-[#8a857a] text-xs uppercase tracking-wider">or instant preview</span>
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
                </div>
              </div>

              {/* Security guarantee footnote */}
              <div className="border-t border-[#eee9df] pt-4 text-[11px] text-[#7c786e] space-y-1">
                <p className="flex items-center gap-1.5 text-[#476340] font-medium">
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                  Zero-credential exposure guarantee
                </p>
                <p className="leading-relaxed text-[#7c786e]">
                  Authentication is managed securely via Firebase. Your journal entries remain locked strictly to your unique authenticated UID in Cloud Firestore.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e6e0d4] py-6 px-6 text-center text-xs text-[#8a857a]">
        <p>ReflectAI &bull; Powered by Google Cloud Firestore, Firebase Authentication & Gemini 3.6 Flash</p>
      </footer>
    </div>
  );
};
