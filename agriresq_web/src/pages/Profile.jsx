import { useEffect, useRef, useState } from "react";
import { api } from "../api/supabaseApi";
import { announceProfile, uploadAvatar } from "../api/avatarApi";

const ROLE_LABEL = { ADMIN: "Administrator", STALL_OPERATOR: "Stall operator", RESCUE_BUYER: "Rescue buyer" };

function readStoredUser() {
  try { return JSON.parse(localStorage.getItem("agriresq_current_user") || "{}"); } catch { return {}; }
}

export default function Profile() {
  const fileInputRef = useRef(null);

  const [stored] = useState(readStoredUser);
  const [loaded, setLoaded] = useState(false);
  const [role, setRole] = useState(stored.role || "");
  const [name, setName] = useState(stored.full_name || stored.name || "");
  const [email, setEmail] = useState(stored.email || "");
  const [location, setLocation] = useState(stored.market_location || "");
  const [avatar, setAvatar] = useState(stored.avatar_url || null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const [avatarErr, setAvatarErr] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPass, setChangingPass] = useState(false);

  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");
  const [passMsg, setPassMsg] = useState("");
  const [passErr, setPassErr] = useState("");

  // Everything comes from Supabase (profiles + auth); localStorage is only a first-paint fallback.
  useEffect(() => {
    let alive = true;
    api.me()
      .then((me) => {
        if (!alive) return;
        if (me) {
          setName(me.full_name || "");
          setEmail(me.email || "");
          setLocation(me.market_location || "");
          setAvatar(me.avatar_url || null);
          setRole(me.role || "");
        }
      })
      .catch((err) => { if (alive) setProfileErr(`Could not load your profile: ${err.message}`); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarMsg("");
    setAvatarErr("");
    setUploading(true);
    try {
      const result = await uploadAvatar(file);
      setAvatar(result.url);
      if (result.saved) setAvatarMsg("Profile picture updated.");
      else setAvatarErr(result.warning);
    } catch (err) {
      setAvatarErr(err.message || "Could not update the picture.");
    } finally {
      setUploading(false);
    }
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setProfileMsg("");
    setProfileErr("");

    if (!name.trim()) {
      setProfileErr("Name cannot be empty.");
      return;
    }

    setSaving(true);
    try {
      await api.updateProfile({ full_name: name.trim(), market_location: location.trim() });
      announceProfile({ full_name: name.trim(), market_location: location.trim() });
      setProfileMsg("Profile updated successfully.");
    } catch (err) {
      setProfileErr(err.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSave = async (e) => {
    e.preventDefault();
    setPassMsg("");
    setPassErr("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPassErr("Please fill in all password fields.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassErr("New passwords do not match.");
      return;
    }
    if (newPassword.length < 6) {
      setPassErr("New password must be at least 6 characters.");
      return;
    }

    setChangingPass(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPassMsg("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPassErr(err.message || "Could not change the password.");
    } finally {
      setChangingPass(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "10px 12px",
    border: "1px solid #e2e8f0", borderRadius: "8px",
    fontSize: "14px", outline: "none",
    boxSizing: "border-box", background: "#fff", color: "#1a1a1a"
  };

  const readOnlyStyle = { ...inputStyle, background: "#f8fafc", color: "#64748b", cursor: "not-allowed" };

  const labelStyle = {
    fontSize: "12px", color: "#64748b",
    display: "block", marginBottom: "6px"
  };

  const fieldWrap = { marginBottom: "1rem" };

  const successBox = {
    background: "#dcfce7", color: "#15803d",
    borderRadius: "8px", padding: "10px 14px",
    fontSize: "13px", marginBottom: "1rem"
  };

  const errorBox = {
    background: "#fee2e2", color: "#b91c1c",
    borderRadius: "8px", padding: "10px 14px",
    fontSize: "13px", marginBottom: "1rem"
  };

  const warnBox = {
    background: "#fef3c7", color: "#92400e",
    borderRadius: "8px", padding: "10px 14px",
    fontSize: "13px", marginBottom: "1rem"
  };

  const sectionCard = {
    background: "#fff", borderRadius: "12px",
    border: "1px solid #e2e8f0", padding: "1.5rem 2rem",
    marginBottom: "1.5rem"
  };

  const saveBtn = (busy) => ({
    padding: "10px 24px", background: "#1D9E75",
    color: "#fff", border: "none", borderRadius: "8px",
    fontSize: "14px", fontWeight: 600, cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.7 : 1
  });

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", padding: "2rem 1rem" }}>

      <p style={{ fontSize: "22px", fontWeight: 700, color: "#1a1a1a", margin: "0 0 0.25rem" }}>
        My Profile
      </p>
      <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 2rem" }}>
        Manage your account information and password
      </p>

      {/* Avatar + Profile Info */}
      <div style={sectionCard}>
        <p style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a", margin: "0 0 1.25rem" }}>
          Profile information
        </p>

        {/* Avatar */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "1.5rem" }}>
          <button
            type="button"
            onClick={handleAvatarClick}
            disabled={uploading}
            aria-label="Change profile picture"
            style={{
              width: "80px", height: "80px", borderRadius: "50%", padding: 0,
              background: avatar ? "transparent" : "#1D9E75",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: uploading ? "wait" : "pointer", overflow: "hidden",
              border: "3px solid #e2e8f0", flexShrink: 0
            }}
          >
            {avatar ? (
              <img src={avatar} alt="Your profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "28px", fontWeight: 700, color: "#fff" }}>
                {(name || email || "?").charAt(0).toUpperCase()}
              </span>
            )}
          </button>
          <div>
            <button
              type="button"
              onClick={handleAvatarClick}
              disabled={uploading}
              style={{
                padding: "8px 16px", background: "transparent",
                border: "1px solid #e2e8f0", borderRadius: "8px",
                fontSize: "13px", cursor: uploading ? "wait" : "pointer", color: "#64748b",
                marginBottom: "6px", display: "block"
              }}
            >
              {uploading ? "Uploading…" : "📷 Change photo"}
            </button>
            <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>
              JPG or PNG. It is resized automatically.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarChange}
          />
        </div>
        {avatarMsg && <div role="status" style={successBox}>{avatarMsg}</div>}
        {avatarErr && <div role="alert" style={warnBox}>{avatarErr}</div>}

        <form onSubmit={handleProfileSave}>
          {profileMsg && <div role="status" style={successBox}>{profileMsg}</div>}
          {profileErr && <div role="alert" style={errorBox}>{profileErr}</div>}

          <div style={fieldWrap}>
            <label htmlFor="profile-name" style={labelStyle}>Full name</label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!loaded}
              style={inputStyle}
            />
          </div>

          <div style={fieldWrap}>
            <label htmlFor="profile-email" style={labelStyle}>Email address (sign-in email, cannot be changed here)</label>
            <input id="profile-email" type="email" value={email} readOnly style={readOnlyStyle} />
          </div>

          <div style={fieldWrap}>
            <label htmlFor="profile-role" style={labelStyle}>Account type (fixed)</label>
            <input id="profile-role" type="text" value={ROLE_LABEL[role] || role || "—"} readOnly style={readOnlyStyle} />
          </div>

          <div style={fieldWrap}>
            <label htmlFor="profile-location" style={labelStyle}>Location / Terminal</label>
            <input
              id="profile-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Bulua Westbound"
              disabled={!loaded}
              style={inputStyle}
            />
          </div>

          <button type="submit" disabled={saving || !loaded} style={saveBtn(saving)}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>

      {/* Change Password */}
      <div style={sectionCard}>
        <p style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a", margin: "0 0 1.25rem" }}>
          Change password
        </p>

        <form onSubmit={handlePasswordSave}>
          {passMsg && <div role="status" style={successBox}>{passMsg}</div>}
          {passErr && <div role="alert" style={errorBox}>{passErr}</div>}

          <div style={fieldWrap}>
            <label htmlFor="pw-current" style={labelStyle}>Current password</label>
            <input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={fieldWrap}>
            <label htmlFor="pw-new" style={labelStyle}>New password</label>
            <input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={fieldWrap}>
            <label htmlFor="pw-confirm" style={labelStyle}>Confirm new password</label>
            <input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
            />
          </div>

          <button type="submit" disabled={changingPass} style={saveBtn(changingPass)}>
            {changingPass ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>

    </div>
  );
}
