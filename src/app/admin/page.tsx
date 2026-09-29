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

const SESSION_KEY = 'htb_admin_session';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const logoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Tabs: 'table' | 'scanner'
  const [activeTab, setActiveTab] = useState<'table' | 'scanner'>('scanner');
  const [stationMode, setStationMode] = useState<'checkin' | 'refreshment'>('checkin');
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
  const scannerActiveRef = useRef(scannerActive);
  useEffect(() => {
    scannerActiveRef.current = scannerActive;
  }, [scannerActive]);
  // Bumped to force the camera effect to rebuild a dead scanner instance.
  const [scannerEpoch, setScannerEpoch] = useState(0);
  const [modalParticipant, setModalParticipant] = useState<LookupResult | null>(null);
  const modalParticipantRef = useRef<LookupResult | null>(null);
  modalParticipantRef.current = modalParticipant;

  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const scannerRef = useRef<any>(null);
  const isProcessingScanRef = useRef(false);
  const isScannerStartingRef = useRef(false);
  // Every camera teardown/startup is chained onto this queue so two operations can
  // never touch the #admin-qr-reader container at the same time.
  const cameraQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Monotonic id of the newest camera request. Async camera work compares its own id
  // against this and bails out if a newer request superseded it, which stops a slow
  // teardown from tearing down a freshly started scanner (the black viewfinder bug).
  const cameraGenRef = useRef(0);
  // True only while a scanner instance is actually streaming frames. Used to tell
  // "camera is up" apart from "camera was asked for but never came back".
  const isCameraLiveRef = useRef(false);
  const cameraRetryRef = useRef(0);
  // Suppresses repeat scans of the same pass while it stays in front of the camera
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  // In-camera toast feedback state (displayed directly inside camera viewfinder)
  const [cameraToast, setCameraToast] = useState<{
    type: 'success' | 'warning' | 'error';
    title: string;
    message: string;
    badge?: string;
    participant?: LookupResult;
    timestamp?: string;
  } | null>(null);
  const cameraToastRef = useRef<typeof cameraToast>(null);
  cameraToastRef.current = cameraToast;

  // Stop camera scanner completely and release all video stream tracks.
  // Returns the generation id this teardown claimed so callers can detect staleness.
  const stopCameraScanner = useCallback(async () => {
    isScannerStartingRef.current = false;
    const generation = ++cameraGenRef.current;

    const teardown = async () => {
      isCameraLiveRef.current = false;
      const scanner = scannerRef.current;
      scannerRef.current = null;

      if (scanner) {
        try {
          if (scanner.isScanning) {
            await scanner.stop();
          }
        } catch (err) {
          console.warn('Error stopping scanner:', err);
        }
        try {
          scanner.clear();
        } catch {}
      }

      // Forcibly shut down any active media stream tracks on any video element in the container
      try {
        const container = document.getElementById('admin-qr-reader');
        if (container) {
          const video = container.querySelector('video') as HTMLVideoElement | null;
          if (video && video.srcObject) {
            const stream = video.srcObject as MediaStream;
            stream.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch {}
            });
            video.srcObject = null;
          }
        }
      } catch {}
    };

    // Run strictly after any in-flight camera work so a teardown never races a start.
    cameraQueueRef.current = cameraQueueRef.current.then(teardown, teardown);
    try {
      await cameraQueueRef.current;
    } catch {}

    return generation;
  }, []);

  // Wait until the reader container is actually laid out and visible. Scanning into a
  // display:none / zero-size container yields a black viewfinder, so block until it isn't.
  const waitForVisibleContainer = useCallback(async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const container = document.getElementById('admin-qr-reader');
      if (container && container.offsetParent !== null && container.clientWidth > 0) return true;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    }
    return false;
  }, []);

  // html5-qrcode can report a successful start while handing back a video that never
  // receives frames, which renders as a solid black box that only a page refresh clears.
  // Poll for real dimensions/frames and report back so the caller can rebuild.
  const waitForLiveVideo = useCallback(async (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const video = document.querySelector(
        '#admin-qr-reader video'
      ) as HTMLVideoElement | null;
      if (video && video.videoWidth > 0 && video.readyState >= 2) {
        try {
          if (video.paused) await video.play();
        } catch {}
        return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
    }
    return false;
  }, []);

  // Suppression ref & state to eliminate mobile touch ghost clicks when closing modals
  const isDismissingModalRef = useRef(false);
  const [isDismissingModal, setIsDismissingModal] = useState(false);

  const startModalDismissalCooldown = useCallback(() => {
    isDismissingModalRef.current = true;
    setIsDismissingModal(true);
    setTimeout(() => {
      isDismissingModalRef.current = false;
      setIsDismissingModal(false);
    }, 500);
  }, []);

  // Dismissing a scan result behaves like a hard refresh of the scanner desk: the
  // scanner is fully stopped (same action as the Stop Camera button) and a brand new
  // one is started on the next pass, with no tap required. The reader node is never
  // unmounted, so the rebuild happens in place.
  const restartCameraForNextPass = useCallback(() => {
    isProcessingScanRef.current = false;
    lastScanRef.current = { code: '', at: 0 };
    cameraRetryRef.current = 0;
    isCameraLiveRef.current = false;
    isScannerStartingRef.current = false;

    if (!scannerActiveRef.current) {
      setScannerActive(true);
      return;
    }

    // Force a full stop/start cycle on the next tick so the teardown drains first.
    // The effect itself still refuses to start while a card is open, so this is safe
    // to fire unconditionally.
    stopCameraScanner().finally(() => {
      setScannerEpoch((n) => n + 1);
    });
  }, [stopCameraScanner]);

  const resumeCameraScanning = useCallback(() => {
    startModalDismissalCooldown();
    cameraToastRef.current = null;
    setCameraToast(null);
    restartCameraForNextPass();
  }, [startModalDismissalCooldown, restartCameraForNextPass]);

  const showCameraToast = (toastData: {
    type: 'success' | 'warning' | 'error';
    title: string;
    message: string;
    badge?: string;
    participant?: LookupResult;
    timestamp?: string;
  }) => {
    // Show scan result card. The camera is stopped immediately and stays safely off
    // until the desk volunteer explicitly taps [Scan Next Pass] or the cross button.
    cameraToastRef.current = toastData;
    setCameraToast(toastData);
  };

  const openParticipant = (participant: LookupResult) => {
    if (isDismissingModalRef.current) return;
    cameraToastRef.current = null;
    modalParticipantRef.current = participant;
    setCameraToast(null);
    setModalParticipant(participant);
    stopCameraScanner();
  };

  const closeParticipant = () => {
    startModalDismissalCooldown();
    modalParticipantRef.current = null;
    setModalParticipant(null);
    setActionMessage('');
    restartCameraForNextPass();
  };

  // Lock background clicks, touch scrolling and stop scanner whenever any modal or result card is open
  const isModalOpen = Boolean(modalParticipant || importModalOpen || cameraToast);
  const isBackgroundLocked = isModalOpen || isDismissingModal;

  useEffect(() => {
    if (isModalOpen) {
      stopCameraScanner();

      const prevBodyOverflow = document.body.style.overflow;
      const prevHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';

      return () => {
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overflow = prevHtmlOverflow;
      };
    }
  }, [isModalOpen, stopCameraScanner]);


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

        setStats({
          totalRegistered,
          totalRsvp,
          totalCheckedIn,
          totalRefreshment,
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

        // Update the open participant popup with the latest data ONLY if still open
        if (modalParticipantRef.current) {
          const currentId = modalParticipantRef.current.id;
          const currentEmail = modalParticipantRef.current.email;
          const updatedModal = list.find(
            (item) =>
              (currentId && item.id === currentId) ||
              item.email.toLowerCase() === currentEmail.toLowerCase()
          );
          if (updatedModal && modalParticipantRef.current) {
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
    [password]
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

  const handleSignOut = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
    setIsAuthenticated(false);
    setPassword('');
    showToast('Signed out', 'info');
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const success = await fetchData(password);
    if (success) {
      const expiresAt = Date.now() + SESSION_TTL_MS;
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ password, expiresAt }));
      } catch {}
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
      }
      logoutTimerRef.current = setTimeout(() => {
        handleSignOut();
        showToast('Session expired after 6 hours. Please sign in again.', 'warning');
      }, SESSION_TTL_MS);
      setIsAuthenticated(true);
      showToast('Signed in successfully', 'success');
    } else {
      showToast('Incorrect password', 'error');
    }
    setLoading(false);
  };

  // Lookup participant by token or email
  const handleLookup = async (tokenOrEmail: string, fromCamera = false) => {
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
        if (fromCamera) {
          showCameraToast({
            type: 'error',
            title: 'PARTICIPANT NOT FOUND',
            message: data.message || 'No registered participant found for this pass.',
          });
        }
      }
    } catch {
      showToast('Lookup error', 'error');
      if (fromCamera) {
        showCameraToast({
          type: 'error',
          title: 'LOOKUP ERROR',
          message: 'Network error while looking up participant.',
        });
      }
    }
  };

  // Mark Check-in
  const handleMarkCheckin = async (token: string, email?: string, fromCamera = false) => {
    setActionLoading(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email }),
      });
      const data = await res.json();

      let toastType: 'success' | 'warning' | 'error' = 'error';
      let title = 'Check-in Failed';
      let msg = data.message || 'Check-in failed';

      if (data.status === 'CHECK_IN_SUCCESS') {
        toastType = 'success';
        title = 'CHECK-IN DONE!';
        msg = `Checked in at ${formatTime(data.participant?.checkInTime || new Date().toISOString())}`;
      } else if (data.status === 'ALREADY_CHECKED_IN') {
        toastType = 'warning';
        title = 'ALREADY CHECKED IN';
        msg = `Previously checked in at ${formatTime(data.checkInTime)}`;
      } else if (data.status === 'NO_RSVP') {
        toastType = 'error';
        title = 'NO RSVP CONFIRMED';
        msg = 'Participant has not confirmed RSVP yet.';
      } else if (data.status === 'INVALID_TOKEN') {
        toastType = 'error';
        title = 'INVALID TICKET';
        msg = 'No registered participant found for this pass.';
      } else {
        toastType = 'error';
        title = 'CHECK-IN ERROR';
        msg = data.message || 'Check-in failed';
      }

      showToast(msg, toastType);
      setActionMessage(msg);

      if (fromCamera) {
        // Show in-camera toast directly inside the viewfinder. Do NOT open full popup modal!
        showCameraToast({
          type: toastType,
          title,
          message: msg,
          badge: data.participant?.raNumber || data.participant?.id,
          participant: data.participant,
          timestamp: formatTime(new Date().toISOString()),
        });
      } else {
        // Manual lookup or table row click opens full modal
        if (data.participant) {
          openParticipant(data.participant);
        }
      }

      await fetchData();
    } catch {
      showToast('Connection error during check-in', 'error');
      if (fromCamera) {
        showCameraToast({
          type: 'error',
          title: 'NETWORK ERROR',
          message: 'Could not connect to server. Check Wi-Fi.',
        });
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Mark Refreshment
  const handleMarkRefreshment = async (token: string, email?: string, fromCamera = false) => {
    setActionLoading(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/refreshment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email }),
      });
      const data = await res.json();

      let toastType: 'success' | 'warning' | 'error' = 'error';
      let title = 'Action Failed';
      let msg = data.message || 'Action failed';

      if (data.status === 'REFRESHMENT_SUCCESS') {
        toastType = 'success';
        title = 'REFRESHMENT CLAIMED!';
        msg = `Refreshment marked at ${formatTime(data.participant?.refreshmentTime || new Date().toISOString())}`;
      } else if (data.status === 'ALREADY_COLLECTED') {
        toastType = 'warning';
        title = 'ALREADY CLAIMED REFRESHMENT';
        msg = `Already claimed refreshment at ${formatTime(data.refreshmentTime)}`;
      } else if (data.status === 'NOT_CHECKED_IN') {
        toastType = 'warning';
        title = 'GATE CHECK-IN REQUIRED';
        msg = 'Attendee must complete gate check-in first.';
      } else if (data.status === 'NO_RSVP') {
        toastType = 'error';
        title = 'NO RSVP CONFIRMED';
        msg = 'Participant has not confirmed RSVP yet.';
      } else if (data.status === 'INVALID_TOKEN') {
        toastType = 'error';
        title = 'INVALID TICKET';
        msg = 'No registered participant found for this pass.';
      } else {
        toastType = 'error';
        title = 'REFRESHMENT ERROR';
        msg = data.message || 'Action failed';
      }

      showToast(msg, toastType);
      setActionMessage(msg);

      if (fromCamera) {
        // Show in-camera toast directly inside the viewfinder. Do NOT open full popup modal!
        showCameraToast({
          type: toastType,
          title,
          message: msg,
          badge: data.participant?.raNumber || data.participant?.id,
          participant: data.participant,
          timestamp: formatTime(new Date().toISOString()),
        });
      } else {
        if (data.participant) {
          openParticipant(data.participant);
        }
      }

      await fetchData();
    } catch {
      showToast('Connection error during refreshment action', 'error');
      if (fromCamera) {
        showCameraToast({
          type: 'error',
          title: 'NETWORK ERROR',
          message: 'Could not connect to server. Check Wi-Fi.',
        });
      }
    } finally {
      setActionLoading(false);
    }
  };

  // High-speed auto scan handler: instantly stops camera on scan to prevent background looping
  const handleCameraScan = async (decodedText: string) => {
    // If already processing a scan, or a camera toast is active, or modal is open, ignore
    if (isProcessingScanRef.current || cameraToastRef.current || modalParticipantRef.current) return;
    isProcessingScanRef.current = true;

    // Immediately stop the camera scanner and kill all video stream tracks so camera turns off instantly
    await stopCameraScanner();

    // Trigger instant chime & vibration (Google Pay / Paytm style feedback)
    playScanBeep();

    // Clean decodedText: handle URL query params like ?email=... or ?token=... or /pass/... or JSON string
    let clean = decodedText.trim();
    if (clean.startsWith('{') && clean.endsWith('}')) {
      try {
        const parsed = JSON.parse(clean);
        clean = parsed.token || parsed.id || parsed.email || clean;
      } catch {}
    }
    if (clean.includes('token=')) {
      const m = clean.match(/token=([A-Za-z0-9\-]+)/);
      if (m) clean = m[1];
    } else if (clean.includes('email=')) {
      const m = clean.match(/email=([^&]+)/);
      if (m) clean = decodeURIComponent(m[1]);
    } else if (clean.includes('/pass/')) {
      clean = clean.split('/pass/').pop()?.split(/[?#]/)[0] || clean;
    }

    const nowMs = Date.now();
    // A pass that was recently scanned: suppress repeat scan if within 4s without looping
    if (lastScanRef.current.code === clean && nowMs - lastScanRef.current.at < 4000) {
      isProcessingScanRef.current = false;
      return;
    }
    lastScanRef.current = { code: clean, at: nowMs };

    const currentMode = stationModeRef.current;
    try {
      if (currentMode === 'checkin') {
        await handleMarkCheckin(clean, undefined, true /* fromCamera */);
      } else if (currentMode === 'refreshment') {
        await handleMarkRefreshment(clean, undefined, true /* fromCamera */);
      } else {
        await handleLookup(clean, true /* fromCamera */);
      }
    } catch (err) {
      console.error('Camera scan execution error:', err);
      showCameraToast({
        type: 'error',
        title: 'SCAN ERROR',
        message: 'Could not process pass. Tap Scan Next to retry.',
      });
    } finally {
      // Re-assert the stop once processing is done: the lookup call takes long enough
      // for a queued camera start to slip in, and that would give a second camera.
      await stopCameraScanner();
    }
  };

  // Camera scanner lifecycle: active only on scanner tab when enabled and no modal/toast is open
  useEffect(() => {
    let isMounted = true;

    if (!isAuthenticated) return;

    if (activeTab === 'scanner' && scannerActive && !isModalOpen) {
      if (isScannerStartingRef.current) return;
      isScannerStartingRef.current = true;

      // Runs after the awaited start: if a newer camera request came in meanwhile, the
      // instance we just opened is already stale and must be torn down again.
      const discardStaleInstance = async (instance: any) => {
        try {
          if (instance?.isScanning) await instance.stop();
        } catch {}
        try {
          instance?.clear();
        } catch {}
        if (scannerRef.current === instance) scannerRef.current = null;
      };

      const initScanner = async () => {
        // Claim a generation by tearing down whatever is mounted right now.
        const generation = await stopCameraScanner();
        if (!isMounted || generation !== cameraGenRef.current) return;

        // The start itself runs on the same queue as the teardowns. A start that was
        // still awaiting getUserMedia can therefore never land after a stop, which is
        // what used to leave a second camera stream running on top of the first.
        const startWork = async () => {
          const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

          if (!isMounted || generation !== cameraGenRef.current) return;

          if (!(await waitForVisibleContainer())) {
            // Container is still hidden/zero-size. Nudge the lifecycle to retry once
            // layout settles instead of leaving a dead viewfinder behind.
            if (isMounted && generation === cameraGenRef.current) {
              setTimeout(() => {
                if (isMounted) setScannerEpoch((n) => n + 1);
              }, 120);
            }
            return;
          }
          if (!isMounted || generation !== cameraGenRef.current) return;

          const container = document.getElementById('admin-qr-reader');
          if (!container || !isMounted) return;

          const html5Qrcode = new Html5Qrcode('admin-qr-reader', {
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            verbose: false,
            experimentalFeatures: {
              useBarCodeDetectorIfSupported: true,
            },
          });
          scannerRef.current = html5Qrcode;

          const scanConfig = {
            fps: 30, // 30 fps prevents frame queue backlog on mobile
            disableFlip: false,
          };

          const startWithCamera = async (facingMode: 'environment' | 'user') => {
            await html5Qrcode.start(
              { facingMode },
              scanConfig,
              (decodedText: string) => {
                handleCameraScan(decodedText);
              },
              () => {}
            );
          };

          try {
            await startWithCamera('environment');
          } catch (envErr) {
            console.warn('Environment camera unavailable, falling back to default camera:', envErr);
            if (!isMounted || generation !== cameraGenRef.current) {
              await discardStaleInstance(html5Qrcode);
              return;
            }
            try {
              await startWithCamera('user');
            } catch (userErr) {
              await discardStaleInstance(html5Qrcode);
              throw userErr;
            }
          }

          // getUserMedia is slow; the tab may have changed while it was in flight.
          if (!isMounted || generation !== cameraGenRef.current) {
            await discardStaleInstance(html5Qrcode);
            return;
          }

          // A start can "succeed" and still hand back a dead/black stream. Confirm frames
          // are actually flowing, otherwise tear down and let the retry rebuild it.
          if (!(await waitForLiveVideo(2500))) {
            console.warn('Camera produced no frames after start, rebuilding.');
            await discardStaleInstance(html5Qrcode);
            if (isMounted && generation === cameraGenRef.current) {
              if (cameraRetryRef.current < 3) {
                cameraRetryRef.current += 1;
                setTimeout(() => {
                  if (isMounted) setScannerEpoch((n) => n + 1);
                }, 200);
              } else {
                showToast('Camera did not start. Tap Start Camera to retry.', 'warning');
              }
            }
            return;
          }

          cameraRetryRef.current = 0;
          isCameraLiveRef.current = true;
        };

        try {
          cameraQueueRef.current = cameraQueueRef.current.then(startWork, startWork);
          await cameraQueueRef.current;
        } catch (err: any) {
          if (isMounted && generation === cameraGenRef.current) {
            console.error('Camera init error:', err);
            // A failed restart right after a scan is usually a transient race with the
            // previous teardown, so rebuild once more before asking the user to tap.
            if (cameraRetryRef.current < 2) {
              cameraRetryRef.current += 1;
              setTimeout(() => {
                if (isMounted) setScannerEpoch((n) => n + 1);
              }, 250);
              return;
            }
            showToast('Camera unavailable or permission denied.', 'warning');
            setScannerActive(false);
          }
        } finally {
          if (generation === cameraGenRef.current) isScannerStartingRef.current = false;
        }
      };

      initScanner();
    } else {
      // Inactive, tab switched, or modal open: completely stop camera and turn off hardware sensor/LED
      isScannerStartingRef.current = false;
      stopCameraScanner();
    }

    return () => {
      isMounted = false;
      stopCameraScanner();
    };
  }, [isAuthenticated, activeTab, scannerActive, scannerEpoch, isModalOpen, stopCameraScanner, waitForVisibleContainer]);

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      stopCameraScanner();
    };
  }, [stopCameraScanner]);

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

  // Restore persistent 6-hour session from localStorage on initial load
  useEffect(() => {
    let isMounted = true;
    const restoreSession = async () => {
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null;
        if (!raw) {
          if (isMounted) setIsCheckingSession(false);
          return;
        }
        const session = JSON.parse(raw);
        const remaining = session.expiresAt ? session.expiresAt - Date.now() : 0;
        if (!session.password || remaining <= 0) {
          localStorage.removeItem(SESSION_KEY);
          if (isMounted) setIsCheckingSession(false);
          return;
        }
        if (isMounted) setPassword(session.password);
        const success = await fetchData(session.password);
        if (isMounted) {
          if (success) {
            setIsAuthenticated(true);
            if (logoutTimerRef.current) {
              clearTimeout(logoutTimerRef.current);
            }
            logoutTimerRef.current = setTimeout(() => {
              handleSignOut();
              showToast('Session expired after 6 hours. Please sign in again.', 'warning');
            }, remaining);
          } else {
            localStorage.removeItem(SESSION_KEY);
            setPassword('');
          }
        }
      } catch {
        try {
          localStorage.removeItem(SESSION_KEY);
        } catch {}
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [fetchData, handleSignOut]);

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
    // Filter by search query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    if (q === 'pending rsvp' || q === 'pending-rsvp' || q === 'no rsvp') {
      return !a.hasRsvp;
    }
    if (q === 'pending checkin' || q === 'pending check-in' || q === 'not checked in') {
      return a.hasRsvp && !a.hasCheckedIn;
    }
    if (q === 'pending refreshment' || q === 'pending refreshments') {
      return a.hasCheckedIn && !a.hasRefreshment;
    }
    return (
      a.email.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      (a.raNumber && a.raNumber.toLowerCase().includes(q))
    );
  });

  // ── Session Restoring Screen ──
  if (isCheckingSession) {
    return (
      <div className="min-h-[100dvh] bg-htb-bg flex flex-col items-center justify-center p-4">
        <img
          src="/logo.png"
          alt="HTB Chennai Logo"
          className="w-12 h-12 mb-3 object-contain animate-pulse"
        />
        <div className="flex items-center gap-2 text-xs font-mono text-htb-muted">
          <svg className="animate-spin h-3.5 w-3.5 text-htb-green" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Restoring session...</span>
        </div>
      </div>
    );
  }

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

      {/* Top Navbar */}
      <header
        aria-hidden={isBackgroundLocked}
        className={`border-b border-htb-border bg-htb-card px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-40 transition-all ${
          isBackgroundLocked ? 'pointer-events-none select-none opacity-30 filter blur-[1px]' : ''
        }`}
      >
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
            onClick={handleSignOut}
            className="border border-htb-border hover:bg-htb-elevated px-3 py-1.5 rounded-md text-xs font-medium text-htb-muted hover:text-htb-heading transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main
        aria-hidden={isBackgroundLocked}
        className={`flex-1 p-3.5 sm:p-6 max-w-7xl w-full mx-auto space-y-5 transition-all ${
          isBackgroundLocked ? 'pointer-events-none select-none opacity-30 filter blur-[1px]' : ''
        }`}
      >
        {/* Navigation Tabs */}
        <div className="flex bg-htb-card border border-htb-border p-1 rounded-lg">
          <button
            onClick={() => {
              if (isModalOpen || isDismissingModalRef.current) return;
              setActiveTab('scanner');
            }}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-2 ${
              activeTab === 'scanner'
                ? 'bg-htb-elevated text-htb-green shadow-sm border border-htb-border/60'
                : 'text-htb-muted hover:text-htb-heading'
            }`}
          >
            <span>QR Scanner & Desk</span>
          </button>
          <button
            onClick={() => {
              if (isModalOpen || isDismissingModalRef.current) return;
              setActiveTab('table');
            }}
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
            {/* Simple Station Switcher: Check-in Gate or Refreshments */}
            <div className="grid grid-cols-2 gap-2 bg-htb-card border border-htb-border p-1.5 rounded-xl">
              <button
                onClick={() => {
                  if (isModalOpen || isDismissingModalRef.current) return;
                  setStationMode('checkin');
                  setActionMessage('');
                }}
                className={`py-2.5 px-3 text-xs sm:text-sm font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1.5 ${
                  stationMode === 'checkin'
                    ? 'bg-htb-elevated text-htb-green border border-htb-green/40 shadow-sm'
                    : 'text-htb-muted hover:text-htb-heading'
                }`}
              >
                <span>Check-in Gate</span>
              </button>
              <button
                onClick={() => {
                  if (isModalOpen || isDismissingModalRef.current) return;
                  setStationMode('refreshment');
                  setActionMessage('');
                }}
                className={`py-2.5 px-3 text-xs sm:text-sm font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1.5 ${
                  stationMode === 'refreshment'
                    ? 'bg-htb-elevated text-htb-green border border-htb-green/40 shadow-sm'
                    : 'text-htb-muted hover:text-htb-heading'
                }`}
              >
                <span>Refreshments</span>
              </button>
            </div>

            {/* Camera QR Scanner Card */}
            <div className="bg-htb-card border border-htb-border rounded-xl p-3.5 sm:p-4 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-xs font-semibold text-htb-heading">
                    {stationMode === 'checkin'
                      ? 'Gate Check-in Station'
                      : 'Refreshments Station'}
                  </h2>
                  <p className="text-[11px] text-htb-muted">
                    {stationMode === 'checkin'
                      ? 'Auto-checks in scanned pass'
                      : 'Marks refreshment as collected'}
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

              {/* The reader node stays mounted for the whole session and is only hidden with
                  CSS. Unmounting it between scans left html5-qrcode holding a dead node,
                  which is what produced a permanently black viewfinder. */}
              <div className={scannerActive ? 'block' : 'hidden'}>
                <div className="relative overflow-hidden rounded-xl border border-htb-border bg-black mx-auto w-full min-h-[300px] flex items-center justify-center">
                  <div id="admin-qr-reader" className="w-full flex items-center justify-center" />

                  {/* Clean, professional QR reticle & overlay - only shown when scanner is actively seeking */}
                  {!isModalOpen && (
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
                        Scan participant&apos;s QR code on ticket
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {!scannerActive && (
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
            {/* Read-only stat boxes (RSVP, check-in, refreshments & total) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="bg-htb-card border border-htb-border rounded-xl p-4 shadow-sm space-y-1 select-none">
                <span className="block text-xs font-semibold text-htb-muted">RSVPs</span>
                <span className="block text-3xl sm:text-4xl font-extrabold text-htb-heading">
                  {stats?.totalRsvp ?? 0}
                </span>
              </div>

              <div className="bg-htb-card border border-htb-border rounded-xl p-4 shadow-sm space-y-1 select-none">
                <span className="block text-xs font-semibold text-htb-muted">Checked In</span>
                <span className="block text-3xl sm:text-4xl font-extrabold text-htb-heading">
                  {stats?.totalCheckedIn ?? 0}
                </span>
              </div>

              <div className="bg-htb-card border border-htb-border rounded-xl p-4 shadow-sm space-y-1 select-none">
                <span className="block text-xs font-semibold text-htb-muted">Refreshments</span>
                <span className="block text-3xl sm:text-4xl font-extrabold text-htb-heading">
                  {stats?.totalRefreshment ?? 0}
                </span>
              </div>

              <div className="bg-htb-card border border-htb-border rounded-xl p-4 shadow-sm space-y-1 select-none">
                <span className="block text-xs font-semibold text-htb-muted">Total Participants</span>
                <span className="block text-3xl sm:text-4xl font-extrabold text-htb-heading">
                  {stats?.totalRegistered ?? 0}
                </span>
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
                      onClick={() => {
                        if (isModalOpen || isDismissingModalRef.current) return;
                        setSearchQuery('');
                      }}
                      className="absolute right-2.5 top-2.5 text-xs text-htb-muted hover:text-htb-heading"
                    >
                      &times;
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 w-full sm:w-auto text-xs">
                  <button
                    onClick={() => {
                      if (isModalOpen || isDismissingModalRef.current) return;
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
                    onClick={() => {
                      if (isModalOpen || isDismissingModalRef.current) return;
                      handleExportJSON();
                    }}
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
                      if (isDismissingModalRef.current || isModalOpen) return;
                      openParticipant({
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
                            if (isModalOpen || isDismissingModalRef.current) return;
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
                          if (isDismissingModalRef.current || isModalOpen) return;
                          openParticipant({
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
                              onClick={() => {
                                if (isModalOpen || isDismissingModalRef.current) return;
                                copyTicketId(a.id);
                              }}
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
                              if (isDismissingModalRef.current || isModalOpen) return;
                              openParticipant({
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

      {/* Invisible Touch Shield: absorbs ghost taps/clicks during modal transition */}
      {isDismissingModal && (
        <div
          className="fixed inset-0 z-[9998] bg-transparent cursor-default pointer-events-auto select-none"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}

      {/* ── Gate Scan Result Modal (Check-in & Refreshments) ── */}
      {cameraToast && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Blackout Backdrop - tap outside closes cleanly */}
          <div
            className="fixed inset-0 bg-black/85 backdrop-blur-md animate-fade-in cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              resumeCameraScanning();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              resumeCameraScanning();
            }}
          />

          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-sm bg-htb-card border border-htb-border rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 text-center animate-slide-up pointer-events-auto overscroll-contain"
          >
            {/* Header with Title & Cross Button */}
            <div className="flex items-center justify-between border-b border-htb-border pb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center ${
                    cameraToast.type === 'success'
                      ? 'bg-htb-green/20 text-htb-green border border-htb-green/40'
                      : cameraToast.type === 'warning'
                      ? 'bg-htb-warning/20 text-htb-warning border border-htb-warning/40'
                      : 'bg-htb-error/20 text-htb-error border border-htb-error/40'
                  }`}
                >
                  {cameraToast.type === 'success' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : cameraToast.type === 'warning' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </span>
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    cameraToast.type === 'success'
                      ? 'text-htb-green'
                      : cameraToast.type === 'warning'
                      ? 'text-htb-warning'
                      : 'text-htb-error'
                  }`}
                >
                  {cameraToast.title}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  resumeCameraScanning();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  resumeCameraScanning();
                }}
                className="w-8 h-8 rounded-full bg-htb-elevated border border-htb-border hover:border-htb-border-light text-htb-muted hover:text-htb-heading flex items-center justify-center text-lg leading-none transition-colors active:scale-90"
                aria-label="Close result"
              >
                &times;
              </button>
            </div>

            {/* Attendee Details */}
            {cameraToast.participant ? (
              <div className="bg-htb-elevated border border-htb-border rounded-xl p-4 text-center space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-htb-green tracking-wider">
                  Verified Attendee
                </span>
                <h4 className="text-lg sm:text-xl font-bold text-htb-heading break-words">
                  {cameraToast.participant.name || 'Participant'}
                </h4>
                <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs pt-1">
                  {cameraToast.participant.raNumber && (
                    <span className={`${BADGE} px-2 py-0.5 text-xs`}>
                      {cameraToast.participant.raNumber}
                    </span>
                  )}
                  {cameraToast.participant.id && (
                    <span className="font-mono text-htb-muted text-xs">
                      {cameraToast.participant.id}
                    </span>
                  )}
                </div>
                <p className="text-xs text-htb-muted pt-1">{cameraToast.message}</p>
              </div>
            ) : (
              <div className="p-4 bg-htb-elevated border border-htb-border rounded-xl text-center">
                <p className="text-xs text-htb-muted">{cameraToast.message}</p>
              </div>
            )}

            {/* Action Buttons: See Info and Close */}
            <div className="pt-2 flex items-center gap-2.5">
              {cameraToast.participant && (
                <button
                  type="button"
                  onClick={() => {
                    const p = cameraToast.participant!;
                    setCameraToast(null);
                    openParticipant(p);
                  }}
                  className="flex-1 h-11 bg-htb-elevated hover:bg-htb-elevated-hover border border-htb-border hover:border-htb-heading/40 text-htb-heading font-semibold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4 text-htb-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>See Info</span>
                </button>
              )}
              <button
                type="button"
                onClick={resumeCameraScanning}
                className="flex-1 h-11 bg-htb-green hover:bg-htb-green-dim text-htb-bg font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <span>Scan Next Pass</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── See Info Popup Modal ── */}
      {modalParticipant && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Blackout Backdrop - tap outside closes cleanly */}
          <div
            className="fixed inset-0 bg-black/85 backdrop-blur-md animate-fade-in cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeParticipant();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeParticipant();
            }}
          />

          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="relative z-10 bg-htb-card border border-htb-border w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4 animate-slide-up pointer-events-auto overscroll-contain"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-htb-border pb-3">
              <h3 className="text-sm sm:text-base font-bold text-htb-heading">Participant Details</h3>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeParticipant();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeParticipant();
                }}
                className="w-8 h-8 rounded-full bg-htb-elevated border border-htb-border hover:border-htb-border-light text-htb-muted hover:text-htb-heading flex items-center justify-center text-lg leading-none transition-colors active:scale-90"
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
                    {modalParticipant.refreshment ? 'Already claimed refreshment' : 'Not yet claimed'}
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
                  <span>Already claimed refreshment. All event actions completed.</span>
                </div>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeParticipant();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeParticipant();
                }}
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
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Blackout Backdrop */}
          <div
            className="fixed inset-0 bg-black/85 backdrop-blur-md animate-fade-in cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startModalDismissalCooldown();
              setImportModalOpen(false);
              setImportFile(null);
              setImportError('');
              setImportPreviewCount(null);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startModalDismissalCooldown();
              setImportModalOpen(false);
              setImportFile(null);
              setImportError('');
              setImportPreviewCount(null);
            }}
          />

          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="relative z-10 bg-htb-card border border-htb-border w-full max-w-md rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5 pointer-events-auto overscroll-contain"
          >
            <div className="flex items-center justify-between border-b border-htb-border pb-3">
              <div>
                <h3 className="text-base font-bold text-htb-heading">Import Participants (JSON)</h3>
                <p className="text-xs text-htb-muted">Upload a JSON file of attendee records</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startModalDismissalCooldown();
                  setImportModalOpen(false);
                  setImportFile(null);
                  setImportError('');
                  setImportPreviewCount(null);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startModalDismissalCooldown();
                  setImportModalOpen(false);
                  setImportFile(null);
                  setImportError('');
                  setImportPreviewCount(null);
                }}
                className="w-8 h-8 rounded-full bg-htb-elevated border border-htb-border hover:border-htb-border-light text-htb-muted hover:text-htb-heading flex items-center justify-center text-lg leading-none transition-colors active:scale-90"
              >
                &times;
              </button>
            </div>

            {/* Expected JSON Format Helper */}
            <div className="bg-htb-elevated/70 border border-htb-border rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-htb-heading">Sample JSON Format</span>
                <span className="text-[10px] font-mono font-medium text-htb-warning bg-htb-warning/10 border border-htb-warning/30 px-2 py-0.5 rounded">
                  raNumber is optional
                </span>
              </div>
              <pre className="text-[11px] font-mono text-htb-muted bg-htb-card p-2.5 rounded-lg border border-htb-border overflow-x-auto select-all">
{`[
  {
    "name": "David Miller",
    "email": "david@hackthebox.com",
    "raNumber": "RA2211031010099"
  }
]`}
              </pre>
              <p className="text-[11px] text-htb-muted leading-relaxed">
                Provide an array of objects. <strong className="text-htb-heading">name</strong> and <strong className="text-htb-heading">email</strong> are required. <strong className="text-htb-heading">raNumber</strong> is optional.
              </p>
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
                  startModalDismissalCooldown();
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
    </div>
  );
}
