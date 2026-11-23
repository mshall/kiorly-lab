import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken } from "@/lib/api";
import { takeEndSessionUrl } from "@/lib/passport";
import { rememberSignInOrg } from "@/lib/sign-in-default";

export interface Me {
  user: { id: string; displayName: string; role: string; signatory: boolean };
  tenant: { id: string; name: string; edition: string; marketCode: string; currency: string; vatRatePercent: number; integrationMode?: "STANDALONE" | "INTEGRATED"; defaultLocale?: string };
  labs: { id: string; name: string; code: string }[];
  permissions: string[];
  flags: Record<string, { enabled: boolean; scope?: string }>;
  capabilities: string[];
}

interface Ctx {
  token: string | null;
  me: Me | undefined;
  loading: boolean;
  login: (t: string) => void;
  /** Clears the app session; returns true when the browser is being sent to end the Kiorex Passport session too. */
  logout: () => boolean;
  can: (p: string) => boolean;
  flagOn: (k: string) => boolean;
}
const C = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(getToken());
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me", token], queryFn: () => api<Me>("/auth/me"), enabled: Boolean(token), staleTime: 30_000, retry: false, refetchInterval: 60_000 }); // re-checked every minute: a session Passport ended (back-channel logout) or a deactivated account leaves within a minute even when idle
  // the next visit to the login page asks the API for THIS organisation's default sign-in method
  const orgId = q.data?.tenant.id;
  useEffect(() => { rememberSignInOrg(orgId); }, [orgId]);
  const login = useCallback((t: string) => {
    setToken(t);
    setTok(t);
    void qc.invalidateQueries();
  }, [qc]);
  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    qc.clear();
    // Passport-started session: end the Passport session too (RP-initiated logout with id_token_hint), otherwise "Sign in with Kiorex Passport" would silently sign the user back in
    const end = takeEndSessionUrl();
    if (end) window.location.assign(end);
    return Boolean(end);
  }, [qc]);
  useEffect(() => {
    const h = () => { setTok(null); takeEndSessionUrl(); };
    window.addEventListener("kiorly:logout", h);
    return () => window.removeEventListener("kiorly:logout", h);
  }, []);
  const value = useMemo<Ctx>(
    () => ({ token, me: q.data, loading: Boolean(token) && q.isLoading, login, logout, can: (p) => q.data?.permissions.includes(p) ?? false, flagOn: (k) => q.data?.flags[k]?.enabled ?? true }),
    [token, q.data, q.isLoading, login, logout],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("AuthProvider missing");
  return c;
}
