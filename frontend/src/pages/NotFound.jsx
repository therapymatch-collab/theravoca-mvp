import { Link } from "react-router-dom";
import { Header, Footer } from "@/components/SiteShell";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="font-serif-display text-7xl text-[#2D4A3E]">404</div>
          <p className="mt-3 text-[#6D6A65]">This page doesn't exist.</p>
          <Link
            to="/"
            className="tv-btn-primary mt-8 inline-flex"
            data-testid="not-found-home-btn"
          >
            Back home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
