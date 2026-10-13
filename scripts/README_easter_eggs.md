# Easter Egg Pre-Generation Script

Generates 33 unique, high-quality AI artwork images of Easter eggs using the
Automatic1111 Stable Diffusion WebUI API running locally on the Linux server.

---

## Requirements

| Requirement | Details |
|---|---|
| GPU server | Linux, RTX 3090 Ti |
| A1111 WebUI | Running on `http://127.0.0.1:7860` with `--api` flag |
| Python | 3.8+ |
| `requests` library | `pip install requests` |

---

## How to Run

### 1. SSH into the Linux server

```bash
ssh sender@<your-server-ip>
```

### 2. Make sure A1111 is running with the API enabled

If it is not already running, start it:

```bash
cd ~/stable-diffusion-webui
python launch.py --api --listen
```

The `--api` flag is required. The `--listen` flag is only needed if you want to
access the WebUI from another machine on the network.

### 3. Install the Python dependency (once)

```bash
pip install requests
```

### 4. Run the script

```bash
python3 /path/to/generate_easter_eggs.py
```

Or copy it to the server first:

```bash
scp generate_easter_eggs.py sender@<your-server-ip>:~/
ssh sender@<your-server-ip> python3 ~/generate_easter_eggs.py
```

---

## Output

Files are saved to `/home/sender/easter_eggs/` (created automatically):

```
/home/sender/easter_eggs/
  easter_egg_01.png   ← Fabergé imperial egg
  easter_egg_02.png   ← Crystalline universe egg
  ...
  easter_egg_33.png   ← Parallel universe egg
```

Each image is **768 × 768 px**, generated at 40 steps with DPM++ 2M Karras.
Approximate size per file: 400 – 900 KB.

---

## Resumable — Safe to Re-Run

- Any egg that already has a `.png` file is **skipped automatically**.
- If a generation fails, a `.error.txt` file is written alongside it and the
  script continues to the next egg.
- Just re-run the script to retry any failures — already-done eggs are untouched.

---

## Progress Output

```
Output directory: /home/sender/easter_eggs
A1111 API reachable. 3 model(s) loaded.

  Generating egg 01/33: A Fabergé imperial Easter egg with intricate 24k gold f...
    Saved /home/sender/easter_eggs/easter_egg_01.png  (612 KB, 18.3s)
  Generating egg 02/33: A crystalline Easter egg containing a miniature universe...
    Saved /home/sender/easter_eggs/easter_egg_02.png  (588 KB, 17.1s)
  ...
  Skipping egg 05/33 — file already exists.
  ...

============================================================
GENERATION SUMMARY
============================================================
  Total:     33
  Generated: 31
  Skipped:   2  (already existed)
  Failed:    0

  All 33 Easter eggs are ready!
============================================================
```

---

## Using the Images in the App

Once generated, the images can be:

1. **Served directly** from the SD-Stream server over HTTP/HTTPS so the app
   downloads them on demand.
2. **Uploaded via FTP** to the web host alongside the gallery assets
   (same FTP server used for leaderboard / gallery uploads).
3. **Bundled** into the app as local assets if offline access is required.

The filename pattern `easter_egg_NN.png` (zero-padded, 1-indexed) makes it
easy to iterate from the app side:

```js
const eggUrl = (n) =>
  `https://your-server.com/easter_eggs/easter_egg_${String(n).padStart(2, '0')}.png`;
```

---

## Generation Parameters

| Parameter | Value |
|---|---|
| Steps | 40 |
| CFG scale | 8.5 |
| Sampler | DPM++ 2M Karras |
| Resolution | 768 × 768 |
| Negative prompt | blurry, low quality, watermark, ugly, deformed, text |
| Timeout per image | 300 s |

---

## Estimated Run Time

On an RTX 3090 Ti, each 768 × 768 image at 40 steps takes roughly **15 – 35 seconds**.
Full batch of 33 eggs: approximately **10 – 20 minutes**.
