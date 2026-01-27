import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Download, Smartphone, Check, Share, Plus, MoreVertical, Crown } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function Install() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Detect iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    // Detect Android
    const android = /Android/.test(navigator.userAgent);
    setIsAndroid(android);

    // Listen for install prompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // Listen for app installed
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className="glass border-border">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg">
                <Crown className="w-10 h-10 text-primary-foreground" />
              </div>
            </div>
            <CardTitle className="text-2xl gradient-text">APEX Numbers</CardTitle>
            <CardDescription>
              Install the app for the best experience
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {isInstalled ? (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
                  <Check className="w-8 h-8 text-primary" />
                </div>
                <p className="text-muted-foreground">
                  App is already installed! Open it from your home screen.
                </p>
                <Link to="/agent-portal">
                  <Button className="w-full">
                    Go to Portal
                  </Button>
                </Link>
              </div>
            ) : deferredPrompt ? (
              // Android/Chrome install prompt available
              <div className="space-y-4">
                <Button onClick={handleInstall} className="w-full gap-2" size="lg">
                  <Download className="w-5 h-5" />
                  Install App
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  One tap to add to your home screen
                </p>
              </div>
            ) : isIOS ? (
              // iOS instructions
              <div className="space-y-4">
                <div className="text-center mb-4">
                  <Smartphone className="w-12 h-12 mx-auto text-primary mb-2" />
                  <p className="font-medium">Install on iPhone/iPad</p>
                </div>
                
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Share className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">1. Tap Share</p>
                      <p className="text-muted-foreground">
                        Tap the share button at the bottom of Safari
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Plus className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">2. Add to Home Screen</p>
                      <p className="text-muted-foreground">
                        Scroll down and tap "Add to Home Screen"
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">3. Confirm</p>
                      <p className="text-muted-foreground">
                        Tap "Add" in the top right corner
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : isAndroid ? (
              // Android Chrome menu instructions
              <div className="space-y-4">
                <div className="text-center mb-4">
                  <Smartphone className="w-12 h-12 mx-auto text-primary mb-2" />
                  <p className="font-medium">Install on Android</p>
                </div>
                
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <MoreVertical className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">1. Open Menu</p>
                      <p className="text-muted-foreground">
                        Tap the three dots in Chrome's top right
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Download className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">2. Install App</p>
                      <p className="text-muted-foreground">
                        Tap "Install app" or "Add to Home Screen"
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">3. Confirm</p>
                      <p className="text-muted-foreground">
                        Tap "Install" to add the app
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // Desktop/unknown browser
              <div className="text-center space-y-4">
                <Smartphone className="w-12 h-12 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">
                  Visit this page on your mobile device to install the app
                </p>
                <Link to="/agent-portal">
                  <Button variant="outline" className="w-full">
                    Continue to Portal
                  </Button>
                </Link>
              </div>
            )}

            {!isInstalled && (
              <div className="pt-4 border-t border-border">
                <Link to="/agent-portal">
                  <Button variant="ghost" className="w-full text-muted-foreground">
                    Skip for now
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Works offline • Fast loading • Home screen access
        </p>
      </motion.div>
    </div>
  );
}
