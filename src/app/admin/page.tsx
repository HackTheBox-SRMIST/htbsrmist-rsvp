'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Toast from '@/components/Toast';

// Dark badge shared by every email / RA pair in the participant views, so the
// same two values look identical in the list, the card and the popup. Styled
// like the existing Ticket ID chip so it reads as part of the app.
const BADGE =
  'inline-flex items-center rounded-md border border-htb-border bg-htb-elevated px-1.5 py-0.5 font-mono text-htb-text';

interface Stats {
  totalRegistered: number;
  totalRsvp: number;
  totalCheckedIn: number;
  totalRefreshment: number;
  pendingCheckins: number;
  pendingRefreshments: number;
}

interface Attendee {
  id: string;
  name: string;
  email: string;
  raNumber?: string;
  hasRsvp: boolean;
  rsvpTime: string | null;
  hasCheckedIn: boolean;
  checkInTime: string | null;
  hasRefreshment: boolean;
  refreshmentTime: string | null;
}

interface LookupResult {
  id: string;
  name: string;
  email: string;
  raNumber?: string;
  rsvp: boolean;
  rsvpTime: string | null;
  checkedIn: boolean;
  checkInTime: string | null;
  refreshment: boolean;
  refreshmentTime: string | null;
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Tabs: 'table' | 'scanner'
  const [activeTab, setActiveTab] = useState<'table' | 'scanner'>('scanner');
  const [stationMode, setStationMode] = useState<'checkin' | 'refreshment' | 'info'>('checkin');
  const stationModeRef = useRef(stationMode);
  useEffect(() => {
    stationModeRef.current = stationMode;
  }, [stationMode]);

  // Import JSON Modal states
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewCount, setImportPreviewCount] = useState<number | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  const playScanBeep = () => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(80);
      }
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch {}
  };
  const [scannerActive, setScannerActive] = useState(false);
  // Bumped to force the camera effect to rebuild a dead scanner instance.
  const [scannerEpoch, setScannerEpoch] = useState(0);
  const [modalParticipant, setModalParticipant] = useState<LookupResult | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const scannerRef = useRef<any>(null);
  const isProcessingScanRef = useRef(false);
  const isScannerStartingRef = useRef(false);
  // Suppresses repeat scans of the same pass while it stays in front of the camera
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  // Scanning surfaces the result as the Participant Details popup, which the
  // admin dismisses with the cross before handling the next pass.
  const openParticipant = (participant: LookupResult) => {
    setModalParticipant(participant);
    // Freeze the decoder while the popup is up. The pass is often still held
    // in front of the lens, and a live scanner would keep re-reading it.
    try {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.pause(true);
      }
    } catch {}
  };

  const closeParticipant = () => {
    setModalParticipant(null);
    setActionMessage('');
    // "Close & Scan Next" has to hand the camera straight back, and clear the
    // duplicate-scan window so the next pass registers on the first frame
    // instead of being ignored as a repeat.
    lastScanRef.current = { code: '', at: 0 };
    try {
      if (scannerRef.current?.getState?.() === 3 /* PAUSED */) {
        scannerRef.current.resume();
        return;
      }
    } catch {}
    // The instance is dead (stream ended while paused, resume rejected it).
    // Drop it and bump the epoch so the effect rebuilds a working camera rather
    // than leaving the desk looking at a frozen frame.
    if (scannerRef.current) {
      scannerRef.current = null;
      setScannerEpoch((n) => n + 1);
    }
  };

  // Toast
  const [toast, setToast] = useState({
    visible: false,
    message: '',
    type: 'info' as 'success' | 'error' | 'warning' | 'info',
  });

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => {
    setToast({ visible: true, message, type });
  };

  // One-tap copy ticket ID helper
  const [copiedTicketId, setCopiedTicketId] = useState<string | null>(null);

  const copyTicketId = (ticketId: string) => {
    if (!ticketId || ticketId === 'No ticket' || ticketId === 'No Ticket') return;
    navigator.clipboard.writeText(ticketId);
    setCopiedTicketId(ticketId);
    showToast(`Copied ${ticketId}`, 'info');
    setTimeout(() => {
      setCopiedTicketId(null);
    }, 2000);
  };

  const fetchData = useCallback(
    async (pass: string = password) => {
      try {
        const res = await fetch(`/api/export?format=json`, {
        headers: { 'x-admin-password': pass },
      });
        if (res.status === 401) throw new Error('Invalid admin password');
        if (!res.ok) throw new Error('Failed to load attendee data');
        const data = await res.json();

        const rawList: any[] = Array.isArray(data) ? data : data.attendees || [];
        const totalRegistered = rawList.length;
        const totalRsvp = rawList.filter((a: any) => a.rsvp === true || a.rsvp === 'YES').length;
        const totalCheckedIn = rawList.filter((a: any) => a.checkin === true || a.checked_in === true || a.checkedIn === 'YES').length;
        const totalRefreshment = rawList.filter((a: any) => a.refreshments === true || a.refreshment === true || a.refreshment === 'YES').length;
        const pendingCheckins = Math.max(0, totalRsvp - totalCheckedIn);
        const pendingRefreshments = Math.max(0, totalCheckedIn - totalRefreshment);

        setStats({
          totalRegistered,
          totalRsvp,
          totalCheckedIn,
          totalRefreshment,
          pendingCheckins,
          pendingRefreshments,
        });

        const list: Attendee[] = rawList.map((a: any) => ({
          id: a.id || a.attendee_id || a.token || a.attendeeId || '',
          name: a.name || '',
          email: a.email || '',
          raNumber: a.ra_number || a.raNumber || a.ra || a.usn || '',
          hasRsvp: a.rsvp === true || a.rsvp === 'YES',
          rsvpTime: a.rsvp_time || a.rsvpTime || null,
          hasCheckedIn: a.checkin === true || a.checked_in === true || a.checkedIn === 'YES',
          checkInTime: a.checkin_time || a.check_in_time || a.checkInTime || null,
          hasRefreshment: a.refreshments === true || a.refreshment === true || a.refreshment === 'YES',
          refreshmentTime: a.refreshment_time || a.refreshmentTime || null,
        }));

        setAttendees(list);

        // Update the open participant popup with the latest data
        if (modalParticipant) {
          const updatedModal = list.find(
            (item) =>
              (modalParticipant.id && item.id === modalParticipant.id) ||
              item.email.toLowerCase() === modalParticipant.email.toLowerCase()
          );
          if (updatedModal) {
            setModalParticipant({
              id: updatedModal.id,
              name: updatedModal.name,
              email: updatedModal.email,
              raNumber: updatedModal.raNumber,
              rsvp: updatedModal.hasRsvp,
              rsvpTime: updatedModal.rsvpTime,
              checkedIn: updatedModal.hasCheckedIn,
              checkInTime: updatedModal.checkInTime,
              refreshment: updatedModal.hasRefreshment,
              refreshmentTime: updatedModal.refreshmentTime,
            });
          }
        }

        return true;
      } catch (err: any) {
        setError(err.message);
        return false;
      }
    },
    [password, modalParticipant]
  );

  // Handle File Selection for Import JSON
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed.attendees || parsed.records || [];
      const valid = list.filter((item: any) => item.email && item.email.includes('@'));
      setImportPreviewCount(valid.length);
      if (valid.length === 0) {
        setImportError('No valid participant records with email found in JSON.');
      }
    } catch {
      setImportPreviewCount(null);
      setImportError('Invalid JSON format.');
    }
  };

  // Execute Import JSON (Merge vs Replace)
  const handleExecuteImport = async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportError('');
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('mode', importMode);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        headers: { 'x-admin-password': password },
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Import successful', 'success');
        setImportModalOpen(false);
        setImportFile(null);
        setImportPreviewCount(null);
        if (jsonFileInputRef.current) {
          jsonFileInputRef.current.value = '';
        }
        await fetchData();
      } else {
        setImportError(data.message || 'Import failed.');
        showToast(data.message || 'Import failed', 'error');
      }
    } catch {
      setImportError('Network error while uploading JSON.');
      showToast('Network error while uploading JSON', 'error');
    } finally {
      setImportLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const success = await fetchData(password);
    if (success) {
      setIsAuthenticated(true);
      showToast('Signed in successfully', 'success');
    } else {
      showToast('Incorrect password', 'error');
    }
    setLoading(false);
  };

  // Lookup participant by token or email
  const handleLookup = async (tokenOrEmail: string) => {
    const query = tokenOrEmail.trim();
    if (!query) return;

    setActionMessage('');
    try {
      const isEmail = query.includes('@');
      const body = isEmail ? { email: query } : { token: query };
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success && data.participant) {
        showToast(`Loaded ${data.participant.name || query}`, 'info');
        openParticipant(data.participant);
      } else {
        showToast(data.message || 'Participant not found', 'error');
      }
    } catch {
      showToast('Lookup error', 'error');
    }
  };

  // Mark Check-in
  const handleMarkCheckin = async (token: string, email?: string) => {
    setActionLoading(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email }),
      });
      const data = await res.json();

      if (data.status === 'CHECK_IN_SUCCESS') {
        showToast('Check-in marked successfully!', 'success');
        setActionMessage('Check-in marked successfully!');
      } else if (data.status === 'ALREADY_CHECKED_IN') {
        showToast('Check-in already completed.', 'warning');
        setActionMessage(`Check-in already completed (${formatTime(data.checkInTime)})`);
      } else if (data.status === 'NO_RSVP') {
        showToast('Participant has not confirmed RSVP yet.', 'error');
        setActionMessage('Participant has not confirmed RSVP yet.');
      } else if (data.status === 'INVALID_TOKEN') {
        showToast('No registered participant found for this token.', 'error');
        setActionMessage('No registered participant found for this token.');
      } else {
        showToast(data.message || 'Check-in failed', 'error');
        setActionMessage(data.message);
      }

      if (data.participant) {
        openParticipant(data.participant);
      }
      await fetchData();
    } catch {
      showToast('Connection error during check-in', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Mark Refreshment
  const handleMarkRefreshment = async (token: string, email?: string) => {
    setActionLoading(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/refreshment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email }),
      });
      const data = await res.json();

      if (data.status === 'REFRESHMENT_SUCCESS') {
        showToast('Refreshment marked as collected!', 'success');
        setActionMessage('Refreshment marked as collected!');
      } else if (data.status === 'ALREADY_COLLECTED') {
        showToast('Refreshment already collected.', 'warning');
        setActionMessage(`Refreshment already collected (${formatTime(data.refreshmentTime)})`);
      } else if (data.status === 'NOT_CHECKED_IN') {
        showToast('Participant must complete gate check-in first.', 'warning');
        setActionMessage('Participant must complete gate check-in first.');
      } else if (data.status === 'NO_RSVP') {
        showToast('Participant has not confirmed RSVP yet.', 'error');
        setActionMessage('Participant has not confirmed RSVP yet.');
      } else if (data.status === 'INVALID_TOKEN') {
        showToast('No registered participant found for this token.', 'error');
        setActionMessage('No registered participant found for this token.');
      } else {
        showToast(data.message || 'Action failed', 'error');
        setActionMessage(data.message);
      }

      if (data.participant) {
        openParticipant(data.participant);
      }
      await fetchData();
    } catch {
      showToast('Connection error during refreshment action', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // High-speed auto scan handler
  const handleCameraScan = async (decodedText: string) => {
    if (isProcessingScanRef.current) return;
    isProcessingScanRef.current = true;

    // Trigger instant chime & vibration (Google Pay / Paytm style feedback)
    playScanBeep();

    // Clean decodedText: handle URL query params like ?email=... or ?token=... or /pass/...
    let clean = decodedText.trim();
    if (clean.includes('token=')) {
      const m = clean.match(/token=([A-Za-z0-9\-]+)/);
      if (m) clean = m[1];
    } else if (clean.includes('email=')) {
      const m = clean.match(/email=([^&]+)/);
      if (m) clean = decodeURIComponent(m[1]);
    } else if (clean.includes('/pass/')) {
      clean = clean.split('/pass/').pop()?.split(/[?#]/)[0] || clean;
    }

    // A pass that is still sitting in front of the camera decodes many times per
    // second. Only act on it once, so the desk does not re-fire the same action.
    const nowMs = Date.now();
    if (lastScanRef.current.code === clean && nowMs - lastScanRef.current.at < 8000) {
      return;
    }
    lastScanRef.current = { code: clean, at: nowMs };

    const currentMode = stationModeRef.current;
    try {
      if (currentMode === 'checkin') {
        await handleMarkCheckin(clean);
      } else if (currentMode === 'refreshment') {
        await handleMarkRefreshment(clean);
      } else {
        await handleLookup(clean);
      }
    } finally {
      setTimeout(() => {
        isProcessingScanRef.current = false;
      }, 600); // short cooldown so a genuinely new pass is picked up instantly
    }
  };

  // High-speed, Google Pay / Paytm style camera setup with instant zero-glitch tab switching
  useEffect(() => {
    let isMounted = true;

    if (!isAuthenticated) return;

    if (activeTab === 'scanner' && scannerActive) {
      // If scanner is already running, nothing to do
      if (scannerRef.current && scannerRef.current.getState?.() === 2 /* SCANNING */) {
        return;
      }

      // If scanner was paused, resume it instantly without restarting camera
      if (scannerRef.current && scannerRef.current.getState?.() === 3 /* PAUSED */) {
        try {
          scannerRef.current.resume();
          return;
        } catch {
          // If resume fails, fall through to re-init
        }
      }

      if (isScannerStartingRef.current) return;
      isScannerStartingRef.current = true;

      const initScanner = async () => {
        try {
          const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

          if (!isMounted) return;

          // Stop and clear any previous instance
          if (scannerRef.current) {
            try {
              if (scannerRef.current.isScanning) {
                await scannerRef.current.stop();
              }
              scannerRef.current.clear();
            } catch {}
          }

          // Initialize with native GPU BarcodeDetector & QR code only
          const html5Qrcode = new Html5Qrcode('admin-qr-reader', {
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            verbose: false,
            experimentalFeatures: {
              useBarCodeDetectorIfSupported: true, // Native browser GPU acceleration
            },
          });
          scannerRef.current = html5Qrcode;

          // Full-frame scanning: no `qrbox`, so the decoder receives the entire
          // camera picture. `aspectRatio` is deliberately omitted so the stream
          // keeps its native ratio and nothing is cropped away.
          //
          // The decoder canvas is sized from the viewfinder's CSS pixels, so a
          // larger viewfinder means more pixels for the QR to be read from -
          // that is what lets an off-centre pass still resolve. Keep this box
          // unclamped in height.
          const scanConfig = {
            fps: 60, // Aggressive decode attempts per second
            disableFlip: false,
          };

          // 1. Try back/environment camera (phones)
          try {
            await html5Qrcode.start(
              { facingMode: 'environment' },
              scanConfig,
              (decodedText: string) => {
                handleCameraScan(decodedText);
              },
              () => {}
            );
          } catch (envErr) {
            console.warn('Environment camera unavailable, falling back to default camera:', envErr);
            // 2. Fallback to front/user camera (laptops, webcams)
            await html5Qrcode.start(
              { facingMode: 'user' },
              scanConfig,
              (decodedText: string) => {
                handleCameraScan(decodedText);
              },
              () => {}
            );
          }
        } catch (err: any) {
          console.error('Camera init error:', err);
          showToast('Camera unavailable or permission denied.', 'warning');
          setScannerActive(false);
        } finally {
          isScannerStartingRef.current = false;
        }
      };

      initScanner();
    } else {
      // When switching away from scanner tab or toggling off:
      // Pause camera capture so CPU and battery are saved, and resuming is instant!
      if (scannerRef.current) {
        try {
          if (scannerRef.current.getState?.() === 2 /* SCANNING */) {
            scannerRef.current.pause(true);
          }
        } catch {}
      }
    }

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, activeTab, scannerActive, scannerEpoch]);

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop().then(() => {
              try { scannerRef.current?.clear(); } catch {}
            }).catch(() => {});
          } else {
            try { scannerRef.current.clear(); } catch {}
          }
        } catch {}
      }
    };
  }, []);

  // Export Formatted JSON
  const handleExportJSON = async () => {
    try {
      const res = await fetch(`/api/export?format=json`, {
      headers: { 'x-admin-password': password },
    });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const formattedJson = JSON.stringify(data, null, 2);
      const blob = new Blob([formattedJson], { type: 'application/json;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `htb-chennai-attendees-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast('Exported formatted JSON attendance data', 'success');
    } catch {
      showToast('Export failed', 'error');
    }
  };

  // Auto-sync interval (runs automatically in background)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAuthenticated) {
      interval = setInterval(() => fetchData(), 15000);
    }
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchData]);

  const formatTime = (iso?: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const filteredAttendees = attendees.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.email.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      (a.raNumber && a.raNumber.toLowerCase().includes(q))
    );
  });

  // ── Login Screen ──
  if (!isAuthenticated) {
    return (
      <div className="min-h-[100dvh] bg-htb-bg flex items-center justify-center p-4">
        <Toast
          visible={toast.visible}
          message={toast.message}
          type={toast.type}
          onClose={() => setToast((p) => ({ ...p, visible: false }))}
        />
      <div className="bg-htb-card border border-htb-border w-full max-w-sm rounded-xl p-5 sm:p-8 shadow-2xl mx-4">
          <div className="mb-6 text-center">
            <img
              src="/logo.png"
              alt="HTB Chennai Logo"
              className="w-12 h-12 mx-auto mb-3 object-contain"
            />
            <h1 className="text-xl font-bold text-htb-heading mb-1">Event Admin</h1>
            <p className="text-xs text-htb-muted">HTB Chennai</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-htb-heading mb-1.5">
                Admin Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-12 bg-htb-elevated border border-htb-border rounded-lg px-3.5 text-htb-heading text-sm focus:border-htb-green focus:ring-1 focus:ring-htb-green transition-all"
                placeholder="Enter password..."
                required
                autoFocus
              />
            </div>
            {error && <p className="text-htb-error text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-htb-green hover:bg-htb-green-dim disabled:opacity-50 text-htb-bg font-semibold rounded-lg text-sm transition-all duration-150 flex items-center justify-center gap-2 active:scale-[0.99]"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-htb-bg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Signing in...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>
          <div className="mt-6 pt-4 border-t border-htb-border text-center">
            <Link href="/" className="text-xs text-htb-muted hover:text-htb-heading transition-colors">
              &larr; Back to RSVP Portal
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Authenticated Admin Dashboard ──
  return (
    <div className="min-h-screen bg-htb-bg text-htb-text flex flex-col">
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast((p) => ({ ...p, visible: false }))}
      />

      {/* ── See Info Popup Modal ── */}
      {modalParticipant && (
        <div
          onClick={closeParticipant}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-htb-card border border-htb-border w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4 animate-slide-up"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-htb-border pb-3">
              <h3 className="text-sm sm:text-base font-bold text-htb-heading">Participant Details</h3>
              <button
                onClick={closeParticipant}
                className="text-htb-muted hover:text-htb-heading p-1 text-xl leading-none transition-colors"
                aria-label="Close participant details"
              >
                &times;
              </button>
            </div>

            {/* Profile Info */}
            <div className="bg-htb-elevated border border-htb-border rounded-xl p-4">
              <span className="text-[10px] uppercase font-bold text-htb-green tracking-wider">
                Attendee Profile
              </span>
              <h4 className="text-xl sm:text-2xl font-bold text-htb-heading mt-0.5 break-words">
                {modalParticipant.name || 'Participant'}
              </h4>
              {modalParticipant.raNumber && (
                <span className={`${BADGE} text-xs mt-1.5 select-all`}>
                  {modalParticipant.raNumber}
                </span>
              )}
              <span className={`${BADGE} text-[11px] mt-1.5 select-all break-all`}>
                {modalParticipant.email}
              </span>
              <div className="mt-3 pt-2.5 border-t border-htb-border/60 flex items-center justify-between">
                <span className="text-xs text-htb-muted">Ticket ID:</span>
                {modalParticipant.id ? (
                  <button
                    onClick={() => copyTicketId(modalParticipant.id)}
                    title="Tap to copy Ticket ID"
                    className="text-xs font-mono text-htb-muted hover:text-htb-heading bg-htb-card hover:bg-htb-elevated border border-htb-border px-2 py-1 rounded flex items-center gap-1.5 transition-all active:scale-95"
                  >
                    <span>{copiedTicketId === modalParticipant.id ? 'Copied!' : modalParticipant.id}</span>
                    {copiedTicketId === modalParticipant.id ? (
                      <svg className="w-3.5 h-3.5 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                ) : (
                  <span className="text-xs font-mono text-htb-muted/50">Not generated yet</span>
                )}
              </div>
            </div>

            {/* Status Breakdown with Timestamps */}
            <div className="border border-htb-border rounded-xl bg-htb-elevated/40 divide-y divide-htb-border/60 text-xs">
              {/* RSVP */}
              <div className="p-3.5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-htb-heading">1. Event RSVP</p>
                  <p className="text-[11px] text-htb-muted">
                    {modalParticipant.rsvp ? 'Confirmed by participant' : 'Pending response'}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center justify-center px-3 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                      modalParticipant.rsvp
                        ? 'bg-htb-green/10 text-htb-green border border-htb-green/40'
                        : 'bg-htb-elevated border border-htb-border/60 text-htb-muted/60'
                    }`}
                  >
                    {modalParticipant.rsvp ? 'Done' : 'Pending'}
                  </span>
                  {modalParticipant.rsvpTime && (
                    <p className="text-[10px] text-htb-muted mt-1 font-mono">
                      {formatTime(modalParticipant.rsvpTime)}
                    </p>
                  )}
                </div>
              </div>

              {/* Check-in */}
              <div className="p-3.5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-htb-heading">2. Venue Gate Check-in</p>
                  <p className="text-[11px] text-htb-muted">
                    {modalParticipant.checkedIn ? 'Admitted to event' : 'Not yet checked in'}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center justify-center px-3 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                      modalParticipant.checkedIn
                        ? 'bg-htb-green/10 text-htb-green border border-htb-green/40'
                        : 'bg-htb-elevated border border-htb-border/60 text-htb-muted/60'
                    }`}
                  >
                    {modalParticipant.checkedIn ? 'Done' : 'Pending'}
                  </span>
                  {modalParticipant.checkInTime && (
                    <p className="text-[10px] text-htb-muted mt-1 font-mono">
                      {formatTime(modalParticipant.checkInTime)}
                    </p>
                  )}
                </div>
              </div>

              {/* Refreshment */}
              <div className="p-3.5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-htb-heading">3. Refreshments</p>
                  <p className="text-[11px] text-htb-muted">
                    {modalParticipant.refreshment ? 'Refreshment collected' : 'Not yet claimed'}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center justify-center px-3 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                      modalParticipant.refreshment
                        ? 'bg-htb-green/10 text-htb-green border border-htb-green/40'
                        : 'bg-htb-elevated border border-htb-border/60 text-htb-muted/60'
                    }`}
                  >
                    {modalParticipant.refreshment ? 'Done' : 'Pending'}
                  </span>
                  {modalParticipant.refreshmentTime && (
                    <p className="text-[10px] text-htb-muted mt-1 font-mono">
                      {formatTime(modalParticipant.refreshmentTime)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="space-y-2 pt-2">
              {actionMessage && (
                <p className="text-xs text-center text-htb-green font-medium">
                  {actionMessage}
                </p>
              )}

              {!modalParticipant.checkedIn && modalParticipant.rsvp && (
                <button
                  onClick={() => handleMarkCheckin(modalParticipant.id, modalParticipant.email)}
                  disabled={actionLoading}
                  className="w-full h-12 bg-htb-green hover:bg-htb-green-dim disabled:opacity-50 text-htb-bg font-bold rounded-lg text-xs uppercase tracking-wider transition-colors"
                >
                  {actionLoading ? 'Updating...' : 'Mark Check-in'}
                </button>
              )}

              {modalParticipant.checkedIn && !modalParticipant.refreshment && (
                <button
                  onClick={() => handleMarkRefreshment(modalParticipant.id, modalParticipant.email)}
                  disabled={actionLoading}
                  className="w-full h-12 bg-htb-green hover:bg-htb-green-dim disabled:opacity-50 text-htb-bg font-bold rounded-lg text-xs uppercase tracking-wider transition-colors"
                >
                  {actionLoading ? 'Updating...' : 'Mark Refreshment Collected'}
                </button>
              )}

              {modalParticipant.checkedIn && modalParticipant.refreshment && (
                <div className="p-3 bg-htb-green/10 border border-htb-green/30 rounded-lg text-center text-xs text-htb-green font-medium flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>All event actions completed.</span>
                </div>
              )}

              <button
                onClick={closeParticipant}
                className="w-full h-10 border border-htb-border hover:bg-htb-elevated text-htb-muted hover:text-htb-heading rounded-lg text-xs font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import JSON Modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-htb-card border border-htb-border w-full max-w-md rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-htb-border pb-3">
              <div>
                <h3 className="text-base font-bold text-htb-heading">Import Participants (JSON)</h3>
                <p className="text-xs text-htb-muted">Upload a JSON file of attendee records</p>
              </div>
              <button
                onClick={() => {
                  setImportModalOpen(false);
                  setImportFile(null);
                  setImportError('');
                  setImportPreviewCount(null);
                }}
                className="w-8 h-8 rounded-full bg-htb-elevated border border-htb-border text-htb-muted hover:text-htb-heading flex items-center justify-center text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* File Selection */}
            <div>
              <label className="block text-xs font-medium text-htb-heading mb-1.5">
                Select JSON File
              </label>
              <input
                type="file"
                ref={jsonFileInputRef}
                accept=".json,application/json"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div
                onClick={() => jsonFileInputRef.current?.click()}
                className="border-2 border-dashed border-htb-border hover:border-htb-border-light rounded-xl p-4 text-center cursor-pointer bg-htb-elevated/40 hover:bg-htb-elevated transition-colors"
              >
                {importFile ? (
                  <div>
                    <p className="text-xs font-semibold text-htb-heading">{importFile.name}</p>
                    <p className="text-[11px] text-htb-muted mt-0.5">
                      {(importFile.size / 1024).toFixed(1)} KB
                      {importPreviewCount !== null && ` • ${importPreviewCount} valid participants`}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        jsonFileInputRef.current?.click();
                      }}
                      className="text-[11px] text-htb-green hover:underline mt-2 inline-block"
                    >
                      Choose different file
                    </button>
                  </div>
                ) : (
                  <div>
                    <svg className="w-8 h-8 mx-auto text-htb-muted/70 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-xs font-medium text-htb-heading">Click to browse JSON file</p>
                    <p className="text-[11px] text-htb-muted mt-1">Accepts array of participants: [{'{'} name, email, ra_number? {'}'}]</p>
                  </div>
                )}
              </div>
            </div>

            {/* Import Mode: The 2 Options */}
            <div>
              <label className="block text-xs font-medium text-htb-heading mb-2">
                Choose Import Action
              </label>
              <div className="space-y-2.5">
                {/* Option 1: Add as Add-on (Merge) */}
                <div
                  onClick={() => setImportMode('merge')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    importMode === 'merge'
                      ? 'border-htb-green/60 bg-htb-green/5 ring-1 ring-htb-green/40'
                      : 'border-htb-border bg-htb-elevated/40 hover:bg-htb-elevated'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                      className="mt-0.5 text-htb-green focus:ring-htb-green"
                    />
                    <div>
                      <p className="text-xs font-semibold text-htb-heading">
                        Add as Add-on to Existing Participants (Merge)
                      </p>
                      <p className="text-[11px] text-htb-muted mt-0.5 leading-relaxed">
                        Preserves existing participants, RSVP tokens, and check-in records. Adds new participants and updates existing details.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Option 2: Remove Existing Data (Replace all) */}
                <div
                  onClick={() => setImportMode('replace')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    importMode === 'replace'
                      ? 'border-htb-warning/60 bg-htb-warning/5 ring-1 ring-htb-warning/40'
                      : 'border-htb-border bg-htb-elevated/40 hover:bg-htb-elevated'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="mt-0.5 text-htb-warning focus:ring-htb-warning"
                    />
                    <div>
                      <p className="text-xs font-semibold text-htb-heading">
                        Remove Existing Data & Replace All
                      </p>
                      <p className="text-[11px] text-htb-muted mt-0.5 leading-relaxed">
                        Removes all current participants and completely replaces the database with the records from the uploaded JSON.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {importError && (
              <div className="p-2.5 rounded-lg bg-htb-error/10 border border-htb-error/30 text-htb-error text-xs">
                {importError}
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-htb-border">
              <button
                type="button"
                onClick={() => {
                  setImportModalOpen(false);
                  setImportFile(null);
                  setImportError('');
                  setImportPreviewCount(null);
                }}
                className="h-10 px-4 rounded-lg border border-htb-border hover:bg-htb-elevated text-htb-muted hover:text-htb-heading text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={!importFile || importLoading || importPreviewCount === 0}
                className="h-10 px-5 bg-htb-green hover:bg-htb-green-dim disabled:opacity-50 text-htb-bg text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
              >
                {importLoading ? 'Importing...' : 'Import Participants'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <header className="border-b border-htb-border bg-htb-card px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="HTB Chennai Logo"
            className="w-8 h-8 sm:w-9 sm:h-9 object-contain shrink-0"
          />
          <div>
            <h1 className="text-sm sm:text-base font-bold text-htb-heading leading-tight">
              HTB Chennai
            </h1>
            <p className="text-[11px] text-htb-muted">Event Admin</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-xs">
          <Link
            href="/"
            className="text-htb-muted hover:text-htb-heading px-2.5 py-1.5 transition-colors hidden sm:inline"
          >
            RSVP Portal
          </Link>
          <button
            onClick={() => {
              setIsAuthenticated(false);
              setPassword('');
            }}
            className="border border-htb-border hover:bg-htb-elevated px-3 py-1.5 rounded-md text-xs font-medium text-htb-muted hover:text-htb-heading transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-3.5 sm:p-6 max-w-7xl w-full mx-auto space-y-5">
        {/* Navigation Tabs */}
        <div className="flex bg-htb-card border border-htb-border p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-2 ${
              activeTab === 'scanner'
                ? 'bg-htb-elevated text-htb-green shadow-sm border border-htb-border/60'
                : 'text-htb-muted hover:text-htb-heading'
            }`}
          >
            <span>QR Scanner & Desk</span>
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-2 ${
              activeTab === 'table'
                ? 'bg-htb-elevated text-htb-green shadow-sm border border-htb-border/60'
                : 'text-htb-muted hover:text-htb-heading'
            }`}
          >
            <span>Participants List ({attendees.length})</span>
          </button>
        </div>

        {/* ── TAB 1: Streamlined Mobile-First QR Scanner Desk ── */}
        <div className={activeTab === 'scanner' ? 'max-w-xl mx-auto space-y-4' : 'hidden'}>
            {/* Simple Station Switcher: Check-in, Refreshment, or See Info */}
            <div className="grid grid-cols-3 gap-1.5 bg-htb-card border border-htb-border p-1 rounded-xl">
              <button
                onClick={() => {
                  setStationMode('checkin');
                  setActionMessage('');
                }}
                className={`py-2.5 px-1 text-xs font-semibold rounded-lg transition-all text-center ${
                  stationMode === 'checkin'
                    ? 'bg-htb-elevated text-htb-green border border-htb-green/40'
                    : 'text-htb-muted hover:text-htb-heading'
                }`}
              >
                Check-in Gate
              </button>
              <button
                onClick={() => {
                  setStationMode('refreshment');
                  setActionMessage('');
                }}
                className={`py-2.5 px-1 text-xs font-semibold rounded-lg transition-all text-center ${
                  stationMode === 'refreshment'
                    ? 'bg-htb-elevated text-htb-green border border-htb-green/40'
                    : 'text-htb-muted hover:text-htb-heading'
                }`}
              >
                Refreshments
              </button>
              <button
                onClick={() => {
                  setStationMode('info');
                  setActionMessage('');
                }}
                className={`py-2.5 px-1 text-xs font-semibold rounded-lg transition-all text-center ${
                  stationMode === 'info'
                    ? 'bg-htb-elevated text-htb-green border border-htb-green/40'
                    : 'text-htb-muted hover:text-htb-heading'
                }`}
              >
                See Info
              </button>
            </div>

            {/* Camera QR Scanner Card */}
            <div className="bg-htb-card border border-htb-border rounded-xl p-3.5 sm:p-4 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-xs font-semibold text-htb-heading">
                    {stationMode === 'checkin'
                      ? 'Gate Check-in Station'
                      : stationMode === 'refreshment'
                      ? 'Refreshments Station'
                      : 'Attendee Lookup'}
                  </h2>
                  <p className="text-[11px] text-htb-muted">
                    {stationMode === 'checkin'
                      ? 'Auto-checks in scanned pass'
                      : stationMode === 'refreshment'
                      ? 'Marks refreshment as collected'
                      : 'Shows full attendee pass details'}
                  </p>
                </div>
                <button
                  onClick={() => setScannerActive((v) => !v)}
                  className={`h-9 px-3.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                    scannerActive
                      ? 'border border-htb-error/40 text-htb-error bg-htb-error/10 hover:bg-htb-error/20'
                      : 'bg-htb-green text-htb-bg hover:bg-htb-green-dim font-bold shadow-sm'
                  }`}
                >
                  {scannerActive ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span>Stop Camera</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span>Start Camera</span>
                    </>
                  )}
                </button>
              </div>

              {scannerActive ? (
                <div className="relative overflow-hidden rounded-xl border border-htb-border bg-black mx-auto w-full">
                  <div id="admin-qr-reader" className="w-full flex items-center justify-center" />

                  {/* Clean, professional QR reticle & overlay */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-4">
                    <div className="relative w-48 h-48 sm:w-56 sm:h-56">
                      {/* 4 Corner Markers */}
                      <span className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-htb-green rounded-tl-sm" />
                      <span className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-htb-green rounded-tr-sm" />
                      <span className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-htb-green rounded-bl-sm" />
                      <span className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-htb-green rounded-br-sm" />

                      {/* Sweeping scanline */}
                      <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-htb-green to-transparent opacity-80 animate-scanline" />
                    </div>

                    <p className="mt-3 text-[11px] font-medium text-white/90 bg-black/75 px-3 py-1 rounded-full backdrop-blur-sm shadow border border-white/10">
                      Scan anywhere in view - the frame is only a guide
                    </p>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setScannerActive(true)}
                  className="cursor-pointer border border-dashed border-htb-border hover:border-htb-green/40 hover:bg-htb-elevated/40 rounded-xl p-8 sm:p-12 text-center transition-all group"
                >
                  <div className="w-12 h-12 mx-auto rounded-full bg-htb-elevated border border-htb-border group-hover:border-htb-green/40 flex items-center justify-center text-htb-muted group-hover:text-htb-green transition-colors mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <p className="text-xs font-semibold text-htb-heading group-hover:text-htb-green transition-colors">
                    Click to Start Camera Scanner
                  </p>
                    <p className="text-[11px] text-htb-muted mt-1">
                    Holds the QR anywhere in view and fires the moment it reads
                  </p>
                </div>
              )}
            </div>
        </div>

        {/* ── TAB 2: Participants List Table (Clean, Non-CSV, With 'See Info' Popup) ── */}
        <div className={activeTab === 'table' ? 'space-y-4' : 'hidden'}>
            {/* Metric Cards (6 Summary Counters) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3.5">
              <div className="bg-htb-card border border-htb-border rounded-xl p-3 sm:p-4">
                <p className="text-[11px] font-medium text-htb-muted">Registered</p>
                <p className="text-xl sm:text-2xl font-bold text-htb-heading mt-1">
                  {stats?.totalRegistered ?? 0}
                </p>
              </div>
              <div className="bg-htb-card border border-htb-border rounded-xl p-3 sm:p-4">
                <p className="text-[11px] font-medium text-htb-muted">RSVP&apos;d</p>
                <p className="text-xl sm:text-2xl font-bold text-htb-heading mt-1">
                  {stats?.totalRsvp ?? 0}
                </p>
              </div>
              <div className="bg-htb-card border border-htb-border rounded-xl p-3 sm:p-4">
                <p className="text-[11px] font-medium text-htb-muted">Checked In</p>
                <p className="text-xl sm:text-2xl font-bold text-htb-heading mt-1">
                  {stats?.totalCheckedIn ?? 0}
                </p>
              </div>
              <div className="bg-htb-card border border-htb-border rounded-xl p-3 sm:p-4">
                <p className="text-[11px] font-medium text-htb-muted">Refreshments</p>
                <p className="text-xl sm:text-2xl font-bold text-htb-heading mt-1">
                  {stats?.totalRefreshment ?? 0}
                </p>
              </div>
              <div className="bg-htb-card border border-htb-border rounded-xl p-3 sm:p-4">
                <p className="text-[11px] font-medium text-htb-muted">Pending Check-in</p>
                <p className="text-xl sm:text-2xl font-bold text-htb-muted/70 mt-1">
                  {stats?.pendingCheckins ?? 0}
                </p>
              </div>
              <div className="bg-htb-card border border-htb-border rounded-xl p-3 sm:p-4">
                <p className="text-[11px] font-medium text-htb-muted">Pending Refreshments</p>
                <p className="text-xl sm:text-2xl font-bold text-htb-muted/70 mt-1">
                  {stats?.pendingRefreshments ?? 0}
                </p>
              </div>
            </div>

            {/* Table Container */}
            <div className="bg-htb-card border border-htb-border rounded-xl overflow-hidden shadow-lg">
              {/* Search & Actions Bar (Clean JSON Export Only) */}
              <div className="p-3.5 sm:p-4 border-b border-htb-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name, email, RA number, ticket ID..."
                    className="w-full h-10 bg-htb-elevated border border-htb-border rounded-lg pl-3 pr-8 text-sm sm:text-xs text-htb-heading placeholder-htb-muted focus:border-htb-border-light"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-xs text-htb-muted hover:text-htb-heading"
                    >
                      &times;
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 w-full sm:w-auto text-xs">
                  <button
                    onClick={() => {
                      setImportFile(null);
                      setImportPreviewCount(null);
                      setImportError('');
                      if (jsonFileInputRef.current) jsonFileInputRef.current.value = '';
                      setImportModalOpen(true);
                    }}
                    className="h-9 px-3.5 bg-htb-elevated border border-htb-border hover:border-htb-green/40 hover:text-htb-green text-htb-heading rounded-lg font-medium transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span>Import JSON</span>
                  </button>
                  <button
                    onClick={handleExportJSON}
                    className="h-9 px-3.5 bg-htb-elevated border border-htb-border hover:border-htb-border-light text-htb-heading rounded-lg font-medium transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5 text-htb-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>Export JSON</span>
                  </button>
                </div>
              </div>

              {/* 1. Mobile Attendee Cards (< 768px) with Clean Multi-line Layout */}
              <div className="block md:hidden divide-y divide-htb-border/50">
                {filteredAttendees.map((a, i) => (
                  <div
                    key={a.id || a.email || i}
                    onClick={() => {
                      setModalParticipant({
                        id: a.id,
                        name: a.name,
                        email: a.email,
                        raNumber: a.raNumber,
                        rsvp: a.hasRsvp,
                        rsvpTime: a.rsvpTime,
                        checkedIn: a.hasCheckedIn,
                        checkInTime: a.checkInTime,
                        refreshment: a.hasRefreshment,
                        refreshmentTime: a.refreshmentTime,
                      });
                    }}
                    className="p-3 sm:p-3.5 hover:bg-htb-elevated/40 cursor-pointer transition-colors space-y-1.5"
                  >
                    {/* Line 1: Name gets the full row width; Ticket ID stays right-aligned */}
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-htb-heading text-sm sm:text-base break-words min-w-0">
                        {a.name || 'Participant'}
                      </span>
                      {a.id ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyTicketId(a.id);
                          }}
                          title="Tap to copy Ticket ID"
                          className="text-[10px] font-mono text-htb-muted hover:text-htb-heading bg-htb-elevated hover:bg-htb-card border border-htb-border px-1.5 py-0.5 rounded shrink-0 select-all flex items-center gap-1 transition-colors active:scale-95"
                        >
                          <span>{copiedTicketId === a.id ? 'Copied!' : a.id}</span>
                          {copiedTicketId === a.id ? (
                            <svg className="w-3 h-3 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      ) : (
                        <span className="text-[10px] font-mono text-htb-muted/50 bg-htb-elevated/40 border border-htb-border/40 px-1.5 py-0.5 rounded shrink-0">
                          No ticket
                        </span>
                      )}
                    </div>

                    {/* Line 2: Email and RA number as white-glass chips, keeping the name unwrapped above */}
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className={`${BADGE} text-[10px] select-all break-all`}>
                        {a.email}
                      </span>
                      {a.raNumber && (
                        <span className={`${BADGE} text-[10px] select-all`}>
                          {a.raNumber}
                        </span>
                      )}
                    </div>

                    {/* Line 3: RSVP, Check-in, Refreshment statuses + (i) Info Icon */}
                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-htb-border/30">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium flex-wrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] transition-colors ${
                            a.hasRsvp
                              ? 'bg-htb-green/10 text-htb-green border border-htb-green/40 font-bold'
                              : 'bg-htb-elevated border border-htb-border/60 text-htb-muted/60 font-medium'
                          }`}
                        >
                          RSVP: {a.hasRsvp ? 'Done' : 'Pending'}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] transition-colors ${
                            a.hasCheckedIn
                              ? 'bg-htb-green/10 text-htb-green border border-htb-green/40 font-bold'
                              : 'bg-htb-elevated border border-htb-border/60 text-htb-muted/60 font-medium'
                          }`}
                        >
                          Check-in: {a.hasCheckedIn ? 'Done' : 'Pending'}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] transition-colors ${
                            a.hasRefreshment
                              ? 'bg-htb-green/10 text-htb-green border border-htb-green/40 font-bold'
                              : 'bg-htb-elevated border border-htb-border/60 text-htb-muted/60 font-medium'
                          }`}
                        >
                          Refreshment: {a.hasRefreshment ? 'Done' : 'Pending'}
                        </span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setModalParticipant({
                            id: a.id,
                            name: a.name,
                            email: a.email,
                            raNumber: a.raNumber,
                            rsvp: a.hasRsvp,
                            rsvpTime: a.rsvpTime,
                            checkedIn: a.hasCheckedIn,
                            checkInTime: a.checkInTime,
                            refreshment: a.hasRefreshment,
                            refreshmentTime: a.refreshmentTime,
                          });
                        }}
                        title="See Info & Actions"
                        className="w-7 h-7 rounded-full bg-htb-elevated border border-htb-border hover:border-htb-heading/30 text-htb-muted hover:text-htb-heading flex items-center justify-center shrink-0 transition-colors"
                        aria-label="See Info"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 2. Desktop Table View (>= 768px) with (i) Info Icon Button */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-htb-border bg-htb-elevated text-htb-muted">
                      <th className="p-3.5 font-medium min-w-[220px]">Participant</th>
                      <th className="p-3.5 font-medium">Ticket ID</th>
                      <th className="p-3.5 font-medium">RSVP</th>
                      <th className="p-3.5 font-medium">Check-in</th>
                      <th className="p-3.5 font-medium">Refreshment</th>
                      <th className="p-3.5 font-medium text-right">Info</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-htb-border/40">
                    {filteredAttendees.map((a, i) => (
                      <tr key={a.id || a.email || i} className="hover:bg-htb-elevated/40 transition-colors">
                        <td className="p-3.5 min-w-[220px]">
                          <p className="font-semibold text-sm sm:text-base text-htb-heading break-words">
                            {a.name || 'Participant'}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            <span className={`${BADGE} text-[11px] select-all break-all`}>
                              {a.email}
                            </span>
                            {a.raNumber && (
                              <span className={`${BADGE} text-[10px] select-all`}>
                                {a.raNumber}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="p-3.5">
                          {a.id ? (
                            <button
                              onClick={() => copyTicketId(a.id)}
                              title="Click to copy Ticket ID"
                              className="font-mono text-htb-muted hover:text-htb-heading text-[11px] select-all flex items-center gap-1.5 px-2 py-1 rounded bg-htb-elevated hover:bg-htb-card border border-htb-border hover:border-htb-border-light transition-all active:scale-95"
                            >
                              <span>{copiedTicketId === a.id ? 'Copied!' : a.id}</span>
                              {copiedTicketId === a.id ? (
                                <svg className="w-3 h-3 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              )}
                            </button>
                          ) : (
                            <span className="font-mono text-htb-muted/60 text-[11px]">No ticket</span>
                          )}
                        </td>

                        <td className="p-3.5">
                          {a.hasRsvp ? (
                            <div>
                              <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-htb-green/10 text-htb-green border border-htb-green/40">
                                Done
                              </span>
                              <p className="text-[10px] text-htb-muted mt-1 font-mono">{formatTime(a.rsvpTime)}</p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-htb-elevated border border-htb-border/60 text-htb-muted/60">
                              Pending
                            </span>
                          )}
                        </td>

                        <td className="p-3.5">
                          {a.hasCheckedIn ? (
                            <div>
                              <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-htb-green/10 text-htb-green border border-htb-green/40">
                                Done
                              </span>
                              <p className="text-[10px] text-htb-muted mt-1 font-mono">{formatTime(a.checkInTime)}</p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-htb-elevated border border-htb-border/60 text-htb-muted/60">
                              Pending
                            </span>
                          )}
                        </td>

                        <td className="p-3.5">
                          {a.hasRefreshment ? (
                            <div>
                              <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-htb-green/10 text-htb-green border border-htb-green/40">
                                Done
                              </span>
                              <p className="text-[10px] text-htb-muted mt-1 font-mono">{formatTime(a.refreshmentTime)}</p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-htb-elevated border border-htb-border/60 text-htb-muted/60">
                              Pending
                            </span>
                          )}
                        </td>

                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => {
                              setModalParticipant({
                                id: a.id,
                                name: a.name,
                                email: a.email,
                                raNumber: a.raNumber,
                                rsvp: a.hasRsvp,
                                rsvpTime: a.rsvpTime,
                                checkedIn: a.hasCheckedIn,
                                checkInTime: a.checkInTime,
                                refreshment: a.hasRefreshment,
                                refreshmentTime: a.refreshmentTime,
                              });
                            }}
                            title="See Info & Actions"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-htb-elevated border border-htb-border hover:border-htb-heading/30 text-htb-muted hover:text-htb-heading transition-colors"
                            aria-label="See Info"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredAttendees.length === 0 && (
                <div className="p-8 text-center text-xs text-htb-muted">
                  {searchQuery
                    ? 'No participants found matching your search.'
                    : 'No participant records yet.'}
                </div>
              )}
            </div>
        </div>
      </main>
    </div>
  );
}
