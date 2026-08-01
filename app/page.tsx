"use client";

import { Suspense, useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signInWithGoogle } from "@/lib/oauth";
import { ErrorBanner } from "./components/ErrorBanner";
import { StaticBMC } from "./components/StaticBMC";

/* ================================================================
   Mouse-following ambient glow (candlelight metaphor)
   ================================================================ */
function MouseGlow() {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    let raf = 0;
    let mx = 0;
    let my = 0;
    let cx = 0;
    let cy = 0;

    const handleMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    const tick = () => {
      cx += (mx - cx) * 0.06;
      cy += (my - cy) * 0.06;
      if (glowRef.current) {
        glowRef.current.style.setProperty("--mg-x", `${cx}px`);
        glowRef.current.style.setProperty("--mg-y", `${cy}px`);
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", handleMove);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={glowRef}
      className="pointer-events-none fixed inset-0 z-[2]"
      style={{
        background:
          "radial-gradient(600px circle at var(--mg-x) var(--mg-y), rgba(var(--primary-rgb),0.08), transparent 60%)",
      }}
    />
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="currentColor"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="currentColor"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="currentColor"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="currentColor"
      />
    </svg>
  );
}

/* ================================================================
   TopNav: honest, minimal, scroll-aware
   ================================================================ */
function TopNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-background/80 backdrop-blur-md border-b border-border"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          {/* Logo mark: wax seal stamp */}
          <div className="relative w-8 h-8 shrink-0 text-primary">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-primary">
              <path
                d="M16 2.2c1.8-.1 3.6.4 5.1 1.2 1.4.7 2.6 1.8 3.6 3.1.9 1.2 1.5 2.6 1.8 4.1.3 1.5.2 3-.2 4.4-.4 1.5-1.1 2.8-2.1 3.9-1 1.2-2.3 2.1-3.7 2.7-1.6.7-3.3 1-5 1-1.7 0-3.4-.4-4.9-1.2-1.3-.7-2.5-1.7-3.4-2.9-.9-1.2-1.5-2.6-1.8-4.1-.3-1.5-.2-3 .2-4.4.4-1.4 1.1-2.7 2-3.8 1-1.2 2.2-2.1 3.6-2.8 1.3-.6 2.7-1 4.2-1.1.2 0 .4 0 .6-.1z"
                fill="currentColor"
                fillOpacity="0.1"
                stroke="currentColor"
                strokeOpacity="0.4"
                strokeWidth="1"
              />
              <path
                d="M16 5.8c1.4-.1 2.8.3 4 1 1.1.6 2 1.5 2.7 2.6.6 1 .9 2.1.9 3.3 0 1.2-.3 2.3-.9 3.3-.7 1-1.6 1.8-2.7 2.4-1.2.6-2.6 1-4 1-1.4 0-2.8-.3-4-1-1.1-.6-2-1.4-2.6-2.4-.6-1-.9-2.1-.9-3.3 0-1.2.3-2.3.8-3.3.6-1.1 1.5-2 2.6-2.6 1.2-.7 2.6-1.1 4.1-1z"
                stroke="currentColor"
                strokeOpacity="0.25"
                strokeWidth="0.75"
                fill="none"
              />
              <text
                x="16"
                y="21.5"
                textAnchor="middle"
                fontSize="13.5"
                fontWeight="400"
                fill="currentColor"
                fillOpacity="0.85"
                style={{
                  fontFamily: "var(--font-display), Georgia, serif",
                  letterSpacing: "-0.02em",
                }}
              >
                R
              </text>
            </svg>
          </div>
          <span className="font-display text-lg tracking-tight text-foreground">
            RocketMap
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-foreground-muted">
          <a
            href="#how-it-works"
            className="nav-link-delve relative hover:text-foreground transition-colors duration-300"
          >
            How it works
          </a>
          <a
            href="#demo"
            className="nav-link-delve relative hover:text-foreground transition-colors duration-300"
          >
            Demo
          </a>
          <a
            href="#workflow"
            className="nav-link-delve relative hover:text-foreground transition-colors duration-300"
          >
            Workflow
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={() => signInWithGoogle()}
            className="text-sm font-medium text-foreground-muted hover:text-foreground transition-colors hidden sm:block"
          >
            Log in
          </button>
          <button
            onClick={() => signInWithGoogle()}
            className="ui-btn ui-btn-primary !h-9 !px-4 text-sm border border-primary/30 hover:border-primary/50 transition-all active:translate-y-[1px] active:shadow-none"
          >
            Get Started
          </button>
        </div>
      </div>
    </header>
  );
}

type ChapterProps = {
  eyebrow: string;
  title: string;
  detail: string;
  children: ReactNode;
  reverse?: boolean;
};

function ProductChapter({ eyebrow, title, detail, children, reverse = false }: ChapterProps) {
  return (
    <section className="w-full max-w-[1200px] px-4 sm:px-6 md:px-8 py-16 md:py-28">
      <div className={`grid items-center gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16 ${reverse ? "lg:grid-cols-[1.25fr_0.75fr]" : ""}`}>
        <div className={`space-y-5 ${reverse ? "lg:order-2" : ""}`}>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-primary-deep">
            {eyebrow}
          </span>
          <h2 className="font-display text-4xl md:text-5xl leading-[1.03] text-foreground">
            {title}
          </h2>
          <p className="max-w-md font-body text-lg leading-relaxed text-foreground-muted">
            {detail}
          </p>
        </div>
        <div className={reverse ? "lg:order-1" : ""}>{children}</div>
      </div>
    </section>
  );
}

function ContradictionPreview() {
  return (
    <div className="rounded-[14px] border border-border bg-canvas-surface p-5 shadow-[0_16px_40px_rgba(var(--ink-shadow),0.08)]">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-foreground-muted">Consistency check</span>
        <span className="rounded-full bg-state-critical/10 px-2 py-1 font-mono text-[10px] text-state-critical">1 conflict</span>
      </div>
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 mt-5">
        <div className="bg-canvas-surface p-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-foreground-muted">Revenue model</span>
          <p className="mt-3 text-sm font-medium text-foreground">Enterprise annual contracts</p>
        </div>
        <div className="bg-canvas-surface p-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-foreground-muted">Primary channel</span>
          <p className="mt-3 text-sm font-medium text-foreground">Self-serve acquisition</p>
        </div>
      </div>
      <div className="mt-5 rounded-lg bg-state-critical/8 p-4">
        <p className="font-display text-xl text-foreground">These decisions pull in opposite directions.</p>
        <p className="mt-1 text-sm text-foreground-muted">Choose sales-led, self-serve, or a deliberate hybrid.</p>
      </div>
    </div>
  );
}

function SprintPreview() {
  const tasks = [
    ["01", "Interview 5 buyers about procurement", "High"],
    ["02", "Test willingness to pay at $12k/year", "High"],
    ["03", "Document a self-serve conversion path", "Medium"],
  ];
  return (
    <div className="rounded-[14px] border border-border bg-canvas-surface p-5 shadow-[0_16px_40px_rgba(var(--ink-shadow),0.08)]">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-foreground-muted">Validation sprint</span>
        <span className="font-mono text-[10px] text-state-warning">3 OPEN</span>
      </div>
      <div className="divide-y divide-border">
        {tasks.map(([number, task, priority]) => (
          <div key={number} className="flex items-center gap-4 py-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-foreground-muted">{number}</span>
            <p className="flex-1 text-sm font-medium leading-relaxed text-foreground">{task}</p>
            <span className={`font-mono text-[10px] uppercase ${priority === "High" ? "text-state-critical" : "text-state-warning"}`}>{priority}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-4 text-sm text-foreground-muted">
        <span className="h-2 w-2 rounded-full bg-state-ai" />
        Prioritized by risk, not by a generic checklist.
      </div>
    </div>
  );
}

/* ================================================================
   DELIGHT: Final CTA — dramatic closing moment
   ================================================================ */
function FinalCTA() {
  return (
    <section id="workflow" className="w-full relative py-20 md:py-24 px-6 overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(var(--primary-rgb),0.12),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_80%,rgba(var(--primary-rgb),0.08),transparent_60%)]" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto text-center space-y-8">
        <h2 className="font-display text-4xl sm:text-5xl md:text-6xl text-foreground leading-[1.1]">
          Build the model.
          <br />
          Test the weak point.
        </h2>
        <p className="text-lg sm:text-xl text-foreground-muted font-body max-w-2xl mx-auto leading-relaxed">
          Your next decision deserves more than a blank canvas.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <div className="cta-glow">
            <button
              onClick={() => signInWithGoogle()}
              className="ui-btn ui-btn-primary !h-12 !px-8 text-base w-full sm:w-auto font-medium shadow-[0_0_20px_rgba(var(--primary-rgb),0.25)] hover:shadow-[0_0_35px_rgba(var(--primary-rgb),0.4)] transition-all border border-primary/30 hover:border-primary/50 active:translate-y-[1px] active:shadow-none"
            >
              <GoogleIcon />
              <span className="ml-2">Start your free canvas</span>
            </button>
          </div>
          <a
            href="#how-it-works"
            className="ui-btn ui-btn-secondary !h-12 !px-8 text-base w-full sm:w-auto active:translate-y-[1px]"
          >
            See how it works
          </a>
        </div>

        <p className="text-xs text-foreground-muted font-mono tracking-wide opacity-80 pt-2">
          Free forever plan. No credit card required.
        </p>
      </div>
    </section>
  );
}

/* ================================================================
   DELIGHT: Minimal footer with craft
   ================================================================ */
function Footer() {
  return (
    <footer className="w-full border-t border-border bg-background/50 backdrop-blur-sm">
      <div className="max-w-[1200px] mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="text-primary">
            <path
              d="M16 2.2c1.8-.1 3.6.4 5.1 1.2 1.4.7 2.6 1.8 3.6 3.1.9 1.2 1.5 2.6 1.8 4.1.3 1.5.2 3-.2 4.4-.4 1.5-1.1 2.8-2.1 3.9-1 1.2-2.3 2.1-3.7 2.7-1.6.7-3.3 1-5 1-1.7 0-3.4-.4-4.9-1.2-1.3-.7-2.5-1.7-3.4-2.9-.9-1.2-1.5-2.6-1.8-4.1-.3-1.5-.2-3 .2-4.4.4-1.4 1.1-2.7 2-3.8 1-1.2 2.2-2.1 3.6-2.8 1.3-.6 2.7-1 4.2-1.1.2 0 .4 0 .6-.1z"
              fill="currentColor"
              fillOpacity="0.1"
              stroke="currentColor"
              strokeOpacity="0.4"
              strokeWidth="1"
            />
            <path
              d="M16 5.8c1.4-.1 2.8.3 4 1 1.1.6 2 1.5 2.7 2.6.6 1 .9 2.1.9 3.3 0 1.2-.3 2.3-.9 3.3-.7 1-1.6 1.8-2.7 2.4-1.2.6-2.6 1-4 1-1.4 0-2.8-.3-4-1-1.1-.6-2-1.4-2.6-2.4-.6-1-.9-2.1-.9-3.3 0-1.2.3-2.3.8-3.3.6-1.1 1.5-2 2.6-2.6 1.2-.7 2.6-1.1 4.1-1z"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="0.75"
              fill="none"
            />
            <text
              x="16"
              y="21.5"
              textAnchor="middle"
              fontSize="13.5"
              fontWeight="400"
              fill="currentColor"
              fillOpacity="0.85"
              style={{
                fontFamily: "var(--font-display), Georgia, serif",
                letterSpacing: "-0.02em",
              }}
            >
              R
            </text>
          </svg>
          <span className="font-display text-sm text-foreground/80">
            RocketMap
          </span>
        </div>

        <div className="flex items-center gap-8 text-sm text-foreground-muted/60">
          <a href="#" className="hover:text-foreground-muted transition-colors">
            Privacy
          </a>
          <a href="#" className="hover:text-foreground-muted transition-colors">
            Terms
          </a>
        </div>

        <p className="text-xs text-foreground-muted/40 font-mono">
          &copy; {new Date().getFullYear()} RocketMap
        </p>
      </div>
    </footer>
  );
}

/* ================================================================
   Main Landing Content
   ================================================================ */
function LandingContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="min-h-screen relative flex flex-col items-center bg-background text-foreground overflow-hidden">
      {/* Background layers */}
      <div className="landing-glow" />
      <div className="landing-grid absolute inset-0 opacity-40 pointer-events-none" />
      <div className="landing-noise" />
      <MouseGlow />

      <TopNav />

      <main className="flex-1 w-full flex flex-col items-center z-10">
        <ErrorBanner error={error} />

        {/* Hero */}
        <section className="w-full max-w-[1200px] px-4 sm:px-6 pt-24 md:pt-28 pb-6 md:pb-10">
          <div className="max-w-4xl mx-auto text-center">
            <div className="relative space-y-4 md:space-y-5">
              <div className="landing-title-glow" />
              <h1 className="landing-title stagger-in stagger-2 text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.1] tracking-tight mx-auto max-w-4xl">
                Find the assumption that breaks your business model.
              </h1>
              <p className="stagger-in stagger-3 text-base sm:text-lg md:text-xl text-foreground-muted font-body max-w-2xl mx-auto leading-relaxed">
                Map the business. Let RocketMap find the contradiction. Test what matters next.
              </p>
            </div>

            <div className="stagger-in stagger-4 flex flex-col sm:flex-row items-center justify-center gap-3 pt-5 md:pt-6">
              <div className="cta-glow w-full sm:w-auto">
                <button
                  onClick={() => signInWithGoogle()}
                  className="ui-btn ui-btn-primary !h-12 !px-7 text-base w-full sm:w-auto font-medium shadow-[0_0_20px_rgba(var(--primary-rgb),0.25)] hover:shadow-[0_0_35px_rgba(var(--primary-rgb),0.4)] transition-all border border-primary/30 hover:border-primary/50 active:translate-y-[1px] active:shadow-none"
                >
                  <GoogleIcon />
                  <span className="ml-2">Continue with Google</span>
                </button>
              </div>
              <a
                href="#demo"
                className="ui-btn ui-btn-secondary !h-12 !px-7 text-base w-full sm:w-auto active:translate-y-[1px]"
              >
                See the demo
              </a>
            </div>

            <p className="stagger-in stagger-5 text-xs text-foreground-muted font-mono tracking-wide opacity-80 pt-3">
              Free forever plan. No credit card required.
            </p>
          </div>
        </section>

        {/* Product proof */}
        <section id="demo" className="w-full max-w-[1200px] px-4 sm:px-6 md:px-8 pb-16 md:pb-20">
          <div className="text-center space-y-3 mb-6 md:mb-8">
            <span className="inline-block font-mono text-[11px] uppercase tracking-[0.12em] text-foreground-muted/60">
              Start with the whole model
            </span>
            <h2 className="font-display text-2xl sm:text-3xl md:text-4xl text-foreground">
              One canvas, not nine disconnected boxes.
            </h2>
          </div>

          <div className="landing-canvas-preview">
            <StaticBMC />
          </div>
        </section>

        <div id="how-it-works">
          <ProductChapter
            eyebrow="Then read across it"
            title="See where your story does not add up."
            detail="RocketMap checks the decisions inside your model against one another, then names the tradeoff."
          >
            <ContradictionPreview />
          </ProductChapter>

          <ProductChapter
            eyebrow="Turn doubt into work"
            title="Leave with the next proof point."
            detail="Each conflict becomes a focused validation sprint, so you know what to learn before you build."
            reverse
          >
            <SprintPreview />
          </ProductChapter>
        </div>

        {/* Final CTA */}
        <FinalCTA />
      </main>

      <Footer />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <LandingContent />
    </Suspense>
  );
}
