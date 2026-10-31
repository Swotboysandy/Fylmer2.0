import { Tabs as BeTabs, TabsList as BeTabsList, TabsTrigger as BeTabsTrigger, TabsContent as BeTabsContent } from './ui/beui-tabs';
import { CreationComposer } from './CreationComposer';
import { VoiceOverlay } from './VoiceOverlay';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Textarea } from './ui/textarea';

import {
  ArrowUpRight,
  ArrowUp,
  Mic,
  Play,
  Pause,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  Film,
  Layers,
  Check,
  Download,
  ChevronRight,
  Square,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { StudioTour } from './StudioTour';
import { DreamTransitionPanel } from './DreamTransitionPanel';
import { SceneTransition } from './SceneTransition';
import { transitionAt } from '../services/sceneTransitions';
import { speechRecognitionService, SpeechRecognitionService } from '../services/speechRecognitionService';
import { orcaTracker } from '../services/orcaTracker';
import type { StoryboardShot } from '../types/framelock';
import './cleanStudio.css';
type Props = {
  shots: StoryboardShot[];
  activeShot: StoryboardShot | null;
  transcript: string;
  processing: boolean;
  playing: boolean;
  time: number;
  duration: number;
  status: string;
  muted: boolean;
  onTranscript: (s: string) => void;
  onGenerate: () => void;
  onCommand: (s: string) => void;
  onSelect: (id: string) => void;
  onPlay: () => void;
  onSeek: (t: number) => void;
  onNarrate: () => void;
  onMute: () => void;
  onExport: () => void;
  exporting: boolean;
  inspector: ReactNode;
  controls: ReactNode;
  onShortcuts: () => void;
  shortcuts: ReactNode;
  onAudit: () => void;
};
export function CleanStudio(p: Props) {
  const [workspace, setWorkspace] = useState('create'),
    [inputMode, setInputMode] = useState('describe'),
    [command, setCommand] = useState(''),
    [voiceNoticeText, setVoiceNoticeText] = useState<string | null>(null),
    [isDictating, setIsDictating] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false),
    [focusDirection, setFocusDirection] = useState(false),
    [inspect, setInspect] = useState(false);

  const handleSimulateVoice = (sampleText: string) => {
    setVoiceNoticeText('Streaming simulated voice...');
    orcaTracker.trackAction('voice', `Started local voice simulation: "${sampleText.slice(0, 40)}..."`);
    void speechRecognitionService.simulateLocalSpeech(sampleText, {
      onResult: (text, isFinal) => {
        setCommand(text);
        p.onTranscript(text);
        if (isFinal) {
          setVoiceNoticeText(`Heard (Local Voice): "${text}"`);
          orcaTracker.trackAction('voice', `Local voice simulation completed: "${text}"`);
        }
      },
      onStateChange: (listening) => setIsDictating(listening),
    });
  };

  const handleToggleVoiceDictation = () => {
    if (isDictating || speechRecognitionService.isListening()) {
      speechRecognitionService.stopListening();
      setIsDictating(false);
      setVoiceNoticeText('Voice dictation stopped.');
      return;
    }

    setVoiceNoticeText(null);
    if (!speechRecognitionService.isSupported() || SpeechRecognitionService.isCloudVoiceUnavailable()) {
      setVoiceNoticeText('Offline mode (Local Voice Stream active).');
      handleSimulateVoice(command.trim() || 'two men travel to space trying to reach mars on the way we got some issues');
      return;
    }

    const started = speechRecognitionService.startListening({
      continuous: true,
      interimResults: true,
      onResult: (text, isFinal) => {
        setCommand(text);
        p.onTranscript(text);
        if (isFinal) {
          setVoiceNoticeText(`Heard: "${text}"`);
        }
      },
      onError: (err) => {
        setIsDictating(false);
        orcaTracker.record('warn', 'voice', `Native speech error: ${err}`);
        if (err.includes('network') || err.includes('unreachable')) {
          SpeechRecognitionService.markCloudVoiceUnavailable();
          setVoiceNoticeText('Browser cloud voice unreachable (Orca/offline). Switched to local voice stream.');
          handleSimulateVoice(command.trim() || 'two men travel to space trying to reach mars on the way we got some issues');
        } else {
          setVoiceNoticeText(err + ' You can type your direction or choose a sample below.');
        }
      },
      onStateChange: (listening) => {
        setIsDictating(listening);
        if (listening) {
          setVoiceNoticeText('Listening live... speak your direction.');
        }
      },
    });

    if (!started) {
      setVoiceNoticeText('Microphone unavailable. Running local voice stream.');
      handleSimulateVoice(command.trim() || 'two men travel to space trying to reach mars on the way we got some issues');
    }
  };

  useEffect(() => {
    const syncListening = () => {
      const active = speechRecognitionService.isListening();
      setIsDictating((prev) => (prev !== active ? active : prev));
    };
    const timer = setInterval(syncListening, 250);
    return () => clearInterval(timer);
  }, []);

  const input = useRef<HTMLDivElement>(null),
    reduced = useReducedMotion();
  useEffect(() => {
    if (!focusDirection || voiceOpen || workspace !== 'create' || inputMode !== 'describe') return;
    const frame = requestAnimationFrame(() => {
      input.current?.querySelector('textarea')?.focus();
      setFocusDirection(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusDirection, voiceOpen, workspace, inputMode]);
  const transition = transitionAt(
    p.shots.map((s) => s.durationSeconds),
    p.time,
    !reduced,
  );
  const hasStory = p.shots.length > 0;
  const shot = p.playing ? p.shots[transition.index] : p.activeShot;
  const selectWorkspace = (value: string) => {
    if (p.playing) p.onPlay();
    setWorkspace(value);
  };

  useEffect(() => {
    if (hasStory) {
      setInspect(true);
    }
  }, [hasStory]);
  return (
    <div className="clean-studio dark">
      <a className="clean-skip" href="#clean-main">
        Skip to workspace
      </a>
      <header className="clean-header">
        <a href="#" className="clean-brand">
          <span className="brand-symbol">
            <Square size={18} />
          </span>
          anchorshot<span className="brand-dot">.</span>
        </a>
        {hasStory && <span className="project-label">
          Untitled film <ChevronRight size={12} /> Workspace
        </span>}
        <div className="header-actions">
          <span className="local-label">
            <i /> Local session
          </span>
          <StudioTour />
          <Button
            variant="ghost"
            size="icon"
            onClick={p.onMute}
            aria-label={p.muted ? 'Enable spoken feedback' : 'Mute spoken feedback'}
          >
            {p.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </Button>
        </div>
      </header>
      <Tabs value={workspace} onValueChange={selectWorkspace}>
        <div className="workspace-nav" hidden={!hasStory}>
          <TabsList aria-label="Workspace">
            <TabsTrigger value="create">
              Create
            </TabsTrigger>
            <TabsTrigger value="dream">
              Dream
            </TabsTrigger>
            <TabsTrigger value="review" disabled={!hasStory}>
              Review
            </TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" className="shortcut-button" onClick={p.onShortcuts}>
            Keyboard shortcuts <span>?</span>
          </Button>
        </div>
        <main id="clean-main">
          <TabsContent value="create" forceMount hidden={workspace !== 'create'}>
            <div className={hasStory ? "creation-grid" : "creation-grid creation-empty"}>
              <section className="director-column" aria-label="Direct your film">
                <p className="eyebrow">YOUR DIRECTOR'S CHAIR</p>
                <h1>
                  What would you
                  <br />
                  like to create?
                </h1>
                <p className="intro-copy">
                  A thought, a memory, a whole new world.
                  <br />
                  Start with what you can imagine.
                </p>
                <BeTabs variant="segment" value={inputMode} onValueChange={setInputMode} className="input-tabs">
                  <BeTabsList aria-label="Story input" wrapperClassName="mx-auto !w-fit">
                    <BeTabsTrigger value="describe">Describe a video</BeTabsTrigger>
                    <BeTabsTrigger value="script">Paste a script</BeTabsTrigger>
                  </BeTabsList>
                  <BeTabsContent value="describe">
                    {p.transcript && (
                      <div className="flex items-center justify-between text-xs text-[#94a3b8] bg-[#0f172a] border border-[#334155] rounded-xl px-3 py-2 mb-2 font-mono" role="status">
                        <span className="truncate max-w-[80%]">Script: <span className="text-[#38bdf8]">"{p.transcript}"</span></span>
                        <span className="text-[10px] text-[#34d399] font-bold shrink-0 ml-2">Synced to Shots</span>
                      </div>
                    )}
                    {voiceNoticeText && (
                      <div className="inline-notice flex flex-col gap-1.5 p-2 rounded-xl bg-[#0f172a] border border-[#334155] mb-2" role="status">
                        <div className="flex items-center justify-between text-xs text-[#cbd5e1]">
                          <span>{voiceNoticeText}</span>
                          <span className="text-[10px] text-[#38bdf8] font-mono shrink-0">100% Offline Mode</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[#1e293b]">
                          <span className="text-[10px] text-[#64748b] shrink-0">Try Voice:</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 text-[11px] text-[#38bdf8] hover:bg-[#1e293b] px-1.5"
                            onClick={() => handleSimulateVoice('two men travel to space trying to reach mars on the way we got some issues')}
                          >
                            Space Mission
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 text-[11px] text-[#38bdf8] hover:bg-[#1e293b] px-1.5"
                            onClick={() => handleSimulateVoice('I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.')}
                          >
                            Kitchen to Ocean
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 text-[11px] text-[#38bdf8] hover:bg-[#1e293b] px-1.5"
                            onClick={() => handleSimulateVoice('I open my bedroom door and step onto the moon, still holding my favorite cup.')}
                          >
                            Moon & Cup
                          </Button>
                        </div>
                      </div>
                    )}
                    <div ref={input} className="creation-composer-slot">
                      <CreationComposer
                        prompt={command}
                        setPrompt={setCommand}
                        isLoading={p.processing}
                        onSubmit={(text) => {
                          p.onCommand(text);
                          setInspect(true);
                        }}
                        onScript={() => setInputMode('script')}
                        hasStory={hasStory}
                        onReview={() => selectWorkspace('review')}
                        onTools={() => setInspect((value) => !value)}
                        onVoice={handleToggleVoiceDictation}
                        isListening={isDictating}
                      />
                    </div>
                    <p className="input-note">Type a direction, or open the voice preview. Storyboards use local sample scenes.</p>
                    {!hasStory && <div className="starter-suggestions" aria-label="Story suggestions">
                      {[
                        ['Kitchen to ocean', 'I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.'],
                        ['A dream in space', 'I open my bedroom door and step onto the moon, still holding my favorite cup.'],
                        ['Rainy city escape', 'I walk through a rainy city under an amber umbrella. The street transforms into a quiet forest; the umbrella stays with me.'],
                        ['Bring a memory to life', 'Turn a memory of a quiet morning with my family into a short film, keeping the familiar objects consistent.'],
                      ].map(([label, idea]) => <Button key={label} variant="outline" size="sm" className="rounded-full"
                        onClick={() => { setCommand(idea); setFocusDirection(true); }}>
                        {label}<ArrowUpRight size={13} aria-hidden="true" />
                      </Button>)}
                    </div>}
                    {hasStory && <div className="direction-suggestions">
                      <Button variant="outline" size="sm" onClick={() => { setCommand(''); p.onCommand('Fix shot 2'); }}>
                        Fix shot 2 <ArrowUpRight size={12} />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setCommand(''); p.onCommand('Narrate the scene'); }}
                      >
                        Describe this scene <ArrowUpRight size={12} />
                      </Button>
                    </div>}
                  </BeTabsContent>
                  <BeTabsContent value="script">
                    <label className="script-label" htmlFor="film-script">
                      Your script
                    </label>
                    <Textarea
                      id="film-script"
                      aria-label="Scene Transcript"
                      className="min-h-64"
                      value={p.transcript}
                      onChange={(e) => p.onTranscript(e.target.value)}
                      rows={12}
                    />
                    <Button
                      className="w-full mt-3"
                      onClick={p.onGenerate}
                      disabled={p.processing || !p.transcript.trim()}
                    >
                      {p.processing ? 'Preparing storyboard...' : 'Create storyboard'}
                      <ArrowUpRight size={16} />
                    </Button>
                    <p className="input-note">
                      Offline sample planner. Your text stays in this session.
                    </p>
                  </BeTabsContent>
                </BeTabs>
              </section>
              {hasStory && <section className="film-column" aria-label="Film preview">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">THE CANVAS</span>
                    <h2>Your story, taking shape.</h2>
                  </div>
                  <span className="sample-badge">Sample storyboard</span>
                </div>
                <div className="preview-frame">
                  {shot?.videoUrl ? (
                    <div className="relative w-full h-full flex items-center justify-center bg-black rounded overflow-hidden">
                      <video
                        key={shot.videoUrl}
                        src={shot.videoUrl}
                        controls
                        autoPlay
                        loop
                        playsInline
                        className="w-full h-full object-contain"
                        aria-label={`Video preview of shot ${shot.shotNumber}: ${shot.promptDescription}`}
                      />
                      <div className="absolute top-2 right-2 px-2 py-0.5 bg-[#10B981] text-black text-[10px] font-bold rounded flex items-center gap-1 shadow">
                        <span>AI VIDEO PREVIEW</span>
                      </div>
                    </div>
                  ) : shot ? (
                    <SceneTransition
                      source={shot.currentImageUrl}
                      destination={
                        p.playing ? p.shots[transition.index + 1]?.currentImageUrl : undefined
                      }
                      mask={shot.proposedFix?.mask?.maskBase64}
                      progress={p.playing ? transition.progress : 0}
                      description={`Preview of shot ${shot.shotNumber}`}
                    />
                  ) : (
                    <div className="preview-empty">Preparing your storyboard...</div>
                  )}
                  <div className="preview-tag">
                    SHOT {String(shot?.shotNumber ?? 1).padStart(2, '0')}{' '}
                    <span>/ {String(p.shots.length).padStart(2, '0')}</span>
                  </div>
                  {!shot?.videoUrl && (
                    <Button
                      size="icon"
                      className="preview-play"
                      onClick={p.onPlay}
                      disabled={!p.shots.length}
                      aria-label={p.playing ? 'Pause preview' : 'Play preview'}
                    >
                      {p.playing ? <Pause size={26} /> : <Play size={26} />}
                    </Button>
                  )}
                </div>
                <div className="preview-transport">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={p.onPlay}
                    disabled={!p.shots.length}
                    aria-label={p.playing ? 'Pause timeline' : 'Play timeline'}
                  >
                    {p.playing ? <Pause size={15} /> : <Play size={15} />}
                  </Button>
                  <output>{p.time.toFixed(1)}s</output>
                  <Slider
                    onKeyDown={event => event.stopPropagation()}
                    ref={node => { node?.querySelector('[role="slider"]')?.setAttribute("aria-label", "Preview time"); }}
                    min={0}
                    max={p.duration || 1}
                    step={0.1}
                    value={[p.time]}
                    onValueChange={([value]) => p.onSeek(value)}
                  />
                  <span>{p.duration.toFixed(1)}s</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Narrate selected shot"
                    onClick={p.onNarrate}
                    disabled={!shot}
                  >
                    <Volume2 size={17} />
                  </Button>
                </div>
                <div className="shots-heading">
                  <span>
                    Storyboard <span className="count-label">{p.shots.length} shots</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setInspect((v) => !v)}
                    aria-expanded={inspect}
                  >
                    <SlidersHorizontal size={14} />
                    {inspect ? 'Close tools' : 'Shot tools'}
                  </Button>
                </div>
                <div className="shot-strip">
                  {p.shots.map((s) => (
                    <Button
                      key={s.id}
                      variant="outline"
                      className={shot?.id === s.id ? 'shot-thumb selected' : 'shot-thumb'}
                      onClick={() => p.onSelect(s.id)}
                      aria-label={`Select shot ${s.shotNumber}`}
                      aria-pressed={shot?.id === s.id}
                    >
                      <img src={s.currentImageUrl} alt="" />
                      <span>
                        <b>{String(s.shotNumber).padStart(2, '0')}</b>
                        {s.durationSeconds}s
                      </span>
                    </Button>
                  ))}
                </div>
                <div className="film-footer">
                  <span>
                    <i /> {p.processing ? 'Working locally...' : 'Ready for your next direction'}
                  </span>
                  <Button disabled={p.exporting || !p.shots.length} onClick={p.onExport}>
                    <Download size={15} />
                    {p.exporting ? 'Exporting...' : 'Export film'}
                  </Button>
                </div>
                {inspect && <div className="tools-surface">{p.inspector}</div>}
              </section>}
            </div>
          </TabsContent>
          <TabsContent value="dream" forceMount hidden={workspace !== 'dream'}>
            <div className="focused-workspace">
              <p className="eyebrow">CHANGE THE WORLD. KEEP YOUR ANCHORS.</p>
              <h1>Some things stay with you.</h1>
              <p className="intro-copy">
                Select your cup and umbrella. Let the kitchen become an ocean.
              </p>
              <div className="tools-surface dream-surface">
                <DreamTransitionPanel />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="review" forceMount hidden={workspace !== 'review'}>
            <div className="focused-workspace">
              <p className="eyebrow">THE DETAILS THAT MATTER</p>
              <h1>Keep your story consistent.</h1>
              <p className="intro-copy">
                Review selected shots, adjust continuity rules, and inspect local results.
              </p>
              <Button onClick={p.onAudit}>
                Review sequence <Check size={15} />
              </Button>
              <div className="review-layout tools-surface">
                {workspace === 'review' && p.controls}
                {workspace === 'review' && p.inspector}
              </div>
            </div>
          </TabsContent>
        </main>
      </Tabs>
      <footer className="workspace-footer" hidden={!hasStory}>
        <span>ANCHORSHOT / LOCAL STUDIO</span>
        <details>
          <summary>Activity</summary>
          <p>
            {p.status}
          </p>
        </details>
        <span>No cloud generation</span>
      </footer>
      <div className="sr-only" role="status" aria-live="polite">
        {p.status}
      </div>
      {p.shortcuts}
      <VoiceOverlay
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
      />
    </div>
  );
}
