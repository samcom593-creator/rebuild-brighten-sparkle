import { motion } from "framer-motion";
import { Play, Star } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";

interface VideoTestimonialCardProps {
  name: string;
  role: string;
  location: string;
  quote: string;
  stats: { income: string; timeframe: string };
  videoDuration: string;
  gradientClass: string;
  onClick: () => void;
  index: number;
}

export function VideoTestimonialCard({
  name,
  role,
  location,
  stats,
  videoDuration,
  gradientClass,
  onClick,
  index,
}: VideoTestimonialCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
    >
      <GlassCard
        className="overflow-hidden cursor-pointer group"
        onClick={onClick}
      >
        {/* Video Thumbnail Area */}
        <div className={`relative aspect-video bg-gradient-to-br ${gradientClass} overflow-hidden`}>
          {/* Decorative elements */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.1)_0%,transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,0,0,0.2)_0%,transparent_50%)]" />
          
          {/* Agent Initial */}
          <div className="absolute top-4 left-4 w-12 h-12 rounded-full bg-background/20 backdrop-blur-sm flex items-center justify-center text-xl font-bold text-white border border-white/20">
            {name.charAt(0)}
          </div>

          {/* Play Button */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            whileHover={{ scale: 1.05 }}
          >
            <motion.div
              className="w-16 h-16 rounded-full bg-primary/90 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-primary/30 group-hover:bg-primary transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <Play className="h-7 w-7 text-primary-foreground fill-primary-foreground ml-1" />
            </motion.div>
            
            {/* Pulse ring on hover */}
            <motion.div
              className="absolute w-16 h-16 rounded-full border-2 border-primary/50"
              initial={{ scale: 1, opacity: 0 }}
              animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          </motion.div>

          {/* Duration Badge */}
          <div className="absolute bottom-3 right-3 px-2 py-1 rounded bg-background/80 backdrop-blur-sm text-xs font-medium">
            {videoDuration}
          </div>

          {/* Income Badge */}
          <div className="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-primary/90 backdrop-blur-sm text-xs font-bold text-primary-foreground">
            {stats.income} • {stats.timeframe}
          </div>
        </div>

        {/* Agent Info */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-foreground">{name}</h4>
              <p className="text-sm text-muted-foreground">
                {role} • {location}
              </p>
            </div>
            <div className="flex gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="h-3.5 w-3.5 fill-primary text-primary" />
              ))}
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
