#!/usr/bin/env node
/**
 * One-time migration: copy the local data/attendees.json into MongoDB.
 *
 * Safe to re-run. It upserts by email, so existing RSVP / check-in / refreshment
 * state and issued ticket IDs are preserved rather than duplicated.
 *
 *   npm run seed
 *
 * Set MONGODB_URI in .env.local first (see .env.local.example).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadEnv() {
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

function generateAttendeeToken() {
  return `HTB-CHENNAI-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function normalizeRecord(record) {
  const isRsvp = record.rsvp === 'YES' || record.rsvp === true;
  // Accepts the legacy attendeeId column but stores one canonical field.
  let ticketId = (record.ticketId || record.attendeeId || record.id || record.token || '')
    .trim()
    .toUpperCase();
  if (isRsvp && !ticketId) ticketId = generateAttendeeToken();
  // Single canonical field: emails are stored lowercased so the unique index
  // and every lookup can key off `email` directly, with no duplicate key field.
  const email = (record.email || '').trim().toLowerCase();
  const raNumber = (record.raNumber || record.ra_number || record.ra || record.usn || '').trim();
  return {
    email,
    name: (record.name || '').trim(),
    rsvp: isRsvp ? 'YES' : '',
    rsvpTime: record.rsvpTime || (isRsvp ? new Date().toISOString() : ''),
    ticketId,
    checkedIn: record.checkedIn === 'YES' || record.checkin === true ? 'YES' : '',
    checkInTime: record.checkInTime || '',
    refreshment: record.refreshment === 'YES' || record.refreshments === true ? 'YES' : '',
    refreshmentTime: record.refreshmentTime || '',
    // Omit the key entirely rather than storing null when there is no RA.
    ...(raNumber ? { raNumber } : {}),
  };
}

loadEnv();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('\nMONGODB_URI is not set.');
  console.error('Add it to .env.local, then re-run: npm run seed\n');
  process.exit(1);
}

const dataPath = path.join(root, 'data', 'attendees.json');
if (!fs.existsSync(dataPath)) {
  console.error(`\nNo attendees file at ${dataPath}`);
  console.error('Nothing to migrate.\n');
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const list = Array.isArray(parsed) ? parsed : parsed.attendees || [];
const docs = list.map(normalizeRecord).filter((d) => d.email && d.email.includes('@'));

const dbName = 'htbsrmist';
const collName = 'new_rsvp';
const client = new MongoClient(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });

try {
  await client.connect();
  const collection = client.db(dbName).collection(collName);

  try {
    await collection.createIndex({ email: 1 }, { unique: true });
    await collection.createIndex({ ticketId: 1 });
  } catch (error) {
    console.warn(`[seed] index note: ${error.message}`);
  }

  const result = await collection.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { email: doc.email },
        update: { $set: doc },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  const total = await collection.countDocuments({});
  console.log('\nSeed complete');
  console.log(`  database:  ${dbName}.${collName}`);
  console.log(`  inserted:  ${result.upsertedCount}`);
  console.log(`  updated:   ${result.matchedCount}`);
  console.log(`  total now: ${total}\n`);
} catch (error) {
  console.error('\nSeed failed:', error.message, '\n');
  process.exitCode = 1;
} finally {
  await client.close();
}
