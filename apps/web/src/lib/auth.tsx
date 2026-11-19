import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken } from "@/lib/api";

export interface Me {
  user: { id: string; displayName: string; role: string; signatory: boolean };
  tenant: { id: string; name: string; edition: string; marketCode: string; currency: string; vatRatePercent: number };
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
  logout: () => void;
  can: (p: string) => boolean;
  flagOn: (k: string) => boolean;
}
const C = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(getToken());
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me", token], queryFn: () => api<Me>("/auth/me"), enabled: Boolean(token), staleTime: 30_000, retry: false });
  const login = useCallback((t: string) => {
    setToken(t);
    setTok(t);
    void qc.invalidateQueries();
  }, [qc]);
  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    qc.clear();
  }, [qc]);
  useEffect(() => {
    const h = () => setTok(null);
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
