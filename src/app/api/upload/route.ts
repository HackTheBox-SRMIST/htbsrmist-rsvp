import { NextRequest, NextResponse } from 'next/server';
import { importAttendees } from '@/lib/database';
import { requireAdmin } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const denied = requireAdmin(request, 'upload', formData.get('password') as string);
    if (denied) return denied;

    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'NO_FILE', message: 'No file provided.' },
        { status: 400 }
      );
    }

    const mode = ((formData.get('mode') as string) || 'merge').toLowerCase() === 'replace' ? 'replace' : 'merge';
    const text = await file.text();
    const trimmed = text.trim();
    const records: any[] = [];

    // Support JSON format (array of objects or { attendees: [...] } with name and email)
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return NextResponse.json(
          { error: 'INVALID_JSON', message: 'Failed to parse JSON file.' },
          { status: 400 }
        );
      }

      const list: any[] = Array.isArray(parsed)
        ? parsed
        : parsed.attendees || parsed.data || parsed.records || [];

      if (!Array.isArray(list) || list.length === 0) {
        return NextResponse.json(
          { error: 'EMPTY_FILE', message: 'JSON contains no attendee records.' },
          { status: 400 }
        );
      }

      for (const item of list) {
        const email = (item.email || '').trim();
        const name = (item.name || '').trim();
        const raNumber = (item.ra_number || item.raNumber || item.ra || item.usn || '').trim();
        if (email && email.includes('@')) {
          records.push({
            ...item,
            email,
            name,
            raNumber: raNumber || undefined,
          });
        }
      }
    } else {
      // Support CSV format
      const lines = trimmed
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l);

      if (lines.length < 2) {
        return NextResponse.json(
          { error: 'EMPTY_FILE', message: 'File has no data rows.' },
          { status: 400 }
        );
      }

      const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
      const emailIdx = header.findIndex((h) => h.includes('email'));
      const nameIdx = header.findIndex((h) => h.includes('name'));
      const raIdx = header.findIndex((h) => h.includes('ra') || h.includes('usn') || h.includes('reg'));

      if (emailIdx === -1) {
        return NextResponse.json(
          {
            error: 'INVALID_FORMAT',
            message: 'CSV must have an "Email" column in the header.',
          },
          { status: 400 }
        );
      }

      for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVLine(lines[i]);
        const email = fields[emailIdx]?.trim();
        const name = nameIdx >= 0 ? fields[nameIdx]?.trim() || '' : '';
        const raNumber = raIdx >= 0 ? fields[raIdx]?.trim() || '' : '';

        if (email && email.includes('@')) {
          records.push({ email, name, raNumber: raNumber || undefined });
        }
      }
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: 'NO_VALID_RECORDS', message: 'No valid attendee records with email found.' },
        { status: 400 }
      );
    }

    const result = await importAttendees(records, mode);

    return NextResponse.json({
      success: true,
      message:
        mode === 'replace'
          ? `Replaced all records: ${result.added} participants imported.`
          : `Import complete: ${result.added} added, ${result.updated} updated.`,
      added: result.added,
      updated: result.updated,
      total: result.total,
      mode,
    });
  } catch (error) {
    console.error('Upload Error:', error);
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'Failed to process upload.' },
      { status: 500 }
    );
  }
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  fields.push(current);
  return fields;
}
