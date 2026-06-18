import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import { plansApi } from "../services";
import "./PlansPricing.css";

const PLANS = [
  {
    id: "basic",
    name: "Basic",
    tag: "Start Here",
    tagStyle: "blue",
    priceMonthly: 499,
    priceYearly: 1499,
    icon: "person",
    features: [
      "Access to basic application",
      "Email support",
      "Up to 5 request per month",
    ],
  },
  {
    id: "standard",
    name: "Standard",
    tag: "Most Popular",
    tagStyle: "orange",
    priceMonthly: 999,
    priceYearly: 2999,
    icon: "star",
    features: [
      "Access to all application",
      "Priority email & chat support",
      "Up to 20 requests per month",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    tag: "Best Value",
    tagStyle: "blue",
    priceMonthly: 1999,
    priceYearly: 3999,
    icon: "diamond",
    features: [
      "Access to all application",
      "Dedicated account manager",
      "Unlimited requests",
    ],
  },
];

export default function PlansPricing() {
  const [yearly, setYearly] = useState(false);
  const [plans, setPlans] = useState(PLANS);

  useEffect(() => {
    let isMounted = true;

    const loadPlans = async () => {
      const list = await plansApi.getPlans();
      if (!isMounted) return;
      if (Array.isArray(list) && list.length) {
        setPlans(list);
      }
    };

    loadPlans();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="page-gradient plans-page">
      <div className="card-container plans-card">
        <header className="plans-header">
          <Logo to="/" />
          <nav className="plans-nav">
            <Link to="/plans" className="nav-link">
              Home
            </Link>
            <Link to="/plans" className="nav-link">
              About Us
            </Link>
            <Link to="/plans" className="nav-link">
              Contact
            </Link>
          </nav>
          <Link to="/login">
            <button type="button" className="btn btn-primary">
              Login / Sign Up
            </button>
          </Link>
        </header>

        <h1 className="plans-title">Plans & Pricing</h1>
        <p className="plans-subtitle">
          Choose the best plan that suits your needs.
        </p>

        <div className="toggle-wrap">
          <div className="toggle-inner">
            <button
              type="button"
              className={`toggle-btn ${!yearly ? "active" : ""}`}
              onClick={() => setYearly(false)}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`toggle-btn ${yearly ? "active" : ""}`}
              onClick={() => setYearly(true)}
            >
              Yearly
              <span className="save-badge">Save 20%</span>
            </button>
          </div>
        </div>

        <div className="pricing-grid">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`pricing-card pricing-card-${plan.id}`}
            >
              <div className="pricing-card-header">
                <span className={`pricing-icon pricing-icon-${plan.icon}`}>
                  {plan.icon === "person" && (
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  )}
                  {plan.icon === "star" && (
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                    </svg>
                  )}
                  {plan.icon === "diamond" && (
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M19 3H5L2 9l10 12L22 9l-3-6zM9.62 8l1.5-3h1.76l1.5 3H9.62zM11 10v6.68L5.44 10H11zm2 0h5.56L13 16.68V10zM17.38 8l-1.5-3h1.76l1.5 3H17.38z" />
                    </svg>
                  )}
                </span>
                <h3 className="pricing-name">{plan.name}</h3>
                <span className={`pricing-tag pricing-tag-${plan.tagStyle}`}>
                  {plan.tag}
                </span>
              </div>
              <p className="pricing-price">
                ₹{" "}
                {(yearly ? plan.priceYearly : plan.priceMonthly).toLocaleString(
                  "en-IN",
                )}{" "}
                <span>/month</span>
                {yearly && (
                  <span className="pricing-yearly-note">billed yearly</span>
                )}
              </p>
              <ul className="pricing-features">
                {plan.features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <Link to="/payment">
                <button type="button" className="btn btn-primary pricing-cta">
                  Get Started
                </button>
              </Link>
            </div>
          ))}
        </div>

        <div className="support-section-wrap">
          <div className="support-box">
            <p>
              Have a questions? Reach out to our support team for assistance.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-contact-support"
              onClick={() => window.location.assign("/support/chat")}
            >
              Contact Support
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
