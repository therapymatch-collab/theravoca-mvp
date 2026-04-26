import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Landing from "@/pages/Landing";
import VerifyEmail from "@/pages/VerifyEmail";
import TherapistApply from "@/pages/TherapistApply";
import TherapistSignup from "@/pages/TherapistSignup";
import SignIn from "@/pages/SignIn";
import PatientPortal from "@/pages/PatientPortal";
import TherapistPortal from "@/pages/TherapistPortal";
import PatientResults from "@/pages/PatientResults";
import AdminLogin from "@/pages/AdminLogin";
import AdminDashboard from "@/pages/AdminDashboard";
import NotFound from "@/pages/NotFound";

function App() {
  useEffect(() => {
    document.title = "TheraVoca — Let therapists come to you";
  }, []);
  return (
    <div className="App tv-grain min-h-screen">
      <Toaster richColors position="top-center" />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/portal/patient" element={<PatientPortal />} />
          <Route path="/portal/therapist" element={<TherapistPortal />} />
          <Route path="/therapists/join" element={<TherapistSignup />} />
          <Route path="/verify/:token" element={<VerifyEmail />} />
          <Route
            path="/therapist/apply/:requestId/:therapistId"
            element={<TherapistApply />}
          />
          <Route path="/results/:requestId" element={<PatientResults />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
