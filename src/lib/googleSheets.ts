import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('Google Sheets credentials not configured');
  }

  return new google.auth.JWT(email, undefined, key, SCOPES);
}

function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID!;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1';

export interface Attendee {
  rowIndex: number;
  email: string;
  name: string;
  rsvp: string;
  attendeeId: string;
  checkedIn: string;
  checkInTime: string;
  scannerDevice: string;
}

export async function findAttendeeByEmail(email: string): Promise<Attendee | null> {
  const sheets = getSheets();
  const range = `${SHEET_NAME}!A:G`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const rows = response.data.values;
  if (!rows) return null;

  const normalizedEmail = email.toLowerCase().trim();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]?.toLowerCase().trim() === normalizedEmail) {
      return {
        rowIndex: i + 1,
        email: rows[i][0] || '',
        name: rows[i][1] || '',
        rsvp: rows[i][2] || '',
        attendeeId: rows[i][3] || '',
        checkedIn: rows[i][4] || '',
        checkInTime: rows[i][5] || '',
        scannerDevice: rows[i][6] || '',
      };
    }
  }

  return null;
}

export async function findAttendeeByToken(token: string): Promise<Attendee | null> {
  const sheets = getSheets();
  const range = `${SHEET_NAME}!A:G`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const rows = response.data.values;
  if (!rows) return null;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][3] === token) {
      return {
        rowIndex: i + 1,
        email: rows[i][0] || '',
        name: rows[i][1] || '',
        rsvp: rows[i][2] || '',
        attendeeId: rows[i][3] || '',
        checkedIn: rows[i][4] || '',
        checkInTime: rows[i][5] || '',
        scannerDevice: rows[i][6] || '',
      };
    }
  }

  return null;
}

export async function updateRSVP(rowIndex: number, token: string): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!C${rowIndex}:D${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['YES', token]],
    },
  });
}

export async function markCheckedIn(
  rowIndex: number,
  deviceId?: string
): Promise<string> {
  const sheets = getSheets();
  const now = new Date().toISOString();

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!E${rowIndex}:G${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['YES', now, deviceId || '']],
    },
  });

  return now;
}

export async function getAllAttendees(): Promise<Omit<Attendee, 'rowIndex'>[]> {
  const sheets = getSheets();
  const range = `${SHEET_NAME}!A:G`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return [];

  return rows.slice(1).map((row) => ({
    email: row[0] || '',
    name: row[1] || '',
    rsvp: row[2] || '',
    attendeeId: row[3] || '',
    checkedIn: row[4] || '',
    checkInTime: row[5] || '',
    scannerDevice: row[6] || '',
  }));
}
