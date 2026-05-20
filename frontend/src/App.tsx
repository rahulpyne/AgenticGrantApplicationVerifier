import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import "./index.css";
import Dashboard from "./pages/Dashboard";
import CaseDetail from "./pages/CaseDetail";
import ManagerQueue from "./pages/ManagerQueue";

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <nav className="nav">
          <span className="nav-brand">PacifiCan · RDII Intake Triage</span>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/manager">Manager Queue</NavLink>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/manager" element={<ManagerQueue />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
