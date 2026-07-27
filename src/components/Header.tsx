import { Link } from "@tanstack/react-router";
import { LogOut, PackageCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-[image:var(--gradient-brand)] text-primary-foreground shadow-[var(--shadow-brand)]">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link to="/" className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[image:var(--gradient-gold)] text-accent-foreground shadow-[var(--shadow-gold)]">
            <PackageCheck className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-base font-semibold leading-tight sm:text-lg">
              Mewar Distribution Centre
            </span>
            <span className="block truncate text-[11px] uppercase tracking-[0.18em] opacity-75">
              Dispatch Verification
            </span>
          </span>
        </Link>

        {user ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-right text-xs leading-tight sm:block">
              <span className="block font-semibold">{user.username}</span>
              <span className="block capitalize opacity-75">{user.role}</span>
            </span>
            <Button
              size="sm"
              variant="gold"
              onClick={logout}
              aria-label="Log out"
              className="rounded-full"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
