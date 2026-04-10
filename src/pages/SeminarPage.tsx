import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Play, Pause, Volume2, VolumeX, Maximize, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SEMINAR_VIDEO_URL = "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&modestbranding=1";

export default function SeminarPage() {
  const [muted, setMuted] = useState(false);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 sm:p-6 text-center"
      >
        <div className="flex items-center justify-center gap-2 mb-2">
          <Crown className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold text-white" style={{ fontFamily: "Syne" }}>
            APEX Financial
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">
          Weekly Career Seminar
        </h1>
        <p className="text-sm text-gray-400">
          Every Thursday at 7:00 PM CST • Watch the latest replay below
        </p>
      </motion.div>

      {/* Video Player */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="flex-1 flex items-center justify-center px-4 pb-8"
      >
        <div className="w-full max-w-5xl aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-primary/10">
          <iframe
            src={SEMINAR_VIDEO_URL}
            title="APEX Weekly Seminar"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="w-full h-full"
            style={{ border: 0 }}
          />
        </div>
      </motion.div>

      {/* Bottom Info */}
      <div className="p-4 text-center">
        <p className="text-xs text-gray-500">
          New recordings are posted every Friday morning. Check back each week for the latest session.
        </p>
      </div>
    </div>
  );
}
