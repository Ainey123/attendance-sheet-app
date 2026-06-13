# Deployment Guide - Supabase + Vercel

This guide will help you migrate your attendance app to use Supabase PostgreSQL for persistent data storage on Vercel.

## Prerequisites
- A GitHub repository with your attendance app code
- A Vercel account (free)
- A Supabase account (free)

---

## Step 1: Set Up Supabase Database

### 1.1 Create Supabase Project
1. Go to https://supabase.com and sign up/login
2. Click **"New Project"**
3. Fill in:
   - **Name**: attendance-sheet-app
   - **Database Password**: Generate a strong password (save it!)
   - **Region**: Choose a region closest to your users
4. Click **"Create new project"**
5. Wait 2-3 minutes for the project to be ready

### 1.2 Initialize Database Schema
1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **"New Query"**
3. Copy the contents of `supabase-schema.sql` from your project
4. Paste it into the SQL Editor
5. Click **"Run"** (bottom right)
6. You should see "Success" message

### 1.3 Get Supabase Credentials
1. In Supabase dashboard, go to **Project Settings** (gear icon)
2. Click **"API"** in the left menu
3. Copy these values:
   - **Project URL**: `https://xxxxxxxxxxxxx.supabase.co`
   - **service_role key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (long string)

---

## Step 2: Update Your Code

### 2.1 Install Supabase Client
Run this command in your project directory:
```bash
npm install @supabase/supabase-js
```

### 2.2 Commit Changes
```bash
git add .
git commit -m "Migrate to Supabase for persistent storage"
git push origin main
```

---

## Step 3: Configure Vercel Environment Variables

### 3.1 Open Vercel Project
1. Go to https://vercel.com/dashboard
2. Open your attendance-sheet-app project

### 3.2 Add Environment Variables
1. Go to **Settings** > **Environment Variables**
2. Click **"Add New"**
3. Add the following variables:

| Key | Value | Environment |
|-----|-------|-------------|
| `SUPABASE_URL` | Your Supabase Project URL | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service_role key | Production, Preview, Development |

4. Click **"Save"**

### 3.3 Redeploy
1. Go to **Deployments** tab
2. Click the three dots (...) next to the latest deployment
3. Click **"Redeploy"**
4. Wait for deployment to complete

---

## Step 4: Verify Deployment

### 4.1 Test Your App
1. Open your Vercel deployment URL
2. Try adding a new employee
3. Try clocking in/out
4. Check if data persists after page refresh

### 4.2 Check Supabase Dashboard
1. Go to Supabase dashboard
2. Click **Table Editor** (left sidebar)
3. Check the `employees` table - you should see your new employee
4. Check the `attendance` table - you should see clock-in/out records

---

## Troubleshooting

### Error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
- Make sure you added both environment variables in Vercel
- Make sure you selected all environments (Production, Preview, Development)
- Redeploy after adding variables

### Error: "Database connection failed"
- Check your Supabase project is active (not paused)
- Verify your credentials are correct
- Check Supabase status page: https://status.supabase.com

### Data not persisting
- Make sure you ran the SQL schema in Supabase SQL Editor
- Check Supabase Table Editor to see if data is being written
- Check Vercel logs for errors

---

## Benefits of This Setup

✅ **Persistent Data**: Data survives serverless restarts  
✅ **Free Tier**: Supabase offers 500MB storage (plenty for attendance data)  
✅ **Scalable**: Can handle thousands of employees  
✅ **Real-time**: Supabase supports real-time subscriptions (future feature)  
✅ **Backup**: Automatic daily backups included in free tier  

---

## Next Steps

After successful deployment:
1. Delete the old `data.json` file (no longer needed)
2. Remove JSONBlob references from code (if any)
3. Consider adding authentication for admin panel
4. Set up custom domain in Vercel
