import {SceneDetailsEditor} from './SceneDetailsEditor';
import {DashboardLayout} from './DashboardLayout';
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
  onSaveScene:(id:string,prompt:string,duration:number)=>void;
  storageStatus:string;
  projectId:string; projectTitle:string; projects:{id:string;title:string}[];
  onNewProject:()=>void; onOpenProject:(id:string)=>void; onRenameProject:(title:string)=>void;

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

  useEffect(()=>{setWorkspace('create');setCommand('');setVoiceOpen(false);setInspect(false);},[p.projectId]);
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
    <div className={hasStory ? "clean-studio dark editor-shell" : "clean-studio dark"}>
      <a className="clean-skip" href="#clean-main">
        Skip to workspace
      </a>
      <header className="clean-header">
        <button type="button" onClick={()=>selectWorkspace('create')} aria-label="Go to creation workspace" className="clean-brand">
          <span className="brand-symbol">
            <Square size={18} />
          </span>
          anchorshot<span className="brand-dot">.</span>
        </button>
        <nav className="project-navigation" aria-label="Project navigation">
          <select aria-label="Switch project" value={p.projectId} disabled={p.processing||p.exporting} onChange={event=>p.onOpenProject(event.target.value)}>
            {p.projects.map(project=><option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          {hasStory && <><ChevronRight size={12}/><button onClick={()=>selectWorkspace('create')}>Workspace</button><ChevronRight size={12}/><span aria-current="page">{workspace}</span></>}
        </nav>
        <div className="header-actions">
          <Button variant="outline" size="sm" disabled={p.processing||p.exporting} onClick={p.onNewProject}>New project</Button>
          {hasStory && <details className="project-rename"><summary>Rename</summary><form onSubmit={event=>{event.preventDefault();const title=String(new FormData(event.currentTarget).get('title')||'').trim();if(title)p.onRenameProject(title);event.currentTarget.closest('details')?.removeAttribute('open');}}><input name="title" aria-label="Project name" defaultValue={p.projectTitle} key={p.projectTitle} maxLength={80} required/><Button size="sm" type="submit">Save name</Button></form></details>}

          <span className="local-label">
            <i /> {p.storageStatus}
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
              <Film size={18} aria-hidden="true"/> Create
            </TabsTrigger>
            <TabsTrigger value="dream">
              <Layers size={18} aria-hidden="true"/> Dream
            </TabsTrigger>
            <TabsTrigger value="review" disabled={!hasStory}>
              <Check size={18} aria-hidden="true"/> Review
            </TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" className="shortcut-button" onClick={p.onShortcuts}>
            Keyboard shortcuts <span>?</span>
          </Button>
        </div>
        {hasStory && <div className="editor-actionbar"><div><span className="editor-section-label">{workspace==='create'?'FILM EDITOR':workspace==='dream'?'TRANSITIONS':'CONTINUITY'}</span><h1>{workspace==='create'?'Storyboard':workspace==='dream'?'Dream studio':'Scene review'}</h1></div><div className="editor-context-actions"><span>{p.shots.length} scenes · {p.duration.toFixed(1)}s</span><Button variant="outline" size="sm" onClick={p.onAudit} disabled={p.processing}>Check continuity</Button><Button size="sm" onClick={p.onExport} disabled={p.exporting||p.processing}><Download size={15}/>{p.exporting?'Exporting...':'Export film'}</Button></div></div>}
        <main id="clean-main">
          <TabsContent value="create" forceMount hidden={workspace !== 'create'}>
            <DashboardLayout active={hasStory}>
              <section className="director-column" aria-label="Direct your film">
                {hasStory ? <div className="dashboard-direction-heading"><p className="eyebrow">DIRECTOR</p><h1>Direction</h1><p className="intro-copy">Edit the story with a prompt or your script.</p></div> : <>
                <p className="eyebrow">YOUR DIRECTOR'S CHAIR</p>
                <h1>
                  What would you like to create?
                </h1>
                <p className="intro-copy">
                  A thought, a memory, a whole new world. Start with what you can imagine.
                </p>
                </>}
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
                    <span className="eyebrow">PREVIEW</span>
                    <h2>Scene {shot?.shotNumber ?? 1}</h2>
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
                      onClick={() => {
                        p.onSelect(s.id);
                        if (typeof s.timestamp === 'number') {
                          p.onSeek(s.timestamp);
                        } else {
                          let offset = 0;
                          for (const prev of p.shots) {
                            if (prev.id === s.id) break;
                            offset += prev.durationSeconds;
                          }
                          p.onSeek(offset);
                        }
                      }}
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
              {hasStory && shot && <SceneDetailsEditor key={shot.id} shot={shot} disabled={p.processing||p.playing} onSave={p.onSaveScene}/>}

            </DashboardLayout>
          </TabsContent>
          <TabsContent value="dream" forceMount hidden={workspace !== 'dream'}>
            <DashboardLayout active>
              <section className="workspace-guide"><p className="eyebrow">DREAM</p><h1>Transition setup</h1><p>Choose the worlds, select what stays, then preview the change.</p><ol><li>Select your source images</li><li>Correct each anchor mask</li><li>Preview and verify protection</li><li>Export your transition</li></ol><Button variant="outline" onClick={()=>selectWorkspace('create')}>Back to film</Button></section>
              <section className="tools-surface unified-tools dream-surface" aria-label="Dream editing workspace">{p.projects.map(project=><div key={project.id} hidden={project.id!==p.projectId}><DreamTransitionPanel projectId={project.id} /></div>)}</section>
              <aside className="workspace-guide"><p className="eyebrow">ANCHOR PROTECTION</p><h2>Keep the details that matter.</h2><p>Cup and umbrella use separate masks. Review both selections before applying them.</p><p>Use the local verification report to check protected pixels across the transition.</p><Button variant="outline" onClick={()=>selectWorkspace('review')}>Review your scenes</Button></aside>
            </DashboardLayout>
          </TabsContent>
          <TabsContent value="review" forceMount hidden={workspace !== 'review'}>
            <DashboardLayout active>
              <section className="workspace-guide"><p className="eyebrow">REVIEW</p><h1>Scenes</h1><p>Select a scene to inspect its anchors, corrections and revision history.</p><Button onClick={p.onAudit} disabled={p.processing}>Review sequence<Check size={15}/></Button>
              <div className="review-scene-list">{p.shots.map(scene=><Button key={scene.id} variant="ghost" className="review-scene" aria-pressed={scene.id===shot?.id} onClick={()=>p.onSelect(scene.id)}><img src={scene.currentImageUrl} alt=""/><span>Scene {scene.shotNumber}<small>{scene.status} · {scene.durationSeconds}s</small></span></Button>)}</div></section>
              <section className="tools-surface unified-tools" aria-label="Scene review tools">{workspace==='review' && p.inspector}</section>
              <aside className="workspace-guide"><p className="eyebrow">PROJECT</p><h2>Story &amp; rules</h2><p>Your script and continuity rules guide each scene. Open project controls to change the sequence or edit rules.</p><details className="project-controls"><summary>Project controls</summary><div className="tools-surface unified-tools">{workspace==='review' && p.controls}</div></details><Button variant="outline" onClick={()=>selectWorkspace('create')}>Back to film</Button></aside>
            </DashboardLayout>
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
