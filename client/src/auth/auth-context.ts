import { createContext, useContext } from "react";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  sessionError: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    displayName: string,
    password: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
