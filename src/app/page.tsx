'use client';

import React, { useState, useEffect } from 'react';
import Toast from '@/components/Toast';

interface RsvpResult {
  token: string;
  name: string;
  email: string;
  raNumber?: string;
  alreadyRsvpd: boolean;
  message: string;
  rsvpTime?: string;
}

export default function RsvpPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RsvpResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
  }>({ visible: false, message: '', type: 'info' });

  const orgName = 'Hack The Box Chennai';

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'warning' | 'info'
  ) => {
    setToast({ visible: true, message, type });
  };

  const submitEmailRsvp = async (targetEmail: string) => {
    if (!targetEmail) return;

    setLoading(true);
    setErrorMsg('');
    setResult(null);

    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        setErrorMsg('');
        setResult({
          token: data.token,
          name: data.name,
          email: data.email,
          raNumber: data.raNumber,
          alreadyRsvpd: data.alreadyRsvpd,
          message: data.message,
          rsvpTime: data.rsvpTime,
        });

        showToast(
          data.message || (data.alreadyRsvpd ? 'RSVP already completed.' : 'RSVP confirmed!'),
          data.alreadyRsvpd ? 'info' : 'success'
        );

        // Generate QR code client-side using the secure token only (never plain email).
        // Kept separate from the fetch so a failed image render never discards a
        // pass that the server already confirmed.
        try {
          const QRCode = (await import('qrcode')).default;
          const url = await QRCode.toDataURL(data.token, {
            width: 360,
            margin: 2,
            color: { dark: '#0d0f0e', light: '#ffffff' },
          });
          setQrDataUrl(url);
        } catch (qrErr) {
          console.error('QR generation failed:', qrErr);
          setQrDataUrl('');
          showToast('Pass confirmed, but the QR image failed to load. Please retry.', 'error');
        }
      } else {
        const msg = data.message || 'This email is not registered for this event.';
        setResult(null);
        setQrDataUrl('');
        setErrorMsg(msg);
        showToast(msg, 'error');
      }
    } catch {
      setResult(null);
      setQrDataUrl('');
      const connErr = 'Could not connect to server. Please try again.';
      setErrorMsg(connErr);
      showToast(connErr, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitEmailRsvp(email);
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlEmail = params.get('email');
      if (urlEmail) {
        setEmail(urlEmail);
        submitEmailRsvp(urlEmail);
      }
    }
  }, []);

  const copyToken = () => {
    if (!result?.token) return;
    navigator.clipboard.writeText(result.token);
    setCopied(true);
    showToast('Ticket ID copied to clipboard', 'info');
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setResult(null);
    setErrorMsg('');
    setEmail('');
    setQrDataUrl('');
  };

  return (
    <div className="min-h-screen bg-htb-bg text-htb-text flex flex-col justify-between p-4 sm:p-6">
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <div className="w-full max-w-md mx-auto my-auto py-6 sm:py-10">
        {/* Brand Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center mb-3 px-4 py-1.5 rounded-full bg-htb-green/10 border border-htb-green/40 backdrop-blur-md shadow-[inset_0_1px_0_rgba(159,239,0,0.18)] text-xs font-medium tracking-wide text-htb-green">
            <span>{orgName}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-htb-heading tracking-tight">
            Event Pass
          </h1>
          <p className="text-xs sm:text-sm text-htb-muted mt-1.5 max-w-sm mx-auto">
            Confirm your attendance to receive your event ticket for venue access and refreshments.
          </p>
        </div>

        {/* Card */}
        <div className="bg-htb-card border border-htb-border rounded-xl p-5 sm:p-8 shadow-xl">
          {/* Initial Input State */}
          {!result && !errorMsg && (
            <form onSubmit={handleRsvp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-htb-heading mb-1.5">
                  Registered Email Address
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-12 bg-htb-elevated border border-htb-border rounded-lg px-3.5 text-htb-heading placeholder-htb-muted text-sm focus:border-htb-green focus:ring-1 focus:ring-htb-green transition-all"
                    placeholder="you@example.com"
                    required
                    disabled={loading}
                    autoFocus
                  />
                </div>
                <p className="text-xs text-htb-muted mt-1.5 leading-relaxed">
                  Please use the email ID you provided during initial registration.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-htb-green hover:bg-htb-green-dim disabled:opacity-50 text-htb-bg font-semibold rounded-lg text-sm transition-all duration-150 flex items-center justify-center gap-2 active:scale-[0.99]"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-htb-bg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                    <span>Verifying Email...</span>
                  </>
                ) : (
                  <span>Confirm RSVP & View Pass</span>
                )}
              </button>
            </form>
          )}

          {/* Unregistered / Error State */}
          {errorMsg && !result && (
            <div className="space-y-4">
              <div className="rounded-lg border border-htb-error/30 bg-htb-error/10 p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-htb-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <h3 className="text-xs font-semibold text-htb-error">
                      {errorMsg.toLowerCase().includes('not registered')
                        ? 'Registration Not Found'
                        : 'Something went wrong'}
                    </h3>
                    <p className="text-xs text-htb-text mt-1 leading-relaxed">{errorMsg}</p>
                    {errorMsg.toLowerCase().includes('not registered') && (
                      <p className="text-[11px] text-htb-muted mt-2">
                        Please check for typos or try the alternate email you registered with.
                      </p>
                    )}
                  </div>

                </div>
              </div>

              <button
                onClick={reset}
                className="w-full h-11 border border-htb-border hover:bg-htb-elevated text-htb-heading font-medium rounded-lg text-xs transition-colors"
              >
                &larr; Try With Another Email
              </button>
            </div>
          )}

          {/* Pass Card (Success State) */}
          {result && (
            <div className="space-y-5 animate-fade-in">
              {/* Header Details */}
              <div className="text-center pb-1">
                <span
                  className={`inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full border ${
                    result.alreadyRsvpd
                      ? 'border-htb-warning/40 bg-htb-warning/10 text-htb-warning'
                      : 'border-htb-green/40 bg-htb-green/10 text-htb-green'
                  }`}
                >
                  {result.alreadyRsvpd ? 'RSVP already completed' : 'RSVP confirmed'}
                </span>
                <h2 className="text-xl sm:text-2xl font-bold text-htb-heading mt-2.5 break-words">
                  {result.name || 'Participant'}
                </h2>
                {result.raNumber && (
                  <span className="text-sm font-semibold font-mono text-htb-text bg-htb-elevated border border-htb-border px-2.5 py-1 rounded-md inline-block mt-2 select-all">
                    {result.raNumber}
                  </span>
                )}
                <span className="text-xs sm:text-sm font-mono text-htb-text bg-htb-elevated border border-htb-border px-2.5 py-1 rounded-md inline-block mt-2 break-all select-all">
                  {result.email}
                </span>
              </div>

              {/* QR Code Container */}
              {qrDataUrl && (
                <div className="flex flex-col items-center">
                  <div className="bg-white p-3.5 rounded-xl shadow-lg border border-htb-border/40">
                    <img
                      src={qrDataUrl}
                      alt={`Pass for ${result.name}`}
                      className="w-48 h-48 sm:w-56 sm:h-56 object-contain"
                    />
                  </div>
                  <p className="text-[11px] text-htb-muted mt-2">
                    Show this QR code at the venue for check-in and refreshments
                  </p>
                </div>
              )}

              {/* Secure Token Box */}
              <div
                onClick={copyToken}
                title="Tap to copy Ticket ID"
                className="bg-htb-elevated hover:bg-htb-elevated/80 border border-htb-border hover:border-htb-green/40 rounded-lg p-3 flex items-center justify-between gap-3 cursor-pointer transition-all active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <p className="text-[10px] text-htb-muted uppercase tracking-wider font-semibold">
                    Ticket ID (Tap to copy)
                  </p>
                  <p className="text-xs sm:text-sm font-mono font-bold text-htb-green truncate mt-0.5">
                    {result.token}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToken();
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium border border-htb-border hover:bg-htb-card rounded text-htb-text hover:text-htb-heading transition-colors shrink-0 flex items-center gap-1.5"
                >
                  {copied ? (
                    <>
                      <svg className="w-3.5 h-3.5 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-htb-green font-semibold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5 text-htb-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Pass Guidelines */}
              <div className="text-xs text-htb-muted bg-htb-elevated/40 border border-htb-border/40 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-htb-heading font-medium text-xs">
                  <svg className="w-3.5 h-3.5 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Pass Details</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px]">
                  <li>This QR pass is valid for both <strong>Venue Check-in</strong> and <strong>Refreshment Collection</strong>.</li>
                  <li>Your pass is permanent and can be accessed anytime by entering your email.</li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                {qrDataUrl && (
                  <a
                    href={qrDataUrl}
                    download={`HTB-Chennai-Pass-${result.token}.png`}
                    className="w-full h-12 bg-htb-green hover:bg-htb-green-dim text-htb-bg font-semibold rounded-lg text-sm transition-all duration-150 flex items-center justify-center gap-2 active:scale-[0.99]"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>Download Ticket Pass (PNG)</span>
                  </a>
                )}
                <button
                  onClick={reset}
                  className="w-full h-10 border border-htb-border hover:bg-htb-elevated text-htb-muted hover:text-htb-heading rounded-lg text-xs transition-colors"
                >
                  Look Up Another Email
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center text-xs text-htb-muted py-4">
        <p>{orgName} &bull; Official Event Portal</p>
      </footer>
    </div>
  );
}
