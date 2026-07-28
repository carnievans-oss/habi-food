# Habi-Food — Deployment Guide

## Files needed
- `habifood.html` — complete web application
- `netlify.toml` — build configuration

## Deploy to Netlify
1. Go to [app.netlify.com](https://app.netlify.com)
2. Drag your folder with both files onto the dashboard
3. Wait for the build to complete (~30 seconds)
4. Open your live URL

## Test after deployment
- Login: Enter `1234` or click "Try Demo Mode"
- Map should show satellite view with tree markers
- Search works for events
- Stats show in the sidebar

## Troubleshooting
If you see "Plugin not installed" error, your `netlify.toml` still has the plugin reference. Use the fixed version above.

## Access codes
- `1234`
- `WILD-1234`
- `DEMO-2026`
- `CARER-001`
- `TEST-123`