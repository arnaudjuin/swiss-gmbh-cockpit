"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) { setError("Wrong password"); return; }
    const data = await res.json();
    localStorage.setItem("session_token", data.token);
    router.push("/dashboard");
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)" }}>
      <form onSubmit={submit} className="panel" style={{ width: 320, padding: 28 }}>
        <h2 style={{ marginTop: 0 }}>Swiss GmbH Cockpit</h2>
        <p className="hint">Demo password: <code>demo</code></p>
        <div className="field">
          <label className="field__label" htmlFor="pw">Password</label>
          <input id="pw" type="password" className="control" value={password}
                 onChange={e => setPassword(e.target.value)} autoFocus />
        </div>
        {error && <div className="notice notice--danger" style={{ margin: "10px 0" }}>{error}</div>}
        <div className="form-actions"><button className="btn btn--primary" type="submit">Log in</button></div>
      </form>
    </div>
  );
}
