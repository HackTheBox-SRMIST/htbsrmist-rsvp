# Hack The Box Chennai — Event Ticket Generator

Keeps track of who came, in what order, and what they got. Next.js + MongoDB.

## How it works

Each attendee goes through three steps, in order:

**RSVP** → they enter their email and get a QR pass.
**Check-in** → staff scan that QR at the door.
**Refreshment** → staff scan again at the counter.

Nobody can be checked in without RSVPing, and refreshment needs check-in first.
Trying to do a step twice just says it's already done.

A ticket ID (`HTB-CHENNAI-XXXXXXXXXXXX`) is created when someone RSVPs. The QR
only contains that ticket — no names or emails. RSVPs again with the same email
and they just get their original pass back, nothing duplicated.

Anyone who hasn't RSVP'd yet has no ticket, and shows as `No ticket` in the
dashboard.

## Pages

- `/` — where attendees RSVP
- `/admin` — password-protected. Scanner, counts, and CSV import/export.

## Setting it up

**1. Make a database.** Free MongoDB Atlas at [mongodb.com/atlas](https://www.mongodb.com/atlas).
Add a user, allow `0.0.0.0/0` under Network Access (Vercel needs it), then copy
the connection string from **Connect → Drivers → Node.js**.

**2. Add your config.**

```bash
cp .env.local.example .env.local
```

Then fill in two values: `ADMIN_PASSWORD` (pick something strong) and
`MONGODB_URI` (the Atlas string).

**3. Load your attendee list.**

```bash
npm run seed
```

Reads `data/attendees.json` and matches people by email, so it's safe to run
more than once — anyone already checked in stays checked in.

**4. Run it.**

```bash
npm run dev
```

Go to [localhost:3000](http://localhost:3000).

## Deploying to Vercel

Push to a git repo, then import it at [vercel.com/new](https://vercel.com/new).
Nothing else to configure.

Add `MONGODB_URI` and `ADMIN_PASSWORD` under **Settings → Environment
Variables**, for both Production and Preview. Then deploy, and run
`npm run seed` once against the same database.
