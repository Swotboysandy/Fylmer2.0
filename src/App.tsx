import { useReducedMotion } from 'motion/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ContinuityRule,
  DirectorPresetScenario,
  ModelInvocationRecord,
  ProjectState,
  StoryboardShot,
} from './types/framelock';
import { DIRECTOR_PRESETS, metaModelClient } from './services/metaModels';
import { speechService } from './services/speechService';
import { renderMuseStoryboardFrame } from './services/canvasEngine';
import { VoiceTranscriptPanel } from './components/VoiceTranscriptPanel';
import { StoryboardStage } from './components/StoryboardStage';
import { AudioTimeline } from './components/AudioTimeline';
import { ShotInspectorPanel } from './components/ShotInspectorPanel';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';

export default function App() {
  const reducedMotion = useReducedMotion();
  const initialPreset = DIRECTOR_PRESETS[0];

  const [projectState, setProjectState] = useState<ProjectState>({
    projectId: 'proj-framelock-01',
    title: initialPreset.title,
    transcript: initialPreset.transcript,
    isRecording: false,
    rules: [],
    shots: [],
    activeShotId: null,
    isPlayingAnimatic: false,
    isProcessing: true,
    statusAnnouncement:
      'Framelock Studio initialized. Loading Sequence 01: Midnight Diner Rain and running continuity audit.',
  });

  const [activePresetId, setActivePresetId] = useState<string>(initialPreset.id);
  const [showSamMaskOverlay, setShowSamMaskOverlay] = useState<boolean>(true);
  const [transitionsEnabled, setTransitionsEnabled] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'animatic'>('grid');
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState<boolean>(false);
  const [modelLogs, setModelLogs] = useState<ModelInvocationRecord[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const lastNarratedShotIdInAnimaticRef = useRef<string | null>(null);

  // Subscribe to speech synthesis state and Meta Model logs
  useEffect(() => {
    speechService.setSpeakingCallback(setIsSpeaking);
    metaModelClient.onLogUpdate((logs) => setModelLogs([...logs]));
  }, []);

  // Announce status helper (updates aria-live region + optional TTS narration)
  const announceStatus = useCallback((message: string, speakAloud: boolean = true) => {
    setProjectState((prev) => ({
      ...prev,
      statusAnnouncement: message,
    }));
    if (speakAloud) {
      speechService.speak(message, true);
    }
  }, []);

  // Load initial storyboard sequence on mount
  useEffect(() => {
    let mounted = true;
    metaModelClient
      .generateStoryboardFromTranscript(initialPreset.transcript, undefined, true)
      .then(({ rules, shots }) => {
        if (!mounted) return;
        const mismatchShot = shots.find((s) => s.status === 'mismatch');
        setProjectState((prev) => ({
          ...prev,
          rules,
          shots,
          activeShotId: mismatchShot ? mismatchShot.id : shots[0]?.id || null,
          isProcessing: false,
          statusAnnouncement: `Loaded ${shots.length} storyboard shots. Continuity Alert in Shot ${
            mismatchShot?.shotNumber || 2
          }: ${mismatchShot?.discrepancyMessage || 'Discrepancy detected.'} Press Y to apply SAM 3.1 fix or N to narrate.`,
        }));
      });
    return () => {
      mounted = false;
    };
  }, [initialPreset.transcript]);

  // Compute total animatic duration
  const totalDurationSeconds = useMemo(
    () => projectState.shots.reduce((acc, s) => acc + s.durationSeconds, 0),
    [projectState.shots]
  );

  // Active shot reference
  const activeShot = useMemo(
    () =>
      projectState.shots.find((s) => s.id === projectState.activeShotId) ||
      projectState.shots[0] ||
      null,
    [projectState.shots, projectState.activeShotId]
  );

  // Select a shot and optionally narrate it
  const handleSelectShot = useCallback(
    (shotId: string, narrate: boolean = false) => {
      const target = projectState.shots.find((s) => s.id === shotId);
      if (!target) return;

      speechService.playEarcon(target.status === 'mismatch' ? 'mismatch' : 'focus');

      // Calculate timeline start offset for this shot
      let timeOffset = 0;
      for (const s of projectState.shots) {
        if (s.id === shotId) break;
        timeOffset += s.durationSeconds;
      }
      setCurrentTimeSeconds(timeOffset);

      setProjectState((prev) => ({
        ...prev,
        activeShotId: shotId,
        statusAnnouncement: `Selected Shot ${target.shotNumber} of ${prev.shots.length}. ${
          target.status === 'mismatch'
            ? `Continuity Discrepancy: ${target.discrepancyMessage}`
            : 'Continuity verified.'
        }`,
      }));

      if (narrate) {
        speechService.speak(target.spokenDescription, true);
      }
    },
    [projectState.shots]
  );

  // Narrate a specific shot on demand
  const handleNarrateShot = useCallback((shot: StoryboardShot) => {
    setProjectState((prev) => ({
      ...prev,
      statusAnnouncement: `Narrating Shot ${shot.shotNumber}: ${shot.spokenDescription}`,
    }));
    speechService.speak(shot.spokenDescription, true);
  }, []);

  // Rebuild storyboard from transcript (`muse-spark-1.3` + `muse-image-1.0` + `sam-3.1`)
  const handleRebuildFromTranscript = useCallback(
    async (injectDiscrepancy: boolean = true, overrideTranscript?: string) => {
      const targetTranscript = overrideTranscript ?? projectState.transcript;
      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement:
          'Running muse-spark-1.3 shot planner and muse-image-1.0 storyboard synthesis...',
      }));

      const { rules, shots } = await metaModelClient.generateStoryboardFromTranscript(
        targetTranscript,
        undefined,
        injectDiscrepancy
      );

      const mismatchShot = shots.find((s) => s.status === 'mismatch');
      speechService.playEarcon(mismatchShot ? 'mismatch' : 'consistent');

      const summaryMsg = mismatchShot
        ? `Generated ${shots.length} shots. Discrepancy flagged in Shot ${mismatchShot.shotNumber}: ${mismatchShot.discrepancyMessage}`
        : `Generated ${shots.length} shots. All shots pass continuity verification.`;

      setProjectState((prev) => ({
        ...prev,
        transcript: targetTranscript,
        rules,
        shots,
        activeShotId: mismatchShot ? mismatchShot.id : shots[0]?.id || null,
        isProcessing: false,
        statusAnnouncement: summaryMsg,
      }));
      speechService.speak(summaryMsg, true);
    },
    [projectState.transcript]
  );

  // Switch Director Preset Sequence
  const handleSelectPreset = useCallback(
    async (preset: DirectorPresetScenario) => {
      setActivePresetId(preset.id);
      setProjectState((prev) => ({
        ...prev,
        title: preset.title,
        transcript: preset.transcript,
        isPlayingAnimatic: false,
      }));
      setCurrentTimeSeconds(0);
      await handleRebuildFromTranscript(true, preset.transcript);
    },
    [handleRebuildFromTranscript]
  );

  // Apply SAM 3.1 Continuity Fix (`sam-3.1` mask isolation + client-side canvas pixel recoloring)
  const handleApplyProposedFix = useCallback(
    async (shotId: string, customColor?: string) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;

      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement: `Isolating ${
          targetShot.proposedFix?.targetObject || 'prop'
        } in Shot ${targetShot.shotNumber} with SAM 3.1 mask and recoloring pixels...`,
      }));

      const updatedShot = await metaModelClient.applyContinuityFix(targetShot, customColor);
      speechService.playEarcon('fixApplied');

      const resolvedColor =
        customColor || targetShot.proposedFix?.targetColor || 'blue';
      const resolvedObject = targetShot.proposedFix?.targetObject || 'cup';

      const confirmationMessage = `Continuity verified on Shot ${updatedShot.shotNumber}. ${resolvedObject} recolored to ${resolvedColor} via SAM 3.1 segmentation mask.`;

      setProjectState((prev) => ({
        ...prev,
        isProcessing: false,
        shots: prev.shots.map((s) => (s.id === shotId ? updatedShot : s)),
        activeShotId: shotId,
        statusAnnouncement: confirmationMessage,
      }));

      speechService.speak(confirmationMessage, true);
    },
    [projectState.shots]
  );

  // Manual SAM 3.1 Segmentation trigger on any shot
  const handleSegmentObjectManual = useCallback(
    async (shotId: string, targetObject: string) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;

      const primaryRuleColor = projectState.rules[0]?.expectedValue || 'blue';
      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement: `Running SAM 3.1 segmentation on Shot ${targetShot.shotNumber} for target "${targetObject}"...`,
      }));

      const mask = await metaModelClient.segmentObjectWithSam3(
        targetShot.shotNumber,
        targetObject
      );
      setShowSamMaskOverlay(true);
      speechService.playEarcon('focus');

      setProjectState((prev) => ({
        ...prev,
        isProcessing: false,
        shots: prev.shots.map((s) =>
          s.id === shotId
            ? {
                ...s,
                proposedFix: {
                  action: 'recolor',
                  targetObject,
                  targetColor: primaryRuleColor,
                  mask,
                },
              }
            : s
        ),
        statusAnnouncement: `SAM 3.1 isolated ${targetObject} in Shot ${
          targetShot.shotNumber
        } with ${(mask.confidence * 100).toFixed(1)}% confidence.`,
      }));
    },
    [projectState.shots, projectState.rules]
  );

  // Revert a shot to an earlier revision
  const handleRevertShotRevision = useCallback(
    (shotId: string, revisionId: string) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;
      const rev = targetShot.revisions.find((r) => r.revisionId === revisionId);
      if (!rev) return;

      const isInitialMismatch =
        revisionId.endsWith('-initial') &&
        rev.actionApplied.toLowerCase().includes('red');

      speechService.playEarcon('focus');
      setProjectState((prev) => ({
        ...prev,
        shots: prev.shots.map((s) =>
          s.id === shotId
            ? {
                ...s,
                currentImageUrl: rev.imageUrl,
                status: isInitialMismatch ? 'mismatch' : 'consistent',
                discrepancyMessage: isInitialMismatch
                  ? `Restored initial revision containing continuity discrepancy (${rev.actionApplied}).`
                  : undefined,
              }
            : s
        ),
        statusAnnouncement: `Restored Shot ${targetShot.shotNumber} to revision: ${rev.actionApplied}.`,
      }));
    },
    [projectState.shots]
  );

  // Update shot prompt description and duration, regenerating its canvas frame
  const handleUpdateShotPrompt = useCallback(
    (shotId: string, newPrompt: string, newDuration: number) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;

      const primaryRule = projectState.rules[0];
      const targetObject = primaryRule?.targetObject || 'cup';
      const expectedColor = primaryRule?.expectedValue || 'blue';

      const cameraAngles: Array<'wide' | 'medium' | 'closeup' | 'over_shoulder'> = [
        'wide',
        'medium',
        'closeup',
        'over_shoulder',
      ];
      const angle = cameraAngles[(targetShot.shotNumber - 1) % cameraAngles.length];

      const { imageUrl } = renderMuseStoryboardFrame({
        shotNumber: targetShot.shotNumber,
        cameraAngle: angle,
        settingTitle: 'Studio Stage',
        targetObject,
        objectColorName: expectedColor,
        weatherOrMood: 'rain_noir',
        characterPose: 'seated_detective',
        seed: targetShot.shotNumber * 23 + Date.now() % 100,
      });

      const updatedSpoken = `Shot ${targetShot.shotNumber}, duration ${newDuration.toFixed(
        1
      )} seconds. ${newPrompt}. Continuity verified: ${targetObject} is ${expectedColor}.`;

      speechService.playEarcon('consistent');
      setProjectState((prev) => ({
        ...prev,
        shots: prev.shots.map((s) =>
          s.id === shotId
            ? {
                ...s,
                promptDescription: newPrompt,
                durationSeconds: newDuration,
                spokenDescription: updatedSpoken,
                currentImageUrl: imageUrl,
                status: 'consistent',
                discrepancyMessage: undefined,
                revisions: [
                  ...s.revisions,
                  {
                    revisionId: `rev-${s.shotNumber}-${s.revisions.length + 1}`,
                    timestamp: Date.now(),
                    imageUrl,
                    actionApplied: `Prompt updated & regenerated via muse-image-1.0`,
                  },
                ],
              }
            : s
        ),
        statusAnnouncement: `Updated Shot ${targetShot.shotNumber} prompt and duration (${newDuration}s).`,
      }));
    },
    [projectState.shots, projectState.rules]
  );

  // Add or update a ContinuityRule and re-audit all shots
  const handleAddOrUpdateRule = useCallback(
    async (targetObject: string, expectedValue: string) => {
      const newRule: ContinuityRule = {
        id: `rule-${targetObject}-color`,
        scope: 'all_shots',
        targetObject,
        property: 'color',
        expectedValue,
        revision: (projectState.rules[0]?.revision || 1) + 1,
      };

      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement: `Updated continuity rule: ${targetObject}.color must be ${expectedValue}. Re-auditing all shots with muse-spark-1.3 and SAM 3.1...`,
      }));

      // Re-audit all shots against the new expected color
      const updatedShots: StoryboardShot[] = [];
      for (const shot of projectState.shots) {
        const mask =
          shot.proposedFix?.mask ||
          (await metaModelClient.segmentObjectWithSam3(shot.shotNumber, targetObject));
        const currentRevAction =
          shot.revisions[shot.revisions.length - 1]?.actionApplied.toLowerCase() || '';
        const matchesNewRule = currentRevAction.includes(expectedValue.toLowerCase());

        updatedShots.push({
          ...shot,
          status: matchesNewRule ? 'consistent' : 'mismatch',
          discrepancyMessage: matchesNewRule
            ? undefined
            : `Rule updated to "${targetObject}.color = ${expectedValue}". Shot ${shot.shotNumber} requires SAM 3.1 recolor to ${expectedValue}.`,
          proposedFix: {
            action: 'recolor',
            targetObject,
            targetColor: expectedValue,
            mask,
          },
        });
      }

      const mismatchCount = updatedShots.filter((s) => s.status === 'mismatch').length;
      speechService.playEarcon(mismatchCount > 0 ? 'mismatch' : 'consistent');

      const msg = `Continuity rule updated: ${targetObject} color = ${expectedValue}. ${mismatchCount} shots flagged for SAM 3.1 recolor.`;
      setProjectState((prev) => ({
        ...prev,
        isProcessing: false,
        rules: [newRule, ...prev.rules.filter((r) => r.id !== newRule.id)],
        shots: updatedShots,
        statusAnnouncement: msg,
      }));
      speechService.speak(msg, true);
    },
    [projectState.rules, projectState.shots]
  );

  // Run Full Sequence Continuity Audit (`muse-spark-1.3`)
  const handleRunFullAudit = useCallback(() => {
    const mismatches = projectState.shots.filter((s) => s.status === 'mismatch');
    if (mismatches.length === 0) {
      speechService.playEarcon('consistent');
      announceStatus(
        `Continuity Audit Complete: All ${projectState.shots.length} shots satisfy active continuity rules.`,
        true
      );
    } else {
      const firstMismatch = mismatches[0];
      speechService.playEarcon('mismatch');
      setProjectState((prev) => ({
        ...prev,
        activeShotId: firstMismatch.id,
      }));
      announceStatus(
        `Continuity Audit found ${mismatches.length} discrepancy. Focused on Shot ${firstMismatch.shotNumber}: ${firstMismatch.discrepancyMessage} Press Y to apply SAM 3.1 fix.`,
        true
      );
    }
  }, [projectState.shots, announceStatus]);

  // Execute natural voice or text command (`muse-spark-1.3` intent router)
  const handleExecuteVoiceCommand = useCallback(
    async (commandText: string) => {
      const lower = commandText.toLowerCase();

      if (lower.includes('fix')) {
        // Check if a specific shot number was named, otherwise fix active or first mismatched shot
        const shotMatch = lower.match(/shot\s*(\d+)/);
        const targetShotNum = shotMatch ? parseInt(shotMatch[1], 10) : null;
        const targetShot =
          (targetShotNum
            ? projectState.shots.find((s) => s.shotNumber === targetShotNum)
            : projectState.shots.find((s) => s.status === 'mismatch')) || activeShot;

        if (targetShot) {
          await handleApplyProposedFix(targetShot.id);
        } else {
          announceStatus('All shots are already consistent.', true);
        }
        return;
      }

      if (lower.includes('narrate') || lower.includes('read') || lower.includes('describe')) {
        const summary = projectState.shots.map((s) => s.spokenDescription).join(' ');
        announceStatus(`Narrating full storyboard sequence: ${summary}`, true);
        return;
      }

      if (
        lower.includes('emerald') ||
        lower.includes('amber') ||
        lower.includes('blue') ||
        lower.includes('red') ||
        lower.includes('purple') ||
        lower.includes('white')
      ) {
        const colors = ['emerald', 'amber', 'blue', 'red', 'purple', 'white'];
        const chosenColor = colors.find((c) => lower.includes(c)) || 'blue';
        const targetObj = projectState.rules[0]?.targetObject || 'cup';
        await handleAddOrUpdateRule(targetObj, chosenColor);
        return;
      }

      // Default: append to transcript and rebuild sequence
      const updatedTranscript = `${projectState.transcript} ${commandText}`.trim();
      await handleRebuildFromTranscript(false, updatedTranscript);
    },
    [
      projectState.shots,
      projectState.rules,
      projectState.transcript,
      activeShot,
      handleApplyProposedFix,
      handleAddOrUpdateRule,
      handleRebuildFromTranscript,
      announceStatus,
    ]
  );

  // Toggle Voice Recording (`muse-voice-transcribe-1.0`)
  const handleToggleRecording = useCallback(async () => {
    if (projectState.isRecording) {
      // Stop recording
      speechService.playEarcon('recordStop');
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      } else {
        setProjectState((prev) => ({ ...prev, isRecording: false, isProcessing: true }));
        const { transcript: transcribedCommand } = await metaModelClient.transcribeAudio(
          null,
          'Fix continuity mismatch in Shot 2 using SAM 3.1'
        );
        await handleExecuteVoiceCommand(transcribedCommand);
      }
      return;
    }

    // Start recording
    speechService.stopSpeaking();
    speechService.playEarcon('recordStart');
    setProjectState((prev) => ({
      ...prev,
      isRecording: true,
      statusAnnouncement:
        'Microphone active. Speak your director command or continuity rule now. Press V again to finish.',
    }));

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach((track) => track.stop());
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          setProjectState((prev) => ({ ...prev, isRecording: false, isProcessing: true }));
          const { transcript: transcribed } = await metaModelClient.transcribeAudio(
            blob,
            'Fix continuity mismatch in Shot 2 using SAM 3.1'
          );
          await handleExecuteVoiceCommand(transcribed);
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
      }
    } catch {
      // Fallback for environments without physical mic hardware: keep recording state active until user presses [V]
      mediaRecorderRef.current = null;
    }
  }, [projectState.isRecording, handleExecuteVoiceCommand]);

  // Toggle Animatic Playback (`isPlayingAnimatic`)
  const handleTogglePlayAnimatic = useCallback(() => {
    setProjectState((prev) => {
      const nextPlaying = !prev.isPlayingAnimatic;
      if (nextPlaying) {
        if (currentTimeSeconds >= totalDurationSeconds) setCurrentTimeSeconds(0);
        setViewMode('animatic');
        lastNarratedShotIdInAnimaticRef.current = null;
      } else {
        speechService.stopSpeaking();
      }
      return {
        ...prev,
        isPlayingAnimatic: nextPlaying,
        statusAnnouncement: nextPlaying
          ? 'Playing storyboard animatic with synchronized voice narration.'
          : 'Animatic playback paused.',
      };
    });
  }, [currentTimeSeconds, totalDurationSeconds]);

  // Animatic Timeline Clock Effect
  useEffect(() => {
    if (!projectState.isPlayingAnimatic || projectState.shots.length === 0) return;

    let previous = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setCurrentTimeSeconds((prevTime) => {
        const nextTime = prevTime + delta;
        if (nextTime >= totalDurationSeconds) {
          setProjectState((p) => ({
            ...p,
            isPlayingAnimatic: false,
            statusAnnouncement: 'Animatic sequence playback completed.',
          }));
          return totalDurationSeconds;
        }

        // Determine which shot corresponds to `nextTime`
        let elapsed = 0;
        for (const shot of projectState.shots) {
          if (nextTime >= elapsed && nextTime < elapsed + shot.durationSeconds) {
            if (lastNarratedShotIdInAnimaticRef.current !== shot.id) {
              lastNarratedShotIdInAnimaticRef.current = shot.id;
              setProjectState((p) => ({
                ...p,
                activeShotId: shot.id,
                statusAnnouncement: `Animatic playing Shot ${shot.shotNumber}: ${shot.promptDescription}`,
              }));
              speechService.speak(shot.spokenDescription, true);
            }
            break;
          }
          elapsed += shot.durationSeconds;
        }

        return nextTime;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [projectState.isPlayingAnimatic, projectState.shots, totalDurationSeconds]);

  // Scrub timeline manually
  const handleScrubTime = useCallback(
    (timeSec: number) => {
      const clamped = Math.max(0, Math.min(totalDurationSeconds, timeSec));
      setCurrentTimeSeconds(clamped);
      speechService.playEarcon('scrub');

      let elapsed = 0;
      for (const shot of projectState.shots) {
        if (clamped >= elapsed && (clamped < elapsed + shot.durationSeconds || shot === projectState.shots[projectState.shots.length - 1])) {
          if (projectState.activeShotId !== shot.id) {
            setProjectState((prev) => ({
              ...prev,
              activeShotId: shot.id,
            }));
          }
          break;
        }
        elapsed += shot.durationSeconds;
      }
    },
    [totalDurationSeconds, projectState.shots, projectState.activeShotId]
  );

  // Export Project JSON
  const handleExportProjectJson = useCallback(() => {
    const exportPayload = {
      mode: 'offline-fixture',
      transitionsEnabled: transitionsEnabled && !reducedMotion,
      projectId: projectState.projectId,
      title: projectState.title,
      exportedAt: new Date().toISOString(),
      transcript: projectState.transcript,
      rules: projectState.rules,
      shots: projectState.shots.map((s) => ({
        id: s.id,
        shotNumber: s.shotNumber,
        durationSeconds: s.durationSeconds,
        promptDescription: s.promptDescription,
        spokenDescription: s.spokenDescription,
        status: s.status,
        revisionsCount: s.revisions.length,
        currentImageUrl: s.currentImageUrl,
        mask: s.proposedFix?.mask,
        revisions: s.revisions,
      })),
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectState.projectId}-continuity-report.json`;
    a.click();
    URL.revokeObjectURL(url);
    announceStatus('Exported Framelock storyboard and continuity report JSON.', true);
  }, [projectState, announceStatus, transitionsEnabled, reducedMotion]);

  // Global Keyboard Navigation (WCAG 2.2 AAA Full Keyboard Control)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInputFocused) return;

      const key = e.key.toLowerCase();

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlayAnimatic();
      } else if (key === 'v') {
        e.preventDefault();
        handleToggleRecording();
      } else if (key === 'n' && activeShot) {
        e.preventDefault();
        handleNarrateShot(activeShot);
      } else if (key === 'y' && activeShot) {
        e.preventDefault();
        handleApplyProposedFix(activeShot.id);
      } else if (key === 'm') {
        e.preventDefault();
        setShowSamMaskOverlay((prev) => {
          const next = !prev;
          announceStatus(`SAM 3.1 segmentation overlay ${next ? 'enabled' : 'hidden'}.`, false);
          return next;
        });
      } else if (key === 'a') {
        e.preventDefault();
        handleRunFullAudit();
      } else if (key === 'g') {
        e.preventDefault();
        handleRebuildFromTranscript(true);
      } else if (key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const idx = projectState.shots.findIndex((s) => s.id === projectState.activeShotId);
        const nextIdx = Math.min(projectState.shots.length - 1, idx + 1);
        if (projectState.shots[nextIdx]) {
          handleSelectShot(projectState.shots[nextIdx].id, true);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const idx = projectState.shots.findIndex((s) => s.id === projectState.activeShotId);
        const prevIdx = Math.max(0, idx - 1);
        if (projectState.shots[prevIdx]) {
          handleSelectShot(projectState.shots[prevIdx].id, true);
        }
      } else if (['1', '2', '3', '4'].includes(key)) {
        e.preventDefault();
        const shotIdx = parseInt(key, 10) - 1;
        if (projectState.shots[shotIdx]) {
          handleSelectShot(projectState.shots[shotIdx].id, true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeShot,
    projectState.shots,
    projectState.activeShotId,
    handleTogglePlayAnimatic,
    handleToggleRecording,
    handleNarrateShot,
    handleApplyProposedFix,
    handleRunFullAudit,
    handleRebuildFromTranscript,
    handleSelectShot,
    announceStatus,
  ]);

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    speechService.setMuted(nextMuted);
    setProjectState((prev) => ({
      ...prev,
      statusAnnouncement: nextMuted
        ? 'Spoken synthesis and audio cues muted.'
        : 'Spoken synthesis and audio cues enabled.',
    }));
  };

  return (
    <div className="min-h-screen bg-[#121417] text-white flex flex-col">
      {/* Skip to Main Storyboard Stage Link for Screen Readers */}
      <a
        href="#main-storyboard-workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2.5 focus:bg-[#38BDF8] focus:text-[#121417] focus:font-bold focus:rounded"
      >
        Skip to Main Storyboard Workspace
      </a>

      {/* Strict 3-Zone Top Navigation Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-[#1E232B] border-b-2 border-[#323A46]">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          className="text-xl font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0"
        >
          Framelock
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav
          aria-label="Primary Studio Navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-[#E2E8F0]"
        >
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Storyboard
          </button>
          <button
            type="button"
            onClick={() => setViewMode('animatic')}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Animatic Stage
          </button>
          <button
            type="button"
            onClick={handleRunFullAudit}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Continuity Audit
          </button>
          <button
            type="button"
            onClick={() => setIsShortcutsModalOpen(true)}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Shortcuts [?]
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleTogglePlayAnimatic}
            className="min-h-[44px] px-4 py-2 text-sm font-bold text-[#121417] bg-[#38BDF8] hover:bg-[#7DD3FC] rounded transition-colors whitespace-nowrap shrink-0"
          >
            {projectState.isPlayingAnimatic ? 'Pause Animatic [SPACE]' : 'Play Animatic [SPACE]'}
          </button>
        </div>
      </header>

      {/* Persistent High-Contrast Screen Reader / Voice Status Dock (aria-live="polite") */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="px-6 py-3 bg-[#16191E] border-b-2 border-[#323A46] flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="px-2 py-0.5 bg-[#0F172A] border border-[#38BDF8] rounded text-xs font-mono font-bold text-[#38BDF8] whitespace-nowrap shrink-0">
            ARIA-LIVE STATUS
          </span>
          <p className="font-mono text-sm font-semibold text-white truncate">
            {projectState.statusAnnouncement}
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-[#E2E8F0] shrink-0">
          <span>KEYS:</span>
          <kbd className="px-1.5 py-0.5 bg-[#0F172A] text-[#38BDF8] rounded">[V] Voice</kbd>
          <kbd className="px-1.5 py-0.5 bg-[#0F172A] text-[#38BDF8] rounded">[N] Narrate</kbd>
          <kbd className="px-1.5 py-0.5 bg-[#0F172A] text-[#38BDF8] rounded">[Y] Fix</kbd>
          <kbd className="px-1.5 py-0.5 bg-[#0F172A] text-[#38BDF8] rounded">[←/→] Shot</kbd>
        </div>
      </div>

      {/* Main 3-Column Tactile Studio Workspace */}
      <main
        id="main-storyboard-workspace"
        className="flex-1 w-full max-w-[1600px] mx-auto p-4 md:p-6 flex flex-col xl:flex-row items-stretch gap-6"
      >
        {/* Left Dock: Live Voice Transcript & Continuity Rules */}
        <VoiceTranscriptPanel
          transcript={projectState.transcript}
          isRecording={projectState.isRecording}
          isProcessing={projectState.isProcessing}
          isSpeaking={isSpeaking}
          isMuted={isMuted}
          rules={projectState.rules}
          activePresetId={activePresetId}
          onToggleRecording={handleToggleRecording}
          onTranscriptChange={(newText) =>
            setProjectState((prev) => ({ ...prev, transcript: newText }))
          }
          onRebuildFromTranscript={handleRebuildFromTranscript}
          onSelectPreset={handleSelectPreset}
          onExecuteVoiceCommand={handleExecuteVoiceCommand}
          onAddOrUpdateRule={handleAddOrUpdateRule}
          onToggleMute={handleToggleMute}
        />

        {/* Center Stage: Storyboard Frames Grid / Animatic Monitor + Audio Scrubbing Timeline */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <p className="text-xs font-mono text-[#94A3B8]">OFFLINE FIXTURES / No model API calls / Scores measure local checks, not AI quality</p>
          <StoryboardStage
            currentTimeSeconds={currentTimeSeconds}
            transitionsEnabled={transitionsEnabled}
            onSetTransitionsEnabled={setTransitionsEnabled}
            shots={projectState.shots}
            rules={projectState.rules}
            activeShotId={projectState.activeShotId}
            showSamMaskOverlay={showSamMaskOverlay}
            isPlayingAnimatic={projectState.isPlayingAnimatic}
            viewMode={viewMode}
            onSetViewMode={setViewMode}
            onSelectShot={handleSelectShot}
            onNarrateShot={handleNarrateShot}
            onApplyProposedFix={(shotId) => handleApplyProposedFix(shotId)}
            onRunFullAudit={handleRunFullAudit}
            onToggleSamMaskOverlay={() => setShowSamMaskOverlay((prev) => !prev)}
            onExportProjectJson={handleExportProjectJson}
          />

          <AudioTimeline
            shots={projectState.shots}
            activeShotId={projectState.activeShotId}
            isPlayingAnimatic={projectState.isPlayingAnimatic}
            currentTimeSeconds={currentTimeSeconds}
            totalDurationSeconds={totalDurationSeconds}
            onSelectShot={handleSelectShot}
            onTogglePlayAnimatic={handleTogglePlayAnimatic}
            onScrubTime={handleScrubTime}
          />
        </div>

        {/* Right Dock: Active Shot Continuity & SAM 3.1 Inspector */}
        <ShotInspectorPanel
          activeShot={activeShot}
          showSamMaskOverlay={showSamMaskOverlay}
          isProcessing={projectState.isProcessing}
          modelLogs={modelLogs}
          onToggleSamMaskOverlay={() => setShowSamMaskOverlay((prev) => !prev)}
          onNarrateShot={handleNarrateShot}
          onApplyProposedFix={handleApplyProposedFix}
          onSegmentObjectManual={handleSegmentObjectManual}
          onRevertShotRevision={handleRevertShotRevision}
          onUpdateShotPrompt={handleUpdateShotPrompt}
        />
      </main>

      {/* Accessible Keyboard & Voice Command Reference Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />
    </div>
  );
}
