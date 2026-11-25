import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { HeroSection } from "@/components/landing/HeroSection";
import { setRefSlug } from "@/lib/refSlug";

const Index = () => {
  const { user, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const urlRefSlug = searchParams.get("ref");

  // Preserve the validated 24-hour referral before a CTA or auth redirect.
  useEffect(() => {
    if (urlRefSlug) setRefSlug(urlRefSlug);
  }, [urlRefSlug]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Galaxy Financial · Build Your Insurance Career";
    const description = "Choose your path with Galaxy Financial. Explore carrier access, training, and support for licensed producers and future agents.";
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = meta?.content;
    if (meta) meta.content = description;
    return () => {
      document.title = previousTitle;
      if (meta && previousDescription !== undefined) meta.content = previousDescription;
    };
  }, []);

  if (!isLoading && user) return <Navigate to="/dashboard" replace />;
  return (
    <div className="min-h-screen overflow-x-hidden w-full max-w-full relative bg-[#0A0A0A]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      >
        Skip to main content
      </a>
      <main id="main-content" tabIndex={-1}>
        <HeroSection />
      </main>
    </div>
  );
};

export default Index;
