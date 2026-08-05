import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import ReygiriLinksPage from "./pages/ReygiriLinksPage";
import NoticeModal from "./components/NoticeModal";
import UpdatePrompt from "./components/UpdatePrompt";
import StagingBanner from "./components/StagingBanner";
import "./components/PriceButton.css";
import "./components/OrderModal.css";
import "./components/SideMenu.css";
import "./components/NoticeCard.css";
import "./components/NoticeModal.css";
import "./components/TermsAcceptModal.css";
import "./components/RecentOrdersTable.css";
import "./components/JalaliDateInput.css";
import "./components/RefreshBar.css";
import "./components/BottomTabBar.css";
import "./components/BalanceStrip.css";
import "./components/UpdatePrompt.css";
import "./pages/AdminPage.css";
import "./components/AdminShell.css";
import "./pages/LoginPage.css";
import "./pages/MyOrdersPage.css";
import "./pages/ClientForms.css";
import "./App.css";

// This path can now stay as-is or be simplified - the admin panel is
// protected by real username/password login, not just URL obscurity.
const ADMIN_PATH = "/admin-hs-panel";

// Temporarily hide client حساب page (BalancePage code kept for later).
const CLIENT_BALANCE_VISIBLE = false;

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">در حال بارگذاری…</div>;
  if (!user) return <LoginPage />;
  return (
    <>
      <NoticeModal />
      {children}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <StagingBanner />
          <UpdatePrompt />
          <Routes>
            <Route path="/" element={<Protected><TraderPage /></Protected>} />
            <Route path="/my-orders" element={<Protected><MyOrdersPage /></Protected>} />
            <Route
              path="/balance"
              element={
                CLIENT_BALANCE_VISIBLE ? (
                  <Protected><BalancePage /></Protected>
                ) : (
                  <Protected><Navigate to="/" replace /></Protected>
                )
              }
            />
            <Route path="/kyc" element={<Protected><KycPage /></Protected>} />
            <Route path="/upload-receipt" element={<Protected><UploadReceiptPage /></Protected>} />
            <Route path="/register-transfer" element={<Protected><RegisterTransferPage /></Protected>} />
            <Route path="/terms" element={<Protected><TermsPage /></Protected>} />
            <Route path="/about" element={<Protected><AboutPage /></Protected>} />
            <Route path="/reygiri" element={<Protected><ReygiriLinksPage /></Protected>} />
            <Route path={ADMIN_PATH} element={<AdminPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
