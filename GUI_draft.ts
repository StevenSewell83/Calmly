import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Home, 
  Calendar, 
  Target, 
  Layers, 
  Settings, 
  Plus, 
  Play, 
  Coffee, 
  HelpCircle,
  CheckCircle2,
  Clock, 
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  X,
  Zap,
  CalendarDays,
  Timer,
  Wind,
  GripVertical,
  Inbox,
  Bell,
  Activity,
  Droplets,
  Pill,
  MoreHorizontal,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  Calendar as CalendarIcon,
  Search,
  Quote,
  Trash2,
  FastForward,
  BrainCircuit,
  Sparkles,
  CalendarCheck,
  SplitSquareVertical,
  MapPin,
  Check,
  CalendarPlus
} from 'lucide-react';

// --- Custom Icon: Using the EXACT SVG paths from LittleThings.svg ---
const MountainClimberIcon = ({ className }) => (
  <svg 
    viewBox="0 0 160 160" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
  >
    {/* Mountain Path */}
    <path 
      d="M26 130L80 34.5L134 130H26Z" 
      stroke="currentColor" 
      strokeWidth="6" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
    />
    {/* Wavy Snow Cap Path */}
    <path 
      d="M60.5 69.5L80 34.5L99.5 69.5C93.5 72.5 87 66 80 72C73 66 66.5 72.5 60.5 69.5Z" 
      fill="currentColor" 
    />
    {/* Climber Group - Scaled and Positioned per original SVG */}
    <g transform="translate(10, 5)">
      <circle cx="48" cy="80" r="5" fill="currentColor" />
      <path d="M48 85V105" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <path d="M62 65V105" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M62 65L82 74L62 83V65Z" fill="currentColor" />
      <path d="M48 90L62 85" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M48 90L38 95" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M48 105L58 112" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <path d="M48 105L40 118" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    </g>
  </svg>
);

// --- Internal Sub-components (Defined above App to ensure scope) ---

const KanbanCard = ({ item, columnId, onDragStart, onDragEnd }) => (
  <div 
    draggable
    onDragStart={(e) => onDragStart(e, item, columnId)}
    onDragEnd={onDragEnd}
    className="group bg-white border border-stone-100 p-5 rounded-[1.8rem] shadow-sm hover:shadow-md hover:border-emerald-200 transition-all cursor-grab active:cursor-grabbing relative"
  >
    <div className="flex items-start justify-between mb-3">
      <h4 className="text-sm leading-snug text-stone-800 font-medium">{item.text}</h4>
      <GripVertical className="w-4 h-4 text-stone-200 opacity-40 group-hover:opacity-100" />
    </div>
    <div className="flex items-center space-x-3 text-[10px] text-stone-400">
       <span className="flex items-center"><CalendarIcon className="w-3 h-3 mr-1" /> {item.dueDate || "No date"}</span>
    </div>
  </div>
);

const KanbanColumn = ({ id, title, icon: Icon, list, tasks, onDrop, onDragStart, onDragEnd, setIsTriageMode, dragOverColumn, setDragOverColumn }) => (
  <div 
    onDragOver={(e) => { e.preventDefault(); setDragOverColumn(id); }}
    onDragLeave={() => setDragOverColumn(null)}
    onDrop={(e) => onDrop(e, id)}
    className={`flex flex-col min-h-0 rounded-[2.5rem] p-3 transition-all duration-500 ${dragOverColumn === id ? 'bg-emerald-50/50 ring-2 ring-emerald-200' : 'bg-transparent'}`}
  >
    <div className="flex items-center justify-between mb-6 px-4 pt-2">
      <div className="flex items-center space-x-2">
        <Icon className={`w-4 h-4 ${id === 'today' ? 'text-emerald-500' : 'text-stone-400'}`} />
        <h3 className="text-xs font-bold tracking-[0.2em] text-stone-500 uppercase">{title}</h3>
      </div>
      {id === 'inbox' && (list && list.length > 0) && (
        <button onClick={() => setIsTriageMode(true)} className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full flex items-center shadow-sm hover:bg-emerald-100 transition-colors">
          <Zap className="w-3 h-3 mr-1 fill-current" /> Triage
        </button>
      )}
    </div>
    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar px-2 space-y-4 pb-20">
      {list && list.map(item => (
        <KanbanCard key={item.id} item={item} columnId={id} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      ))}
      {id === 'inbox' && (
        <button className="w-full py-8 border-2 border-dashed border-stone-100 rounded-[1.8rem] text-stone-300 hover:border-emerald-200 hover:text-emerald-500 transition-all flex flex-col items-center justify-center space-y-1">
          <Plus className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Brain Dump</span>
        </button>
      )}
    </div>
  </div>
);

const HomeView = ({ tasks, onDragStart, onDragEnd, onDrop, setIsTriageMode, dragOverColumn, setDragOverColumn }) => {
  if (!tasks) return null;
  return (
    <div className="h-full flex flex-col px-10 py-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="mb-10">
        <h1 className="text-4xl font-serif text-stone-800 italic">Peace, Alex.</h1>
        <p className="text-stone-400 text-lg font-light tracking-wide">Here is your landscape.</p>
      </header>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-10 pb-40 h-full min-h-0">
          <KanbanColumn 
            id="inbox" title="Inbox" icon={Inbox} list={tasks.inbox || []} 
            onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop} 
            setIsTriageMode={setIsTriageMode} dragOverColumn={dragOverColumn} setDragOverColumn={setDragOverColumn} 
          />
          <KanbanColumn 
            id="today" title="Today" icon={Clock} list={tasks.today || []} 
            onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop} 
            dragOverColumn={dragOverColumn} setDragOverColumn={setDragOverColumn} 
          />
          <KanbanColumn 
            id="week" title="This Week" icon={CalendarDays} list={tasks.week || []} 
            onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop} 
            dragOverColumn={dragOverColumn} setDragOverColumn={setDragOverColumn} 
          />
      </div>
    </div>
  );
};

const SidebarItem = ({ id, icon: Icon, label, activeTab, setActiveTab, isTriageMode, setIsTriageMode, setSelectedProjectId }) => (
  <button
    onClick={() => { setActiveTab(id); setIsTriageMode(false); setSelectedProjectId(null); }}
    className={`group flex items-center justify-between w-full px-4 py-3.5 mb-1 rounded-xl transition-all duration-300 ${
      activeTab === id && !isTriageMode
      ? 'bg-stone-200 text-stone-900 shadow-sm' 
      : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'
    }`}
  >
    <div className="flex items-center">
      <Icon className={`w-5 h-5 mr-3 transition-transform duration-300 ${activeTab === id ? 'scale-110' : 'group-hover:scale-110'}`} />
      <span className="text-sm font-medium tracking-tight">{label}</span>
    </div>
  </button>
);

const App = () => {
  // --- Global State ---
  const [activeTab, setActiveTab] = useState('home');
  const [isTriageMode, setIsTriageMode] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [captureText, setCaptureText] = useState("");
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dragOverColumn, setDragOverColumn] = useState(null);

  // --- ADHD Data Anchors ---
  const quotes = [
    "From little things big things grow.",
    "One thing at a time is enough.",
    "Progress over perfection.",
    "Your focus is your greatest power.",
    "Slow is smooth, smooth is fast.",
    "Start where you are. Use what you have.",
    "The plan shifts. You remain."
  ];

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const quoteTimer = setInterval(() => setQuoteIndex(p => (p + 1) % quotes.length), 8000);
    return () => { clearInterval(timer); clearInterval(quoteTimer); };
  }, []);

  // --- Tasks State ---
  const [tasks, setTasks] = useState({
    inbox: [
      { id: '1', text: "Schedule dentist appointment", type: 'Task', dueDate: 'Tomorrow' },
      { id: '2', text: "Review Q3 growth data", type: 'Task', dueDate: 'Today' },
      { id: '3', text: "Buy a gift for Sarah", type: 'Task', dueDate: 'Mar 15' },
      { id: '4', text: "Research E2EE protocols", type: 'Task', dueDate: null }
    ],
    today: [
      { id: '101', text: "Design LittleThings Prototype", type: 'Task', start: '09:00', duration: 120, dueDate: 'Today', focus: true }
    ],
    week: [
      { id: '201', text: "Quarterly Report Draft", type: 'Task', dueDate: 'Friday' }
    ],
    calendar: [],
    projects: []
  });

  // --- Handlers ---
  const onDragStart = (e, item, sourceColumn) => {
    e.dataTransfer.setData("item", JSON.stringify({ item, sourceColumn }));
    e.currentTarget.style.opacity = "0.5";
  };

  const onDragEnd = (e) => {
    e.currentTarget.style.opacity = "1";
    setDragOverColumn(null);
  };

  const onDrop = (e, targetColumn) => {
    e.preventDefault();
    const dataStr = e.dataTransfer.getData("item");
    if (!dataStr) return;
    const data = JSON.parse(dataStr);
    
    if (data.sourceColumn === targetColumn) {
      setDragOverColumn(null);
      return;
    }

    const sourceList = tasks[data.sourceColumn].filter(i => i.id !== data.item.id);
    const targetList = [{ ...data.item, focus: targetColumn === 'today' && tasks.today.length === 0 }, ...tasks[targetColumn]];
    
    setTasks(prev => ({ ...prev, [data.sourceColumn]: sourceList, [targetColumn]: targetList }));
    setDragOverColumn(null);
  };

  const handleTriageSubmit = (dest) => {
    const currentItem = tasks.inbox[0];
    if (!currentItem) return;

    const newInbox = tasks.inbox.slice(1);
    const finalized = { ...currentItem, dueDate: dest === 'today' ? 'Today' : dest === 'week' ? 'This Week' : null };
    
    if (dest !== 'delete') {
      setTasks(prev => ({ 
        ...prev, 
        inbox: newInbox, 
        [dest]: [finalized, ...(prev[dest] || [])] 
      }));
    } else {
      setTasks(prev => ({ ...prev, inbox: newInbox }));
    }

    if (newInbox.length === 0) setIsTriageMode(false);
  };

  // --- Views ---

  const TriageOverlay = () => {
    const currentItem = tasks.inbox[0];
    if (!currentItem) return null;

    return (
      <div className="fixed inset-0 bg-[#F9F7F2] z-[100] flex flex-col items-center justify-center animate-in slide-in-from-bottom duration-500">
        <header className="w-full max-w-5xl px-12 py-10 flex items-center justify-between">
          <div className="bg-emerald-100 text-emerald-800 px-4 py-2 rounded-full text-[10px] font-bold tracking-[0.2em]">TRIAGE MODE</div>
          <button onClick={() => setIsTriageMode(false)} className="p-4 hover:bg-stone-200 rounded-full text-stone-400"><X /></button>
        </header>
        <div className="flex-1 w-full max-w-4xl flex flex-col justify-center px-12">
          <h2 className="text-5xl font-serif italic text-stone-800 text-center mb-16">{currentItem.text}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl mx-auto">
            {['today', 'week', 'projects', 'delete'].map(dest => (
              <button key={dest} onClick={() => handleTriageSubmit(dest)} className="bg-white border border-stone-100 p-8 rounded-[2.5rem] flex flex-col items-center justify-center transition-all hover:border-emerald-300 hover:shadow-xl group">
                 {dest === 'today' && <Clock className="w-6 h-6 mb-2 text-emerald-500" />}
                 {dest === 'week' && <CalendarDays className="w-6 h-6 mb-2 text-stone-400" />}
                 {dest === 'projects' && <Target className="w-6 h-6 mb-2 text-stone-400" />}
                 {dest === 'delete' && <Trash2 className="w-6 h-6 mb-2 text-rose-300" />}
                 <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400 group-hover:text-stone-800">{dest}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-[#F9F7F2] text-stone-900 font-sans selection:bg-emerald-100 overflow-hidden">
      {isTriageMode && <TriageOverlay />}
      
      {/* Sidebar Navigation */}
      <aside className="w-72 border-r border-stone-200/60 bg-white/50 backdrop-blur-md p-10 flex flex-col shrink-0">
        <div className="flex items-center mb-16 px-2">
          {/* Main Logo - Exact paths from LittleThings.svg integrated here */}
          <div className="w-20 h-20 bg-stone-900 rounded-[2.2rem] mr-5 flex items-center justify-center shadow-2xl shrink-0">
            <MountainClimberIcon className="w-14 h-14 text-white" />
          </div>
          <span className="font-serif italic text-3xl tracking-tighter text-stone-800">LittleThings</span>
        </div>
        <nav className="flex-1 space-y-4">
          <SidebarItem id="home" icon={Home} label="Home" activeTab={activeTab} setActiveTab={setActiveTab} isTriageMode={isTriageMode} setIsTriageMode={setIsTriageMode} setSelectedProjectId={setSelectedProjectId} />
          <SidebarItem id="plan" icon={Calendar} label="Plan" activeTab={activeTab} setActiveTab={setActiveTab} isTriageMode={isTriageMode} setIsTriageMode={setIsTriageMode} setSelectedProjectId={setSelectedProjectId} />
          <SidebarItem id="projects" icon={Target} label="Projects" activeTab={activeTab} setActiveTab={setActiveTab} isTriageMode={isTriageMode} setIsTriageMode={setIsTriageMode} setSelectedProjectId={setSelectedProjectId} />
        </nav>
        <div className="mt-auto border-t border-stone-100 pt-8">
          <SidebarItem id="settings" icon={Settings} label="Settings" activeTab={activeTab} setActiveTab={setActiveTab} isTriageMode={isTriageMode} setIsTriageMode={setIsTriageMode} setSelectedProjectId={setSelectedProjectId} />
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col relative">
        {/* Persistent Capture Header */}
        <div className="w-full h-32 border-b border-stone-100 bg-white/40 backdrop-blur-md flex items-center justify-between px-12 shrink-0 z-40">
           <div className="w-20"><Search className="w-7 h-7 text-stone-300" /></div>
           <div className="flex-1 max-w-4xl relative group px-6">
              <div className="relative">
                <input 
                  type="text" value={captureText} onChange={e => setCaptureText(e.target.value)}
                  placeholder="Capture a thought instantly..."
                  className="w-full bg-stone-100/50 border-b-2 border-stone-200 py-6 px-16 text-2xl font-light focus:outline-none focus:border-emerald-400 transition-all rounded-t-3xl placeholder:text-stone-400 shadow-sm"
                />
                <Plus className="absolute left-6 top-1/2 -translate-y-1/2 w-8 h-8 text-stone-300 group-focus-within:text-emerald-500 transition-colors" />
                <div className="absolute right-6 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-500 uppercase tracking-widest group-focus-within:opacity-0 transition-opacity bg-stone-200/50 px-4 py-2 rounded-xl border border-stone-200 shadow-sm">CMD + K</div>
              </div>
           </div>
           {/* Time Blindness Support Clock */}
           <div className="w-64 flex flex-col items-end pointer-events-none select-none">
              <div className="text-4xl font-serif italic text-stone-800 leading-none mb-1">
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-xs font-bold text-stone-400 uppercase tracking-[0.2em]">
                {currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
           </div>
        </div>

        {/* Workspace Area */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'home' ? (
            <HomeView 
              tasks={tasks} 
              onDragStart={onDragStart} 
              onDragEnd={onDragEnd} 
              onDrop={onDrop} 
              setIsTriageMode={setIsTriageMode} 
              dragOverColumn={dragOverColumn} 
              setDragOverColumn={setDragOverColumn} 
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-stone-200">
              <AlertCircle className="w-24 h-24 mb-6 opacity-20" />
              <p className="text-2xl font-serif italic text-stone-300">Calibrating this view...</p>
              <button onClick={() => setActiveTab('home')} className="mt-8 text-xs font-bold uppercase tracking-widest text-emerald-600 border-b border-emerald-200 pb-1">Return to Landscape</button>
            </div>
          )}
        </div>

        {/* Motivational Banner */}
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 h-20 w-auto min-w-[36rem] max-w-4xl bg-white/70 backdrop-blur-xl border border-stone-100 rounded-full flex items-center justify-center z-50 overflow-hidden shadow-[0_20px_60px_-10px_rgba(0,0,0,0.08)]">
          <div className="relative h-10 w-full flex items-center justify-center">
            {quotes.map((quote, idx) => (
              <div key={idx} className={`absolute transition-all duration-1000 ease-in-out text-2xl font-serif italic text-stone-500 text-center px-16 whitespace-nowrap ${idx === quoteIndex ? 'translate-y-0 opacity-100' : idx === (quoteIndex + 1) % quotes.length ? 'translate-y-20 opacity-0' : '-translate-y-20 opacity-0'}`}>{quote}</div>
            ))}
            <Quote className="absolute left-8 w-8 h-8 text-emerald-300 opacity-60" />
          </div>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E7E5E4; border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #D6D3D1; }
      `}} />
    </div>
  );
};

export default App;