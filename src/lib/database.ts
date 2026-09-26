import { MongoClient, Db, Collection, ObjectId, AnyBulkWriteOperation, Filter } from 'mongodb';
import { generateAttendeeToken } from '@/lib/tokenGenerator';

export interface AttendeeRecord {
  email: string;
  name: string;
  rsvp: 'YES' | 'NO' | '';
  rsvpTime: string;
  ticketId: string; // Secure token, always stored uppercase
  checkedIn: 'YES' | 'NO' | '';
  checkInTime: string;
  refreshment: 'YES' | 'NO' | '';
  refreshmentTime: string;
  raNumber?: string; // Optional RA Number / USN (e.g., RA2211031010004)
}

/** An attendee plus the Mongo document id used to update that exact record. */
export type AttendeeRef = AttendeeRecord & { dbId: string };

interface AttendeeDoc extends Omit<AttendeeRecord, 'raNumber'> {
  _id?: ObjectId;
  raNumber?: string;
}

const MONGO_URI = process.env.MONGODB_URI;
// Fixed in code rather than configured per environment: this app has exactly one
// attendee database. Change it here and redeploy.
const DB_NAME = 'htbsrmist';
const COLLECTION = 'new_rsvp';

// Cached on globalThis so the connection is reused across invocations inside a
// warm serverless instance, and survives Next.js hot reloads in development.
const globalCache = globalThis as unknown as {
  __htbMongo?: { client: MongoClient; db: Db; indexesReady?: Promise<void> };
};

let indexesPromise: Promise<void> | null = null;

/**
 * `topology` is not part of the driver's public type, so probe it defensively.
 * If the shape is unexpected we assume the client is fine rather than tearing
 * down a working connection.
 */
function isClientUsable(client: MongoClient): boolean {
  const topology = (client as unknown as { topology?: { isConnected?: () => boolean } }).topology;
  if (typeof topology?.isConnected !== 'function') return true;
  return topology.isConnected();
}

function connect(): Promise<Db> {
  if (!MONGO_URI) {
    throw new Error(
      'MONGODB_URI is not set. Add it to .env.local locally, and to the Vercel project environment variables before deploying.'
    );
  }

  const cached = globalCache.__htbMongo;
  if (cached) {
    // A cached client can be torn down underneath us (idle close, topology
    // error, hot reload). Handing it back regardless would make every later
    // request fail with MongoTopologyClosedError, so revalidate and rebuild.
    const usable = isClientUsable(cached.client);
    if (usable) return Promise.resolve(cached.db);
    globalCache.__htbMongo = undefined;
    indexesPromise = null;
  }

  const client = new MongoClient(MONGO_URI, {
    // Serverless instances are short-lived and a free Atlas cluster caps total
    // connections, so each instance opens a single pooled connection.
    maxPoolSize: 1,
    minPoolSize: 0,
    // Atlas closes idle connections; keep the window generous so a warm
    // instance is not torn down between two attendee scans.
    maxIdleTimeMS: 300000,
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
  });

  const db = client.db(DB_NAME);
  globalCache.__htbMongo = { client, db };
  return Promise.resolve(db);
}

async function getCollection(): Promise<Collection<AttendeeDoc>> {
  const db = await connect();
  return db.collection<AttendeeDoc>(COLLECTION);
}

/**
 * Best-effort index creation. Runs once per warm instance. Never throws: a
 * pre-existing duplicate (from an older import) would otherwise block every
 * request, and lookup correctness does not depend on the index existing.
 */
async function ensureIndexes(collection: Collection<AttendeeDoc>): Promise<void> {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      try {
        // Unique on the normalized email, so an exact-duplicate import is rejected.
        await collection.createIndex({ email: 1 }, { unique: true });
        await collection.createIndex({ ticketId: 1 });
      } catch (error) {
        // 85 "already exists with different options" and 86 "index already
        // exists" mean the seed script created it first. That is the normal
        // path, not a problem, so it stays quiet. Anything else is worth
        // knowing about.
        const code = (error as { code?: number }).code;
        if (code !== 85 && code !== 86) {
          console.warn(
            '[db] Could not create indexes; lookups still work but may be full scans:',
            (error as Error).message
          );
        }
      }
    })();
  }
  await indexesPromise;
}

function normalizeRecord(record: any): AttendeeDoc {
  const isRsvp = record.rsvp === 'YES' || record.rsvp === true;
  // Accepts the legacy attendeeId column on import, but stores one canonical
  // field. Tickets are uppercase by construction, so a single field is enough:
  // reads uppercase their input instead of relying on a duplicate index key.
  let ticketId = (
    record.ticketId ||
    record.attendeeId ||
    record.id ||
    record.token ||
    ''
  )
    .trim()
    .toUpperCase();
  if (isRsvp && !ticketId) {
    ticketId = generateAttendeeToken();
  }
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
    checkedIn:
      record.checkedIn === 'YES' || record.checkin === true || record.checked_in === true
        ? 'YES'
        : '',
    checkInTime: record.checkInTime || record.checkin_time || '',
    refreshment:
      record.refreshment === 'YES' || record.refreshments === true || record.refreshment === true
        ? 'YES'
        : '',
    refreshmentTime: record.refreshmentTime || record.refreshment_time || '',
    // Omit the key entirely rather than storing null when there is no RA.
    ...(raNumber ? { raNumber } : {}),
  };
}

function toRef(doc: AttendeeDoc): AttendeeRef {
  return {
    email: doc.email,
    name: doc.name,
    rsvp: doc.rsvp,
    rsvpTime: doc.rsvpTime,
    ticketId: doc.ticketId,
    checkedIn: doc.checkedIn,
    checkInTime: doc.checkInTime,
    refreshment: doc.refreshment,
    refreshmentTime: doc.refreshmentTime,
    raNumber: doc.raNumber,
    dbId: doc._id!.toString(),
  };
}

function toRecord(doc: AttendeeDoc): AttendeeRecord {
  const { _id, ...record } = doc;
  void _id;
  return record as AttendeeRecord;
}

function isValidObjectId(value: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(value);
}

export async function findAttendeeByEmail(emailInput: string): Promise<AttendeeRef | null> {
  const email = emailInput.trim().toLowerCase();
  // Unregistered participants have an empty email, so an empty query
  // would otherwise match the first of them.
  if (!email) return null;

  const collection = await getCollection();
  await ensureIndexes(collection);
  const doc = await collection.findOne({ email });
  return doc ? toRef(doc) : null;
}

export async function findAttendeeByToken(token: string): Promise<AttendeeRef | null> {
  const trimmed = token.trim().toUpperCase();
  // Most seeded attendees have no ticket yet, so they store an empty string.
  // Without this guard an empty scan would match one of them.
  if (!trimmed) return null;

  const collection = await getCollection();
  await ensureIndexes(collection);
  const doc = await collection.findOne({ ticketId: trimmed });
  return doc ? toRef(doc) : null;
}

export async function updateRSVP(dbId: string, token?: string, raNumber?: string): Promise<string> {
  const collection = await getCollection();
  if (!isValidObjectId(dbId)) throw new Error('Invalid attendee id');

  const now = new Date().toISOString();
  const finalToken = (token || generateAttendeeToken()).trim();

  // Pipeline form keeps this atomic: an existing rsvpTime is never overwritten,
  // matching the original "first RSVP wins" behaviour.
  const result = await collection.updateOne(
    { _id: new ObjectId(dbId) },
    [
      {
        $set: {
          rsvp: 'YES',
          rsvpTime: { $ifNull: ['$rsvpTime', now] },
          ticketId: finalToken.toUpperCase(),
          ...(raNumber && raNumber.trim() ? { raNumber: raNumber.trim() } : {}),
        },
      },
    ]
  );

  if (!result.matchedCount) throw new Error('Attendee not found');

  const doc = await collection.findOne({ _id: new ObjectId(dbId) }, { projection: { rsvpTime: 1 } });
  return doc?.rsvpTime || now;
}

export async function markCheckedIn(dbId: string): Promise<string> {
  const collection = await getCollection();
  if (!isValidObjectId(dbId)) throw new Error('Invalid attendee id');

  const now = new Date().toISOString();
  const result = await collection.updateOne(
    { _id: new ObjectId(dbId) },
    {
      $set: {
        checkedIn: 'YES',
        checkInTime: now,
      },
    }
  );

  if (!result.matchedCount) throw new Error('Attendee not found');
  return now;
}

export async function markRefreshment(dbId: string): Promise<string> {
  const collection = await getCollection();
  if (!isValidObjectId(dbId)) throw new Error('Invalid attendee id');

  const now = new Date().toISOString();
  const result = await collection.updateOne(
    { _id: new ObjectId(dbId) },
    {
      $set: {
        refreshment: 'YES',
        refreshmentTime: now,
      },
    }
  );

  if (!result.matchedCount) throw new Error('Attendee not found');
  return now;
}

export async function getAllAttendees(): Promise<AttendeeRecord[]> {
  const collection = await getCollection();
  const docs = await collection.find({}).sort({ email: 1 }).toArray();
  return docs.map(toRecord);
}

export async function getStats() {
  const collection = await getCollection();
  const [total, rsvpCount, checkinCount, refreshmentCount] = await Promise.all([
    collection.countDocuments({}),
    collection.countDocuments({ rsvp: 'YES' }),
    collection.countDocuments({ checkedIn: 'YES' }),
    collection.countDocuments({ refreshment: 'YES' }),
  ]);

  return {
    total,
    rsvpCount,
    checkinCount,
    refreshmentCount,
    pendingCheckinCount: Math.max(0, rsvpCount - checkinCount),
    pendingRefreshmentCount: Math.max(0, checkinCount - refreshmentCount),
  };
}

export async function importAttendees(
  records: any[],
  mode: 'merge' | 'replace' = 'merge'
): Promise<{ added: number; updated: number; total: number }> {
  const collection = await getCollection();
  await ensureIndexes(collection);

  // Normalize first: `email` is now the canonical key, so it is what dedupes,
  // matches, and upserts against.
  const valid = records
    .map((record) => normalizeRecord(record))
    .filter((doc) => doc.email.includes('@'));

  // Replace mode backs the admin's "Remove Existing Data & Replace All" button.
  if (mode === 'replace') {
    await collection.deleteMany({});
    if (valid.length) await collection.insertMany(valid as AttendeeDoc[], { ordered: false });
    return { added: valid.length, updated: 0, total: valid.length };
  }

  const ops: AnyBulkWriteOperation<AttendeeDoc>[] = valid.map((normalized) => {
    const setFields: Partial<AttendeeDoc> = { email: normalized.email };

    if (normalized.name) setFields.name = normalized.name;
    if (normalized.raNumber) setFields.raNumber = normalized.raNumber;
    if (normalized.rsvp === 'YES') {
      setFields.rsvp = 'YES';
      setFields.rsvpTime = normalized.rsvpTime;
      if (normalized.ticketId) {
        setFields.ticketId = normalized.ticketId;
      }
    }
    if (normalized.checkedIn === 'YES') {
      setFields.checkedIn = 'YES';
      setFields.checkInTime = normalized.checkInTime;
    }
    if (normalized.refreshment === 'YES') {
      setFields.refreshment = 'YES';
      setFields.refreshmentTime = normalized.refreshmentTime;
    }

    // $setOnInsert seeds the untouched columns of a brand-new document. Any
    // path already in $set must be stripped, otherwise MongoDB rejects the
    // write with a conflicting-update-path error.
    const onInsert: Partial<AttendeeDoc> = {};
    for (const key of Object.keys(normalized) as (keyof AttendeeDoc)[]) {
      if (key === 'email') continue;
      if (key in setFields) continue;
      (onInsert as Record<string, unknown>)[key] = (normalized as unknown as Record<string, unknown>)[key];
    }

    return {
      updateOne: {
        filter: { email: normalized.email } as Filter<AttendeeDoc>,
        update: { $set: setFields, $setOnInsert: onInsert },
        upsert: true,
      },
    } as AnyBulkWriteOperation<AttendeeDoc>;
  });

  if (!ops.length) {
    const total = await collection.countDocuments({});
    return { added: 0, updated: 0, total };
  }

  const result = await collection.bulkWrite(ops, { ordered: false });
  const total = await collection.countDocuments({});
  return {
    added: result.upsertedCount,
    updated: result.matchedCount,
    total,
  };
}
