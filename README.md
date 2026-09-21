# 🤖 VisionAI — AI-Based Image Caption Generator

<p align="center">
  <b>AI-powered image caption generation using BLIP, PyTorch, Hugging Face Transformers and Flask.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.x-blue?logo=python">
  <img src="https://img.shields.io/badge/Flask-Web%20App-black?logo=flask">
  <img src="https://img.shields.io/badge/PyTorch-Deep%20Learning-ee4c2c?logo=pytorch">
  <img src="https://img.shields.io/badge/Hugging%20Face-Transformers-yellow?logo=huggingface">
  <img src="https://img.shields.io/badge/Computer%20Vision-AI-green">
</p>

---

## 📌 Overview

**VisionAI** is an AI-powered web application that automatically generates meaningful captions for uploaded images.

The application uses the **BLIP (Bootstrapping Language-Image Pre-training)** model from Salesforce through Hugging Face Transformers to understand image content and generate natural-language descriptions.

The generated caption can then be enhanced using additional features such as tone transformation, hashtags, emojis, translation and text-to-speech.

---

## ✨ Features

- 🖼️ **AI Image Caption Generation**
- 🧠 **BLIP Vision-Language Model**
- ✍️ **Caption Tone Transformation**
  - Professional
  - Funny
  - Creative
  - Instagram
- #️⃣ **Hashtag Generation**
- 😊 **Emoji Suggestions**
- 🌍 **Multi-language Translation**
- 🔊 **Text-to-Speech**
- 📚 **Caption History**
- 📱 **Responsive Web Interface**
- ⚡ **Flask-based Backend**

---

## 🧠 AI Model

VisionAI uses:

**Model:** `Salesforce/blip-image-captioning-base`

### Technologies used

- Hugging Face Transformers
- PyTorch
- BLIP
- Pillow
- Python

### Caption Generation Pipeline

```text
Input Image
     ↓
Image Preprocessing
     ↓
BLIP Processor
     ↓
BLIP Vision-Language Model
     ↓
Text Generation
     ↓
Generated Caption
     ↓
Caption Enhancement
     ↓
Final Result
