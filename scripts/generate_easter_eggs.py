#!/usr/bin/env python3
"""
generate_easter_eggs.py
Pre-generates 33 unique artistic Easter egg images via the A1111 Stable Diffusion WebUI API.

Run on the Linux server:
    python3 generate_easter_eggs.py

Requirements: requests  (pip install requests)
A1111 must be running with --api flag:
    python launch.py --api --listen
"""

import base64
import json
import os
import time
import traceback

import requests

# ── Config ────────────────────────────────────────────────────────────────────
API_BASE = "http://127.0.0.1:7860"
TXT2IMG_ENDPOINT = f"{API_BASE}/sdapi/v1/txt2img"
OUTPUT_DIR = "/home/sender/easter_eggs"

NEGATIVE_PROMPT = "blurry, low quality, watermark, ugly, deformed, text"

GENERATION_PARAMS = {
    "negative_prompt": NEGATIVE_PROMPT,
    "steps": 40,
    "cfg_scale": 8.5,
    "width": 768,
    "height": 768,
    "sampler_name": "DPM++ 2M Karras",
}

REQUEST_TIMEOUT_SECONDS = 300  # 5 min; 40-step 768px on 3090Ti is ~15-30 s

# ── Prompts ────────────────────────────────────────────────────────────────────
PROMPTS = [
    # 01
    "A Fabergé imperial Easter egg with intricate 24k gold filigree, sapphire and ruby gemstone inlays, "
    "painted enamel portraits, photographed on black velvet, macro lens, hyperrealistic, masterpiece",
    # 02
    "A crystalline Easter egg containing a miniature universe, swirling galaxies and nebulae visible through "
    "optical glass, perfect reflections, void background, macro photography, 8k detail",
    # 03
    "A steampunk mechanical Easter egg with exposed brass clockwork gears, ruby jeweled bearings, glass "
    "porthole windows, aged copper patina, volumetric studio lighting, octane render",
    # 04
    "An Art Nouveau Easter egg with flowing golden botanical vines in the style of Alphonse Mucha, exotic "
    "flowers, antique ivory background, museum photograph, hyperrealistic",
    # 05
    "A bioluminescent deep-sea Easter egg glowing with ethereal blue and violet light, organic alien texture, "
    "surrounded by floating plankton, complete darkness, underwater macro",
    # 06
    "A Japanese Kintsugi Easter egg repaired with glowing golden lacquer seams, fractured ancient ceramic, "
    "wabi-sabi philosophy, professional still-life photography",
    # 07
    "A holographic Easter egg with iridescent rainbow interference patterns, floating in darkness, laser "
    "light grids, futuristic aesthetic, product photography, 8k",
    # 08
    "A Viking Nordic Easter egg carved from fossilized mammoth ivory, ancient runic inscriptions filled with "
    "blue pigment, bronze clasps, archaeological museum lighting",
    # 09
    "A microscopic Easter egg made from crystallized amino acids, electron microscopy aesthetic, false color "
    "enhanced, scientific beauty at nanoscale",
    # 10
    "A forbidden forest Easter egg overgrown with miniature moss, tiny mushrooms, dewdrops on spider webs, "
    "living ecosystem, extreme close-up nature photography",
    # 11
    "A cosmic horror Easter egg housing a small eldritch entity, dark tentacles pressing against glass from "
    "inside, dim amber light, cinematic lighting, unsettling beauty",
    # 12
    "A Georgian enamel Easter egg with intricate millefiori glass patterns in jewel tones, cloisonné "
    "metalwork, Florentine goldsmith artistry, art historical photograph",
    # 13
    "A quantum Easter egg existing in superposition, simultaneously cracked and whole, double-exposure "
    "photography, physics made visual, ethereal",
    # 14
    "An ice cave Easter egg carved from a single glacial crystal, ancient air bubbles trapped inside like "
    "stars, cool blue internal light, polar photography",
    # 15
    "A silk embroidered Easter egg wrapped in impossible needlework depicting entire landscapes, magnified "
    "to reveal infinite detail, textile art tradition",
    # 16
    "A fractal mathematical Easter egg with recursive infinite patterns, Mandelbrot set decoration, digital "
    "hyperrealism, stunning geometry",
    # 17
    "A lava lamp Easter egg with molten colored wax in slow motion, warm amber glow, 1970s retro futurism, "
    "long exposure photography",
    # 18
    "A neural network Easter egg with synaptic connections visible, bioluminescent brain tissue patterns, "
    "neuroscience meets sacred art, darkfield microscopy",
    # 19
    "An ancient Egyptian Easter egg with hieroglyphic inscriptions, lapis lazuli and gold leaf, limestone "
    "base, British Museum photograph",
    # 20
    "A liquid mercury Easter egg with perfect chrome surface, perfect reflections of warped surroundings, "
    "industrial surrealism, high-key studio lighting",
    # 21
    "A cosmic nebula Easter egg formed from hydrogen plasma dust clouds, Hubble telescope aesthetic, "
    "billion-year formation made intimate, astrophotography",
    # 22
    "A clock mechanism Easter egg with hundreds of tiny interlocked watch parts creating a mechanical "
    "flower, German horology, close-up photography",
    # 23
    "A bonsai Easter egg where the shell surface IS a miniature ancient forest, tiny ceramic trees and rock "
    "formations, Japanese garden philosophy, macro",
    # 24
    "A phoenix feather Easter egg woven from fire and light, molten gold and deep crimson, mythological "
    "artifact, dramatic heroic studio lighting",
    # 25
    "A meteorite Easter egg fused from space rock, visible chondrule crystals and metal flakes, cosmic "
    "origin, scientific specimen photography, 8k",
    # 26
    "A music box Easter egg opening to reveal a crystalline mechanical stage, tiny dancers, music notes "
    "made visible as light waves, nostalgia and wonder",
    # 27
    "An alchemist's Easter egg containing a glowing philosopher's stone, warmly glowing amber orb inside "
    "mercury glass shell, medieval mysticism, laboratory light",
    # 28
    "A deep sea hydrothermal vent Easter egg of exotic minerals, vivid orange sulfur crystals, white silica "
    "formations, extremophile ecosystem, macro",
    # 29
    "A digital glitch Easter egg with RGB color channel separation, scanlines and pixel corruption as art, "
    "vaporwave sacred geometry, high detail",
    # 30
    "A Tibetan mandala Easter egg with hand-painted geometric patterns in mineral pigments, hundreds of "
    "hours of meditative artistry, spiritual centeredness",
    # 31
    "A coral reef Easter egg with living corals and tropical fish in cross section, underwater macro "
    "photography, vibrant ocean life",
    # 32
    "A clockwork origami Easter egg folded from single platinum foil sheet into impossible geometric "
    "complexity, mathematical art, product photography",
    # 33
    "An Easter egg containing a parallel universe, tiny figures living in eternal spring with cherry "
    "blossoms, golden hour light, God's eye perspective",
]

TOTAL = len(PROMPTS)
assert TOTAL == 33, f"Expected 33 prompts, got {TOTAL}"


# ── Helpers ───────────────────────────────────────────────────────────────────

def ensure_output_dir() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR}")


def output_path(index: int) -> str:
    return os.path.join(OUTPUT_DIR, f"easter_egg_{index:02d}.png")


def error_path(index: int) -> str:
    return os.path.join(OUTPUT_DIR, f"easter_egg_{index:02d}.error.txt")


def already_done(index: int) -> bool:
    path = output_path(index)
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        return True
    return False


def check_api_reachable() -> None:
    """Fail fast with a clear message if A1111 is not up."""
    try:
        resp = requests.get(f"{API_BASE}/sdapi/v1/sd-models", timeout=10)
        resp.raise_for_status()
        print(f"A1111 API reachable. {len(resp.json())} model(s) loaded.\n")
    except requests.exceptions.ConnectionError:
        raise SystemExit(
            f"\nERROR: Cannot reach A1111 at {API_BASE}\n"
            "Make sure Stable Diffusion WebUI is running with the --api flag:\n"
            "    python launch.py --api --listen\n"
        )
    except Exception as exc:
        raise SystemExit(f"\nERROR checking A1111 API: {exc}\n")


def generate_image(prompt: str, index: int) -> bytes:
    """Call txt2img and return raw PNG bytes."""
    payload = {
        "prompt": prompt,
        **GENERATION_PARAMS,
    }
    response = requests.post(
        TXT2IMG_ENDPOINT,
        json=payload,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()

    images = data.get("images")
    if not images:
        raise ValueError("API response contained no images field.")

    png_bytes = base64.b64decode(images[0])
    return png_bytes


def save_image(png_bytes: bytes, index: int) -> None:
    path = output_path(index)
    with open(path, "wb") as fh:
        fh.write(png_bytes)


def save_error(index: int, prompt: str, exc: Exception) -> None:
    path = error_path(index)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"Prompt:\n{prompt}\n\n")
        fh.write(f"Error:\n{exc}\n\n")
        fh.write("Traceback:\n")
        fh.write(traceback.format_exc())


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ensure_output_dir()
    check_api_reachable()

    succeeded: list[int] = []
    skipped: list[int] = []
    failed: list[int] = []

    for i, prompt in enumerate(PROMPTS, start=1):
        label = f"egg {i:02d}/{TOTAL}"

        if already_done(i):
            print(f"  Skipping {label} — file already exists.")
            skipped.append(i)
            continue

        short_prompt = prompt[:72] + "..." if len(prompt) > 75 else prompt
        print(f"  Generating {label}: {short_prompt}")
        t0 = time.time()

        try:
            png_bytes = generate_image(prompt, i)
            save_image(png_bytes, i)
            elapsed = time.time() - t0
            kb = len(png_bytes) / 1024
            print(f"    Saved {output_path(i)}  ({kb:.0f} KB, {elapsed:.1f}s)")
            succeeded.append(i)

            # Remove stale error file from a previous failed attempt
            err_file = error_path(i)
            if os.path.isfile(err_file):
                os.remove(err_file)

        except Exception as exc:
            elapsed = time.time() - t0
            print(f"    ERROR after {elapsed:.1f}s: {exc}")
            save_error(i, prompt, exc)
            failed.append(i)
            # Continue to the next egg

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("GENERATION SUMMARY")
    print("=" * 60)
    print(f"  Total:     {TOTAL}")
    print(f"  Generated: {len(succeeded)}")
    print(f"  Skipped:   {len(skipped)}  (already existed)")
    print(f"  Failed:    {len(failed)}")

    if skipped:
        print(f"\n  Skipped eggs:  {skipped}")
    if succeeded:
        print(f"  New eggs:      {succeeded}")
    if failed:
        print(f"\n  Failed eggs:   {failed}")
        print("  Check the .error.txt files in", OUTPUT_DIR, "for details.")
        print("  Re-run the script to retry failed eggs.")

    if len(succeeded) + len(skipped) == TOTAL:
        print("\n  All 33 Easter eggs are ready!")
    else:
        remaining = TOTAL - len(succeeded) - len(skipped)
        print(f"\n  {remaining} egg(s) still missing. Re-run to retry.")

    print("=" * 60)


if __name__ == "__main__":
    main()
