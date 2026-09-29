'use client';

import React, { useState, useEffect } from 'react';
import Toast from '@/components/Toast';

interface RsvpResult {
  token: string;
  name: string;
  email: string;
  raNumber?: string;
  alreadyRsvpd: boolean;
  checkedIn?: boolean;
  checkInTime?: string;
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
  const [downloadingTicket, setDownloadingTicket] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
  }>({ visible: false, message: '', type: 'info' });

  const orgName = 'HTB Chennai';

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
          checkedIn: data.checkedIn ?? false,
          checkInTime: data.checkInTime,
          message: data.message,
          rsvpTime: data.rsvpTime,
        });

        const toastMsg = data.checkedIn
          ? 'Pass loaded: Already checked in'
          : data.alreadyRsvpd
          ? 'Pass loaded: Check-in pending'
          : 'RSVP confirmed!';
        showToast(
          toastMsg,
          data.checkedIn ? 'success' : data.alreadyRsvpd ? 'warning' : 'success'
        );

        // Generate QR code client-side using the secure token only (never plain email).
        // Kept separate from the fetch so a failed image render never discards a
        // pass that the server already confirmed.
        try {
          const QRCode = (await import('qrcode')).default;
          const url = await QRCode.toDataURL(data.token, {
            width: 720,
            margin: 2,
            color: { dark: '#0d0f0e', light: '#ffffff' },
            errorCorrectionLevel: 'H',
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

  const downloadFullTicket = async () => {
    if (!result || !qrDataUrl) return;
    setDownloadingTicket(true);

    try {
      const canvas = document.createElement('canvas');
      const baseWidth = 720;
      const baseHeight = 1040;
      const scale = 3; // 3x Ultra-HD crisp print quality (2160 x 3120px)
      canvas.width = baseWidth * scale;
      canvas.height = baseHeight * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(scale, scale);

      const width = baseWidth;
      const height = baseHeight;

      const drawRoundRect = (
        x: number,
        y: number,
        w: number,
        h: number,
        r: number
      ) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      };

      // 1. Outer Background
      ctx.fillStyle = '#0d0f0e';
      ctx.fillRect(0, 0, width, height);

      // 2. Ticket Body Card
      const cardX = 35;
      const cardY = 35;
      const cardW = width - 70;
      const cardH = height - 70;
      drawRoundRect(cardX, cardY, cardW, cardH, 24);
      ctx.fillStyle = '#141716';
      ctx.fill();
      ctx.strokeStyle = '#242826';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Top Stub Background
      ctx.save();
      drawRoundRect(cardX, cardY, cardW, 205, 24);
      ctx.clip();
      ctx.fillStyle = '#1a1d1b';
      ctx.fillRect(cardX, cardY, cardW, 205);
      ctx.restore();

      // Draw Logo
      await new Promise<void>((resolve) => {
        const logoImg = new Image();
        logoImg.onload = () => {
          ctx.drawImage(logoImg, 65, 55, 42, 42);
          resolve();
        };
        logoImg.onerror = () => resolve();
        logoImg.src = '/logo.png';
      });

      // Logo Text
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#f3f4f6';
      ctx.textAlign = 'left';
      ctx.fillText('HTB CHENNAI', 118, 82);

      // Status Badge
      const isDone = !!result.checkedIn;
      const badgeText = isDone ? 'CHECK-IN DONE' : 'CHECK-IN LEFT';
      ctx.font = 'bold 11px monospace';
      const badgeW = 145;
      const badgeH = 30;
      const badgeX = cardX + cardW - badgeW - 30;
      const badgeY = 60;
      drawRoundRect(badgeX, badgeY, badgeW, badgeH, 6);
      ctx.fillStyle = isDone ? 'rgba(159, 239, 0, 0.15)' : 'rgba(245, 158, 11, 0.15)';
      ctx.fill();
      ctx.strokeStyle = isDone ? '#9fef00' : '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = isDone ? '#9fef00' : '#f59e0b';
      ctx.textAlign = 'center';
      ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + 19);

      // Attendee Name
      ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = '#f3f4f6';
      ctx.textAlign = 'left';
      const nameText = result.name || 'Participant';
      ctx.fillText(nameText, 65, 142);

      // Chips row (RA & Email)
      let chipX = 65;
      if (result.raNumber) {
        ctx.font = 'bold 12px monospace';
        const raW = ctx.measureText(result.raNumber).width + 20;
        drawRoundRect(chipX, 160, raW, 26, 6);
        ctx.fillStyle = '#141716';
        ctx.fill();
        ctx.strokeStyle = '#323734';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#9fef00';
        ctx.fillText(result.raNumber, chipX + 10, 177);
        chipX += raW + 10;
      }

      ctx.font = '12px monospace';
      const emailW = ctx.measureText(result.email).width + 20;
      drawRoundRect(chipX, 160, emailW, 26, 6);
      ctx.fillStyle = '#141716';
      ctx.fill();
      ctx.strokeStyle = '#323734';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#c5c8c6';
      ctx.fillText(result.email, chipX + 10, 177);

      // Perforation Line with Side Cutouts (Exact Inward Semicircles, erasing outer vertical card border)
      const tearY = 235;
      const r1 = 20;
      ctx.fillStyle = '#0d0f0e';

      // Cutout Left: erase outer vertical border and curve inward to the right
      ctx.beginPath();
      ctx.rect(cardX - 10, tearY - r1 - 2, 11, (r1 + 2) * 2);
      ctx.arc(cardX, tearY, r1, -Math.PI / 2, Math.PI / 2);
      ctx.fill();

      // Cutout Right: erase outer vertical border and curve inward to the left
      ctx.beginPath();
      ctx.rect(cardX + cardW - 1, tearY - r1 - 2, 11, (r1 + 2) * 2);
      ctx.arc(cardX + cardW, tearY, r1, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.fill();

      // Dashed Line (Bold & Prominent)
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = '#4a524e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cardX + 28, tearY);
      ctx.lineTo(cardX + cardW - 28, tearY);
      ctx.stroke();
      ctx.setLineDash([]);

      // QR Code Container
      const qrBoxW = 340;
      const qrBoxH = 370;
      const qrBoxX = (width - qrBoxW) / 2;
      const qrBoxY = 275;
      drawRoundRect(qrBoxX, qrBoxY, qrBoxW, qrBoxH, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#242826';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Viewfinder Reticle Brackets on QR Box
      ctx.strokeStyle = '#141716';
      ctx.lineWidth = 2;
      const rL = 12;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(qrBoxX + 12, qrBoxY + 12 + rL);
      ctx.lineTo(qrBoxX + 12, qrBoxY + 12);
      ctx.lineTo(qrBoxX + 12 + rL, qrBoxY + 12);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(qrBoxX + qrBoxW - 12 - rL, qrBoxY + 12);
      ctx.lineTo(qrBoxX + qrBoxW - 12, qrBoxY + 12);
      ctx.lineTo(qrBoxX + qrBoxW - 12, qrBoxY + 12 + rL);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(qrBoxX + 12, qrBoxY + qrBoxH - 12 - rL);
      ctx.lineTo(qrBoxX + 12, qrBoxY + qrBoxH - 12);
      ctx.lineTo(qrBoxX + 12 + rL, qrBoxY + qrBoxH - 12);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(qrBoxX + qrBoxW - 12 - rL, qrBoxY + qrBoxH - 12);
      ctx.lineTo(qrBoxX + qrBoxW - 12, qrBoxY + qrBoxH - 12);
      ctx.lineTo(qrBoxX + qrBoxW - 12, qrBoxY + qrBoxH - 12 - rL);
      ctx.stroke();

      // Generate ultra-high resolution QR code (1200x1200px) with highest error correction
      let highResQr = qrDataUrl;
      try {
        const QRCode = (await import('qrcode')).default;
        highResQr = await QRCode.toDataURL(result.token, {
          width: 1200,
          margin: 1,
          color: { dark: '#0d0f0e', light: '#ffffff' },
          errorCorrectionLevel: 'H',
        });
      } catch {}

      // Draw QR Image
      await new Promise<void>((resolve) => {
        const qrImg = new Image();
        qrImg.onload = () => {
          ctx.drawImage(qrImg, qrBoxX + 25, qrBoxY + 22, 290, 290);
          resolve();
        };
        qrImg.onerror = () => resolve();
        qrImg.src = highResQr;
      });

      // Scan at venue caption
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'center';
      ctx.fillText('SCAN AT VENUE ENTRY', width / 2, qrBoxY + qrBoxH - 18);

      // Secondary Perforation Tear Line with Side Cutouts (Exact Inward Semicircles, erasing outer vertical card border)
      const tear2Y = 665;
      const r2 = 15;
      ctx.fillStyle = '#0d0f0e';

      // Left Cutout: erase outer vertical border and curve inward to the right
      ctx.beginPath();
      ctx.rect(cardX - 10, tear2Y - r2 - 2, 11, (r2 + 2) * 2);
      ctx.arc(cardX, tear2Y, r2, -Math.PI / 2, Math.PI / 2);
      ctx.fill();

      // Right Cutout: erase outer vertical border and curve inward to the left
      ctx.beginPath();
      ctx.rect(cardX + cardW - 1, tear2Y - r2 - 2, 11, (r2 + 2) * 2);
      ctx.arc(cardX + cardW, tear2Y, r2, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.fill();

      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = '#3e4541';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cardX + 22, tear2Y);
      ctx.lineTo(cardX + cardW - 22, tear2Y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ticket ID Box
      const idBoxY = 690;
      const idBoxW = cardW - 60;
      const idBoxX = cardX + 30;
      drawRoundRect(idBoxX, idBoxY, idBoxW, 68, 12);
      ctx.fillStyle = '#1a1d1b';
      ctx.fill();
      ctx.strokeStyle = '#242826';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#717875';
      ctx.fillText('TICKET ID', idBoxX + 20, idBoxY + 25);

      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = '#9fef00';
      ctx.fillText(result.token, idBoxX + 20, idBoxY + 50);

      // Barcode graphic in Ticket ID box
      const bcX = idBoxX + idBoxW - 120;
      const bcY = idBoxY + 20;
      const bcH = 30;
      const barWidths = [2, 1, 3, 2, 1, 4, 1, 2, 3, 1, 2, 4, 1, 3, 2, 1, 3, 1, 4, 2];
      let curBcX = bcX;
      ctx.fillStyle = '#4b5550';
      barWidths.forEach((bw, idx) => {
        if (idx % 2 === 0) {
          ctx.fillRect(curBcX, bcY, bw, bcH);
        }
        curBcX += bw + 1.5;
      });

      // Pass Details Guidelines
      const guideY = 775;
      drawRoundRect(idBoxX, guideY, idBoxW, 90, 12);
      ctx.fillStyle = 'rgba(26, 29, 27, 0.5)';
      ctx.fill();
      ctx.strokeStyle = '#242826';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#f3f4f6';
      ctx.fillText('PASS DETAILS', idBoxX + 20, guideY + 26);

      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.fillText('• Show this QR pass for venue entry check-in and refreshments.', idBoxX + 20, guideY + 50);
      ctx.fillText('• This pass is permanent and linked to your registered email.', idBoxX + 20, guideY + 70);

      // Footer
      ctx.font = '11px monospace';
      ctx.fillStyle = '#717875';
      ctx.textAlign = 'center';
      ctx.fillText('HTB CHENNAI', width / 2, cardY + cardH - 24);

      // Trigger Download
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${result.token}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('Downloaded full ticket pass!', 'success');
    } catch (err) {
      console.error('Download ticket error:', err);
      showToast('Failed to generate full ticket image. Please try again.', 'error');
    } finally {
      setDownloadingTicket(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-htb-bg text-htb-text flex flex-col items-center justify-center p-4">
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <div className="w-full max-w-md mx-auto my-auto">
        {/* Brand Header (Only shown before ticket is generated) */}
        {!result && (
          <div className="text-center mb-4 sm:mb-5">
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-xl bg-htb-elevated border border-htb-border font-mono shadow-md">
              <img
                src="/logo.png"
                alt="HTB Chennai Logo"
                className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
              />
              <span className="text-base sm:text-lg text-htb-heading font-bold tracking-wide">
                {orgName}
              </span>
            </div>
          </div>
        )}

        {/* ── TICKET PASS CONTAINER ── */}
        <div className="relative bg-htb-card border border-htb-border rounded-2xl shadow-2xl">
          {/* Initial Input State */}
          {!result && !errorMsg && (
            <div>
              {/* Ticket Top Stub */}
              <div className="px-5 pt-6 pb-4 sm:px-8 sm:pt-7 sm:pb-5 text-center bg-htb-elevated/30 rounded-t-2xl">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-htb-heading tracking-tight font-mono">
                  EVENT PASS
                </h1>
                <p className="text-xs sm:text-sm text-htb-muted mt-1.5 max-w-xs mx-auto">
                  Confirm your attendance to receive your event ticket
                </p>
              </div>

              {/* Ticket Perforation Tear Line with Side Cutouts (Half-Circles) */}
              <div className="relative flex items-center justify-between my-1">
                <div className="absolute -left-[2px] top-1/2 -translate-y-1/2 w-4 h-8 bg-htb-bg rounded-r-full z-20 pointer-events-none" />
                <div className="w-full border-t-2 border-dashed border-[#444c48] mx-5 sm:mx-6" />
                <div className="absolute -right-[2px] top-1/2 -translate-y-1/2 w-4 h-8 bg-htb-bg rounded-l-full z-20 pointer-events-none" />
              </div>

              {/* Ticket Body / Input Form */}
              <div className="p-5 sm:p-8 pt-5 rounded-b-2xl">
                <form onSubmit={handleRsvp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-htb-heading mb-1.5 font-mono">
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
              </div>
            </div>
          )}

          {/* Unregistered / Error State */}
          {errorMsg && !result && (
            <div>
              {/* Ticket Top Stub */}
              <div className="px-5 pt-6 pb-4 sm:px-8 sm:pt-7 sm:pb-5 text-center bg-htb-elevated/30 rounded-t-2xl">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-htb-heading tracking-tight font-mono">
                  EVENT PASS
                </h1>
              </div>

              {/* Ticket Perforation Tear Line with Side Cutouts (Half-Circles) */}
              <div className="relative flex items-center justify-between my-1">
                <div className="absolute -left-[2px] top-1/2 -translate-y-1/2 w-4 h-8 bg-htb-bg rounded-r-full z-20 pointer-events-none" />
                <div className="w-full border-t-2 border-dashed border-[#444c48] mx-5 sm:mx-6" />
                <div className="absolute -right-[2px] top-1/2 -translate-y-1/2 w-4 h-8 bg-htb-bg rounded-l-full z-20 pointer-events-none" />
              </div>

              <div className="p-5 sm:p-8 pt-5 space-y-4 rounded-b-2xl">
                <div className="rounded-lg border border-htb-error/30 bg-htb-error/10 p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-htb-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <h3 className="text-xs font-semibold text-htb-error font-mono">
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
            </div>
          )}

          {/* Pass Card (Success State) */}
          {result && (
            <div>
              {/* Issued Ticket Header Stub */}
              <div className="px-5 pt-6 pb-4 sm:px-8 sm:pt-7 sm:pb-5 text-center bg-htb-elevated/30 rounded-t-2xl">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="inline-flex items-center gap-2">
                    <img
                      src="/logo.png"
                      alt="HTB Logo"
                      className="w-5 h-5 sm:w-6 sm:h-6 object-contain"
                    />
                    <span className="font-mono text-xs sm:text-sm font-bold text-htb-heading tracking-wide">
                      {orgName}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 text-[10px] sm:text-xs font-semibold font-mono rounded border ${
                      result.checkedIn
                        ? 'border-htb-green/40 bg-htb-green/10 text-htb-green'
                        : 'border-htb-warning/40 bg-htb-warning/10 text-htb-warning'
                    }`}
                  >
                    {result.checkedIn ? 'CHECK-IN DONE' : 'CHECK-IN LEFT'}
                  </span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-extrabold text-htb-heading tracking-tight break-words">
                  {result.name || 'Participant'}
                </h2>

                <div className="flex flex-wrap items-center justify-center gap-2 mt-2.5">
                  {result.raNumber && (
                    <span className="text-xs font-semibold font-mono text-htb-text bg-htb-elevated border border-htb-border px-2.5 py-1 rounded-md select-all">
                      {result.raNumber}
                    </span>
                  )}
                  <span className="text-xs font-mono text-htb-text bg-htb-elevated border border-htb-border px-2.5 py-1 rounded-md select-all break-all">
                    {result.email}
                  </span>
                </div>
              </div>

              {/* Ticket Perforation Tear Line with Side Cutouts (Half-Circles) */}
              <div className="relative flex items-center justify-between my-1">
                <div className="absolute -left-[2px] top-1/2 -translate-y-1/2 w-4 h-8 bg-htb-bg rounded-r-full z-20 pointer-events-none" />
                <div className="w-full border-t-2 border-dashed border-[#444c48] mx-5 sm:mx-6" />
                <div className="absolute -right-[2px] top-1/2 -translate-y-1/2 w-4 h-8 bg-htb-bg rounded-l-full z-20 pointer-events-none" />
              </div>

              {/* Issued Ticket Body (QR Code, Token, Actions) */}
              <div className="p-5 sm:p-8 pt-5 space-y-5 animate-fade-in rounded-b-2xl">
                {/* QR Code Container */}
                {qrDataUrl && (
                  <div className="flex flex-col items-center">
                    <div className="relative bg-white p-3.5 sm:p-4 rounded-xl shadow-xl border border-neutral-300">
                      {/* Viewfinder Reticle Brackets */}
                      <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-neutral-800 rounded-tl-sm pointer-events-none" />
                      <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-neutral-800 rounded-tr-sm pointer-events-none" />
                      <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-neutral-800 rounded-bl-sm pointer-events-none" />
                      <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-neutral-800 rounded-br-sm pointer-events-none" />
                      <img
                        src={qrDataUrl}
                        alt={`Pass for ${result.name}`}
                        className="w-48 h-48 sm:w-56 sm:h-56 object-contain"
                      />
                      <div className="mt-2 pt-1 border-t border-dashed border-neutral-300 text-center">
                        <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-neutral-500">
                          Scan At Venue Entry
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-htb-muted mt-2 text-center">
                      Show this QR code at the venue entry for check-in
                    </p>
                  </div>
                )}

                {/* Secondary Perforation Tear Line with Side Cutouts (Half-Circles) */}
                <div className="relative flex items-center justify-between my-2 -mx-5 sm:-mx-8">
                  <div className="absolute -left-[2px] top-1/2 -translate-y-1/2 w-3.5 h-6 bg-htb-bg rounded-r-full z-20 pointer-events-none" />
                  <div className="w-full border-t border-dashed border-[#444c48] mx-5" />
                  <div className="absolute -right-[2px] top-1/2 -translate-y-1/2 w-3.5 h-6 bg-htb-bg rounded-l-full z-20 pointer-events-none" />
                </div>

                {/* Secure Token Box */}
                <div
                  onClick={copyToken}
                  title="Tap to copy Ticket ID"
                  className="bg-htb-elevated hover:bg-htb-elevated/80 border border-htb-border hover:border-htb-green/40 rounded-lg p-3 flex items-center justify-between gap-3 cursor-pointer transition-all active:scale-[0.99]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-htb-muted uppercase tracking-wider font-semibold font-mono">
                        Ticket ID (Tap to copy)
                      </p>
                      {/* Barcode Graphic */}
                      <div className="hidden sm:flex items-center gap-[2px] h-3 opacity-40 select-none mr-2">
                        <div className="w-[1.5px] h-full bg-htb-muted" />
                        <div className="w-[3px] h-full bg-htb-muted" />
                        <div className="w-[1px] h-full bg-htb-muted" />
                        <div className="w-[2px] h-full bg-htb-muted" />
                        <div className="w-[3.5px] h-full bg-htb-muted" />
                        <div className="w-[1px] h-full bg-htb-muted" />
                        <div className="w-[2px] h-full bg-htb-muted" />
                        <div className="w-[4px] h-full bg-htb-muted" />
                        <div className="w-[1px] h-full bg-htb-muted" />
                        <div className="w-[2.5px] h-full bg-htb-muted" />
                        <div className="w-[1px] h-full bg-htb-muted" />
                        <div className="w-[3px] h-full bg-htb-muted" />
                      </div>
                    </div>
                    <p className="text-xs sm:text-sm font-mono font-bold text-htb-green truncate">
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
                  <div className="flex items-center gap-1.5 text-htb-heading font-medium text-xs font-mono">
                    <svg className="w-3.5 h-3.5 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Pass Details</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-[11px]">
                    <li>This QR pass is your verified access ticket for <strong>Venue Check-in</strong> and <strong>Refreshments</strong>.</li>
                    <li>Your pass is permanent and can be accessed anytime by entering your email.</li>
                  </ul>
                </div>

                {/* Action Buttons */}
                <div className="space-y-2 pt-1">
                  {qrDataUrl && (
                    <button
                      onClick={downloadFullTicket}
                      disabled={downloadingTicket}
                      className="w-full h-12 bg-htb-green hover:bg-htb-green-dim disabled:opacity-50 text-htb-bg font-semibold rounded-lg text-sm transition-all duration-150 flex items-center justify-center gap-2 active:scale-[0.99]"
                    >
                      {downloadingTicket ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-htb-bg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                          </svg>
                          <span>Generating Full Ticket...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          <span>Download Ticket Pass (PNG)</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={reset}
                    className="w-full h-10 border border-htb-border hover:bg-htb-elevated text-htb-muted hover:text-htb-heading rounded-lg text-xs transition-colors"
                  >
                    Look Up Another Email
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {/* Footer */}
        <footer className="text-center text-xs text-htb-muted pt-6 pb-2">
          <p>{orgName} &bull; Official Event Portal</p>
        </footer>
      </div>
    </div>
  );
}
