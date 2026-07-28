import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await login(username, password);
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Invalid username or password");
      toast.error(res.error ?? "Invalid username or password");
      return;
    }
    toast.success("Welcome back!");
  }
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[image:var(--gradient-surface)] px-4 py-10">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-primary-foreground shadow-[var(--shadow-brand)]">
            <img src="/logo.jpg" alt="MDC Logo" className="h-full w-full object-cover" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            Mewar Distribution Centre
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to verify dispatches</p>
        </div>
        <form onSubmit={onSubmit} className="surface-card space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              placeholder="Enter username"
              onChange={(e) => setUsername(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              placeholder="Enter password"
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
            />
          </div>
          {error ? (
            <p className="animate-fade-in rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="hero" size="lg" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
