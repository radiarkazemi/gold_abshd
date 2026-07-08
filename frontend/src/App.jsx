import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import TraderPage from "./pages/TraderPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import MyOrdersPage from "./pages/MyOrdersPage";
import "./components/PriceButton.css";
import "./components/OrderModal.css";
import "./pages/AdminPage.css";
import "./pages/LoginPage.css";
import "./pages/MyOrdersPage.css";
import "./App.css";

// This path can now stay as-is or be simplified - the admin panel is
// protected by real username/password login, not just URL obscurity.
const ADMIN_PATH = "/admin-hs-panel";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">در حال بارگذاری…</div>;
  return user ? children : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Protected><TraderPage /></Protected>} />
          <Route path="/my-orders" element={<Protected><MyOrdersPage /></Protected>} />
          <Route path={ADMIN_PATH} element={<AdminPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}