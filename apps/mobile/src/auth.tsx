import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, clearTokens, getAccessToken, saveTokens } from "./api";

export interface Me {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  memberships: {
    communityId: string;
    status: string;
    community: { name: string; defaultCurrency: string };
  }[];
  driverProfile: {
    id: string;
    verificationStatus: string;
    isOnline: boolean;
  } | null;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse {
  user: { id: string };
  tokens: { accessToken: string; refreshToken: string } | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      if (!(await getAccessToken())) {
        setMe(null);
        return;
      }
      setMe(await api<Me>("/v1/users/me"));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const login = useCallback(
    async (email: string, password: string): Promise<Me> => {
      const res = await api<LoginResponse>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.tokens) throw new Error("No tokens issued");
      await saveTokens(res.tokens.accessToken, res.tokens.refreshToken);
      const profile = await api<Me>("/v1/users/me");
      setMe(profile);
      return profile;
    },
    [],
  );

  const logout = useCallback(async () => {
    await clearTokens();
    setMe(null);
  }, []);

  const value = useMemo(
    () => ({ me, loading, login, logout, reload }),
    [me, loading, login, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
