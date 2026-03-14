import { motion } from "framer-motion";
import { Trophy, Medal, Award, Crown, Target, Percent, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { getClosingRateColor } from "@/lib/closingRateColors";

interface MobileLeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  avatarUrl?: string;
  alp: number;
  deals: number;
  presentations: number;
  closingRate: number;
  isCurrentUser: boolean;
}

interface MobileLeaderboardCardProps {
  entry: MobileLeaderboardEntry;
  index: number;
  onClick?: () => void;
  leaders?: {
    alp: string | null;
    presentations: string | null;
    closingRate: string | null;
    deals: string | null;
  };
}

const getAvatarColor = (name: string) => {
  const colors = [
    "from-primary to-primary/60",
    "from-emerald-500 to-emerald-600",
    "from-amber-500 to-orange-500",
    "from-purple-500 to-pink-500",
    "from-cyan-500 to-blue-500",
  ];
  const index = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[index % colors.length];
};

const getInitials = (name: string) => {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
};

export function MobileLeaderboardCard({ entry, index, onClick, leaders }: MobileLeaderboardCardProps) {
  const closeRateColor = getClosingRateColor(entry.closingRate);
  const renderRankBadge = () => {
    if (entry.rank === 1) {
      return (
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 animate-rank-glow shadow-lg">
          <Trophy className="h-4 w-4 text-white" />
        </div>
      );
    }
    if (entry.rank === 2) {
      return (
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 shadow">
          <Medal className="h-4 w-4 text-slate-700" />
        </div>
      );
    }
    if (entry.rank === 3) {
      return (
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-amber-600 to-amber-800 shadow">
          <Award className="h-4 w-4 text-white" />
        </div>
      );
    }
    return (
      <div className={cn(
        "flex items-center justify-center h-8 w-8 rounded-full text-sm font-bold",
        entry.isCurrentUser ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
      )}>
        {entry.rank}
      </div>
    );
  };

  const getLeaderBadges = () => {
    const badges = [];
    if (leaders?.alp === entry.agentId) badges.push(<Crown key="alp" className="h-3.5 w-3.5 text-amber-400" />);
    if (leaders?.presentations === entry.agentId) badges.push(<Target key="pres" className="h-3.5 w-3.5 text-blue-400" />);
    if (leaders?.closingRate === entry.agentId) badges.push(<Percent key="close" className="h-3.5 w-3.5 text-emerald-400" />);
    if (leaders?.deals === entry.agentId) badges.push(<Trophy key="deals" className="h-3.5 w-3.5 text-purple-400" />);
    return badges;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={onClick}
      className={cn(
        "p-4 rounded-xl transition-all active:scale-[0.98] cursor-pointer",
        entry.isCurrentUser
          ? "bg-primary/10 border-2 border-primary/30 shadow-md"
          : entry.rank <= 3
            ? "bg-gradient-to-r from-amber-500/5 to-transparent border border-amber-500/20"
            : "bg-muted/30 border border-border/50",
        "hover:shadow-lg"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Rank Badge */}
        {renderRankBadge()}

        {/* Avatar */}
        <div className={cn(
          "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 bg-gradient-to-br shadow-md",
          entry.avatarUrl ? "" : getAvatarColor(entry.name)
        )}>
          {entry.avatarUrl ? (
            <img 
              src={entry.avatarUrl} 
              alt={entry.name} 
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            getInitials(entry.name)
          )}
        </div>

        {/* Name & Badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "font-semibold truncate",
              entry.isCurrentUser && "text-primary"
            )}>
              {entry.name}
            </span>
            {entry.isCurrentUser && (
              <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">You</span>
            )}
            {getLeaderBadges()}
          </div>
          {/* Stats Row */}
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              {entry.presentations}
            </span>
            <span className="flex items-center gap-1">
              <Trophy className="h-3 w-3" />
              {entry.deals}
            </span>
            <span className={cn(
              "flex items-center gap-1",
              closeRateColor.textClass
            )}>
              <Percent className="h-3 w-3" />
              {entry.closingRate.toFixed(0)}%
            </span>
          </div>
        </div>

        {/* ALP - Large and prominent */}
        <div className="text-right">
          <div className={cn(
            "text-lg font-bold",
            entry.rank === 1 && "text-amber-400",
            entry.rank === 2 && "text-slate-400",
            entry.rank === 3 && "text-amber-600",
            entry.rank > 3 && entry.isCurrentUser && "text-primary"
          )}>
            ${entry.alp >= 1000 ? `${(entry.alp / 1000).toFixed(1)}k` : entry.alp.toLocaleString()}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">ALP</div>
        </div>
      </div>
    </motion.div>
  );
}
