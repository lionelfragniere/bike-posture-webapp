# Bike Posture Checker (Road Fit) — Static Web App

This is a **fully client-side** web app that:
- lets a user **upload a side-view cycling video**
- runs **pose estimation locally in the browser** (no uploads)
- optionally **calibrates mm** by clicking two points on a frame + entering the real distance
- computes basic road-fit posture angles and starter “mm” suggestions
- shows a transparent **skeleton overlay** and angle labels

## Run locally

```bash
python -m http.server 8000
```

Open: `http://localhost:8000`

## Deploy (GitHub Pages)

1. Put `index.html` and `app.js` at the repo root
2. GitHub → **Settings → Pages** → Deploy from branch (`main` / root)
3. If you update files and don’t see changes, do a hard refresh (**Ctrl+F5**) or add `?v=14` to the URL once (cache-bust).

## Video requirements

The app accepts whatever your browser can decode. Best compatibility:
- **MP4 (H.264)** video
- **WebM (VP8/VP9)**

If the video won’t decode, re-export it as H.264 MP4.

## Calibration (optional)

1. Click **Grab calibration frame** (pauses video)
2. Click **Pick 2 points** and click two points on the frame
3. Enter the real distance in **mm** (or use a preset) and click **Set scale**

## Notes

- Crank “too long/too short” is a **heuristic** from movement (knee angle at top of stroke); adjust saddle first.
- Nothing is uploaded: everything remains local in the browser.

Version: v14
