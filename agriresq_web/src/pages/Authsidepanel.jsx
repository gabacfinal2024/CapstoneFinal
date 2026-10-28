import stallPhoto from "../assets/bulua-stall.jpg";

// Shared left panel for Login and Register so the photo, crop and
// spacing are identical on both screens.
export default function AuthSidePanel() {
  return (
    <>
    <style>{`@media (max-width: 760px) { .auth-side-panel { display: none !important; } }`}</style>
    <div className="auth-side-panel" style={{
      backgroundColor: "#155E52",
      // Green tint over the photo keeps the white/mint text readable
      backgroundImage: `linear-gradient(to bottom, rgba(13,63,56,0.80) 0%, rgba(13,63,56,0.10) 40%, rgba(13,63,56,0.15) 60%, rgba(13,63,56,0.88) 100%), url(${stallPhoto})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      // Photo takes a quarter of the screen (never narrower than 260px or wider than 340px)
      flex: "0 0 25%",
      minWidth: "260px",
      maxWidth: "340px",
      // Fixed to the viewport height so the photo is cropped the same way
      // even when the right-hand form is taller (e.g. Register).
      height: "100vh",
      position: "sticky",
      top: 0,
      alignSelf: "flex-start",
      boxSizing: "border-box",
      padding: "2.5rem 2rem",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between"
    }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <div style={{
            width: "40px", height: "40px",
            background: "rgba(255,255,255,0.15)",
            borderRadius: "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "20px"
          }}>🌿</div>
          <p style={{ fontSize: "20px", fontWeight: 600, color: "#DDF3EA", margin: 0 }}>AgriResQ</p>
        </div>
        <p style={{ fontSize: "12px", color: "#73C8B0", margin: "4px 0 0" }}>
          IoT-Assisted Rescue Distribution for Surplus Vegetables
        </p>
      </div>

      <div>
        <p style={{ fontSize: "14px", color: "#DDF3EA", lineHeight: 1.6 }}>
          Connecting farmers and buyers across Cagayan de Oro City.
        </p>

        <div style={{
          background: "rgba(255,255,255,0.12)",
          borderRadius: "8px", padding: "8px 12px", marginTop: "8px",
          backdropFilter: "blur(4px)"
        }}>
          <div style={{ fontSize: "18px", fontWeight: 600, color: "#DDF3EA" }}>Bulua</div>
          <div style={{ fontSize: "11px", color: "#73C8B0" }}>Primary terminal</div>
        </div>
      </div>

      <p style={{ fontSize: "11px", color: "#DDF3EA", margin: 0 }}>Cagayan de Oro City, PH</p>
    </div>
    </>
  );
}