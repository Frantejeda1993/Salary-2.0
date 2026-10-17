import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import TabBar from "./components/TabBar";
import Denied from "./pages/Denied";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Settings from "./pages/Settings";

export default function App() {
  const { status } = useAuth();
  if (status === "loading") return <div className="splash">Cargando…</div>;
  if (status === "signedOut") return <Login />;
  if (status === "denied") return <Denied />;
  if (status === "needsOnboarding") return <Onboarding />;
  return (
    <div className="app">
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ajustes" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  );
}
