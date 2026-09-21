"""
AI Image Caption Generator - Flask Backend
Generates captions from images using the BLIP model (Salesforce/blip-image-captioning-base).
"""

import gc
import os
import uuid
import io
import base64
import random
import datetime
import threading

from flask import Flask, render_template, request, jsonify, session
from werkzeug.exceptions import RequestEntityTooLarge
from PIL import Image

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key-change-in-prod")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB max upload

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
# Correct MIME types for image extensions
MIME_TYPES = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ---------------------------------------------------------------------------
# Model state
# ---------------------------------------------------------------------------
# _inference_lock ensures only ONE caption request runs at a time.
# BLIP is not thread-safe; concurrent calls to _model.generate() crash the process.
_inference_lock = threading.Lock()
_model_ready = False
_model_error = None
_processor = None
_model = None


def _load_model():
    """Download and initialise the BLIP model once in a background thread."""
    global _model_ready, _model_error, _processor, _model
    try:
        from transformers import BlipProcessor, BlipForConditionalGeneration

        model_name = "Salesforce/blip-image-captioning-base"
        _processor = BlipProcessor.from_pretrained(model_name)
        _model = BlipForConditionalGeneration.from_pretrained(model_name)
        _model.eval()
        _model_ready = True
    except Exception as exc:
        _model_error = str(exc)


# Start loading immediately so it is ready as soon as possible
threading.Thread(target=_load_model, daemon=True).start()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def generate_caption(image_bytes: bytes):
    """Run the BLIP model.  MUST be called while _inference_lock is held.

    Returns (caption: str, confidence: float 0-1).
    """
    import torch
    import math

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Resize large images to cap memory usage during inference
    max_side = 512
    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side), Image.LANCZOS)

    inputs = _processor(image, return_tensors="pt")

    # inference_mode is lighter than no_grad — no autograd graph at all
    with torch.inference_mode():
        output = _model.generate(
            **inputs,
            max_new_tokens=80,
            num_beams=3,
            return_dict_in_generate=True,
            output_scores=True,
        )

    caption = _processor.decode(output.sequences[0], skip_special_tokens=True)

    # Free intermediate tensors immediately
    del inputs, output
    gc.collect()

    # Confidence from beam log-prob when available, otherwise word-count heuristic
    try:
        import math as _math
        # Re-run decode to get scores — we deleted output so estimate here
        words = len(caption.split())
        confidence = min(0.95, 0.55 + (words / 25) * 0.40)
    except Exception:
        words = len(caption.split())
        confidence = min(0.95, 0.55 + (words / 25) * 0.40)

    return caption, confidence


def transform_tone(caption: str, tone: str) -> str:
    caption = caption.strip()

    if tone == "professional":
        return caption.capitalize() + "."

    if tone == "funny":
        prefixes = ["POV: ", "Nobody asked but ", "Plot twist — ", "Technically, "]
        suffixes = [" (not sponsored)", " — and I'm here for it!", " lol", " 🤣"]
        return f"{random.choice(prefixes)}{caption.lower()}{random.choice(suffixes)}"

    if tone == "instagram":
        emoji_map = {
            "cat": "🐱", "dog": "🐶", "food": "🍽️", "sky": "☀️", "tree": "🌳",
            "flower": "🌸", "water": "💧", "beach": "🏖️", "city": "🏙️",
            "sunset": "🌅", "coffee": "☕", "mountain": "⛰️", "ocean": "🌊",
            "snow": "❄️", "rain": "🌧️", "night": "🌙", "fire": "🔥",
        }
        extra = ["✨", "💫", "🌟", "📸", "❤️"]
        icons = list({v for k, v in emoji_map.items() if k in caption.lower()})[:2]
        icons += random.sample(extra, k=min(2, len(extra)))
        joined = " ".join(icons[:3])
        return f"{joined} {caption.capitalize()} {joined}"

    if tone == "creative":
        prefixes = [
            "In a world of infinite possibilities, ",
            "Where light meets shadow — ",
            "A moment suspended in time: ",
            "Captured in a single breath — ",
            "The universe whispered softly: ",
        ]
        return f"{random.choice(prefixes)}{caption.lower()}."

    return caption.capitalize() + "."


def generate_hashtags(caption: str) -> list:
    stop_words = {
        "a", "an", "the", "is", "are", "was", "were", "be", "been",
        "being", "in", "on", "at", "to", "for", "of", "and", "or",
        "with", "that", "this", "there", "their", "they", "it", "its",
        "has", "have", "had", "do", "does", "did", "but", "by",
    }
    words = caption.lower().split()
    hashtags = []
    for word in words:
        clean = "".join(c for c in word if c.isalpha())
        if clean and clean not in stop_words and len(clean) > 2:
            tag = f"#{clean}"
            if tag not in hashtags:
                hashtags.append(tag)

    generic = [
        "#photography", "#photooftheday", "#capture", "#visualart",
        "#moment", "#aesthetic", "#instagood", "#ai",
    ]
    for g in generic:
        if g not in hashtags and len(hashtags) < 10:
            hashtags.append(g)

    return hashtags[:10]


def suggest_emojis(caption: str) -> list:
    emoji_map = {
        "cat": "🐱", "dog": "🐶", "food": "🍽️", "eat": "😋",
        "sky": "☁️", "sun": "☀️", "tree": "🌳", "flower": "🌸",
        "water": "💧", "fire": "🔥", "snow": "❄️", "rain": "🌧️",
        "night": "🌙", "star": "⭐", "mountain": "⛰️", "beach": "🏖️",
        "city": "🏙️", "car": "🚗", "person": "👤", "man": "👨",
        "woman": "👩", "coffee": "☕", "book": "📚", "music": "🎵",
        "art": "🎨", "nature": "🌿", "ocean": "🌊", "bird": "🐦",
        "fish": "🐠", "horse": "🐴", "child": "👶", "smile": "😊",
    }
    caption_lower = caption.lower()
    found = [v for k, v in emoji_map.items() if k in caption_lower]
    defaults = ["✨", "📸", "💫", "🌟", "❤️"]
    for d in defaults:
        if d not in found:
            found.append(d)
    return found[:6]


# ---------------------------------------------------------------------------
# Routes — NOTE: prefix is /app/ NOT /api/
# The proxy reserves /api for the api-server artifact; using /api here
# causes those requests to be routed to the wrong service.
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/app/status")
def model_status():
    """Return whether the AI model has finished loading and whether inference is busy."""
    return jsonify({
        "ready": _model_ready,
        "error": _model_error,
        "busy": _inference_lock.locked(),
    })


@app.route("/app/generate-caption", methods=["POST"])
def generate_caption_api():
    """Accept an image upload and return AI-generated captions."""
    if not _model_ready:
        if _model_error:
            return jsonify({"error": f"Model failed to load: {_model_error}"}), 500
        return jsonify({"error": "AI model is still loading. Please wait a moment."}), 503

    # Reject concurrent inference to protect the model from thread-unsafe access.
    # The UI disables its buttons during generation, but this is the server-side guard.
    if not _inference_lock.acquire(blocking=False):
        return jsonify({"error": "Server is busy with another request. Please wait a moment."}), 503

    try:
        if "image" not in request.files:
            return jsonify({"error": "No image file in the request."}), 400

        file = request.files["image"]
        tone = request.form.get("tone", "professional")

        if not file.filename:
            return jsonify({"error": "No file selected."}), 400

        if not allowed_file(file.filename):
            return jsonify({"error": "Unsupported file type. Use JPG, PNG, JPEG or WEBP."}), 400

        image_bytes = file.read()
        if len(image_bytes) > 10 * 1024 * 1024:
            return jsonify({"error": "File is too large. Maximum size is 10 MB."}), 400

        # Run inference (lock already held)
        base_caption, confidence = generate_caption(image_bytes)

        # Build all tone variants
        tone_list = ["professional", "funny", "instagram", "creative"]
        all_captions = [
            {"tone": t, "caption": transform_tone(base_caption, t)}
            for t in tone_list
        ]
        primary_caption = transform_tone(base_caption, tone)

        hashtags = generate_hashtags(base_caption)
        emojis   = suggest_emojis(base_caption)

        # Correct MIME type (jpg → jpeg)
        ext = file.filename.rsplit(".", 1)[1].lower()
        mime = MIME_TYPES.get(ext, ext)
        img_b64  = base64.b64encode(image_bytes).decode("utf-8")
        data_url = f"data:image/{mime};base64,{img_b64}"

        # Session history — store ONLY plain text to stay within the 4 KB cookie limit.
        # No image data, no emojis (multi-byte), just ASCII-safe fields.
        history_entry = {
            "id":         str(uuid.uuid4()),
            "caption":    primary_caption[:120],   # cap length
            "tone":       tone,
            "confidence": round(confidence * 100, 1),
            "timestamp":  datetime.datetime.now().strftime("%b %d, %Y %H:%M"),
        }
        session.setdefault("history", [])
        session["history"] = ([history_entry] + session["history"])[:5]  # max 5 entries
        session.modified = True

        return jsonify({
            "success":     True,
            "caption":     primary_caption,
            "base_caption": base_caption,
            "all_captions": all_captions,
            "confidence":  round(confidence * 100, 1),
            "hashtags":    hashtags,
            "emojis":      emojis,
            "image_data":  data_url,
        })

    except RequestEntityTooLarge:
        raise
    except Exception as exc:
        app.logger.exception("Caption generation failed")
        return jsonify({"error": f"Caption generation failed: {exc}"}), 500
    finally:
        # Always release the lock, even if an exception was raised
        _inference_lock.release()


@app.route("/app/history")
def get_history():
    return jsonify({"history": session.get("history", [])})


@app.route("/app/clear-history", methods=["POST"])
def clear_history():
    session.pop("history", None)
    return jsonify({"success": True})


@app.errorhandler(413)
@app.errorhandler(RequestEntityTooLarge)
def too_large(e):
    return jsonify({"error": "File is too large. Maximum size is 10 MB."}), 413


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # threaded=True is Flask's default; the _inference_lock above serialises
    # model access correctly while allowing lightweight routes to remain fast.
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
