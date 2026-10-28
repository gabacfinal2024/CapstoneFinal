import { useState } from "react";
import { api } from '../api/supabaseApi';
import AuthSidePanel from "./Authsidepanel";

export default function Register({ onBack }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.name || !form.email || !form.password || !form.confirm) {
      setError("Please fill in all fields.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);

    try {
      await api.register({
        full_name: form.name,
        email: form.email,
        password: form.password,
      });

      setSuccess(true);
    } catch (err) {
      console.error("Registration error:", err);
      setError(err.message || "Registration failed. Please check your details.");
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

          {success ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "48px", marginBottom: "1rem" }}>✉️</div>
              <p style={{ fontSize: "20px", fontWeight: 700, color: "#155E52" }}>Verify your email</p>
              <p style={{ fontSize: "14px", color: "#64748b" }}>
                We sent a confirmation link to <strong>{form.email.trim().toLowerCase()}</strong>.
                Open it to verify your address before signing in.
              </p>
              <button
                type="button"
                onClick={onBack}
                style={{ marginTop: "1rem", color: "#155E52", background: "none", border: "none", fontWeight: 600, cursor: "pointer" }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 4px", color: "#1a1a1a" }}>
                Create account
              </p>
              <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 2rem" }}>
                Register a new AgriResQ account
              </p>

              <form onSubmit={handleSubmit}>

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
                  <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "6px" }}>
                    Full name
                  </label>
                  <input
                    type="text"
                    name="name"
                    placeholder="Juan dela Cruz"
                    value={form.name}
                    onChange={handleChange}
                    required
                    style={{
                      width: "100%", padding: "10px 12px",
                      border: "1px solid #e2e8f0", borderRadius: "8px",
                      fontSize: "14px", outline: "none",
                      boxSizing: "border-box", background: "#fff", color: "#1a1a1a"
                    }}
                  />
                </div>

                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "6px" }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="you@agriresq.ph"
                    value={form.email}
                    onChange={handleChange}
                    required
                    style={{
                      width: "100%", padding: "10px 12px",
                      border: "1px solid #e2e8f0", borderRadius: "8px",
                      fontSize: "14px", outline: "none",
                      boxSizing: "border-box", background: "#fff", color: "#1a1a1a"
                    }}
                  />
                </div>

                <p style={{ fontSize: "13px", color: "#475569", background: "#ecfdf5", borderRadius: "8px", padding: "10px 14px", margin: "0 0 1rem", lineHeight: 1.4 }}>
                  New accounts start as rescue buyers. To sell as a stall operator, apply from the mobile app. An administrator reviews the request.
                </p>

                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "6px" }}>
                    Password
                  </label>
                  <input
                    type="password"
                    name="password"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={handleChange}
                    required
                    minLength={8}
                    style={{
                      width: "100%", padding: "10px 12px",
                      border: "1px solid #e2e8f0", borderRadius: "8px",
                      fontSize: "14px", outline: "none",
                      boxSizing: "border-box", background: "#fff", color: "#1a1a1a"
                    }}
                  />
                </div>

                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "6px" }}>
                    Confirm password
                  </label>
                  <input
                    type="password"
                    name="confirm"
                    placeholder="••••••••"
                    value={form.confirm}
                    onChange={handleChange}
                    required
                    style={{
                      width: "100%", padding: "10px 12px",
                      border: "1px solid #e2e8f0", borderRadius: "8px",
                      fontSize: "14px", outline: "none",
                      boxSizing: "border-box", background: "#fff", color: "#1a1a1a"
                    }}
                  />
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
                  {isLoading ? "Creating account..." : "Create account"}
                </button>

                  
                   <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: "13px", color: "#64748b" }}>Already have an account? </span>
              <button
                type="button"
                onClick={onBack}
                style={{
                  background: "none", border: "none",
                  color: "#155E52", fontSize: "13px",
                  fontWeight: 600, cursor: "pointer", padding: 0
                }}
              >
                Login
              </button>
            </div>

              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}