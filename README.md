# Framelock — Accessible Voice-Directed Storyboard Studio

**Framelock** is a WCAG 2.2 AAA accessible, voice-directed storyboard and continuity studio designed for blind, low-vision, and multimodal filmmakers for the Meta Global AI Developer Hackathon.

It combines natural voice direction, real-time spoken screen narration (`window.speechSynthesis`), spatial Web Audio API earcons, and an HTML5 Canvas + SAM 3.1 segmentation engine to detect and fix visual continuity discrepancies across storyboard sequences without requiring visual reliance.

---

## 1. Architecture & Meta AI Model Stack

Framelock orchestrates four Meta AI model capabilities alongside browser speech and canvas engines:

| Model Identifier | Environment Variable | Role in Framelock Pipeline |
| :--- | :--- | :--- |
| **`muse-voice-transcribe-1.0`** | `VITE_MUSE_VOICE_MODEL` | Converts live microphone audio streams (`MediaRecorder`) and voice commands into structured scene transcripts. |
| **`muse-spark-1.3`** | `VITE_MUSE_SPARK_MODEL` | Extracts structured `ContinuityRule` JSON objects, plans shot lists from transcripts, and runs multimodal visual continuity audits. |
| **`muse-image-1.0`** | `VITE_MUSE_IMAGE_MODEL` | Synthesizes storyboard frames across camera angles (`wide`, `medium`, `closeup`, `over_shoulder`) with deterministic reference seeds. |
| **`sam-3.1`** | `VITE_SAM3_MODEL` | Generates object segmentation masks (`SamMask` with bounding box, confidence score, and alpha mask) to isolate target props and perform client-side pixel recoloring. |
| **Web Speech & Audio API** | Browser Native | Provides interruptible spoken descriptions (`window.speechSynthesis`), `aria-live="polite"` telemetry, and distinct tonal earcons for focus, continuity verification, and discrepancy alerts. |

---

## 2. Environment Variables Setup

Copy `.env.example` to `.env` in the project root and configure your Meta AI API credentials:

```bash
cp .env.example .env
```

### `.env` Configuration Reference

```dotenv
# Meta AI Model API Credentials
VITE_META_AI_API_KEY="your_meta_ai_api_key_here"
VITE_META_API_BASE_URL="https://api.meta.ai/v1"

# Meta AI Model Identifiers
VITE_MUSE_VOICE_MODEL="muse-voice-transcribe-1.0"
VITE_MUSE_SPARK_MODEL="muse-spark-1.3"
VITE_MUSE_IMAGE_MODEL="muse-image-1.0"
VITE_SAM3_MODEL="sam-3.1"
```

> **Offline / Zero-Key Evaluation Mode:** If `VITE_META_AI_API_KEY` is left unset or set to `"mock"`, Framelock automatically runs using its built-in deterministic HTML5 Canvas generator, SAM 3.1 mask synthesizer, and client-side pixel manipulation engine so all workflows can be tested live out-of-the-box.

---

## 3. Installation & Running Locally

### Prerequisites
- **Node.js** v18+ and **npm**

### Step-by-Step Instructions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file (or configure secrets in the AI Studio Secrets panel) using the keys listed in `.env.example`.

3. **Start the development server (runs on port 3000):**
   ```bash
   npm run dev
   ```

4. **Type-check and build for production:**
   ```bash
   npm run lint
   npm run build
   ```

---

## 4. Accessible Keyboard Shortcuts & Voice Workflow

Framelock is engineered for complete keyboard-only and screen-reader operation:

| Shortcut | Action |
| :--- | :--- |
| **`[V]`** | Start / Stop Voice Dictation (`muse-voice-transcribe-1.0`) |
| **`[SPACE]`** | Play / Pause Animatic Sequence with synchronized spoken narration |
| **`[←]` / `[→]`** | Navigate Previous / Next Storyboard Shot with automatic status readback |
| **`[1]` – `[4]`** | Jump directly to Shot 1 through Shot 4 |
| **`[N]`** | Narrate active shot visual description and continuity state aloud |
| **`[Y]`** | Accept and apply the proposed `sam-3.1` continuity fix on the active shot |
| **`[M]`** | Toggle the `sam-3.1` segmentation bounding box and alpha mask overlay |
| **`[A]`** | Run full sequence continuity audit (`muse-spark-1.3`) |
| **`[G]`** | Parse transcript and regenerate storyboard frames (`muse-image-1.0`) |
| **`[?]`** | Open / Close the Accessible Keyboard & Voice Command Reference modal |

### Example Voice / Text Directives
Speak via `[V]` or type into the **Direct Voice / Text Command** input:
- `"Fix continuity mismatch in Shot 2 using SAM 3.1"`
- `"Change continuity rule: cup color must be emerald"`
- `"Narrate all shots and continuity status"`
