import { NextRequest, NextResponse } from 'next/server';
import { findAttendeeByToken, findAttendeeByEmail, markRefreshment } from '@/lib/database';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (!checkRateLimit(`refreshment-${ip}`, 45, 60000)) {
      return NextResponse.json(
        { status: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { token, email } = body;

    let attendee = null;

    if (token && typeof token === 'string') {
      attendee =
        (await findAttendeeByToken(token.trim())) ||
        (await findAttendeeByEmail(token.trim().toLowerCase()));
    } else if (email && typeof email === 'string') {
      attendee = await findAttendeeByEmail(email.trim().toLowerCase());
    }

    if (!attendee) {
      return NextResponse.json(
        {
          status: 'INVALID_TOKEN',
          message: 'No registered participant found for this token.',
        },
        { status: 404 }
      );
    }

    // Check if RSVP is confirmed
    if (attendee.rsvp !== 'YES') {
      return NextResponse.json({
        status: 'NO_RSVP',
        message: 'Participant has not confirmed their RSVP.',
        participant: {
          name: attendee.name,
          email: attendee.email,
          rsvp: false,
          checkedIn: false,
          refreshment: false,
        },
      });
    }

    // Check if check-in has been completed first (recommended event flow: RSVP -> Check-in -> Refreshment)
    if (attendee.checkedIn !== 'YES') {
      return NextResponse.json({
        status: 'NOT_CHECKED_IN',
        message: 'Participant must complete venue check-in before collecting refreshments.',
        participant: {
          id: attendee.ticketId,
          name: attendee.name,
          email: attendee.email,
          raNumber: attendee.raNumber || '',
          rsvp: true,
          checkedIn: false,
          refreshment: false,
        },
      });
    }

    // Check if refreshment already collected
    if (attendee.refreshment === 'YES') {
      return NextResponse.json({
        status: 'ALREADY_COLLECTED',
        message: 'Already claimed refreshment.',
        refreshmentTime: attendee.refreshmentTime,
        participant: {
          id: attendee.ticketId,
          name: attendee.name,
          email: attendee.email,
          raNumber: attendee.raNumber || '',
          rsvp: true,
          rsvpTime: attendee.rsvpTime,
          checkedIn: true,
          checkInTime: attendee.checkInTime,
          refreshment: true,
          refreshmentTime: attendee.refreshmentTime,
        },
      });
    }

    // Mark as collected
    const refreshmentTime = await markRefreshment(attendee.dbId);

    return NextResponse.json({
      status: 'REFRESHMENT_SUCCESS',
      message: 'Refreshment marked as collected!',
      refreshmentTime,
      participant: {
        id: attendee.ticketId,
        name: attendee.name,
        email: attendee.email,
        raNumber: attendee.raNumber || '',
        rsvp: true,
        rsvpTime: attendee.rsvpTime,
        checkedIn: true,
        checkInTime: attendee.checkInTime,
        refreshment: true,
        refreshmentTime,
      },
    });
  } catch (error) {
    console.error('Refreshment Error:', error);
    return NextResponse.json(
      { status: 'SERVER_ERROR', message: 'An internal error occurred.' },
      { status: 500 }
    );
  }
}
