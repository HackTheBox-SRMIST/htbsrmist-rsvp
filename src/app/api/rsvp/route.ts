import { NextRequest, NextResponse } from 'next/server';
import { findAttendeeByEmail, updateRSVP } from '@/lib/database';
import { generateAttendeeToken } from '@/lib/tokenGenerator';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting (15 requests/min per IP)
    const ip =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (!checkRateLimit(`rsvp-${ip}`, 15, 60000)) {
      return NextResponse.json(
        {
          success: false,
          error: 'RATE_LIMITED',
          message: 'Too many requests. Please wait a moment and try again.',
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_INPUT',
          message: 'Please enter a valid email address.',
        },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_EMAIL',
          message: 'Please enter a valid email address.',
        },
        { status: 400 }
      );
    }

    // 1. Check whether the email exists in the registered participants database
    const attendee = await findAttendeeByEmail(trimmedEmail);

    // 2. If the email is not registered:
    if (!attendee) {
      return NextResponse.json(
        {
          success: false,
          error: 'NOT_REGISTERED',
          message: 'This email is not registered for this event.',
        },
        { status: 404 }
      );
    }

    // The RA number is never supplied by the participant: it is optional and only
    // ever comes from the registration record (CSV/JSON import).
    const storedRaNumber = (attendee.raNumber || '').trim();

    // 4. If the participant has already RSVP'd:
    // Do not create another RSVP or participant record. Return existing token and status.
    if (attendee.rsvp === 'YES' && attendee.ticketId) {
      const isCheckedIn = attendee.checkedIn === 'YES';
      return NextResponse.json({
        success: true,
        alreadyRsvpd: true,
        checkedIn: isCheckedIn,
        checkInTime: attendee.checkInTime || undefined,
        message: isCheckedIn ? 'Checked in already.' : 'RSVP confirmed. Check-in pending.',
        token: attendee.ticketId,
        name: attendee.name,
        email: attendee.email,
        raNumber: storedRaNumber || undefined,
        rsvpTime: attendee.rsvpTime,
      });
    }

    // 3. If registered and not RSVP'd yet:
    // Mark RSVP status as YES, generate unique token, store timestamp
    const token = attendee.ticketId || generateAttendeeToken();
    const rsvpTime = await updateRSVP(attendee.dbId, token, storedRaNumber);

    return NextResponse.json({
      success: true,
      alreadyRsvpd: false,
      checkedIn: false,
      message: 'RSVP confirmed!',
      token,
      name: attendee.name,
      email: attendee.email,
      raNumber: storedRaNumber || undefined,
      rsvpTime,
    });
  } catch (error) {
    console.error('RSVP Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'SERVER_ERROR',
        message: 'An internal error occurred. Please try again.',
      },
      { status: 500 }
    );
  }
}
