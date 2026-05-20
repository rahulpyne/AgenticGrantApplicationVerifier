import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import "./index.css";
import Dashboard from "./pages/Dashboard";
import CaseDetail from "./pages/CaseDetail";
import ManagerQueue from "./pages/ManagerQueue";
import ApplicantPortal from "./pages/ApplicantPortal";

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <nav className="nav">
          <span className="nav-brand">PacifiCan · RDII</span>

          {/* Applicant-facing */}
          <NavLink to="/apply" className="nav-apply-link">
            Apply for Funding
          </NavLink>

          <span className="nav-divider" />

          {/* Officer-facing */}
          <span className="nav-section-label">Officer Portal</span>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/manager">Manager Queue</NavLink>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/manager" element={<ManagerQueue />} />
            <Route path="/apply" element={<ApplicantPortal />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
