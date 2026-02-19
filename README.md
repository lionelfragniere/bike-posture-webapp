## Recording tips (for best results)
- **True side view** (camera perpendicular to bike)
- Entire rider visible (shoulders to ankles)
- Good lighting, stable camera
- 20–40 seconds of steady pedalling is enough
- Indoor trainer is best, but you can also "backpedal"

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
