import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  children: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  retryCount: number;
  error: Error | null;
}

const MAX_RETRIES = 2;

/**
 * Section-level error boundary with auto-retry.
 * Wraps individual sections so one crash doesn't take down the whole page.
 */
export class ComponentErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    retryCount: 0,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ComponentErrorBoundary:${this.props.name || "unknown"}]`, error, errorInfo);

    // Fire-and-forget error log to database
    this.logErrorToDb(error, errorInfo);

    // Auto-retry up to MAX_RETRIES
    if (this.state.retryCount < MAX_RETRIES) {
      setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
        }));
      }, 500 * (this.state.retryCount + 1)); // backoff: 500ms, 1000ms
    }
  }

  private async logErrorToDb(error: Error, errorInfo: ErrorInfo) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("error_logs" as any).insert({
        user_id: user?.id || null,
        error_message: error.message?.slice(0, 2000) || "Unknown error",
        component_stack: errorInfo.componentStack?.slice(0, 4000) || null,
        url: window.location.href,
      });
    } catch {
      // Silent — never block UI
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, retryCount: 0 });
  };

  public render() {
    if (this.state.hasError && this.state.retryCount >= MAX_RETRIES) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center gap-3 min-h-[120px]">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <p className="text-sm text-muted-foreground">
            This section encountered an error
          </p>
          <Button size="sm" variant="outline" onClick={this.handleRetry} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
