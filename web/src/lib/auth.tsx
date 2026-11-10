import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  needsSetup: boolean;
  mailConfigured: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [mailConfigured, setMail] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<{ needsSetup: boolean; user: User | null; mailConfigured: boolean }>("/auth/status");
      setUser(s.user);
      setNeedsSetup(s.needsSetup);
      setMail(s.mailConfigured);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    setUser(null);
  }, []);

  useEffect(() => {
    refresh();
    const onUnauth = () => setUser(null);
    window.addEventListener("autoreca:unauthorized", onUnauth);
    return () => window.removeEventListener("autoreca:unauthorized", onUnauth);
  }, [refresh]);

  return <Ctx.Provider value={{ user, loading, needsSetup, mailConfigured, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fuera de AuthProvider");
  return c;
}
