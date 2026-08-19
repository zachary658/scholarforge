import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { useAuth } from './lib/auth.jsx';
import Landing from './pages/Landing.jsx';
import NotFound from './pages/NotFound.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Terms from './pages/Terms.jsx';
import Privacy from './pages/Privacy.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Layout from './components/Layout.jsx';

// 代码分割：工作台与管理后台页面按需加载，减小首屏体积
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Writing = lazy(() => import('./pages/Writing.jsx'));
const Proposal = lazy(() => import('./pages/Proposal.jsx'));
const Polish = lazy(() => import('./pages/Polish.jsx'));
const Rewrite = lazy(() => import('./pages/Rewrite.jsx'));
const References = lazy(() => import('./pages/References.jsx'));
const MyTemplates = lazy(() => import('./pages/MyTemplates.jsx'));
const Courses = lazy(() => import('./pages/Courses.jsx'));
const CourseQuote = lazy(() => import('./pages/CourseQuote.jsx'));
const MyDocs = lazy(() => import('./pages/MyDocs.jsx'));
const MyOrders = lazy(() => import('./pages/MyOrders.jsx'));
const MyTasks = lazy(() => import('./pages/MyTasks.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const AiReduce = lazy(() => import('./pages/AiReduce.jsx'));
const Defense = lazy(() => import('./pages/Defense.jsx'));
const LiteratureReview = lazy(() => import('./pages/LiteratureReview.jsx'));
const TaskBook = lazy(() => import('./pages/TaskBook.jsx'));
const Journal = lazy(() => import('./pages/Journal.jsx'));
const Charts = lazy(() => import('./pages/Charts.jsx'));
const GraduationProjects = lazy(() => import('./pages/GraduationProjects.jsx'));
const MyGraduationOrders = lazy(() => import('./pages/MyGraduationOrders.jsx'));

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'));
const AdminOverview = lazy(() => import('./pages/admin/AdminOverview.jsx'));
const AdminCoaching = lazy(() => import('./pages/admin/AdminCoaching.jsx'));
const AdminFeaturePricing = lazy(() => import('./pages/admin/AdminFeaturePricing.jsx'));
const AdminCourseOrders = lazy(() => import('./pages/admin/AdminCourseOrders.jsx'));
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders.jsx'));
const AdminQuotes = lazy(() => import('./pages/admin/AdminQuotes.jsx'));
const AdminTemplates = lazy(() => import('./pages/admin/AdminTemplates.jsx'));
const AdminModels = lazy(() => import('./pages/admin/AdminModels.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));
const AdminLogs = lazy(() => import('./pages/admin/AdminLogs.jsx'));
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance.jsx'));
const AdminGraduation = lazy(() => import('./pages/admin/AdminGraduation.jsx'));
const AdminGraduationOrders = lazy(() => import('./pages/admin/AdminGraduationOrders.jsx'));

const SupportLayout = lazy(() => import('./pages/support/SupportLayout.jsx'));
const SupportDashboard = lazy(() => import('./pages/support/SupportDashboard.jsx'));
const SupportCourseOrders = lazy(() => import('./pages/support/SupportCourseOrders.jsx'));
const SupportCourses = lazy(() => import('./pages/support/SupportCourses.jsx'));
const SupportGraduationOrders = lazy(() => import('./pages/support/SupportGraduationOrders.jsx'));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-pulse text-slate-400">加载中…</div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login?redirect=/admin" replace />;
  if (!user.is_admin) return <Navigate to="/app" replace />;
  return children;
}

function SupportRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login?redirect=/support" replace />;
  if (!user.is_support && !user.is_admin) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
        <Route path="writing" element={<Suspense fallback={<PageFallback />}><Writing /></Suspense>} />
        <Route path="proposal" element={<Suspense fallback={<PageFallback />}><Proposal /></Suspense>} />
        <Route path="literature-review" element={<Suspense fallback={<PageFallback />}><LiteratureReview /></Suspense>} />
        <Route path="task-book" element={<Suspense fallback={<PageFallback />}><TaskBook /></Suspense>} />
        <Route path="defense" element={<Suspense fallback={<PageFallback />}><Defense /></Suspense>} />
        <Route path="journal" element={<Suspense fallback={<PageFallback />}><Journal /></Suspense>} />
        <Route path="polish" element={<Suspense fallback={<PageFallback />}><Polish /></Suspense>} />
        <Route path="rewrite" element={<Suspense fallback={<PageFallback />}><Rewrite /></Suspense>} />
        <Route path="ai-reduce" element={<Suspense fallback={<PageFallback />}><AiReduce /></Suspense>} />
        <Route path="references" element={<Suspense fallback={<PageFallback />}><References /></Suspense>} />
        <Route path="charts" element={<Suspense fallback={<PageFallback />}><Charts /></Suspense>} />
        <Route path="templates" element={<Suspense fallback={<PageFallback />}><MyTemplates /></Suspense>} />
        <Route path="projects" element={<Suspense fallback={<PageFallback />}><Projects /></Suspense>} />
        <Route path="tasks" element={<Suspense fallback={<PageFallback />}><MyTasks /></Suspense>} />
        <Route path="courses" element={<Suspense fallback={<PageFallback />}><Courses /></Suspense>} />
        <Route path="courses/quote" element={<Suspense fallback={<PageFallback />}><CourseQuote /></Suspense>} />
        <Route path="docs" element={<Suspense fallback={<PageFallback />}><MyDocs /></Suspense>} />
        <Route path="orders" element={<Suspense fallback={<PageFallback />}><MyOrders /></Suspense>} />
        <Route path="graduation" element={<Suspense fallback={<PageFallback />}><GraduationProjects /></Suspense>} />
        <Route path="graduation-orders" element={<Suspense fallback={<PageFallback />}><MyGraduationOrders /></Suspense>} />
      </Route>
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <Suspense fallback={<PageFallback />}><AdminLayout /></Suspense>
          </AdminRoute>
        }
      >
        <Route index element={<Suspense fallback={<PageFallback />}><AdminOverview /></Suspense>} />
        <Route path="courses" element={<Suspense fallback={<PageFallback />}><AdminCoaching /></Suspense>} />
        <Route path="course-orders" element={<Suspense fallback={<PageFallback />}><AdminCourseOrders /></Suspense>} />
        <Route path="features" element={<Suspense fallback={<PageFallback />}><AdminFeaturePricing /></Suspense>} />
        <Route path="quotes" element={<Suspense fallback={<PageFallback />}><AdminQuotes /></Suspense>} />
        <Route path="orders" element={<Suspense fallback={<PageFallback />}><AdminOrders /></Suspense>} />
        <Route path="templates" element={<Suspense fallback={<PageFallback />}><AdminTemplates /></Suspense>} />
        <Route path="models" element={<Suspense fallback={<PageFallback />}><AdminModels /></Suspense>} />
        <Route path="users" element={<Suspense fallback={<PageFallback />}><AdminUsers /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<PageFallback />}><AdminSettings /></Suspense>} />
        <Route path="logs" element={<Suspense fallback={<PageFallback />}><AdminLogs /></Suspense>} />
        <Route path="finance" element={<Suspense fallback={<PageFallback />}><AdminFinance /></Suspense>} />
        <Route path="graduation" element={<Suspense fallback={<PageFallback />}><AdminGraduation /></Suspense>} />
        <Route path="graduation-orders" element={<Suspense fallback={<PageFallback />}><AdminGraduationOrders /></Suspense>} />
      </Route>
      <Route
        path="/support"
        element={
          <SupportRoute>
            <Suspense fallback={<PageFallback />}><SupportLayout /></Suspense>
          </SupportRoute>
        }
      >
        <Route index element={<Suspense fallback={<PageFallback />}><SupportDashboard /></Suspense>} />
        <Route path="orders" element={<Suspense fallback={<PageFallback />}><SupportCourseOrders /></Suspense>} />
        <Route path="courses" element={<Suspense fallback={<PageFallback />}><SupportCourses /></Suspense>} />
        <Route path="graduation" element={<Suspense fallback={<PageFallback />}><SupportGraduationOrders /></Suspense>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
