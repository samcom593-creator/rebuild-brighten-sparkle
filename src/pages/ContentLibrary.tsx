import { useState } from "react";
import { Search, Download, Play, Image, Video, Tag, Sparkles, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BackgroundGlow } from "@/components/ui/BackgroundGlow";

const SAMPLE_CONTENT = [
  { id: "1", title: "Success Story Template", type: "image", tags: ["social", "testimonial"], thumbnail: "/placeholder.svg" },
  { id: "2", title: "Weekly Recap Video", type: "video", tags: ["training", "recap"], thumbnail: "/placeholder.svg" },
  { id: "3", title: "Product Overview Reel", type: "video", tags: ["social", "product"], thumbnail: "/placeholder.svg" },
  { id: "4", title: "Team Achievement Post", type: "image", tags: ["social", "team"], thumbnail: "/placeholder.svg" },
  { id: "5", title: "Cold Call Script Guide", type: "image", tags: ["training", "scripts"], thumbnail: "/placeholder.svg" },
  { id: "6", title: "Objection Handling Clips", type: "video", tags: ["training", "sales"], thumbnail: "/placeholder.svg" },
];

const AWARD_TEMPLATES = [
  { id: "top_producer", label: "🏆 Top Producer", color: "from-amber-500 to-yellow-400" },
  { id: "deal_closer", label: "💰 Deal Closer", color: "from-emerald-500 to-teal-400" },
  { id: "rising_star", label: "⭐ Rising Star", color: "from-purple-500 to-pink-400" },
  { id: "team_mvp", label: "🎖️ Team MVP", color: "from-blue-500 to-cyan-400" },
  { id: "streak_king", label: "🔥 Streak King", color: "from-red-500 to-orange-400" },
];

export default function ContentLibrary() {
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [generatedCaption, setGeneratedCaption] = useState("");

  const allTags = [...new Set(SAMPLE_CONTENT.flatMap(c => c.tags))];

  const filtered = SAMPLE_CONTENT.filter(c => {
    const matchesSearch = !search || c.title.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !activeTag || c.tags.includes(activeTag);
    return matchesSearch && matchesTag;
  });

  const generateCaption = () => {
    const hashtags = "#ApexFinancial #LifeInsurance #FinancialFreedom #TopProducer #Insurance #AgentLife";
    const captions = [
      `🚀 Another incredible week at APEX! The grind never stops. ${hashtags}`,
      `💰 Building generational wealth one policy at a time. ${hashtags}`,
      `🏆 Excellence isn't a goal, it's a standard. ${hashtags}`,
      `🔥 When you surround yourself with winners, winning becomes a habit. ${hashtags}`,
    ];
    setGeneratedCaption(captions[Math.floor(Math.random() * captions.length)]);
  };

  return (
    <>
      <BackgroundGlow />
      <div className="p-4 md:p-6 space-y-6 page-enter">
        <div>
          <h1 className="text-2xl font-bold gradient-text" style={{ fontFamily: "Syne" }}>Content Library</h1>
          <p className="text-sm text-muted-foreground">Social media assets, templates & award graphics</p>
        </div>

        <Tabs defaultValue="library">
          <TabsList className="glass">
            <TabsTrigger value="library"><Image className="h-4 w-4 mr-1" /> Library</TabsTrigger>
            <TabsTrigger value="generator"><Sparkles className="h-4 w-4 mr-1" /> Caption Generator</TabsTrigger>
            <TabsTrigger value="awards"><Tag className="h-4 w-4 mr-1" /> Award Templates</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-4 mt-4">
            {/* Search + Tags */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search content..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              {allTags.map(tag => (
                <Badge key={tag} variant={activeTag === tag ? "default" : "outline"} className="cursor-pointer capitalize"
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}>
                  {tag}
                </Badge>
              ))}
            </div>

            {/* Content Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {filtered.map((item, i) => (
                <div key={item.id} className="glass-card p-3 space-y-2 animate-stagger-in" style={{ animationDelay: `${i * 50}ms` }}>
                  <div className="aspect-video bg-muted rounded-lg flex items-center justify-center relative overflow-hidden">
                    {item.type === "video" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
                        <Play className="h-8 w-8 text-white" />
                      </div>
                    )}
                    {item.type === "image" ? <Image className="h-8 w-8 text-muted-foreground" /> : <Video className="h-8 w-8 text-muted-foreground" />}
                  </div>
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <div className="flex items-center gap-1">
                    {item.tags.map(t => <Badge key={t} variant="outline" className="text-[10px] capitalize">{t}</Badge>)}
                  </div>
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1">
                    <Download className="h-3 w-3" /> Download
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="generator" className="space-y-4 mt-4">
            <div className="glass-card p-6 space-y-4 max-w-lg">
              <h3 className="font-bold" style={{ fontFamily: "Syne" }}>Social Post Generator</h3>
              <Textarea placeholder="Describe what you want to post about..." value={caption} onChange={e => setCaption(e.target.value)} rows={3} />
              <Button onClick={generateCaption} className="btn-primary-luxury gap-2">
                <Sparkles className="h-4 w-4" /> Generate Caption
              </Button>
              {generatedCaption && (
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <p className="text-sm whitespace-pre-wrap">{generatedCaption}</p>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => {
                    navigator.clipboard.writeText(generatedCaption);
                    toast.success("Copied!");
                  }}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="awards" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {AWARD_TEMPLATES.map((tmpl, i) => (
                <div key={tmpl.id} className="glass-card p-4 space-y-3 animate-stagger-in" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className={cn("aspect-square rounded-xl bg-gradient-to-br flex items-center justify-center text-4xl", tmpl.color)}>
                    {tmpl.label.split(" ")[0]}
                  </div>
                  <p className="font-bold text-sm" style={{ fontFamily: "Syne" }}>{tmpl.label}</p>
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1">
                    <Download className="h-3 w-3" /> Generate
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
