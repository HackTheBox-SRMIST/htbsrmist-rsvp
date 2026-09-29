import { NextRequest, NextResponse } from 'next/server';
import { getAllAttendees, getStats } from '@/lib/database';
import { requireAdmin } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const denied = requireAdmin(request, 'export');
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';

    const attendees = await getAllAttendees();
    const stats = await getStats();

    if (format === 'csv') {
      const header =
        'attendee_id,email,name,ra_number,rsvp,rsvp_time,checked_in,check_in_time,refreshment,refreshment_time';
      const rows = attendees.map((a) =>
        [
          a.ticketId,
          a.email,
          `"${(a.name || '').replace(/"/g, '""')}"`,
          a.raNumber || '',
          a.rsvp,
          a.rsvpTime,
          a.checkedIn,
          a.checkInTime,
          a.refreshment,
          a.refreshmentTime,
        ].join(',')
      );
      const csv = [header, ...rows].join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="htb-chennai-attendees-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // JSON format: Clean array of participant details
    const jsonData = attendees.map((a) => {
      const item: any = {
        id: a.ticketId || null,
        name: a.name || '',
        email: a.email,
      };
      if (a.raNumber) {
        item.ra_number = a.raNumber;
      }
      item.rsvp = a.rsvp === 'YES';
      item.checkin = a.checkedIn === 'YES';
      item.refreshments = a.refreshment === 'YES';
      return item;
    });

    return new NextResponse(JSON.stringify(jsonData, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="htb-chennai-attendees-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (error) {
    console.error('Export Error:', error);
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'An internal error occurred.' },
      { status: 500 }
    );
  }
}
