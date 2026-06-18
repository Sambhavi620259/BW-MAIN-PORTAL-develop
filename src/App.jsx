import { Suspense, lazy } from "react";
import { Navigate, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import Home from "./pages/Home";
import AllApps from "./pages/AllApps";
import MyApps from "./pages/MyApps";
import Favorites from "./pages/Favorites";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import Activity from "./pages/Activity";
import Registration from "./pages/Registration";
import VerifyEmail from "./pages/VerifyEmail";
import PlansPricing from "./pages/PlansPricing";
import MakePayment from "./pages/MakePayment";
import AdminInviteAccept from "./pages/AdminInviteAccept";

import ProtectedRoute from "./components/ProtectedRoute";
import ErrorBoundary from "./components/ErrorBoundary";

const DashboardLayout = lazy(() => import("./Layouts/DashboardLayout"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
// Admin KYC is now handled inside AdminDashboard via real backend APIs.

const UserDashboard = lazy(() => import("./pages/UserDashboard"));

const TicketCenter = lazy(() => import("./pages/TicketCenter"));
const RaiseTicket = lazy(() => import("./pages/RaiseTicket"));
const TicketDetail = lazy(() => import("./pages/TicketDetail"));

function RouteLoader({ label }) {
  return (
    <div style={{ padding: 16, textAlign: "center", color: "#64748b", fontWeight: 700 }}>
      {label || "Loading..."}
    </div>
  );
}

export default function App() {
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { fontSize: "14px" },
          success: { iconTheme: { primary: "#22c55e", secondary: "#fff" } },
          error: { iconTheme: { primary: "#ef4444", secondary: "#fff" } },
        }}
      />

      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route
  path="/admin/invite/:token"
  element={<AdminInviteAccept />}
/>
          <Route path="/register" element={<Registration />} />
          <Route path="/register/organization" element={<Registration />} />

          <Route path="/plans" element={<PlansPricing />} />
          <Route path="/payment" element={<MakePayment />} />

          <Route
            path="/admin/*"
            element={
              <ProtectedRoute requiredRole="ROLE_ADMIN">
                <Suspense fallback={<RouteLoader label="Loading admin dashboard..." />}>
                  <AdminDashboard />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/kyc"
            element={
              <ProtectedRoute requiredRole="ROLE_ADMIN">
                <Suspense fallback={<RouteLoader label="Loading KYC..." />}>
                  <AdminDashboard />
                </Suspense>
              </ProtectedRoute>
            }
          />


        <Route
          path="/support/chat"
          element={
            <ProtectedRoute requiredRole="ROLE_USER">
              <Suspense fallback={<RouteLoader label="Loading tickets..." />}>
                <TicketCenter />
              </Suspense>
            </ProtectedRoute>
          }
        />
        {/* New production-friendly ticket URLs (preferred). Keep legacy /support/* aliases above. */}
        <Route
          path="/tickets"
          element={
            <ProtectedRoute requiredRole="ROLE_USER">
              <Suspense fallback={<RouteLoader label="Loading tickets..." />}>
                <TicketCenter />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/support/ticket"
          element={
            <ProtectedRoute requiredRole="ROLE_USER">
              <Suspense fallback={<RouteLoader label="Loading ticket form..." />}>
                <RaiseTicket />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/support/ticket/:id"
          element={
            <ProtectedRoute requiredRole="ROLE_USER">
              <Suspense fallback={<RouteLoader label="Loading ticket details..." />}>
                <TicketDetail />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tickets/:id"
          element={
            <ProtectedRoute requiredRole="ROLE_USER">
              <Suspense fallback={<RouteLoader label="Loading ticket details..." />}>
                <TicketDetail />
              </Suspense>
            </ProtectedRoute>
          }
        />

          <Route path="/" element={<Navigate to="/login" replace />} />

          <Route
            element={
              <ProtectedRoute requiredRole="ROLE_USER">
                <Suspense fallback={<RouteLoader label="Loading..." />}>
                  <DashboardLayout />
                </Suspense>
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Suspense fallback={<RouteLoader label="Loading dashboard..." />}><UserDashboard /></Suspense>} />
            {/* Legacy alias kept for compatibility */}
            <Route path="/user-dashboard" element={<Suspense fallback={<RouteLoader label="Loading dashboard..." />}><UserDashboard /></Suspense>} />
            <Route path="/home" element={<Home />} />
            <Route path="/all-apps" element={<AllApps />} />
            <Route path="/my-apps" element={<MyApps />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/activity" element={<Activity />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </>
  );
}
