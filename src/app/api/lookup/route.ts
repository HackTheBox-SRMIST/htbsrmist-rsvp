import { NextRequest, NextResponse } from 'next/server';
import { findAttendeeByToken, findAttendeeByEmail } from '@/lib/database';
import { checkRateLimit } from '@/lib/rateLimit';
import { requireAdmin } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const denied = requireAdmin(request, 'lookup');
    if (denied) return denied;

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (!checkRateLimit(`lookup-${ip}`, 60, 60000)) {
      return NextResponse.json(
        {
          success: false,
          error: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down.',
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { token, email } = body;

    let attendee = null;

    if (token && typeof token === 'string') {
      attendee = await findAttendeeByToken(token.trim());
    } else if (email && typeof email === 'string') {
      attendee = await findAttendeeByEmail(email.trim().toLowerCase());
    }

    if (!attendee) {
      return NextResponse.json(
        {
          success: false,
          error: 'NOT_FOUND',
          message: 'No participant record found for this identifier.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      participant: {
        id: attendee.ticketId || '',
        name: attendee.name,
        email: attendee.email,
        raNumber: attendee.raNumber || '',
        rsvp: attendee.rsvp === 'YES',
        rsvpTime: attendee.rsvpTime || null,
        checkedIn: attendee.checkedIn === 'YES',
        checkInTime: attendee.checkInTime || null,
        refreshment: attendee.refreshment === 'YES',
        refreshmentTime: attendee.refreshmentTime || null,
      },
    });
  } catch (error) {
    console.error('Lookup Error:', error);
    return NextResponse.json(
      { success: false, error: 'SERVER_ERROR', message: 'Internal server error.' },
      { status: 500 }
    );
  }
}
