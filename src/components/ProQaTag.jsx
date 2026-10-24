import { PRO_QA_LABEL, qaProOpen } from '../lib/pro.js';

/**
 * Discreet reminder that the paywall is open on purpose (quality-control build). Renders nothing once PRO_QA_OPEN is
 * switched off in lib/pro.js.
 */
export default function ProQaTag({ className = '' }) {
  if (!qaProOpen()) return null;
  return (
    <span data-testid="qa-pro-tag" className={`select-none text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4af37]/60 ${className}`}>
      {PRO_QA_LABEL}
    </span>
  );
}
