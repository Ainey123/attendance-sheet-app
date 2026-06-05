# Attendance Sheet App 🚀

A premium, zero‑install web app for tracking office attendance with **location‑aware clock‑in/out**, **permanent shareable links**, and **24/7 cloud hosting** on Render.com.

---

## ✨ Features
- **One‑click permanent login** via short alphanumeric token (e.g. `AB12CD34`).
- **Fallback PIN** authentication still works for extra security.
- **Real‑time GPS verification** for every clock‑in/out.
- **Admin dashboard** with live statistics, attendance logs, and employee roster.
- **Responsive, glass‑morphism UI** with vibrant gradients and smooth micro‑animations.
- **Dockerized** – deploy to any cloud provider; Render free tier gives a permanent HTTPS URL.
- **Local testing** via `Start_Attendance_App.bat` (starts server & `localtunnel` for quick remote share).

---

## 🛠️ Local Development
1. **Prerequisites** – make sure you have Node 20 (or later) installed.
2. Clone / open the project folder:
   ```bash
   cd "C:/Users/SL LAPTOP/Desktop/Attendence sheet app"
   ```
3. Install dependencies:
   ```bash
   npm ci
   ```
4. Start the app (with optional `localtunnel` for remote testing):
   ```bash
   ./Start_Attendance_App.bat
   ```
   The server runs on `http://localhost:3000`.  `localtunnel` will expose it at a sub‑domain like `https://attendanceapp.loca.lt`.

---

## 📦 Docker Build (optional)
```bash
docker build -t attendance-app .
docker run -p 3000:3000 attendance-app
```
Visit `http://localhost:3000`.

---

## ☁️ Deploy to Render.com (recommended for 24/7 uptime)
1. **Create a GitHub repository** (public or private) and push the code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit – attendance app with token links"
   git branch -M main
   # Replace <YOUR-REPO-URL> with your GitHub repo URL
   git remote add origin <YOUR-REPO-URL>
   git push -u origin main
   ```
2. Sign in to **Render.com** (free tier). Click **New → Web Service**.
3. Connect the GitHub repo you just created.
4. Render will detect the `Dockerfile`. Use the defaults:
   - **Build Command:** `npm ci`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Click **Create Web Service**. Render builds the Docker image and gives you a permanent URL like `https://attendance-app.onrender.com`.
6. 🎉 Your app is now live 24/7! Share the generated token links with employees – they will land straight on their dashboard.

---

## 🔐 How permanent links work
- When an admin creates an employee, the system generates an **8‑character alphanumeric token** stored in `data.json`.
- The admin can click **Copy Link** in the roster view. The copied URL looks like:
  ```
  https://your‑domain.com/?mode=employee&token=AB12CD34
  ```
- Visiting that URL logs the employee in automatically (no PIN required). If the token is missing or invalid, the usual PIN screen appears.

---

## 📂 Project Structure
```
├─ public/                # Front‑end assets (HTML, JS, CSS)
│   ├─ index.html
│   ├─ app.js            # Core UI logic
│   └─ style.css         # Premium dark theme with glass‑morphism
├─ db.js                  # Simple JSON‑file DB with token helpers
├─ server.js              # Express API (includes token endpoint)
├─ Dockerfile             # Container definition for Render
├─ render.yaml            # Render config (optional)
├─ package.json
├─ Start_Attendance_App.bat
└─ .gitignore
```

---

## 🚀 Ready to go!
- **Test locally** with the batch file or Docker.
- **Deploy** to Render for a permanent, always‑on link.
- Use the **Copy Link** button in the Admin Roster to distribute one‑time permanent login URLs.

Feel free to reach out if you need help connecting the repo to GitHub or customizing the UI further.
