import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { AuthCallback } from "@/features/auth/AuthCallback";
import { MfaRequired } from "@/features/auth/MfaRequired";
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
const KiorexFrontDoor = lazy(() => import("@/features/kiorex/KiorexFrontDoor").then((m) => ({ default: m.KiorexFrontDoor })));
const KiorexConnectPage = lazy(() => import("@/features/kiorex/KiorexConnectPage").then((m) => ({ default: m.KiorexConnectPage })));
const GrowthPage = lazy(() => import("@/features/growth/GrowthPage").then((m) => ({ default: m.GrowthPage })));
const PlanPage = lazy(() => import("@/features/subscription/PlanPage").then((m) => ({ default: m.Plan })));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const PatientsPage = lazy(() => import("@/features/patients/PatientsPage").then((m) => ({ default: m.PatientsPage })));
const PatientProfilePage = lazy(() => import("@/features/patients/PatientProfilePage").then((m) => ({ default: m.PatientProfilePage })));
const ReferrersPage = lazy(() => import("@/features/referrers/ReferrersPage").then((m) => ({ default: m.ReferrersPage })));
const ReceptionPage = lazy(() => import("@/features/reception/ReceptionPage").then((m) => ({ default: m.ReceptionPage })));
const QueueBoardPage = lazy(() => import("@/features/reception/QueueBoardPage").then((m) => ({ default: m.QueueBoardPage })));
const StoragePage = lazy(() => import("@/features/preanalytics/StoragePage").then((m) => ({ default: m.StoragePage })));
const MicrobiologyPage = lazy(() => import("@/features/micro/MicrobiologyPage").then((m) => ({ default: m.MicrobiologyPage })));
const QualityPage = lazy(() => import("@/features/quality/QualityPage").then((m) => ({ default: m.QualityPage })));
const InventoryPage = lazy(() => import("@/features/inventory/InventoryPage").then((m) => ({ default: m.InventoryPage })));
const FinancePage = lazy(() => import("@/features/finance/FinancePage").then((m) => ({ default: m.FinancePage })));
const AnalyticsPage = lazy(() => import("@/features/analytics/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const DoctorPortalPage = lazy(() => import("@/features/portal/DoctorPortalPage").then((m) => ({ default: m.DoctorPortalPage })));
const VerifyReportPage = lazy(() => import("@/features/portal/DoctorPortalPage").then((m) => ({ default: m.VerifyReportPage })));
const PhlebApp = lazy(() => import("@/features/phleb/PhlebApp").then((m) => ({ default: m.PhlebApp })));
const PublicReportPage = lazy(() => import("@/features/release/PublicReportPage").then((m) => ({ default: m.PublicReportPage })));

function Private({ children }: { children: React.ReactNode }) {
  const { token, loading, mfaRequired } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (mfaRequired) return <MfaRequired />;
  if (loading) return <div className="p-8"><Spinner /></div>;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<div className="p-8"><Spinner /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/r/:token" element={<PublicReportPage />} />
        <Route path="/portal/:token" element={<DoctorPortalPage />} />
        <Route path="/verify/:id" element={<VerifyReportPage />} />
        <Route path="/queue-board" element={<Private><QueueBoardPage /></Private>} />
        <Route path="/phleb" element={<Private><PhlebApp /></Private>} />
        <Route element={<Private><AppShell /></Private>}>
          <Route index element={<DashboardPage />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="patients/:id" element={<PatientProfilePage />} />
          <Route path="referrers" element={<ReferrersPage />} />
          <Route path="reception" element={<ReceptionPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="microbiology" element={<MicrobiologyPage />} />
          <Route path="quality" element={<QualityPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="growth" element={<GrowthPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
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
          <Route path="plan" element={<PlanPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="kiorex-connect" element={<KiorexFrontDoor />} />
          <Route path="kiorex-connect/steps" element={<KiorexConnectPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
