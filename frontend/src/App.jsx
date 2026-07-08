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

// NOTE: this is a hidden path, not real authentication.
// Anyone who has this exact URL can open the admin panel.
// Admin login is a separate, later step.
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