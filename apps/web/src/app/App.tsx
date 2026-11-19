import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { OnboardingPage } from "@/features/auth/OnboardingPage";

const OrdersPage = lazy(() => import("@/features/orders/OrdersPage").then((m) => ({ default: m.OrdersPage })));
const NewOrderPage = lazy(() => import("@/features/orders/NewOrderPage").then((m) => ({ default: m.NewOrderPage })));
const OrderDetailPage = lazy(() => import("@/features/orders/OrderDetailPage").then((m) => ({ default: m.OrderDetailPage })));
const AccessioningPage = lazy(() => import("@/features/specimens/AccessioningPage").then((m) => ({ default: m.AccessioningPage })));
const WorklistPage = lazy(() => import("@/features/results/WorklistPage").then((m) => ({ default: m.WorklistPage })));
const ValidationPage = lazy(() => import("@/features/results/ValidationPage").then((m) => ({ default: m.ValidationPage })));
const QcPage = lazy(() => import("@/features/qc/QcPage").then((m) => ({ default: m.QcPage })));
const ReleasePage = lazy(() => import("@/features/release/ReleasePage").then((m) => ({ default: m.ReleasePage })));
const CriticalPage = lazy(() => import("@/features/release/CriticalPage").then((m) => ({ default: m.CriticalPage })));
const BillingPage = lazy(() => import("@/features/billing/BillingPage").then((m) => ({ default: m.BillingPage })));
const ReportsPage = lazy(() => import("@/features/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const CataloguePage = lazy(() => import("@/features/catalogue/CataloguePage").then((m) => ({ default: m.CataloguePage })));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const PhlebApp = lazy(() => import("@/features/phleb/PhlebApp").then((m) => ({ default: m.PhlebApp })));
const PublicReportPage = lazy(() => import("@/features/release/PublicReportPage").then((m) => ({ default: m.PublicReportPage })));

function Private({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (loading) return <div className="p-8"><Spinner /></div>;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<div className="p-8"><Spinner /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/r/:token" element={<PublicReportPage />} />
        <Route path="/phleb" element={<Private><PhlebApp /></Private>} />
        <Route element={<Private><AppShell /></Private>}>
          <Route index element={<DashboardPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/new" element={<NewOrderPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="accessioning" element={<AccessioningPage />} />
          <Route path="worklist" element={<WorklistPage />} />
          <Route path="validation" element={<ValidationPage />} />
          <Route path="qc" element={<QcPage />} />
          <Route path="release" element={<ReleasePage />} />
          <Route path="critical" element={<CriticalPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="catalogue" element={<CataloguePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
