import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import TraderPage from "./pages/TraderPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import MyOrdersPage from "./pages/MyOrdersPage";
import BalancePage from "./pages/BalancePage";
import KycPage from "./pages/KycPage";
import UploadReceiptPage from "./pages/UploadReceiptPage";
import RegisterTransferPage from "./pages/RegisterTransferPage";
import TermsPage from "./pages/TermsPage";
import AboutPage from "./pages/AboutPage";
import "./components/PriceButton.css";
import "./components/OrderModal.css";
import "./components/SideMenu.css";
import "./components/NoticeCard.css";
import "./components/NoticeModal.css";
import "./components/RecentOrdersTable.css";
import "./components/JalaliDateInput.css";
import "./components/RefreshBar.css";
import "./components/BottomTabBar.css";
import "./components/BalanceStrip.css";
import "./pages/AdminPage.css";
import "./components/AdminShell.css";
import "./pages/LoginPage.css";
import "./pages/MyOrdersPage.css";
import "./pages/ClientForms.css";
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
            <Route path="/kyc" element={<Protected><KycPage /></Protected>} />
            <Route path="/upload-receipt" element={<Protected><UploadReceiptPage /></Protected>} />
            <Route path="/register-transfer" element={<Protected><RegisterTransferPage /></Protected>} />
            <Route path="/terms" element={<Protected><TermsPage /></Protected>} />
            <Route path="/about" element={<Protected><AboutPage /></Protected>} />
            <Route path={ADMIN_PATH} element={<AdminPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}