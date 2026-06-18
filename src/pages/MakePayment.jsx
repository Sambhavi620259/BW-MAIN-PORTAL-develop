import { useState } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import { paymentApi } from "../services";
import "./MakePayment.css";

const PAYMENT_TABS = [
  "Credit / Debit Card",
  "Net Banking",
  "UPI",
  "Wallet",
  "More",
];

export default function MakePayment() {
  const [activeTab, setActiveTab] = useState(0);

  const handleMakePayment = async () => {
    const response = await paymentApi.createPayment({
      planId: "standard",
      amount: 999.3,
      channel: PAYMENT_TABS[activeTab],
    });

    if (response?.success) {
      window.alert("Payment request created successfully");
    }
  };

  return (
    <div className="payment-page-wrap payment-page-one-screen">
      <div className="payment-content-area page-gradient">
        <div className="card-container payment-card">
          <header className="payment-inline-header">
            <div className="payment-nav-logo logo-white-box">
              <Logo to="/" />
            </div>
            <div className="payment-nav-center">
              <nav className="payment-nav">
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
            </div>
            <Link to="/login">
              <button type="button" className="btn btn-primary">
                Login / Sign Up
              </button>
            </Link>
          </header>

          <div className="payment-banner">
            <h1>Make Payment</h1>
            <p>Complete your purchase by entering your payment details!</p>
          </div>
          <div className="payment-main-card">
            <div className="payment-layout">
              <div className="payment-left">
                <div className="plan-summary">
                  <div className="plan-summary-top">
                    <div className="plan-info">
                      <span className="plan-avatar">👤</span>
                      <div>
                        <h3>Standard Plan</h3>
                        <span className="plan-badge">
                          <span className="star-yellow">★</span> Priority
                          support
                        </span>
                      </div>
                    </div>
                    <div className="plan-price-block">
                      <span className="plan-price">₹999 /month</span>
                      <button type="button" className="btn-change">
                        Change &gt;
                      </button>
                    </div>
                  </div>
                  <div className="plan-billing-row">
                    <div className="plan-rows-box">
                      <div className="plan-row">
                        <span>Plan Price</span>
                        <span>- 999.80</span>
                      </div>
                      <div className="plan-row">
                        <span>Discount (20% off)</span>
                        <span>- ₹199.80</span>
                      </div>
                    </div>
                    <div className="total-box">
                      <span className="total-label">Total Amount</span>
                      <p className="save-msg">
                        You save ₹199.50 with yearly billing!
                      </p>
                    </div>
                  </div>
                </div>

                <div className="payment-details-section">
                  <h2>Enter payment Details</h2>
                  <div className="payment-tabs">
                    {PAYMENT_TABS.map((tab, i) => (
                      <button
                        key={tab}
                        type="button"
                        className={`payment-tab ${i === activeTab ? "active" : ""}`}
                        onClick={() => setActiveTab(i)}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <div className="card-form">
                    <input
                      type="text"
                      className="input"
                      placeholder="Card Number xxxx xxx xx xx"
                    />
                    <div className="card-form-row">
                      <input
                        type="text"
                        className="input"
                        placeholder="Expiry Date MM/YY"
                      />
                      <input type="text" className="input" placeholder="CVV" />
                    </div>
                    <div className="payment-logos-inline">
                      <span>VISA</span>
                      <span>Mastercard</span>
                      <span>G Pay</span>
                      <span>Paytm</span>
                    </div>
                    <label className="checkbox-label">
                      <input type="checkbox" />
                      <span>Save this card for future payment</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="order-summary-side">
                <div className="order-summary-box">
                  <div className="order-row">Standard Plan</div>
                  <div className="order-row">Plan Price</div>
                  <div className="order-row">Discount (20% OFF)</div>
                  <div className="order-row">Total Amount</div>
                  <div className="order-row order-total">Payment Total</div>
                  <div className="payment-logos">
                    <span>VISA</span>
                    <span>Mastercard</span>
                    <span>G Pay</span>
                    <span>Paytm</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-pay-now"
                    onClick={handleMakePayment}
                  >
                    <span className="btn-cart-icon">🛒</span> Make Payment{" "}
                    <span className="btn-amount">₹999.30</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="payment-bottom-bar">
            <span className="bottom-bar-cart">🛒</span>
            <span>Make Payment</span>
            <span className="payment-amount">₹999.30</span>
          </div>
        </div>
      </div>
    </div>
  );
}
