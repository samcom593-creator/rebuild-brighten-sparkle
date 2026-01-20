import { motion } from "framer-motion";
import { X, Play, Star, Quote } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  testimonial: {
    name: string;
    role: string;
    location: string;
    quote: string;
    stats: { income: string; timeframe: string };
    videoDuration: string;
    gradientClass: string;
    videoUrl?: string;
  } | null;
}

export function VideoModal({ isOpen, onClose, testimonial }: VideoModalProps) {
  if (!testimonial) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-background border-border">
        <VisuallyHidden>
          <DialogTitle>Video Testimonial from {testimonial.name}</DialogTitle>
        </VisuallyHidden>
        
        {/* Video Player Area */}
        <div className={`relative aspect-video ${!testimonial.videoUrl ? `bg-gradient-to-br ${testimonial.gradientClass}` : ''}`}>
          {testimonial.videoUrl ? (
            <iframe
              src={testimonial.videoUrl}
              title={`Video Testimonial from ${testimonial.name}`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.1)_0%,transparent_50%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,0,0,0.2)_0%,transparent_50%)]" />
              
              {/* Play button with coming soon */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.div
                  className="w-20 h-20 rounded-full bg-primary/90 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-primary/30 mb-4"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Play className="h-9 w-9 text-primary-foreground fill-primary-foreground ml-1" />
                </motion.div>
                <p className="text-white/80 text-sm font-medium bg-black/30 px-4 py-2 rounded-full backdrop-blur-sm">
                  Video Coming Soon
                </p>
              </div>

              {/* Duration */}
              <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded bg-background/80 backdrop-blur-sm text-sm font-medium">
                {testimonial.videoDuration}
              </div>
            </>
          )}
        </div>

        {/* Testimonial Content */}
        <div className="p-6 md:p-8">
          <Quote className="h-8 w-8 text-primary/30 mb-4" />
          
          <p className="text-lg md:text-xl text-foreground leading-relaxed mb-6">
            "{testimonial.quote}"
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-border">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold text-primary">
                {testimonial.name.charAt(0)}
              </div>
              <div>
                <div className="font-semibold text-lg">{testimonial.name}</div>
                <div className="text-sm text-muted-foreground">
                  {testimonial.role} • {testimonial.location}
                </div>
                <div className="flex gap-1 mt-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 sm:border-l sm:border-border sm:pl-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{testimonial.stats.income}</div>
                <div className="text-xs text-muted-foreground">{testimonial.stats.timeframe}</div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
