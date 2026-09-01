"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loadPrefs, pref } from "@/lib/prefs";
import { setMoneyFormat } from "@/lib/money";

// App shell: dark sidebar + main column (same classes as the classic SPA, so
// static/app.css styles both frontends identically).
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [company, setCompany] = useState("Muster Consulting GmbH");
  useEffect(() => {
    if (path === "/login") return;
    loadPrefs().then(p => {
      setMoneyFormat(pref(p, "app.currency", "CHF"), pref(p, "app.locale", "de-CH"));
      const name = pref(p, "app.companyName", "");
      if (name) setCompany(name);
    }).catch(() => {});
  }, [path]);
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
        <div className="sidebar-header"><h2>{company}</h2></div>
        <nav className="sidebar-nav">
          {[["/dashboard", "▪", "Dashboard"], ["/forecast", "📈", "Forecast"], ["/cash", "💰", "Cash Allocation"],
            ["/bills", "🧾", "Bills & Documents"], ["/obligations", "🏛", "Obligations"], ["/calendar", "📅", "Calendar"],
            ["/payroll", "👤", "Payroll"], ["/reports", "📊", "Reports"], ["/dividends", "⚡", "Dividends"],
            ["/invoices", "☰", "Invoices"], ["/customers", "◉", "Customers"], ["/expenses", "🧳", "Expenses"],
            ["/bank", "🏦", "Bank Statements"], ["/settings", "⚙", "Settings"]].map(([href, icon, label]) => (
            <a key={href} href={href} className={path === href ? "active" : ""}>
              <span className="icon">{icon}</span> {label}
            </a>
          ))}
          <div className="hint" style={{ padding: "10px 20px" }}>
            Docs, checklists and the edit dialogs still live in the classic frontend.
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
