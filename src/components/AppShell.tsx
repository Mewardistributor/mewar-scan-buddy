import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/Header";
import { Login } from "@/components/Login";
import { Splash } from "@/components/Splash";

let splashShown = false;

function splashAlreadyShown() {
  if (splashShown) return true;
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem("mdc_splash_shown") === "1";
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const [splashDone, setSplashDone] = useState(splashAlreadyShown);


  if (!splashDone) {
    return (
      <Splash
        onDone={() => {
          splashShown = true;
          window.sessionStorage.setItem("mdc_splash_shown", "1");

          setSplashDone(true);
        }}
      />
    );
  }

  if (!ready) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[image:var(--gradient-surface)]">
      <Header />
      <main key={typeof window === "undefined" ? "ssr" : window.location.pathname} className="mx-auto w-full max-w-6xl flex-1 animate-fade-up px-4 py-6 pb-20">
        {children}
      </main>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary">
        {icon}
      </span>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
