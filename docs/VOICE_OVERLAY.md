# Voice orb
The current UI uses the original BeUI VoiceOrb component in a bare bottom-center button. No popup, pill or visible text. Hover and screen-reader labels identify voice chat. Clicking toggles local microphone metering; closing or unmounting releases tracks. Motion uses BeUI SPRING_PRESS, with reduced motion respected. Transcription is not connected; audio is not recorded or uploaded.

Source: https://beui.dev/components/agents/voice-orb. Original source and license: docs/upstream-components. Earlier screenshots in docs/voice-overlay show the superseded popup design.

The production build passes. Prior full regression run had a repeated cup-export download timeout; this is not claimed fixed by the UI changes.

Latest push validation: production build and all five creation/voice browser tests passed. Synthetic microphone start/stop cleanup verified with the bare orb.
