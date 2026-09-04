import React from "react";
import { motion, type Variants } from "motion/react";

interface ReflectMascotProps {
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  animate?: boolean;
}

const SIZE_MAP = {
  sm: "w-8 h-8",
  md: "w-11 h-11",
  lg: "w-16 h-16",
  hero: "w-24 h-24 sm:w-28 sm:h-28",
};

export const ReflectMascot: React.FC<ReflectMascotProps> = ({
  size = "md",
  className = "",
  animate = true,
}) => {
  const sizeClass = SIZE_MAP[size];

  const floatingVariants: Variants = {
    initial: { y: 0, scale: 1 },
    animate: {
      y: [-2, 3, -2],
      scale: [1, 1.02, 1],
      transition: {
        duration: 4.5,
        repeat: Infinity,
        ease: "easeInOut",
      },
    },
  };

  const auraVariants: Variants = {
    initial: { opacity: 0.3, scale: 0.95 },
    animate: {
      opacity: [0.3, 0.6, 0.3],
      scale: [0.95, 1.05, 0.95],
      transition: {
        duration: 3.8,
        repeat: Infinity,
        ease: "easeInOut",
      },
    },
  };

  return (
    <div
      className={`relative inline-flex items-center justify-center select-none ${sizeClass} ${className}`}
      aria-label="ReflectAI Mindful Companion"
    >
      {/* Radiant Aura / Gentle Breathing Glow */}
      {animate && (
        <motion.div
          variants={auraVariants}
          initial="initial"
          animate="animate"
          className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-[#91a38a]/30 via-[#d9c59a]/20 to-[#476340]/20 blur-md pointer-events-none -z-10"
        />
      )}

      {/* Main Animated Mascot Body */}
      <motion.div
        variants={animate ? floatingVariants : undefined}
        initial="initial"
        animate="animate"
        className="w-full h-full"
      >
        <svg
          viewBox="0 0 128 128"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_4px_12px_rgba(44,43,41,0.08)]"
        >
          <defs>
            <linearGradient id="mascot-bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4a6b42" />
              <stop offset="50%" stopColor="#34522f" />
              <stop offset="100%" stopColor="#1f341b" />
            </linearGradient>
            <linearGradient id="mascot-petal-center" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#fdfbf7" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#dcead9" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="mascot-petal-left" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#b6d8b0" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#739a6c" stopOpacity="0.75" />
            </linearGradient>
            <linearGradient id="mascot-petal-right" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#cde5c9" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#8ba784" stopOpacity="0.75" />
            </linearGradient>
            <linearGradient id="mascot-sparkle" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fff6dd" />
              <stop offset="50%" stopColor="#f5c253" />
              <stop offset="100%" stopColor="#d9822b" />
            </linearGradient>
          </defs>

          {/* Squircle Pod */}
          <rect
            x="8"
            y="8"
            width="112"
            height="112"
            rx="28"
            fill="url(#mascot-bg)"
            stroke="#688c60"
            strokeWidth="2"
          />

          {/* Calming Ring */}
          <circle
            cx="64"
            cy="64"
            r="44"
            stroke="#7ea375"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.45"
          />

          {/* Petals */}
          <path
            d="M64 78 C48 76 34 62 38 46 C42 58 52 70 64 78 Z"
            fill="url(#mascot-petal-left)"
            opacity="0.9"
          />
          <path
            d="M64 78 C80 76 94 62 90 46 C86 58 76 70 64 78 Z"
            fill="url(#mascot-petal-right)"
            opacity="0.9"
          />
          <path
            d="M64 82 C38 80 24 66 26 58 C32 72 48 80 64 82 Z"
            fill="#8ba784"
            opacity="0.6"
          />
          <path
            d="M64 82 C90 80 104 66 102 58 C96 72 80 80 64 82 Z"
            fill="#72946a"
            opacity="0.6"
          />

          {/* Center Lotus Heart */}
          <path
            d="M64 28 C56 46 52 64 64 80 C76 64 72 46 64 28 Z"
            fill="url(#mascot-petal-center)"
          />

          {/* Inner Light Spark */}
          <path
            d="M64 42 Q64 54 54 54 Q64 54 64 66 Q64 54 74 54 Q64 54 64 42 Z"
            fill="url(#mascot-sparkle)"
          />
          <circle cx="64" cy="54" r="2.5" fill="#ffffff" />

          {/* Base Reflection Ripples */}
          <path
            d="M48 90 Q64 94 80 90"
            stroke="#b6d8b0"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.85"
          />
          <path
            d="M54 97 Q64 100 74 97"
            stroke="#8ba784"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.6"
          />
        </svg>
      </motion.div>
    </div>
  );
};
