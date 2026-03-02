import { motion } from "framer-motion";
import { Instagram, ExternalLink } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";

interface DirectoryEntry {
  id: string;
  full_name?: string;
  instagram_handle?: string | null;
  followerCount: number;
}

interface InstagramDirectoryProps {
  directory: DirectoryEntry[];
}

export function InstagramDirectory({ directory }: InstagramDirectoryProps) {
  return (
    <GlassCard className="p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Instagram className="h-4 w-4 text-primary" />
        Instagram Directory
        <Badge variant="outline" className="ml-auto text-xs">{directory.length} profiles</Badge>
      </h3>

      {directory.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No Instagram handles on file yet.</p>
      ) : (
        <div className="space-y-2">
          {directory.map((person, i) => (
            <motion.a
              key={person.id}
              href={`https://instagram.com/${person.instagram_handle}`}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 hover:border-primary/30 hover:bg-primary/5 transition-all group"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {person.full_name?.charAt(0) || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{person.full_name}</p>
                <p className="text-xs text-muted-foreground">@{person.instagram_handle}</p>
              </div>
              {person.followerCount > 0 && (
                <Badge variant="secondary" className="text-xs">{person.followerCount.toLocaleString()} followers</Badge>
              )}
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
            </motion.a>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
