import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AuthContext, type AuthContextValue, type AuthUser } from "./auth-context";

interface ApiErrorResponse {
  error?: {
    message?: string;
    details?: Array<{ message: string }>;
  };
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | ApiErrorResponse
      | null;
    const validationMessage = body?.error?.details?.[0]?.message;
    throw new Error(
      validationMessage ?? body?.error?.message ?? "The request could not be completed.",
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<{ user: AuthUser }>("/api/auth/me")
      .then(({ user: currentUser }) => {
        if (active) setUser(currentUser);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof Error && error.message !== "Sign in to continue.") {
          setSessionError(error.message);
        }
        setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      sessionError,
      async login(email, password) {
        const result = await apiRequest<{ user: AuthUser }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setUser(result.user);
        setSessionError(null);
      },
      async register(email, displayName, password) {
        const result = await apiRequest<{ user: AuthUser }>(
          "/api/auth/register",
          {
            method: "POST",
            body: JSON.stringify({ email, displayName, password }),
          },
        );
        setUser(result.user);
        setSessionError(null);
      },
      async logout() {
        await apiRequest<void>("/api/auth/logout", { method: "POST" });
        setUser(null);
      },
    }),
    [user, loading, sessionError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
