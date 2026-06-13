# Supabase Deployment Guide - Permanent Data Storage

This guide will help you migrate your attendance app to use Supabase PostgreSQL for persistent data storage on Vercel. This will fix the data loss issue when Vercel serverless instances restart.

## What Changed
- Removed all local file storage (data.json, JSONBlob)
- Replaced with Supabase PostgreSQL database
- Added robust error handling for database operations
- Data now persists permanently across serverless restarts

---

## Step 1: Create Supabase Account (2 minutes)

1. Go to **https://supabase.com**
2. Click **"Start your project"** or **"Sign up"**
3. Sign up with GitHub or Google
4. Click **"New Project"** button
5. Fill in:
   - **Name**: `attendance-app`
   - **Database Password**: Type any password (remember it!)
   - **Region**: Choose "Southeast Asia" or closest to you
6. Click **"Create new project"**
7. Wait 2-3 minutes (it will say "Creating project...")

---

## Step 2: Set Up Database (1 minute)

1. After project is ready, look at the left sidebar
2. Click **"SQL Editor"** (icon looks like a terminal)
3. Click **"New query"** button
4. Open the file `supabase-schema.sql` from your project folder
5. Copy everything from that file
6. Paste it into the Supabase SQL Editor
7. Click **"Run"** button (bottom right)
8. You should see "Success" at the bottom

---

## Step 3: Get Your Keys (30 seconds)

1. In Supabase, click the **gear icon** (Settings) in left sidebar
2. Click **"API"** or **"API key"** in the menu
3. You will see 2 things to copy:

**Copy this first:**
- **Project URL** (starts with https://xxxx.supabase.co)

**Copy this second:**
- **anon key** or **public key** (starts with eyJhbGci...)
- Look for "anon" or "public" key (NOT the service_role key)

**Save these somewhere safe!**

---

## Step 4: Add Environment Variables to Vercel (1 minute)

1. Go to **https://vercel.com/dashboard**
2. Click on your `attendance-sheet-app` project
3. Click **Settings** tab at the top
4. Click **Environment Variables** on the left
5. Click **"Add New"** button
6. Add the following variables:

| Key | Value | Environment |
|-----|-------|-------------|
| `SUPABASE_URL` | Your Supabase Project URL | Production, Preview, Development |
| `SUPABASE_ANON_KEY` | Your Supabase anon key | Production, Preview, Development |

7. Click **"Save"** for each variable

---

## Step 5: Deploy Your App (30 seconds)

1. Commit and push your changes to GitHub:
```bash
git add .
git commit -m "Migrate to Supabase for persistent storage"
git push origin main
```

2. Vercel will automatically redeploy (wait 1-2 minutes)

---

## Step 6: Test It Works (1 minute)

1. Click your deployment URL to open your app
2. Add a new employee
3. Clock them in
4. Refresh the page
5. Check if the employee is still there ✅

**If data is still there after refresh, it works!**

---

## Step 7: Migrate Existing Data (Optional)

If you have existing employees in your `data.json` file and want to migrate them to Supabase:

1. Update the `migrate.js` file with your actual Supabase credentials
2. Run this command in your project directory:
```bash
node migrate.js
```

This will import all your existing employees, attendance records, and work records into Supabase.

---

## Troubleshooting

**Error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY"**
- Go back to Step 4 and make sure you added BOTH environment variables
- Make sure you selected all 3 environments (Production, Preview, Development)
- Redeploy after adding variables

**Error: "Database connection failed"**
- Check your Supabase project is active (not paused)
- Verify your credentials are correct
- Check Supabase status page: https://status.supabase.com

**Data not persisting**
- Make sure you ran the SQL schema in Supabase SQL Editor (Step 2)
- Check Supabase Table Editor to see if data is being written
- Check Vercel logs for errors

**Migration script fails**
- Make sure you have the correct Supabase credentials in migrate.js
- Update the migrate.js file with your actual Supabase URL and ANON key
- Run the script again

---

## Done! Your app now has permanent storage.

Your data will never disappear again, even when Vercel restarts the server.
