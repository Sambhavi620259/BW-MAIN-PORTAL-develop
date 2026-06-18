import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Header.css";

export default function Header() {
  const [showPopup, setShowPopup] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const navigate = useNavigate();

  const handleAvatarClick = () => {
    setShowPopup(!showPopup);
  };

  const handleOptionClick = (option) => {
    setShowPopup(false);
    if (option === "My Profile") {
      navigate("/profile");
    } else if (option === "Settings") {
      navigate("/settings");
    } else if (option === "Logout") {
      alert("Logged out");
      // navigate("/login"); // if you add login route later
    }
  };

  const navItems = [
    "My Home",
    "Custom App Space",
    "Document Management",
    "Bills Of Materials",
    "Production Planning",
    "Lean Manufacturing",
    "More ▾",
  ];

  const handleNavClick = () => {
    setShowMobileMenu(false);
  };

  return (
    <div className="header-container">
      {/* Top white bar */}
      <div className="topbar">
        <div className="logo">
          <span className="logo-icon">W</span>
          <span className="logo-text">Bold and Wise</span>
        </div>

        <div className="top-icons">
          <span>🔍</span>
          <span>⚙️</span>
          <span>❤️</span>
          <div className="avatar" onClick={handleAvatarClick}>
            JK
            {showPopup && (
              <div className="popup">
                <button onClick={() => handleOptionClick("My Profile")}>
                  My Profile
                </button>
                <button onClick={() => handleOptionClick("Settings")}>
                  Settings
                </button>
                <button onClick={() => handleOptionClick("Logout")}>
                  Logout
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setShowMobileMenu((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={showMobileMenu}
          >
            ☰
          </button>
        </div>
      </div>

      {/* Blue navbar */}
      <div className={`navbar ${showMobileMenu ? "open" : ""}`}>
        <div className="navbar-items">
          {navItems.map((item, index) => (
            <span
              key={item}
              className={index === 0 ? "active" : ""}
              onClick={handleNavClick}
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
