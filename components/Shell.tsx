"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loadPrefs, pref } from "@/lib/prefs";
import { setMoneyFormat } from "@/lib/money";
import ChatWidget from "@/components/ChatWidget";

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
          {([
            { href: "/dashboard", icon: "■", label: "Dashboard" },
            { href: "/forecast", icon: "📈", label: "Forecast" },
            { section: "GmbH Finances" },
            { href: "/cash", icon: "💵", label: "Cash Allocation" },
            { href: "/bills", icon: "📚", label: "Bills & Documents" },
            { href: "/obligations", icon: "🏛️", label: "Obligations" },
            { href: "/calendar", icon: "📅", label: "Calendar" },
            { href: "/payroll", icon: "👤", label: "Payroll" },
            { href: "/reports", icon: "📊", label: "Reports (VAT / Tax)" },
            { href: "/dividends", icon: "⚡", label: "Dividends" },
            { href: "/shareholder-loans", icon: "🤝", label: "Shareholder Loans" },
            { section: "Invoicing" },
            { href: "/invoices", icon: "☰", label: "Invoices" },
            { href: "/customers", icon: "◉", label: "Customers" },
            { section: "Travel Expenses" },
            { href: "/expenses", icon: "♦", label: "Expenses" },
            { href: "/trips", icon: "✈️", label: "Trips" },
            { section: "Banking" },
            { href: "/bank", icon: "🏛️", label: "Bank Statements" },
            { section: "Help" },
            { href: "/docs", icon: "📖", label: "Docs" },
            { href: "/test-procedure", icon: "✅", label: "Accounting Checklist" },
            { href: "/settings", icon: "⚙", label: "Settings" },
          ] as { href?: string; icon?: string; label?: string; section?: string }[]).map((it, i) =>
            it.section
              ? <div key={i} className="nav-section">{it.section}</div>
              : <a key={it.href} href={it.href} className={path === it.href ? "active" : ""}>
                  <span className="icon">{it.icon}</span> {it.label}
                </a>
          )}
        </nav>
        <div className="sidebar-footer" style={{ padding: "12px 20px", display: "flex", gap: 14 }}>
          <button className="btn btn--ghost btn--sm" onClick={toggleTheme} title="Toggle theme">◐</button>
          <button className="btn btn--ghost btn--sm" onClick={logout} title="Log out">⎋</button>
        </div>
      </aside>
      <div className="main">{children}</div>
      <ChatWidget />
    </>
  );
}
