import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from '../api/supabaseApi';
import AuthSidePanel from "./Authsidepanel";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setIsLoading(true);

    try {
      const user = await api.login(email, password);
      const profile = await api.me();

      const currentUser = {
        id: user.id,
        email: user.email,
        full_name: profile?.full_name || '',
        role: profile?.role || '',
        stall_number: profile?.stall_number || '',
        market_location: profile?.market_location || '',
      };

      localStorage.setItem("agriresq_current_user", JSON.stringify(currentUser));
      onLogin(); // Proceed to the Dashboard!
    } catch (err) {
      console.error("Login error:", err);
      setError(err.message || "Invalid email or password.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>

      <AuthSidePanel />

      {/* Right form panel */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc"
      }}>
        <div style={{ width: "100%", maxWidth: "400px", padding: "2rem" }}>

          <p style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 4px", color: "#1a1a1a" }}>
            Welcome back
          </p>
          <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 2rem" }}>
            Administrator sign in
          </p>

          <form onSubmit={handleLogin}>

            {error && (
              <div style={{
                background: "#fee2e2", color: "#b91c1c",
                borderRadius: "8px", padding: "10px 14px",
                fontSize: "13px", marginBottom: "1rem"
              }}>
                {error}
              </div>
            )}

            <div style={{ marginBottom: "1rem" }}>
              <label style={{
                fontSize: "12px", color: "#64748b",
                display: "block", marginBottom: "6px"
              }}>
                Email address
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@agriresq.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%", padding: "10px 12px",
                  border: "1px solid #e2e8f0", borderRadius: "8px",
                  fontSize: "14px", outline: "none",
                  boxSizing: "border-box", background: "#fff", color: "#1a1a1a"
                }}
              />
            </div>

            <div style={{ marginBottom: "0.5rem" }}>
              <label style={{
                fontSize: "12px", color: "#64748b",
                display: "block", marginBottom: "6px"
              }}>
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: "100%", padding: "10px 12px",
                  border: "1px solid #e2e8f0", borderRadius: "8px",
                  fontSize: "14px", outline: "none",
                  boxSizing: "border-box", background: "#fff", color: "#1a1a1a"
                }}
              />
            </div>

            <div style={{ textAlign: "right", marginBottom: "1.5rem" }}>
              <Link to="/forgot-password" style={{ fontSize: "12px", color: "#155E52", textDecoration: "none" }}>
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: "100%", padding: "11px",
                background: "#155E52", color: "#fff",
                border: "none", borderRadius: "8px",
                fontSize: "15px", fontWeight: 600,
                cursor: isLoading ? "not-allowed" : "pointer", 
                marginBottom: "1rem",
                opacity: isLoading ? 0.7 : 1
              }}
              onMouseOver={(e) => !isLoading && (e.target.style.background = "#0D3F38")}
              onMouseOut={(e) => !isLoading && (e.target.style.background = "#155E52")}
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>

            <p style={{ textAlign: "center", fontSize: "13px", color: "#64748b", margin: 0, lineHeight: 1.4 }}>
              Administrator access only. Stall operators and buyers use the AgriResQ mobile app.
            </p>

          </form>
        </div>
      </div>
    </div>
  );
}