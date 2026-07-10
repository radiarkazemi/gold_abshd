import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import TraderPage from "./pages/TraderPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import MyOrdersPage from "./pages/MyOrdersPage";
import BalancePage from "./pages/BalancePage";
import PlaceholderPage from "./pages/PlaceholderPage";
import "./components/PriceButton.css";
import "./components/OrderModal.css";
import "./components/SideMenu.css";
import "./components/NoticeCard.css";
import "./components/RecentOrdersTable.css";
import "./components/BottomTabBar.css";
import "./components/BalanceStrip.css";
import "./pages/AdminPage.css";
import "./components/AdminShell.css";
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
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Protected><TraderPage /></Protected>} />
            <Route path="/my-orders" element={<Protected><MyOrdersPage /></Protected>} />
            <Route path="/balance" element={<Protected><BalancePage /></Protected>} />
            <Route path="/kyc" element={<Protected><PlaceholderPage title="احراز هویت" /></Protected>} />
            <Route path="/upload-receipt" element={<Protected><PlaceholderPage title="ارسال فیش واریز" /></Protected>} />
            <Route path="/register-transfer" element={<Protected><PlaceholderPage title="ثبت حواله" /></Protected>} />
            <Route path="/terms" element={<Protected><PlaceholderPage title="شرایط و قوانین" /></Protected>} />
            <Route path="/about" element={<Protected><PlaceholderPage title="درباره ما" /></Protected>} />
            <Route path={ADMIN_PATH} element={<AdminPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}