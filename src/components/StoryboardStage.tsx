import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Volume2,
  Wand2,
  Layers,
  ShieldCheck,
  Film,
  LayoutGrid,
  Download,
} from 'lucide-react';
import { ContinuityRule, StoryboardShot } from '../types/framelock';

interface StoryboardStageProps {
  shots: StoryboardShot[];
  rules: ContinuityRule[];
  activeShotId: string | null;
  showSamMaskOverlay: boolean;
  isPlayingAnimatic: boolean;
  viewMode: 'grid' | 'animatic';
  onSetViewMode: (mode: 'grid' | 'animatic') => void;
  onSelectShot: (shotId: string, narrate?: boolean) => void;
  onNarrateShot: (shot: StoryboardShot) => void;
  onApplyProposedFix: (shotId: string) => void;
  onRunFullAudit: () => void;
  onToggleSamMaskOverlay: () => void;
  onExportProjectJson: () => void;
}

export const StoryboardStage: React.FC<StoryboardStageProps> = ({
  shots,
  rules,
  activeShotId,
  showSamMaskOverlay,
  isPlayingAnimatic,
  viewMode,
  onSetViewMode,
  onSelectShot,
  onNarrateShot,
  onApplyProposedFix,
  onRunFullAudit,
  onToggleSamMaskOverlay,
  onExportProjectJson,
}) => {
  const activeShot = shots.find((s) => s.id === activeShotId) || shots[0] || null;
  const mismatchCount = shots.filter((s) => s.status === 'mismatch').length;
  const consistentCount = shots.filter((s) => s.status === 'consistent').length;

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-5">
      {/* Stage Workspace Toolbar */}
      <div className="bg-[#1E232B] border-2 border-[#323A46] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented View Switcher */}
          <div
            role="group"
            aria-label="Stage Display Mode"
            className="flex items-center gap-1 p-1 bg-[#16191E] border border-[#323A46] rounded"
          >
            <button
              type="button"
              onClick={() => onSetViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              className={`min-h-[38px] px-3 py-1.5 rounded text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'grid'
                  ? 'bg-[#38BDF8] text-[#121417]'
                  : 'text-[#E2E8F0] hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
              <span>Storyboard Grid</span>
            </button>
            <button
              type="button"
              onClick={() => onSetViewMode('animatic')}
              aria-pressed={viewMode === 'animatic'}
              className={`min-h-[38px] px-3 py-1.5 rounded text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'animatic'
                  ? 'bg-[#38BDF8] text-[#121417]'
                  : 'text-[#E2E8F0] hover:text-white'
              }`}
            >
              <Film className="w-4 h-4" aria-hidden="true" />
              <span>Animatic Monitor</span>
            </button>
          </div>

          {/* Unboxed Clean Continuity Summary Metadata */}
          <div className="flex items-center gap-2 text-sm text-[#E2E8F0] font-mono tabular-nums px-2">
            <span className="text-[#10B981] font-bold">{consistentCount} Consistent</span>
            <span aria-hidden="true">·</span>
            <span className={mismatchCount > 0 ? 'text-[#FDE047] font-bold' : 'text-[#94A3B8]'}>
              {mismatchCount} Discrepancy
            </span>
            <span aria-hidden="true">·</span>
            <span>{rules.length} Active Rules</span>
          </div>
        </div>

        {/* Stage Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleSamMaskOverlay}
            aria-pressed={showSamMaskOverlay}
            className="min-h-[42px] px-3.5 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] text-white text-sm font-semibold rounded flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Layers className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
            <span>{showSamMaskOverlay ? 'SAM 3.1 Masks: ON' : 'SAM 3.1 Masks: OFF'}</span>
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-[#0F172A] text-[#38BDF8] rounded">
              [M]
            </kbd>
          </button>

          <button
            type="button"
            onClick={onRunFullAudit}
            className="min-h-[42px] px-3.5 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] text-white text-sm font-semibold rounded flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="w-4 h-4 text-[#10B981]" aria-hidden="true" />
            <span>Audit Sequence</span>
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-[#0F172A] text-[#38BDF8] rounded">
              [A]
            </kbd>
          </button>

          <button
            type="button"
            onClick={onExportProjectJson}
            className="min-h-[42px] px-3.5 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] text-white text-sm font-semibold rounded flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Animatic Full-Stage Monitor View */}
      {viewMode === 'animatic' && activeShot && (
        <section
          aria-label={`Animatic Stage Monitor showing Shot ${activeShot.shotNumber}`}
          className="bg-[#1E232B] border-2 border-[#38BDF8] rounded-lg p-5 flex flex-col gap-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="font-mono text-base font-bold text-[#38BDF8]">
                ANIMATIC MONITOR · SHOT 0{activeShot.shotNumber} OF 0{shots.length}
              </span>
              {isPlayingAnimatic && (
                <span className="text-xs font-mono font-bold text-[#34D399]">
                  PLAYING LIVE AUDIO + NARRATION
                </span>
              )}
            </div>
            <span className="font-mono text-sm text-[#E2E8F0] tabular-nums">
              DURATION: {activeShot.durationSeconds.toFixed(1)}s
            </span>
          </div>

          <div className="relative aspect-video w-full bg-[#121417] border-2 border-[#323A46] rounded overflow-hidden">
            <img
              src={activeShot.currentImageUrl}
              alt={activeShot.spokenDescription}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />

            {/* SAM 3.1 Segmentation Mask & Bounding Box Overlay */}
            {showSamMaskOverlay && activeShot.proposedFix?.mask && (
              <>
                <img
                  src={activeShot.proposedFix.mask.maskBase64}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-80"
                />
                <div
                  style={{
                    left: `${activeShot.proposedFix.mask.box.x}%`,
                    top: `${activeShot.proposedFix.mask.box.y}%`,
                    width: `${activeShot.proposedFix.mask.box.width}%`,
                    height: `${activeShot.proposedFix.mask.box.height}%`,
                  }}
                  className={`absolute pointer-events-none border-3 border-dashed rounded ${
                    activeShot.status === 'mismatch'
                      ? 'border-[#F59E0B] bg-[#F59E0B]/15'
                      : 'border-[#38BDF8] bg-[#38BDF8]/15'
                  }`}
                >
                  <span className="absolute -top-7 left-0 px-2 py-0.5 bg-[#0F172A] border border-[#38BDF8] text-xs font-mono font-bold text-white whitespace-nowrap rounded-xs">
                    SAM 3.1: {activeShot.proposedFix.targetObject} (
                    {(activeShot.proposedFix.mask.confidence * 100).toFixed(0)}%)
                  </span>
                </div>
              </>
            )}

            {/* High-Contrast Burned-In Caption Scrim */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent p-5 pt-10">
              <p className="text-lg font-medium text-white leading-snug">
                {activeShot.spokenDescription}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Adaptive 2x2 Storyboard Cards Grid */}
      {viewMode === 'grid' && (
        <div
          role="region"
          aria-label="Storyboard Frames Grid"
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
        >
          {shots.map((shot) => {
            const isSelected = shot.id === activeShotId;
            const isMismatch = shot.status === 'mismatch';
            const mask = shot.proposedFix?.mask;

            return (
              <article
                key={shot.id}
                aria-label={`Shot ${shot.shotNumber}, ${shot.status === 'mismatch' ? 'Continuity Discrepancy Flagged' : 'Continuity Verified'}`}
                onClick={() => onSelectShot(shot.id, false)}
                className={`bg-[#1E232B] rounded-lg p-4 flex flex-col gap-3.5 transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-3 border-[#38BDF8]'
                    : isMismatch
                    ? 'border-2 border-[#F59E0B]'
                    : 'border-2 border-[#323A46] hover:border-[#4B5563]'
                }`}
              >
                {/* Card Header with Frame Index & Continuity Status Indicator */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-base font-bold text-white">
                      SHOT 0{shot.shotNumber}
                    </span>
                    <span className="text-[#4B5563]" aria-hidden="true">·</span>
                    <span className="font-mono text-sm text-[#E2E8F0] tabular-nums">
                      {shot.durationSeconds.toFixed(1)}s
                    </span>
                    <kbd className="px-1.5 py-0.5 text-xs font-mono bg-[#0F172A] text-[#94A3B8] rounded">
                      [{shot.shotNumber}]
                    </kbd>
                  </div>

                  {/* High-Contrast Discrepancy / Verified Indicator */}
                  {isMismatch ? (
                    <div className="px-2.5 py-1 bg-[#16191E] border-2 border-[#F59E0B] rounded flex items-center gap-1.5 text-xs font-mono font-bold text-[#FDE047] whitespace-nowrap shrink-0">
                      <AlertTriangle className="w-4 h-4 text-[#F59E0B]" aria-hidden="true" />
                      <span>MISMATCH</span>
                      <span>[N]</span>
                    </div>
                  ) : (
                    <div className="px-2.5 py-1 bg-[#16191E] border border-[#10B981] rounded flex items-center gap-1.5 text-xs font-mono font-bold text-white whitespace-nowrap shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-[#10B981]" aria-hidden="true" />
                      <span>CONSISTENT</span>
                      <span className="text-[#34D399]">[Y]</span>
                    </div>
                  )}
                </div>

                {/* Storyboard Frame Canvas Image + Optional SAM 3.1 Segmentation Mask */}
                <div className="relative aspect-video w-full bg-[#121417] border border-[#323A46] rounded overflow-hidden">
                  <img
                    src={shot.currentImageUrl}
                    alt={shot.spokenDescription}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />

                  {showSamMaskOverlay && mask && (
                    <>
                      <img
                        src={mask.maskBase64}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-75"
                      />
                      <div
                        style={{
                          left: `${mask.box.x}%`,
                          top: `${mask.box.y}%`,
                          width: `${mask.box.width}%`,
                          height: `${mask.box.height}%`,
                        }}
                        className={`absolute pointer-events-none border-2 border-dashed rounded-xs ${
                          isMismatch
                            ? 'border-[#F59E0B] bg-[#F59E0B]/20'
                            : 'border-[#38BDF8] bg-[#38BDF8]/15'
                        }`}
                      >
                        <span className="absolute -top-6 left-0 px-1.5 py-0.5 bg-[#0F172A] border border-[#38BDF8] text-[11px] font-mono font-bold text-white whitespace-nowrap rounded-xs">
                          SAM 3.1: {shot.proposedFix?.targetObject}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Prompt Description */}
                <p className="text-base text-[#E2E8F0] leading-relaxed line-clamp-2">
                  {shot.promptDescription}
                </p>

                {/* Inline Discrepancy Callout & Immediate Fix Action */}
                {isMismatch && shot.discrepancyMessage && (
                  <div className="p-3 bg-[#16191E] border-2 border-[#F59E0B] rounded flex flex-col gap-2.5">
                    <p className="text-sm font-medium text-[#FDE047] leading-snug">
                      {shot.discrepancyMessage}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onApplyProposedFix(shot.id);
                      }}
                      className="min-h-[44px] w-full px-3 py-2 bg-[#38BDF8] hover:bg-[#7DD3FC] text-[#121417] font-bold text-sm rounded flex items-center justify-between transition-colors"
                    >
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <Wand2 className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
                        <span>
                          Fix via SAM 3.1: Recolor {shot.proposedFix?.targetObject} →{' '}
                          {shot.proposedFix?.targetColor}
                        </span>
                      </span>
                      <kbd className="px-2 py-0.5 text-xs font-mono font-bold bg-[#0F172A] text-[#38BDF8] rounded">
                        [Y]
                      </kbd>
                    </button>
                  </div>
                )}

                {/* Card Footer Actions */}
                <div className="flex items-center justify-between gap-2 pt-1 mt-auto border-t border-[#323A46]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectShot(shot.id, false);
                      onNarrateShot(shot);
                    }}
                    aria-label={`Narrate Shot ${shot.shotNumber} aloud`}
                    className="min-h-[42px] px-3 py-1.5 bg-[#16191E] border border-[#4B5563] hover:border-[#38BDF8] rounded text-sm font-semibold text-white flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <Volume2 className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
                    <span>Narrate Shot</span>
                  </button>

                  <span className="text-xs font-mono text-[#94A3B8] tabular-nums">
                    Rev {shot.revisions.length}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
