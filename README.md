# Bike Posture Checker (Webapp, video upload, no targets)

This is a **static web app** (no backend) that:
- lets a user **upload a side-view cycling video**
- runs **pose estimation locally in the browser** (MediaPipe Pose Landmarker via CDN)
- computes key cycling angles and produces **starter road-bike fit suggestions**
- produces **mm-based corrections** by **user calibration** (no printed targets required)

## What you need
- Chrome / Edge (latest)
- Any simple local web server (required; `file://` won’t work due to module loading)

### Video formats
The app accepts **any format your browser can decode**. For the highest compatibility, use:
- **MP4 (H.264 video + AAC audio)**
- or **WebM (VP8/VP9)**

Some phone/WhatsApp exports are **HEVC/H.265**, which may not play in all browsers/OS combinations.
If the video won’t load, re-export/convert to H.264 MP4.

## Run it
From this folder:

### Option A (Python)
```bash
python -m http.server 8000
```
Open:
- http://localhost:8000

### Option B (Node)
```bash
npx serve .
```

## Recording tips (for best results)
- **True side view** (camera perpendicular to bike)
- Entire rider visible (shoulders to ankles)
- Good lighting, stable camera
- 20–40 seconds of steady pedalling is enough
- Indoor trainer is best

## Calibration (how mm works)
To convert pixels to millimetres, you:
1) Pause on a clear frame (app provides a frame preview)
2) Click two points that represent a real distance visible in the video
   - common choices:
     - **wheel diameter** (rim-to-rim) (enter 622mm for 700c bead seat, or ~670mm outer tire diameter depending)
     - **crank length** (e.g., 170mm) between bottom bracket center and pedal spindle (harder to click accurately)
     - any other visible object with known size
3) Enter that real-world distance (mm)

The app then uses that scale for mm suggestions.

## Notes / limitations (MVP)
- This is an MVP: mm corrections are based on **heuristics** and require good camera geometry.
- Results are best when the calibrated object is in the same plane as the rider.
- Different fit methods disagree on exact targets; the app outputs transparent metrics and “starter” recommendations.

## Files
- `index.html` : UI
- `app.js` : logic (pose, calibration, analysis)
