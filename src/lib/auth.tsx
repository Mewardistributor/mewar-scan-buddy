import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase, type AppUser } from "./supabase";

type AuthState = {
  user: AppUser | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);
const STORAGE_KEY = "mdc.user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw) as AppUser);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      login: async (username: string, password: string) => {
        const u = username.trim();
        const p = password.trim();
        if (!u || !p) return { ok: false, error: "Please enter username and password" };
        const { data, error } = await supabase
          .from("users")
          .select("id, username, role, password, driver_id")
          .eq("username", u)
          .limit(50);
        if (error) return { ok: false, error: error.message };
        const match = (data ?? []).find(
          (row) => String(row.username) === u && String(row.password) === p,
        );
        if (!match) return { ok: false, error: "Invalid username or password" };
        const role: AppUser["role"] =
          match.role === "admin" ? "admin" : match.role === "driver" ? "driver" : "uploader";
        const appUser: AppUser = {
          id: String(match.id),
          username: String(match.username),
          role,
          driver_id: match.driver_id ? String(match.driver_id) : null,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appUser));
        setUser(appUser);
        return { ok: true };
      },
      logout: () => {
        window.localStorage.removeItem(STORAGE_KEY);
        setUser(null);
      },
    }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
