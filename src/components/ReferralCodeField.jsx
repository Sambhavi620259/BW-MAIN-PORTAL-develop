/**
 * Referral code input — readOnly when applied from invite link (?ref=).
 */
export default function ReferralCodeField({
  id = "referral-code",
  value = "",
  locked = false,
  placeholder = "Referral Code / Name",
  label = "Referral Code / Name",
  icon = "🎟️",
  error = "",
  onChange,
  onBlur,
}) {
  const hasError = Boolean(error);

  return (
    <div className="reg-input-block">
      <label className="reg-label" htmlFor={id}>
        {label}
      </label>
      <div
        className={`reg-input-with-icon reg-referral-input-wrap${locked ? " reg-referral-locked-wrap" : ""}${hasError ? " reg-input-invalid" : ""}`}
      >
        <span className="reg-input-icon" aria-hidden>
          {icon}
        </span>
        <input
          id={id}
          type="text"
          className={`input reg-premium-input${locked ? " reg-referral-locked" : ""}`}
          placeholder={placeholder}
          value={value}
          readOnly={locked}
          aria-readonly={locked || undefined}
          onChange={onChange}
          onBlur={onBlur}
        />
        {locked ? (
          <span
            className="reg-referral-lock-icon"
            aria-hidden
            title="Referral code locked"
          >
            🔒
          </span>
        ) : null}
      </div>
      {locked ? (
        <p className="reg-referral-locked-hint" id={`${id}-hint`}>
          Referral code applied from invite link
        </p>
      ) : null}
      {hasError ? <div className="reg-field-error">{error}</div> : null}
    </div>
  );
}
