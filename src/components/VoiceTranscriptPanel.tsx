import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Play, Plus, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ContinuityRule, DirectorPresetScenario } from '../types/framelock';
import { DIRECTOR_PRESETS } from '../services/metaModels';

interface VoiceTranscriptPanelProps {
  transcript: string;
  isRecording: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  rules: ContinuityRule[];
  activePresetId: string;
  onToggleRecording: () => void;
  onTranscriptChange: (newTranscript: string) => void;
  onRebuildFromTranscript: (injectDiscrepancy: boolean) => void;
  onSelectPreset: (preset: DirectorPresetScenario) => void;
  onExecuteVoiceCommand: (commandText: string) => void;
  onAddOrUpdateRule: (targetObject: string, expectedValue: string) => void;
  onToggleMute: () => void;
  onTestLocalDictation?: () => void;
}

export const VoiceTranscriptPanel: React.FC<VoiceTranscriptPanelProps> = ({
  transcript,
  isRecording,
  isProcessing,
  isSpeaking,
  isMuted,
  rules,
  activePresetId,
  onToggleRecording,
  onTranscriptChange,
  onRebuildFromTranscript,
  onSelectPreset,
  onExecuteVoiceCommand,
  onAddOrUpdateRule,
  onToggleMute,
  onTestLocalDictation,
}) => {
  const [voiceCommandInput, setVoiceCommandInput] = useState('');
  const [newRuleObject, setNewRuleObject] = useState('cup');
  const [newRuleColor, setNewRuleColor] = useState('blue');
  const [showAddRule, setShowAddRule] = useState(false);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Real-time high-contrast waveform visualizer (#34D399 listening, #F59E0B processing, #38BDF8 speaking)
  useEffect(() => {
    let animId: number;
    let phase = 0;

    const renderWaveform = () => {
      const canvas = waveformCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background recessed well
      ctx.fillStyle = '#16191E';
      ctx.fillRect(0, 0, w, h);

      // Center zero-crossing reference line
      ctx.strokeStyle = '#323A46';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const barCount = 32;
      const barWidth = 5;
      const gap = (w - barCount * barWidth) / (barCount + 1);

      let activeColor = '#4B5563';
      if (isRecording) activeColor = '#34D399'; // Verified Highlight Green when listening
      else if (isProcessing) activeColor = '#F59E0B'; // Discrepancy Amber when processing
      else if (isSpeaking) activeColor = '#38BDF8'; // Electric Sky during live speech feedback

      ctx.fillStyle = activeColor;
      phase += isRecording || isProcessing || isSpeaking ? 0.18 : 0.03;

      for (let i = 0; i < barCount; i++) {
        const x = gap + i * (barWidth + gap);
        const activityFactor = isRecording ? 0.85 : isProcessing ? 0.65 : isSpeaking ? 0.75 : 0.15;
        const wave =
          Math.sin(phase + i * 0.45) * 0.5 +
          Math.cos(phase * 1.4 - i * 0.25) * 0.35 +
          0.15;
        const barHeight = Math.max(4, Math.min(h - 8, Math.abs(wave) * (h - 10) * activityFactor));
        const y = (h - barHeight) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(renderWaveform);
    };

    animId = requestAnimationFrame(renderWaveform);
    return () => cancelAnimationFrame(animId);
  }, [isRecording, isProcessing, isSpeaking]);

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!voiceCommandInput.trim()) return;
    onExecuteVoiceCommand(voiceCommandInput.trim());
    setVoiceCommandInput('');
  };

  const handleRuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleObject.trim() || !newRuleColor.trim()) return;
    onAddOrUpdateRule(newRuleObject.trim().toLowerCase(), newRuleColor.trim().toLowerCase());
    setShowAddRule(false);
  };

  return (
    <aside
      aria-label="Voice Direction and Continuity Rules"
      className="w-full xl:w-[340px] shrink-0 flex flex-col gap-5 bg-[#1E232B] border-2 border-[#323A46] rounded-lg p-5"
    >
      {/* Live Voice Telemetry Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white tracking-tight">
            Voice Director Console
          </h2>
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={isMuted ? 'Unmute spoken narration and audio cues' : 'Mute spoken narration and audio cues'}
            className="min-h-[42px] px-3 py-1.5 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] rounded text-sm font-medium text-white flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            {isMuted ? (
              <>
                <VolumeX className="w-4 h-4 text-[#F59E0B]" aria-hidden="true" />
                <span>TTS Muted</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
                <span>TTS Active</span>
              </>
            )}
          </button>
        </div>

        {/* Audio Waveform Visualizer */}
        <div className="bg-[#16191E] border-2 border-[#323A46] rounded p-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-mono text-[#E2E8F0]">
            <span>
              {isRecording
                ? 'STATE: LISTENING (MUSE-VOICE-1.0)'
                : isProcessing
                ? 'STATE: PROCESSING PIPELINE'
                : isSpeaking
                ? 'STATE: NARRATING SCREEN'
                : 'STATE: STANDBY READY'}
            </span>
            <span className="text-[#94A3B8]">48kHz PCM</span>
          </div>
          <canvas
            ref={waveformCanvasRef}
            width={280}
            height={48}
            className="w-full h-12 rounded"
            aria-label="Real-time audio telemetry waveform"
          />
        </div>

        {/* Primary Voice Record Button (WCAG AAA 48px+ target) */}
        <button
          type="button"
          onClick={onToggleRecording}
          aria-pressed={isRecording}
          className={`min-h-[48px] w-full px-4 py-2.5 rounded font-semibold text-base flex items-center justify-between transition-colors ${
            isRecording
              ? 'bg-[#F59E0B] text-[#121417] hover:bg-[#FBBF24]'
              : 'bg-[#38BDF8] text-[#121417] hover:bg-[#7DD3FC]'
          }`}
        >
          <span className="flex items-center gap-2.5 whitespace-nowrap">
            {isRecording ? (
              <>
                <MicOff className="w-5 h-5 stroke-[2.5]" aria-hidden="true" />
                <span>Stop Voice Capture</span>
              </>
            ) : (
              <>
                <Mic className="w-5 h-5 stroke-[2.5]" aria-hidden="true" />
                <span>Dictate Scene or Rule</span>
              </>
            )}
          </span>
          <kbd className="px-2 py-0.5 text-xs font-mono font-bold bg-[#0F172A] text-[#38BDF8] rounded">
            [V]
          </kbd>
        </button>

        {onTestLocalDictation && (
          <div className="flex items-center justify-between text-xs font-mono text-[#94A3B8] px-1">
            <span>Testing without microphone?</span>
            <button
              type="button"
              onClick={onTestLocalDictation}
              className="text-[#38BDF8] hover:text-[#7DD3FC] underline"
            >
              Test simulated voice
            </button>
          </div>
        )}
      </div>

      {/* Quick Multimodal Voice/Text Command Bar */}
      <form onSubmit={handleCommandSubmit} className="flex flex-col gap-2">
        <label htmlFor="director-command-input" className="text-sm font-semibold text-[#E2E8F0]">
          Direct Voice / Text Command (`muse-spark-1.3`)
        </label>
        <div className="flex gap-2">
          <input
            id="director-command-input"
            type="text"
            value={voiceCommandInput}
            onChange={(e) => setVoiceCommandInput(e.target.value)}
            placeholder='e.g. "Fix shot 2" or "Cup must be emerald"'
            className="flex-1 min-h-[44px] px-3 py-2 bg-[#16191E] border-2 border-[#323A46] rounded text-white placeholder-[#94A3B8] text-sm focus:border-[#38BDF8]"
          />
          <button
            type="submit"
            className="min-h-[44px] px-3.5 py-2 bg-[#1E232B] border-2 border-[#4B5563] hover:border-[#38BDF8] text-white font-semibold text-sm rounded transition-colors whitespace-nowrap shrink-0"
          >
            Run
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => onExecuteVoiceCommand('Fix continuity mismatch in Shot 2 using SAM 3.1')}
            className="px-2.5 py-1 bg-[#16191E] border border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-mono text-[#E2E8F0] transition-colors whitespace-nowrap"
          >
            &ldquo;Fix Shot 2&rdquo;
          </button>
          <button
            type="button"
            onClick={() => onExecuteVoiceCommand('Change continuity rule: cup color must be emerald')}
            className="px-2.5 py-1 bg-[#16191E] border border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-mono text-[#E2E8F0] transition-colors whitespace-nowrap"
          >
            &ldquo;Rule: Cup = Emerald&rdquo;
          </button>
          <button
            type="button"
            onClick={() => onExecuteVoiceCommand('Narrate all shots and continuity status')}
            className="px-2.5 py-1 bg-[#16191E] border border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-mono text-[#E2E8F0] transition-colors whitespace-nowrap"
          >
            &ldquo;Narrate Summary&rdquo;
          </button>
        </div>
      </form>

      {/* Preset Sequence Selector */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#323A46]">
        <label htmlFor="preset-scenario-select" className="text-sm font-semibold text-[#E2E8F0]">
          Director Script Sequence
        </label>
        <select
          id="preset-scenario-select"
          value={activePresetId}
          onChange={(e) => {
            const found = DIRECTOR_PRESETS.find((p) => p.id === e.target.value);
            if (found) onSelectPreset(found);
          }}
          className="min-h-[44px] w-full px-3 py-2 bg-[#16191E] border-2 border-[#323A46] rounded text-white text-sm font-medium focus:border-[#38BDF8]"
        >
          {DIRECTOR_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.title} ({preset.genre})
            </option>
          ))}
        </select>
      </div>

      {/* Live Transcript Log (`muse-voice-transcribe-1.0`) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="live-transcript-textarea" className="text-sm font-semibold text-[#E2E8F0]">
            Scene Transcript (`muse-voice-transcribe-1.0`)
          </label>
          <span className="text-xs font-mono text-[#94A3B8]">Editable</span>
        </div>
        <textarea
          id="live-transcript-textarea"
          rows={5}
          value={transcript}
          onChange={(e) => onTranscriptChange(e.target.value)}
          className="w-full p-3 bg-[#16191E] border-2 border-[#323A46] rounded text-[#E2E8F0] font-mono text-sm leading-relaxed focus:border-[#38BDF8] resize-y"
        />
        <button
          type="button"
          onClick={() => onRebuildFromTranscript(true)}
          disabled={isProcessing}
          className="min-h-[46px] w-full px-3 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] text-white font-semibold text-sm rounded flex items-center justify-between transition-colors disabled:opacity-50"
        >
          <span className="flex items-center gap-2 whitespace-nowrap">
            <RefreshCw className={`w-4 h-4 text-[#38BDF8] ${isProcessing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Parse &amp; Generate Shots</span>
          </span>
          <kbd className="px-2 py-0.5 text-xs font-mono font-bold bg-[#0F172A] text-[#38BDF8] rounded">
            [G]
          </kbd>
        </button>
      </div>

      {/* Extracted Continuity Rules (`muse-spark-1.3`) */}
      <section aria-labelledby="continuity-rules-heading" className="flex flex-col gap-3 pt-2 border-t border-[#323A46]">
        <div className="flex items-center justify-between">
          <h3 id="continuity-rules-heading" className="text-base font-semibold text-white">
            Active Continuity Rules
          </h3>
          <button
            type="button"
            onClick={() => setShowAddRule((prev) => !prev)}
            className="min-h-[36px] px-2.5 py-1 bg-[#16191E] border border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-mono text-[#38BDF8] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Set Rule</span>
          </button>
        </div>

        {showAddRule && (
          <form onSubmit={handleRuleSubmit} className="p-3 bg-[#16191E] border-2 border-[#4B5563] rounded flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="rule-obj-select" className="block text-xs font-mono text-[#E2E8F0] mb-1">
                  Target Prop
                </label>
                <select
                  id="rule-obj-select"
                  value={newRuleObject}
                  onChange={(e) => setNewRuleObject(e.target.value)}
                  className="w-full min-h-[38px] px-2 bg-[#121417] border border-[#4B5563] rounded text-sm text-white"
                >
                  <option value="cup">cup</option>
                  <option value="umbrella">umbrella</option>
                  <option value="jacket">jacket</option>
                </select>
              </div>
              <div>
                <label htmlFor="rule-color-select" className="block text-xs font-mono text-[#E2E8F0] mb-1">
                  Expected Color
                </label>
                <select
                  id="rule-color-select"
                  value={newRuleColor}
                  onChange={(e) => setNewRuleColor(e.target.value)}
                  className="w-full min-h-[38px] px-2 bg-[#121417] border border-[#4B5563] rounded text-sm text-white"
                >
                  <option value="blue">blue</option>
                  <option value="emerald">emerald</option>
                  <option value="amber">amber</option>
                  <option value="red">red</option>
                  <option value="purple">purple</option>
                  <option value="white">white</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="min-h-[40px] w-full bg-[#38BDF8] text-[#121417] font-semibold text-sm rounded hover:bg-[#7DD3FC] transition-colors"
            >
              Enforce Rule &amp; Re-Audit Shots
            </button>
          </form>
        )}

        <ul className="flex flex-col gap-2" role="list">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="p-3 bg-[#16191E] border border-[#323A46] rounded flex items-start justify-between gap-2"
            >
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold text-white font-mono">
                  {rule.targetObject}.{rule.property} = &ldquo;{rule.expectedValue}&rdquo;
                </div>
                <div className="text-xs text-[#E2E8F0] flex items-center gap-1.5">
                  <span>Scope: {rule.scope === 'all_shots' ? 'All Shots' : 'Single Shot'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">Rev {rule.revision}</span>
                </div>
              </div>
              <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
};
