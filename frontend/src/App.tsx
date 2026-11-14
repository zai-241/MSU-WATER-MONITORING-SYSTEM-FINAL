import { lazy, Suspense, type ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import LoginPage from "./pages/LoginPage";

const RELOAD_KEY = "wm_chunk_reload_at";

/**
 * React.lazy that survives a new deploy: a tab (or the APK) opened before the deploy still asks for the old
 * page files, which Hosting no longer has. Reload once to get the new index.html; if that was just tried,
 * show the error instead of looping.
 */
function lazyPage<T extends ComponentType<unknown>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err) => {
      let lastReload = 0;
      try { lastReload = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
      if (Date.now() - lastReload > 10_000) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // keep showing the loader until the reload
      }
      throw err;
    })
  );
}

// Pages after login are loaded on first visit, so the first load (login screen) stays small on phones
const Dashboard = lazyPage(() => import("./pages/Dashboard"));
const Reports = lazyPage(() => import("./pages/Reports"));
const AdminPanel = lazyPage(() => import("./pages/AdminPanel"));
const Logs = lazyPage(() => import("./pages/Logs"));
const Notifications = lazyPage(() => import("./pages/Notifications"));
const NotFound = lazyPage(() => import("./pages/NotFound"));

const PageLoading = () => (
  <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground" role="status" aria-label="Loading page">
    <Loader2 className="animate-spin" size={28} />
  </div>
);

const App = () => (
  <AuthProvider>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/login" element={<LoginPage onLogin={() => {}} />} />
            <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['admin', 'worker', 'viewer']}><Dashboard /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute allowedRoles={['admin', 'worker']}><Reports /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminPanel /></ProtectedRoute>} />
            <Route path="/logs" element={<ProtectedRoute allowedRoles={['admin', 'worker']}><Logs /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute allowedRoles={['admin', 'worker', 'viewer']}><Notifications /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </AuthProvider>
);

export default App;
