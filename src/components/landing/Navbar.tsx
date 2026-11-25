// intentionally-orphan: Retained Galaxy content after the owner chose a two-choice-only homepage; not rendered on the current home.
import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Menu } from "lucide-react";
import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";

const NAV_LINKS = [
  { href: "#agency-system", label: "Platform" },
  { href: "#benefits", label: "Capabilities" },
  { href: "#earnings", label: "Growth Paths" },
  { href: "#career", label: "Roadmap" },
];

/** Keep the opening focused on license selection; details remain one tap away. */
export function Navbar() {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [searchParams] = useSearchParams();
  const applyHref = buildPublicRecruitingHref("/apply", searchParams);

  return (
    <nav aria-label="Main navigation" className="relative z-40 border-y border-white/10 bg-black text-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <details ref={menuRef} className="relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-semibold text-white/70 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
            <Menu className="h-4 w-4" aria-hidden="true" />
            Explore Galaxy
          </summary>
          <div className="absolute left-0 top-full mt-2 w-60 rounded-lg border border-white/15 bg-black p-2 shadow-xl">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                onClick={(event) => {
                  const section = document.querySelector(link.href);
                  if (menuRef.current) menuRef.current.open = false;
                  if (!section) return;
                  event.preventDefault();
                  section.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                  });
                }}
              >
                {link.label}
              </a>
            ))}
            <Link
              to={applyHref}
              className="mt-2 flex min-h-11 items-center rounded-md border-t border-white/15 px-3 text-sm font-semibold text-primary hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Start an application
            </Link>
          </div>
        </details>
        <Link
          to="/login"
          className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-white/70 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          Agent login
        </Link>
      </div>
    </nav>
  );
}
