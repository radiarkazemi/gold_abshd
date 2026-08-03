import { createContext, useContext, useEffect, useState } from "react";
import { getToken, setToken, clearToken, fetchMe } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe()
      .then(setUser)
      .catch((err) => {
        // Only clear the session on real auth failures — not network blips
        // ("Failed to fetch"), which would otherwise kick users to login.
        const msg = String(err?.message || "");
        const isNetwork =
          err?.name === "TypeError" ||
          /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
        if (!isNetwork) {
          clearToken();
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  function login(token, userData) {
    setToken(token);
    setUser(userData);
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}