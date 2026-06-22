import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prediction Finder",
  description: "Track and analyze predictions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="bg-white border-b border-gray-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">PF</span>
                </div>
                <span className="font-semibold text-gray-900 text-lg">Prediction Finder</span>
              </div>
              <nav className="flex items-center gap-6 text-sm font-medium text-gray-600">
                <a href="/" className="hover:text-gray-900 transition-colors">Dashboard</a>
                <a href="/predictions" className="hover:text-gray-900 transition-colors">Predictions</a>
              </nav>
            </div>
          </header>
          <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
          <footer className="bg-white border-t border-gray-200 py-4 text-center text-sm text-gray-500">
            Prediction Finder &copy; {new Date().getFullYear()}
          </footer>
        </div>
      </body>
    </html>
  );
}
