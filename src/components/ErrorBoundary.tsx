import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
// wave-18 (2026-06-04): replaced shadcn <Button> with native <button>. Button
// imports @radix-ui/react-slot for asChild — that single edge dragged the
// entire vendor-radix slice (TooltipProvider, popper transitive graph, etc.)
// onto every cold landing visit because ErrorBoundary is the App.tsx root wrap.
// The error UI fires <1/1000 sessions; styling stays Tailwind-only.

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const MAX_RETRIES = 2;

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    retryCount: 0,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // Fire-and-forget error logging
    this.logErrorToDb(error, errorInfo);

    // Auto-retry up to MAX_RETRIES
    if (this.state.retryCount < MAX_RETRIES) {
      setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
        }));
      }, 500 * (this.state.retryCount + 1));
    }
  }

  private async logErrorToDb(error: Error, errorInfo: ErrorInfo) {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("error_logs" as any).insert({
        user_id: user?.id || null,
        error_message: error.message?.slice(0, 2000) || "Unknown error",
        component_stack: errorInfo.componentStack?.slice(0, 4000) || null,
        url: window.location.href,
      });
    } catch { // empty-catch-allow:error-boundary-report
      // Silent
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                Something went wrong
              </h1>
              <p className="text-muted-foreground">
                We encountered an unexpected error. Please try refreshing the page.
              </p>
            </div>

            {import.meta.env.DEV && this.state.error && (
              <div className="bg-muted/50 rounded-lg p-4 text-left">
                <p className="text-sm font-mono text-destructive break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Page
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
              >
                Go to Home
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              APEX Financial • If this issue persists, contact support
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
