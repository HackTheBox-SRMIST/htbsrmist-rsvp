import { NextRequest, NextResponse } from 'next/server';
import { findAttendeeByToken, findAttendeeByEmail, markCheckedIn } from '@/lib/database';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (!checkRateLimit(`checkin-${ip}`, 45, 60000)) {
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
        message: 'Participant has not confirmed their RSVP yet.',
        participant: {
          name: attendee.name,
          email: attendee.email,
          raNumber: attendee.raNumber || '',
          rsvp: false,
          checkedIn: false,
          refreshment: false,
        },
      });
    }

    // Check if already checked in
    if (attendee.checkedIn === 'YES') {
      return NextResponse.json({
        status: 'ALREADY_CHECKED_IN',
        message: 'Check-in already completed.',
        checkInTime: attendee.checkInTime,
        participant: {
          id: attendee.ticketId,
          name: attendee.name,
          email: attendee.email,
          raNumber: attendee.raNumber || '',
          rsvp: true,
          rsvpTime: attendee.rsvpTime,
          checkedIn: true,
          checkInTime: attendee.checkInTime,
          refreshment: attendee.refreshment === 'YES',
          refreshmentTime: attendee.refreshmentTime || null,
        },
      });
    }

    // Mark as checked in
    const checkInTime = await markCheckedIn(attendee.dbId);

    return NextResponse.json({
      status: 'CHECK_IN_SUCCESS',
      message: 'Check-in marked successfully!',
      checkInTime,
      participant: {
        id: attendee.ticketId,
        name: attendee.name,
        email: attendee.email,
        raNumber: attendee.raNumber || '',
        rsvp: true,
        rsvpTime: attendee.rsvpTime,
        checkedIn: true,
        checkInTime,
        refreshment: attendee.refreshment === 'YES',
        refreshmentTime: attendee.refreshmentTime || null,
      },
    });
  } catch (error) {
    console.error('Check-in Error:', error);
    return NextResponse.json(
      { status: 'SERVER_ERROR', message: 'An internal error occurred.' },
      { status: 500 }
    );
  }
}
