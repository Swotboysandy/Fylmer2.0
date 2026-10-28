import React from 'react';
import { Play, Pause, SkipBack, SkipForward, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { StoryboardShot } from '../types/framelock';

interface AudioTimelineProps {
  shots: StoryboardShot[];
  activeShotId: string | null;
  isPlayingAnimatic: boolean;
  currentTimeSeconds: number;
  totalDurationSeconds: number;
  onSelectShot: (shotId: string, narrate?: boolean) => void;
  onTogglePlayAnimatic: () => void;
  onScrubTime: (timeSeconds: number) => void;
}

export const AudioTimeline: React.FC<AudioTimelineProps> = ({
  shots,
  activeShotId,
  isPlayingAnimatic,
  currentTimeSeconds,
  totalDurationSeconds,
  onSelectShot,
  onTogglePlayAnimatic,
  onScrubTime,
}) => {
  const formatTimecode = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const tenths = Math.floor((sec % 1) * 10);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
  };

  const playheadPercent =
    totalDurationSeconds > 0
      ? Math.min(100, Math.max(0, (currentTimeSeconds / totalDurationSeconds) * 100))
      : 0;

  const activeIndex = shots.findIndex((s) => s.id === activeShotId);

  const handleStepShot = (delta: number) => {
    if (shots.length === 0) return;
    const nextIdx = Math.max(0, Math.min(shots.length - 1, (activeIndex === -1 ? 0 : activeIndex) + delta));
    onSelectShot(shots[nextIdx].id, true);
  };

  return (
    <section
      aria-label="Audio Scrubbing Timeline and Animatic Transport"
      className="bg-[#1E232B] border-2 border-[#323A46] rounded-lg p-5 flex flex-col gap-4"
    >
      {/* Transport Bar Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlayAnimatic}
            className="min-h-[48px] px-5 py-2.5 bg-[#38BDF8] hover:bg-[#7DD3FC] active:bg-[#0284C7] text-[#121417] font-bold text-base rounded flex items-center gap-3 transition-colors whitespace-nowrap shrink-0"
          >
            {isPlayingAnimatic ? (
              <>
                <Pause className="w-5 h-5 fill-current" aria-hidden="true" />
                <span>Pause Animatic</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" aria-hidden="true" />
                <span>Play Animatic</span>
              </>
            )}
            <kbd className="px-2 py-0.5 text-xs font-mono font-bold bg-[#0F172A] text-[#38BDF8] rounded">
              [SPACE]
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => handleStepShot(-1)}
            aria-label="Previous Shot"
            className="min-h-[48px] px-3.5 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] text-white rounded flex items-center gap-1.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <SkipBack className="w-4 h-4" aria-hidden="true" />
            <kbd className="text-xs font-mono text-[#38BDF8]">[←]</kbd>
          </button>

          <button
            type="button"
            onClick={() => handleStepShot(1)}
            aria-label="Next Shot"
            className="min-h-[48px] px-3.5 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] text-white rounded flex items-center gap-1.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <SkipForward className="w-4 h-4" aria-hidden="true" />
            <kbd className="text-xs font-mono text-[#38BDF8]">[→]</kbd>
          </button>
        </div>

        {/* High-Contrast Timecode Telemetry */}
        <div className="flex items-center gap-4 bg-[#16191E] border-2 border-[#323A46] px-4 py-2 rounded font-mono tabular-nums">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#94A3B8]">PLAYHEAD</span>
            <span className="text-lg font-bold text-[#38BDF8]">
              {formatTimecode(currentTimeSeconds)}
            </span>
          </div>
          <span className="text-[#4B5563]" aria-hidden="true">/</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#94A3B8]">TOTAL</span>
            <span className="text-base font-semibold text-white">
              {formatTimecode(totalDurationSeconds)}
            </span>
          </div>
        </div>
      </div>

      {/* Accessible Range Scrubber + Segmented Shot Track Well (#16191E) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs font-mono text-[#E2E8F0]">
          <label htmlFor="timeline-scrubber-input">
            TIMELINE SCRUBBER (USE LEFT/RIGHT ARROWS OR CLICK TRACK)
          </label>
          <span>{shots.length} SHOTS IN SEQUENCE</span>
        </div>

        <input
          id="timeline-scrubber-input"
          type="range"
          min={0}
          max={Math.max(0.1, totalDurationSeconds)}
          step={0.1}
          value={currentTimeSeconds}
          onChange={(e) => onScrubTime(parseFloat(e.target.value))}
          aria-valuetext={`${formatTimecode(currentTimeSeconds)} of ${formatTimecode(totalDurationSeconds)}`}
          className="w-full h-3 accent-[#38BDF8] bg-[#16191E] rounded cursor-pointer"
        />

        {/* Visual Track Well with Shot Segments, Waveform Blocks, and 4px Solid #38BDF8 Playhead */}
        <div className="relative bg-[#16191E] border-2 border-[#323A46] rounded p-2 min-h-[84px] flex items-stretch gap-1.5 overflow-hidden">
          {shots.map((shot) => {
            const isSelected = shot.id === activeShotId;
            const isMismatch = shot.status === 'mismatch';
            const widthWeight = shot.durationSeconds / Math.max(1, totalDurationSeconds);

            return (
              <button
                key={shot.id}
                type="button"
                onClick={() => onSelectShot(shot.id, true)}
                style={{ flexGrow: widthWeight }}
                aria-label={`Timeline track Shot ${shot.shotNumber}, duration ${shot.durationSeconds} seconds, status ${shot.status}`}
                className={`relative p-2.5 rounded text-left flex flex-col justify-between transition-colors border-2 ${
                  isSelected
                    ? 'bg-[#1E232B] border-[#38BDF8]'
                    : isMismatch
                    ? 'bg-[#1E232B]/90 border-[#F59E0B]'
                    : 'bg-[#121417] border-[#323A46] hover:border-[#4B5563]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-white whitespace-nowrap">
                    SHOT 0{shot.shotNumber}
                  </span>
                  {isMismatch ? (
                    <span className="flex items-center gap-1 text-xs font-mono font-bold text-[#FDE047] whitespace-nowrap">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" aria-hidden="true" />
                      <span>MISMATCH</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-mono text-[#10B981] whitespace-nowrap">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>LOCKED</span>
                    </span>
                  )}
                </div>

                {/* Simulated Track Waveform Bars */}
                <div className="flex items-end gap-1 h-5 my-1" aria-hidden="true">
                  {Array.from({ length: 16 }).map((_, idx) => {
                    const barH = 25 + ((shot.shotNumber * 19 + idx * 31) % 75);
                    return (
                      <span
                        key={idx}
                        style={{ height: `${barH}%` }}
                        className={`flex-1 rounded-xs ${
                          isMismatch
                            ? 'bg-[#FDE047]/85'
                            : isSelected
                            ? 'bg-[#38BDF8]/90'
                            : 'bg-[#38BDF8]/55'
                        }`}
                      />
                    );
                  })}
                </div>

                <div className="flex items-center justify-between text-xs font-mono text-[#E2E8F0] tabular-nums">
                  <span className="truncate max-w-[140px]">{shot.promptDescription}</span>
                  <span>{shot.durationSeconds.toFixed(1)}s</span>
                </div>
              </button>
            );
          })}

          {/* 4px Solid #38BDF8 Vertical Playhead Marker */}
          <div
            style={{ left: `${playheadPercent}%` }}
            className="pointer-events-none absolute top-0 bottom-0 w-[4px] bg-[#38BDF8] z-10"
            aria-hidden="true"
          >
            <div className="w-3.5 h-3.5 -ml-[5px] bg-[#38BDF8] border-2 border-[#FFFFFF] rounded-xs" />
          </div>
        </div>
      </div>
    </section>
  );
};
