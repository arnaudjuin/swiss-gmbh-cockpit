"use client";
import { usePathname, useRouter } from "next/navigation";

// App shell: dark sidebar + main column (same classes as the classic SPA, so
// static/app.css styles both frontends identically).
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  if (path === "/login") return <>{children}</>;

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    window.dispatchEvent(new Event("themechange"));
  };
  const logout = () => { localStorage.removeItem("session_token"); router.push("/login"); };

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-header"><h2>Muster Consulting GmbH</h2></div>
        <nav className="sidebar-nav">
          {[["/dashboard", "▪", "Dashboard"], ["/forecast", "📈", "Forecast"], ["/obligations", "🏛", "Obligations"], ["/bills", "🧾", "Bills"]].map(([href, icon, label]) => (
            <a key={href} href={href} className={path === href ? "active" : ""}>
              <span className="icon">{icon}</span> {label}
            </a>
          ))}
          <div className="hint" style={{ padding: "10px 20px" }}>
            Next.js port in progress — the remaining pages live in the classic
            frontend on <a href="http://127.0.0.1:8000" style={{ color: "var(--primary)" }}>:8000</a>.
          </div>
        </nav>
        <div className="sidebar-footer" style={{ padding: "12px 20px", display: "flex", gap: 14 }}>
          <button className="btn btn--ghost btn--sm" onClick={toggleTheme} title="Toggle theme">◐</button>
          <button className="btn btn--ghost btn--sm" onClick={logout} title="Log out">⎋</button>
        </div>
      </aside>
      <div className="main">{children}</div>
    </>
  );
}
