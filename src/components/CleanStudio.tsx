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
import { speechRecognitionService } from '../services/speechRecognitionService';
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
    [voiceNotice, setVoiceNotice] = useState(false),
    [voiceNoticeText, setVoiceNoticeText] = useState<string | null>(null),
    [isDictating, setIsDictating] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false),
    [focusDirection, setFocusDirection] = useState(false),
    [inspect, setInspect] = useState(false);

  const handleToggleVoiceDictation = () => {
    if (isDictating || speechRecognitionService.isListening()) {
      speechRecognitionService.stopListening();
      setIsDictating(false);
      setVoiceNoticeText('Voice dictation stopped.');
      return;
    }

    setVoiceNoticeText(null);
    if (!speechRecognitionService.isSupported()) {
      setVoiceNoticeText('Web Speech API is unavailable in this browser. Try simulated voice test below.');
      return;
    }

    const started = speechRecognitionService.startListening({
      continuous: true,
      interimResults: true,
      onResult: (text, isFinal) => {
        setCommand(text);
        if (isFinal) {
          setVoiceNoticeText(`Heard: "${text}"`);
        }
      },
      onError: (err) => {
        setIsDictating(false);
        setVoiceNoticeText(err);
      },
      onStateChange: (listening) => {
        setIsDictating(listening);
        if (listening) {
          setVoiceNoticeText('Listening live... speak your direction.');
        }
      },
    });

    if (!started) {
      setVoiceNoticeText('Microphone access could not start. Try simulated voice test.');
    }
  };

  const handleSimulateVoice = (sampleText: string) => {
    setVoiceNoticeText('Simulating voice input stream...');
    void speechRecognitionService.simulateLocalSpeech(sampleText, {
      onResult: (text, isFinal) => {
        setCommand(text);
        if (isFinal) {
          setVoiceNoticeText(`Simulated: "${text}"`);
        }
      },
      onStateChange: (listening) => setIsDictating(listening),
    });
  };
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
                    {voiceNotice && (
                      <p className="inline-notice" role="status">
                        Live transcription is not connected. Your typed direction works locally.
                      </p>
                    )}
                    {voiceNoticeText && (
                      <div className="inline-notice flex items-center justify-between gap-2" role="status">
                        <span>{voiceNoticeText}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-[#38BDF8] hover:text-[#7DD3FC] px-1.5 underline"
                          onClick={() => handleSimulateVoice('I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.')}
                        >
                          Run Sample Dictation
                        </Button>
                      </div>
                    )}
                    <div ref={input} className="creation-composer-slot">
                      <CreationComposer
                        prompt={command}
                        setPrompt={setCommand}
                        isLoading={p.processing}
                        onSubmit={p.onCommand}
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
                  {shot ? (
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
                  <Button
                    size="icon"
                    className="preview-play"
                    onClick={p.onPlay}
                    disabled={!p.shots.length}
                    aria-label={p.playing ? 'Pause preview' : 'Play preview'}
                  >
                    {p.playing ? <Pause size={26} /> : <Play size={26} />}
                  </Button>
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
        onTranscript={(text) => setCommand(text)}
        onType={() => {
          setWorkspace('create');
          setInputMode('describe');
          setVoiceNotice(true);
          setFocusDirection(true);
        }}
      />
    </div>
  );
}
