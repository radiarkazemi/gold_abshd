import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import TraderPage from "./pages/TraderPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import "./components/PriceButton.css";
import "./components/OrderModal.css";
import "./pages/AdminPage.css";
import "./pages/LoginPage.css";
import "./App.css";

// NOTE: this is a hidden path, not real authentication.
// Anyone who has this exact URL can open the admin panel.
// Admin login is a separate, later step.
const ADMIN_PATH = "/admin-hs-panel";

function Gate() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="app-loading">در حال بارگذاری…</div>;
  }

  return user ? <TraderPage /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Gate />} />
          <Route path={ADMIN_PATH} element={<AdminPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}