# Habi-Food — Deployment Guide

## What's in this package

- `habifood.html` — the complete single-page web application
- `netlify.toml` — configuration that prevents Netlify from falsely flagging the Firebase API key

## Quick Deploy (2 minutes)

### Option A: Drag and drop to Netlify (fastest)

1. Go to [app.netlify.com](https://app.netlify.com) and log in (or sign up free)
2. Drag the **folder containing both files** onto the Netlify dashboard
3. Netlify will detect it, build it, and give you a live URL
4. Open your new URL — you're live!

### Option B: Deploy via Git (better for updates)

1. Create a new GitHub repository
2. Push both files to it
3. In Netlify, choose "New site from Git" → connect your repo
4. Netlify auto-deploys on every push

## What to check after deployment

- [ ] Map loads with satellite view and road/suburb labels
- [ ] Planned Burns layer shows burn polygons
- [ ] Dashboard stat boxes show real numbers
- [ ] Browse run sheet builds correctly
- [ ] Vegetation maintenance links open the detail modal
- [ ] Login works for existing users

## Troubleshooting

### "Exposed secrets detected" deploy failure

Netlify sometimes flags the Firebase API key as a secret — it's **not** a secret. The `netlify.toml` file in this package tells Netlify to ignore this specific key. If you're still seeing it, make sure `netlify.toml` is in the root of your deployment folder.

### Site loads but map is blank

- Check browser console for errors (F12 → Console tab)
- Ensure you have an internet connection (maps need live tile servers)
- Try switching basemap (dark/satellite/topo buttons)

### Login not working

- The app uses Firebase Authentication — check that your Firebase project is active
- Users need an approved account and access code
- Demo mode: enter `1234` as the password to bypass login

## Next steps (non-urgent)

| Task | Who |
|------|-----|
| EVC canopy species data compilation | Data entry pass (not code) |
| Hosting decision (keep Netlify or switch) | Carni |
| Southern Brown Bandicoot habitat layer | To be built |
| Approved_users privacy lockdown | Separate tested batch |

---

**Questions?** Send a screenshot of the issue and I'll target it.