/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  User, 
  BrainCircuit, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  BookOpen, 
  Send,
  Loader2,
  FileText,
  LogOut,
  History,
  Plus,
  Filter,
  ExternalLink,
  Upload,
  X,
  Target,
  Share,
  Copy,
  Download,
  Layout,
  Command,
  Rocket,
  Cpu,
  Clock,
  Trophy,
  MessageSquareCode,
  Sun,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { jsPDF } from 'jspdf';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  updateDoc,
  doc
} from 'firebase/firestore';
import { auth, signInWithGoogle, db, handleFirestoreError } from './lib/firebase';
import { 
  chatWithAgent,
  analyzeCareer,
  Skill, 
  LearningStep 
} from './lib/gemini';
import { extractTextFromPdf } from './lib/pdf';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isSharedMode, setIsSharedMode] = useState(false);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const [isTyping, setIsTyping] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [theme]);

  const [jd, setJd] = useState('');
  const [jdInputMode, setJdInputMode] = useState<'choice' | 'pdf' | 'text'>('choice');
  const [resume, setResume] = useState('');
  const [resumeInputMode, setResumeInputMode] = useState<'choice' | 'pdf' | 'text'>('choice');
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [parsingProgress, setParsingProgress] = useState(0);
  const [isDraggingResume, setIsDraggingResume] = useState(false);
  const [isDraggingJd, setIsDraggingJd] = useState(false);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedJdFileName, setUploadedJdFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jdFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File, type: 'resume' | 'jd') => {
    // Limit file size to 5MB
    if (file.size > 5 * 1024 * 1024) {
      setAssessmentError("File size exceeds 5MB. Please upload a smaller PDF or paste textual data.");
      return;
    }

    if (file.type !== 'application/pdf') {
      setAssessmentError("Neural Core only accepts PDF formats for analysis at this stage.");
      return;
    }

    setIsParsingPdf(true);
    setParsingProgress(0);
    setAssessmentError(null);
    try {
      const text = await extractTextFromPdf(file, (progress) => {
        setParsingProgress(progress);
      });
      if (!text || text.trim().length === 0) {
        throw new Error("PDF seems empty or consists mainly of non-textual data.");
      }
      
      if (type === 'resume') {
        setResume(text);
        setUploadedFileName(file.name);
        setResumeInputMode('pdf');
      } else {
        setJd(text);
        setUploadedJdFileName(file.name);
        setJdInputMode('pdf');
      }
    } catch (error) {
      console.error(error);
      setAssessmentError("Analysis Interrupted: Could not synthesize text from this PDF. It might be scanned or protected. Please try pasting manually.");
    } finally {
      setIsParsingPdf(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'resume' | 'jd') => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file, type);
  };

  const onDrop = (e: React.DragEvent, type: 'resume' | 'jd') => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file, type);
  };
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string | null>(null);
  
  type Tab = 'overview' | 'skills' | 'interview' | 'learning';
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  
  const [assessment, setAssessment] = useState<{
    id?: string;
    skills: Skill[];
    plan: LearningStep[];
    score: number;
  } | null>(null);
  
  // Conversational state
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [sortByGap, setSortByGap] = useState(false);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  useEffect(() => {
    const authTimeout = setTimeout(() => {
      setIsAuthLoading(false);
    }, 6000); // 6s fallback

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      clearTimeout(authTimeout);
      setUser(u);
      setIsAuthLoading(false);
      
      // Reset state if logging out
      if (!u) {
        setAssessment(null);
        setJd('');
        setJdInputMode('choice');
        setResume('');
        setResumeInputMode('choice');
        setUploadedFileName(null);
        setUploadedJdFileName(null);
        setChatMessages([]);
        setHistory([]);
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(authTimeout);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, 'assessments'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistory(docs);
    });

    return () => unsubscribe();
  }, [user]);

  // Handle Shared Assessment ID from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get('share');
    
    if (shareId) {
      setIsLoading(true);
      setIsSharedMode(true);
      
      const loadShared = async () => {
        try {
          const { getDoc } = await import('firebase/firestore');
          const docRef = doc(db, 'assessments', shareId);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            setAssessment({ id: docSnap.id, ...docSnap.data() } as any);
          } else {
            setAssessmentError("This shared assessment link is invalid or has been removed.");
          }
        } catch (error) {
          console.error("Error loading shared assessment:", error);
          setAssessmentError("Failed to load shared assessment. Please check your connection.");
        } finally {
          setIsLoading(false);
        }
      };
      
      loadShared();
    }
  }, []);

  // Load chat messages when assessment is selected
  useEffect(() => {
    if (!assessment?.id) return;

    const q = query(
      collection(db, 'assessments', assessment.id, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => doc.data() as {role: 'user' | 'assistant', content: string});
      if (messages.length > 0) {
        setChatMessages(messages);
      }
    });

    return () => unsubscribe();
  }, [assessment?.id]);

  const handleAssessment = async () => {
    if (!jd || !resume) return;
    
    const cleanJd = jd.trim();
    const cleanResume = resume.trim();

    if (cleanJd.length < 50 || cleanResume.length < 50) {
      setAssessmentError("One of the documents seems to have very little text. Please ensure the PDF was parsed correctly.");
      return;
    }

    setIsLoading(true);
    setLoadingStage('Analyzing Skill Requirements & Resume Gaps');
    setAssessmentError(null);
    try {
      const { skills: skillsProficiency, plan: learningPlan } = await analyzeCareer(jd, resume);
      
      if (!skillsProficiency || skillsProficiency.length === 0) {
        setAssessmentError("Neural Core failed to evaluate skills. Please ensure the inputs contain relevant technical requirements.");
        setIsLoading(false);
        return;
      }

      setLoadingStage('Initiating Neural Interview Agent');

      const gaps = skillsProficiency.filter(s => s.proficiency < 70);
      
      const averageScore = Math.round(
        skillsProficiency.reduce((acc, curr) => acc + curr.proficiency, 0) / (skillsProficiency.length || 1)
      );

      const initialIntro = `Assessment complete! You have a skill match score of ${averageScore}%. I've identified ${gaps.length} areas for growth. I'm now entering Neural Interview mode to refine your score through conversation.`;
      
      // Get a proactive first question from the agent
      const aiData = await chatWithAgent([{ role: 'user', content: "Please introduce yourself and ask your first interview question based on my profile analysis." }], skillsProficiency, learningPlan);
      const assistantMessage = { role: 'assistant' as const, content: `${initialIntro}\n\n${aiData.message}` };
      
      setChatMessages([assistantMessage]);
      setActiveTab('interview');

      const newAssessment = {
        skills: skillsProficiency,
        plan: learningPlan,
        score: averageScore || 0,
        userId: user ? user.uid : undefined
      };

      if (user) {
        const docRef = await addDoc(collection(db, 'assessments'), {
          ...newAssessment,
          userId: user.uid,
          jd,
          resume,
          createdAt: serverTimestamp()
        });

        // Add initial message to DB
        await addDoc(collection(db, 'assessments', docRef.id, 'messages'), {
          ...assistantMessage,
          createdAt: serverTimestamp()
        });
        
        setAssessment({ id: docRef.id, ...newAssessment });
      } else {
        setAssessment(newAssessment);
      }
    } catch (error) {
      console.error(error);
      if (user) handleFirestoreError(error, 'create', 'assessments');
    } finally {
      setIsLoading(false);
      setLoadingStage(null);
    }
  };

  const handleSendMessage = async () => {
    if (!currentInput.trim()) return;
    
    const userMessage = { role: 'user' as const, content: currentInput };
    const updatedMessages = [...chatMessages, userMessage];
    
    setChatMessages(updatedMessages);
    setCurrentInput('');
    setIsTyping(true);

    try {
      // Get AI response
      const data = await chatWithAgent(updatedMessages, assessment?.skills || [], assessment?.plan || []);
      const assistantMessage = { role: 'assistant' as const, content: data.message };
      
      setChatMessages(prev => [...prev.filter(m => m !== userMessage), userMessage, assistantMessage]);

      // Handle Skill Updates from Chat
      if (data.updates && data.updates.length > 0 && assessment) {
        const updatedSkills = [...assessment.skills];
        let hasChanges = false;

        data.updates.forEach((update: any) => {
          const index = updatedSkills.findIndex(s => s.name === update.skillName);
          if (index !== -1) {
            updatedSkills[index] = {
              ...updatedSkills[index],
              proficiency: update.proficiency,
              resumeNotes: update.reason || updatedSkills[index].resumeNotes,
              isVerified: true
            };
            hasChanges = true;
          }
        });

        if (hasChanges) {
          const newScore = Math.round(updatedSkills.reduce((acc, s) => acc + s.proficiency, 0) / updatedSkills.length);
          const updatedAssessment = {
            ...assessment,
            skills: updatedSkills,
            score: newScore
          };
          
          setAssessment(updatedAssessment);

          // Persist if logged in
          if (user) {
            const assessmentRef = doc(db, 'assessments', assessment.id);
            updateDoc(assessmentRef, {
              skills: updatedSkills,
              score: newScore,
              updatedAt: serverTimestamp()
            }).catch(e => console.error("Chat sync error:", e));
          }
        }
      }

      // If persistent, save to Firestore
      if (assessment?.id && user && user.uid === (assessment as any).userId) {
        try {
          await addDoc(collection(db, 'assessments', assessment.id, 'messages'), {
            ...userMessage,
            createdAt: serverTimestamp()
          });
          
          await addDoc(collection(db, 'assessments', assessment.id, 'messages'), {
            ...assistantMessage,
            createdAt: serverTimestamp()
          });
        } catch (error) {
          console.error("Firestore sync error:", error);
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setAssessmentError("Failed to get response from neural core.");
    } finally {
      setIsTyping(false);
    }
  };

  const handleShare = () => {
    if (!assessment?.id) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?share=${assessment.id}`;
    navigator.clipboard.writeText(shareUrl);
    setShowCopyToast(true);
    setTimeout(() => setShowCopyToast(false), 3000);
  };

  const handleDownloadReport = () => {
    if (!assessment) return;
    
    const doc = new jsPDF();
    const margin = 20;
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setTextColor(0, 240, 255); // #00F0FF
    doc.text("Neural Core Analysis Report", margin, y);
    y += 15;

    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, margin, y);
    y += 15;

    // Proficiency Map
    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text("Proficiency Analysis", margin, y);
    y += 10;

    const pdfGaps = assessment.skills.filter((s: any) => s.proficiency < 70);
    const pdfMatches = assessment.skills.filter((s: any) => s.proficiency >= 70);

    const renderPdfGroup = (skills: any[], title: string) => {
      if (skills.length === 0) return;
      
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text(title, margin, y);
      y += 8;

      skills.forEach((skill: any) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFontSize(10);
        doc.setTextColor(50);
        doc.text(`${skill.name}: ${skill.proficiency}% ${skill.industryBenchmark !== undefined ? `(Industry Average: ${skill.industryBenchmark}%)` : ''}`, margin, y);
        y += 5;
        doc.setFontSize(8);
        doc.setTextColor(100);
        const evidence = doc.splitTextToSize(`Evidence: ${skill.resumeNotes}`, 170);
        doc.text(evidence, margin, y);
        y += (evidence.length * 4);
        if (skill.gapDescription) {
          const gap = doc.splitTextToSize(`Gap: ${skill.gapDescription}`, 170);
          doc.text(gap, margin, y);
          y += (gap.length * 4);
        }
        y += 4;
      });
      y += 5;
    };

    renderPdfGroup(pdfGaps, "CRITICAL GAPS");
    renderPdfGroup(pdfMatches, "STRENGTHS & MATCHES");

    y += 5;
    if (y > 270) { doc.addPage(); y = 20; }

    // Training Roadmap
    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text("Neural Training Roadmap", margin, y);
    y += 10;

    assessment.plan.forEach((step: any, index: number) => {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setTextColor(50);
      doc.text(`${index + 1}. ${step.topic}`, margin, y);
      y += 6;
      doc.setFontSize(9);
      doc.setTextColor(100);
      const desc = doc.splitTextToSize(`Resource: ${step.resource} | Cost: ${step.cost} | Est: ${step.estimate}`, 170);
      doc.text(desc, margin, y);
      y += (desc.length * 5);
      if (step.prerequisites) {
        doc.setFontSize(8);
        doc.setTextColor(150);
        const pre = doc.splitTextToSize(`Prerequisites: ${step.prerequisites}`, 170);
        doc.text(pre, margin, y);
        y += (pre.length * 4);
      }
      y += 6;
    });

    doc.save(`CATALYST_AI_Report_${assessment.id?.substring(0, 8)}.pdf`);
  };

  const handleReset = () => {
    setAssessment(null);
    setJd('');
    setJdInputMode('choice');
    setResume('');
    setUploadedFileName(null);
    setUploadedJdFileName(null);
    setResumeInputMode('choice');
    setChatMessages([]);
    if (isSharedMode) {
      window.history.replaceState({}, '', window.location.pathname);
      setIsSharedMode(false);
    }
  };

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      console.error("Sign in error:", error);
      // Suppress specific errors that are expected or common in popup flows
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        return;
      }
      setAssessmentError("Authentication sequence interrupted. Please check your connection and retry.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, isTyping]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-grid flex items-center justify-center">
        <Loader2 className="w-12 h-12 accent-text animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-grid p-6 md:p-10 flex flex-col font-inter">
      <div className="scanline-effect" />
      
      {/* Background elements */}
      <div className="fixed inset-0 neural-grid opacity-30 pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-transparent via-accent/[0.02] to-transparent pointer-events-none" />

      {/* Header */}
      <header className="flex justify-between items-center z-10 mb-12 relative px-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center border border-accent/20 shadow-[0_0_15px_rgba(var(--accent-rgb),0.2)]">
              <BrainCircuit className="w-5 h-5 accent-text" />
            </div>
            <div>
              <p className="text-[10px] tracking-[0.3em] uppercase opacity-40 font-bold">Neural Protocol / v0.9.4</p>
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-1">CATALYST<span className="opacity-20">_</span>AI</h1>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 glass border-thin rounded-lg hover:text-accent transition-colors"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5 text-accent" /> : <Moon className="w-5 h-5 text-accent" />}
          </button>

          {user ? (
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setShowHistory(!showHistory)}
                className="p-2 glass border-thin rounded-lg hover:accent-text transition-colors relative"
              >
                <History className="w-5 h-5" />
                {history.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                    {history.length}
                  </span>
                )}
              </button>
              <div className="text-right hidden md:block">
                <p className="text-[10px] tracking-[0.4em] uppercase opacity-50">Authorized Agent</p>
                <p className="text-sm font-medium">{user.displayName || user.email}</p>
              </div>
              <button 
                onClick={() => signOut(auth)}
                className="p-2 glass border-thin rounded-lg hover:text-rose-500 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleSignIn}
              disabled={isSigningIn}
              className={`px-6 py-2 rounded-lg flex items-center gap-2 font-bold text-xs uppercase tracking-widest transition-all ${
                isSigningIn 
                  ? 'bg-white/10 text-white/20 cursor-wait' 
                  : 'bg-white text-black hover:bg-accent'
              }`}
            >
              {isSigningIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />}
              {isSigningIn ? 'Authenticating...' : 'Sign In'}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full relative">
        <AnimatePresence>
          {showHistory && user && (
            <motion.div 
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className="fixed right-0 top-0 bottom-0 w-80 glass border-l border-white/10 z-50 p-6 flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xs uppercase tracking-widest font-bold">Assessment History</h3>
                <button onClick={() => setShowHistory(false)} className="opacity-40 hover:opacity-100 transition-opacity">
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-4">
                {history.map((h) => (
                  <button 
                    key={h.id}
                    onClick={() => {
                      setAssessment(h);
                      setJd(h.jd);
                      setJdInputMode(h.jd ? 'text' : 'choice');
                      setResume(h.resume);
                      setUploadedFileName(null);
                      setUploadedJdFileName(null);
                      setResumeInputMode(h.resume ? 'text' : 'choice');
                      setShowHistory(false);
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      assessment?.id === h.id ? 'border-accent bg-accent/5' : 'border-main hover:bg-subtle'
                    }`}
                  >
                    <p className="text-sm font-bold truncate">{h.jd.substring(0, 30)}...</p>
                    <div className="flex justify-between items-center mt-2">
                      <p className="text-[10px] opacity-40 font-mono">
                        {h.createdAt?.toDate().toLocaleDateString()}
                      </p>
                      <p className="text-xs font-bold accent-text">{h.score}%</p>
                    </div>
                  </button>
                ))}
                
                {history.length === 0 && (
                  <div className="text-center py-20 opacity-30">
                    <History className="w-12 h-12 mx-auto mb-4" />
                    <p className="text-xs uppercase tracking-widest font-bold">No history found</p>
                  </div>
                )}
              </div>
              
              <button 
                onClick={handleReset}
                className="mt-6 w-full py-4 border border-main rounded-xl text-[10px] uppercase font-bold tracking-widest hover:bg-accent/5 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> New Assessment
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute -left-20 top-1/2 -translate-y-1/2 huge-display opacity-[0.03] select-none pointer-events-none hidden lg:block vertical-text tracking-[0.5em]">
          NEURAL_SYNAPSE
        </div>

        {!assessment ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-12 xl:gap-20 items-start relative z-10 py-12 px-4"
          >
            <div className="lg:col-span-5 space-y-12 pr-4">
              <div className="space-y-8">
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="inline-flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full"
                >
                  <span className="w-2 h-2 bg-accent rounded-full animate-pulse shadow-[0_0_8px_var(--accent)]" />
                  <p className="text-[10px] uppercase tracking-widest text-accent font-black">Neural Cognitive Core Active</p>
                </motion.div>
                
                <h2 className="huge-display accent-glow text-primary">
                  Map Your <span className="text-accent">Neural</span> Proficiency.
                </h2>
                
                <p className="text-dim text-lg max-w-md font-medium leading-relaxed opacity-80">
                  Transcend basic keyword matching. Catalyst synthesizes your professional DNA against global benchmarks to extract your true technical displacement.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-6 border-thin glass rounded-2xl space-y-3 interactive-glow group transition-all">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-accent/10 transition-colors">
                    <Cpu className="w-5 h-5 opacity-40 group-hover:opacity-100 group-hover:accent-text transition-all" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-widest mb-1">Deep Synthesizer</h4>
                    <p className="text-[10px] text-dim font-medium uppercase tracking-wider leading-tight">Extracts abstract competency from raw documentation</p>
                  </div>
                </div>
                <div className="p-6 border-thin glass rounded-2xl space-y-3 interactive-glow group transition-all">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-accent/10 transition-colors">
                    <Target className="w-5 h-5 opacity-40 group-hover:opacity-100 group-hover:accent-text transition-all" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-widest mb-1">Target Mapping</h4>
                    <p className="text-[10px] text-dim font-medium uppercase tracking-wider leading-tight">Zero-lag alignment with industry standardized roles</p>
                  </div>
                </div>
              </div>
              
              {!user && (
                <button 
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  className={`flex items-center gap-3 px-8 py-5 rounded-2xl transition-all active:scale-95 group font-black uppercase tracking-widest text-xs shadow-2xl ${
                    isSigningIn 
                      ? 'bg-white/10 text-white/20' 
                      : 'bg-white text-black hover:bg-accent'
                  }`}
                >
                  {isSigningIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <User className="w-5 h-5" />} 
                  {isSigningIn ? 'Processing Auth Gateway...' : 'Initiate Secure Sync'}
                  {!isSigningIn && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                </button>
              )}
            </div>

            <div className="lg:col-span-7">
              <div className="glass border-thin p-10 rounded-[2.5rem] relative overflow-hidden group shadow-2xl">
                {/* Visual accents */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent/5 blur-[100px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />

                <div className="relative space-y-10">
                  {/* Step 1: JD */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-subtle p-4 rounded-2xl border-thin">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-main">
                          <span className="text-[10px] font-black text-accent">01</span>
                        </div>
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-dim">Target Protocol (JD)</h3>
                      </div>
                      
                      {jdInputMode !== 'choice' && (
                        <button 
                          onClick={() => {
                            setJd('');
                            setUploadedJdFileName(null);
                            setJdInputMode('choice');
                          }}
                          className="p-2 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors text-white/20"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <AnimatePresence mode="wait">
                      {jdInputMode === 'choice' && (
                        <motion.div 
                          key="jd-choice"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 1.05 }}
                          className="grid grid-cols-2 gap-4"
                        >
                          <button
                            onClick={() => setJdInputMode('pdf')}
                            className="bg-subtle border border-main p-8 rounded-3xl flex flex-col items-center gap-4 hover:border-accent/40 hover:bg-accent/5 transition-all group"
                          >
                            <Upload className="w-6 h-6 opacity-20 group-hover:opacity-100 group-hover:text-accent transition-all" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-dim group-hover:text-primary">Vectorize PDF</span>
                          </button>
                          <button
                            onClick={() => setJdInputMode('text')}
                            className="bg-subtle border border-main p-8 rounded-3xl flex flex-col items-center gap-4 hover:border-accent/40 hover:bg-accent/5 transition-all group"
                          >
                            <FileText className="w-6 h-6 opacity-20 group-hover:opacity-100 group-hover:text-accent transition-all" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-dim group-hover:text-primary">Raw Buffer Input</span>
                          </button>
                        </motion.div>
                      )}

                      {jdInputMode === 'text' && (
                        <motion.div 
                          key="jd-text"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="relative"
                        >
                          <textarea 
                            value={jd}
                            onChange={(e) => setJd(e.target.value)}
                            placeholder="Injection sequence: Paste job description here..."
                            className="w-full h-40 bg-black/40 border border-main rounded-3xl p-6 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent transition-all placeholder:opacity-20 text-white resize-none"
                          />
                        </motion.div>
                      )}

                      {jdInputMode === 'pdf' && (
                        <motion.div 
                          key="jd-pdf"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <div 
                            onClick={() => jdFileInputRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setIsDraggingJd(true); }}
                            onDragLeave={() => setIsDraggingJd(false)}
                            onDrop={(e) => { e.preventDefault(); setIsDraggingJd(false); onDrop(e, 'jd'); }}
                            className={`w-full min-h-[160px] border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-8 transition-all cursor-pointer ${
                              isDraggingJd ? 'border-accent bg-accent/5 shadow-[0_0_30px_rgba(var(--accent-rgb),0.1)]' : 'border-white/5 hover:border-accent/30 hover:bg-white/5'
                            }`}
                          >
                            <input type="file" ref={jdFileInputRef} onChange={(e) => onFileChange(e, 'jd')} accept=".pdf" className="hidden" />
                            {isParsingPdf && jdInputMode === 'pdf' ? (
                                <div className="text-center space-y-4 w-full px-8">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto accent-text" />
                                    <div className="h-1.5 w-full bg-border-color rounded-full overflow-hidden">
                                        <motion.div animate={{ width: `${parsingProgress}%` }} className="h-full bg-accent" />
                                    </div>
                                    <p className="text-[10px] font-black tracking-widest uppercase animate-pulse">Vectorizing Content...</p>
                                </div>
                            ) : uploadedJdFileName ? (
                                <div className="text-center space-y-2">
                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-12 h-12 bg-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-2">
                                        <CheckCircle2 className="w-6 h-6 text-accent" />
                                    </motion.div>
                                    <p className="text-sm font-bold">{uploadedJdFileName}</p>
                                    <p className="text-[10px] uppercase font-black tracking-[0.2em] opacity-40">Ready for Synapse</p>
                                </div>
                            ) : (
                                <div className="text-center space-y-3 group-hover:scale-105 transition-transform">
                                    <Upload className="w-10 h-10 opacity-20 mx-auto" />
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Drop Target Protocol PDF</p>
                                </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Step 2: Resume */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-subtle p-4 rounded-2xl border-thin">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-main">
                          <span className="text-[10px] font-black text-accent">02</span>
                        </div>
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-dim">Neural Blueprint (Resume)</h3>
                      </div>
                      
                      {resumeInputMode !== 'choice' && (
                        <button 
                          onClick={() => {
                            setResume('');
                            setUploadedFileName(null);
                            setResumeInputMode('choice');
                          }}
                          className="p-2 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors text-white/20"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <AnimatePresence mode="wait">
                      {resumeInputMode === 'choice' && (
                        <motion.div 
                          key="resume-choice"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 1.05 }}
                          className="grid grid-cols-2 gap-4"
                        >
                          <button
                            onClick={() => setResumeInputMode('pdf')}
                            className="bg-subtle border border-main p-8 rounded-3xl flex flex-col items-center gap-4 hover:border-accent/40 hover:bg-accent/5 transition-all group"
                          >
                            <Upload className="w-6 h-6 opacity-20 group-hover:opacity-100 group-hover:text-accent transition-all" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-dim group-hover:text-primary">Vectorize PDF</span>
                          </button>
                          <button
                            onClick={() => setResumeInputMode('text')}
                            className="bg-subtle border border-main p-8 rounded-3xl flex flex-col items-center gap-4 hover:border-accent/40 hover:bg-accent/5 transition-all group"
                          >
                            <FileText className="w-6 h-6 opacity-20 group-hover:opacity-100 group-hover:text-accent transition-all" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-dim group-hover:text-primary">Raw Buffer Input</span>
                          </button>
                        </motion.div>
                      )}

                      {resumeInputMode === 'text' && (
                        <motion.div 
                          key="resume-text"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <textarea 
                            value={resume}
                            onChange={(e) => setResume(e.target.value)}
                            placeholder="Injection sequence: Paste professional resume here..."
                            className="w-full h-40 bg-black/40 border border-main rounded-3xl p-6 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent transition-all placeholder:opacity-20 text-white resize-none"
                          />
                        </motion.div>
                      )}

                      {resumeInputMode === 'pdf' && (
                        <motion.div 
                          key="resume-pdf"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <div 
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setIsDraggingResume(true); }}
                            onDragLeave={() => setIsDraggingResume(false)}
                            onDrop={(e) => { e.preventDefault(); setIsDraggingResume(false); onDrop(e, 'resume'); }}
                            className={`w-full min-h-[160px] border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-8 transition-all cursor-pointer ${
                              isDraggingResume ? 'border-accent bg-accent/5 shadow-[0_0_30px_rgba(var(--accent-rgb),0.1)]' : 'border-white/5 hover:border-accent/30 hover:bg-white/5'
                            }`}
                          >
                            <input type="file" ref={fileInputRef} onChange={(e) => onFileChange(e, 'resume')} accept=".pdf" className="hidden" />
                            {isParsingPdf && resumeInputMode === 'pdf' ? (
                                <div className="text-center space-y-4 w-full px-8">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto accent-text" />
                                    <div className="h-1.5 w-full bg-border-color rounded-full overflow-hidden">
                                        <motion.div animate={{ width: `${parsingProgress}%` }} className="h-full bg-accent" />
                                    </div>
                                    <p className="text-[10px] font-black tracking-widest uppercase animate-pulse">Analyzing Biological Record...</p>
                                </div>
                            ) : uploadedFileName ? (
                                <div className="text-center space-y-2">
                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-12 h-12 bg-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-2">
                                        <CheckCircle2 className="w-6 h-6 text-accent" />
                                    </motion.div>
                                    <p className="text-sm font-bold">{uploadedFileName}</p>
                                    <p className="text-[10px] uppercase font-black tracking-[0.2em] opacity-40">Blueprint Loaded</p>
                                </div>
                            ) : (
                                <div className="text-center space-y-3 group-hover:scale-105 transition-transform">
                                    <Upload className="w-10 h-10 opacity-20 mx-auto" />
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Drop Neural Blueprint PDF</p>
                                </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Submission */}
                  <div className="pt-6 space-y-4">
                    {assessmentError && (
                      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl mb-6">
                        <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0" />
                        <p className="text-xs font-semibold text-rose-200">{assessmentError}</p>
                      </motion.div>
                    )}

                    <button 
                      onClick={handleAssessment}
                      disabled={isLoading || !jd.trim() || !resume.trim()}
                      className={`w-full py-6 rounded-3xl flex items-center justify-center gap-3 transition-all relative overflow-hidden group shadow-[0_20px_50px_rgba(0,0,0,0.4)] ${
                        isLoading || !jd.trim() || !resume.trim()
                          ? 'bg-white/5 text-white/20'
                          : 'bg-white text-black hover:bg-accent active:scale-[0.98]'
                      }`}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span className="text-xs uppercase font-black tracking-[0.2em]">Synthesizing Neural Path...</span>
                        </>
                      ) : (
                        <>
                          <Rocket className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                          <span className="text-xs uppercase font-black tracking-[0.2em]">Initiate Deep Analysis</span>
                        </>
                      )}
                    </button>
                    
                    <button
                      onClick={() => {
                        setJd('');
                        setJdInputMode('choice');
                        setResume('');
                        setResumeInputMode('choice');
                        setUploadedFileName(null);
                        setUploadedJdFileName(null);
                        setAssessmentError(null);
                      }}
                      className="w-full py-4 rounded-3xl flex items-center justify-center gap-3 transition-all text-white/40 hover:text-white hover:bg-white/5 text-[10px] uppercase font-black tracking-[0.2em]"
                    >
                      <Plus className="w-4 h-4" /> Reset Inputs
                    </button>
                    
                    {isLoading && loadingStage && (
                      <p className="text-center text-[10px] uppercase tracking-[0.3em] font-black text-accent mt-4 animate-pulse">
                        {loadingStage}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-8 relative z-10 py-4 px-4">
            {/* Copy Toast */}
            <AnimatePresence>
              {showCopyToast && (
                <motion.div 
                  initial={{ opacity: 0, y: 20, x: '-50%' }}
                  animate={{ opacity: 1, y: 0, x: '-50%' }}
                  exit={{ opacity: 0, y: 20, x: '-50%' }}
                  className="fixed bottom-10 left-1/2 z-[100] px-6 py-3 bg-accent text-black font-black text-[10px] uppercase tracking-widest rounded-full shadow-[0_0_30px_rgba(var(--accent-rgb),0.4)] flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Synaptic Link Copied
                </motion.div>
              )}
            </AnimatePresence>

            {/* Header / Stats */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10">
              <div className="space-y-8">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="px-3 py-1 bg-accent/10 border border-accent/20 rounded-full">
                    <p className="text-[10px] uppercase tracking-widest accent-text font-black">
                      {isSharedMode ? 'Extracted Protocol' : 'Neural Career Intelligence'}
                    </p>
                  </div>
                  {assessment.id && (
                    <button 
                      onClick={handleShare}
                      className="flex items-center gap-2 text-[9px] uppercase font-black tracking-widest px-3 py-1 bg-white/5 border border-white/5 rounded-full hover:bg-accent hover:text-black transition-all"
                    >
                      <Share className="w-3 h-3" /> Share Result
                    </button>
                  )}
                  <button 
                    onClick={handleReset}
                    className="flex items-center gap-2 text-[9px] uppercase font-black tracking-widest px-4 py-1 bg-white/10 border border-white/10 rounded-full hover:bg-rose-500 hover:text-white transition-all ml-auto md:ml-0"
                  >
                    <Plus className="w-3 h-3" /> New Analysis
                  </button>
                </div>
                
                <div className="space-y-2">
                  <h2 className="text-6xl font-black tracking-tighter leading-none italic uppercase">Neural Eval<span className="text-accent italic">_</span>01</h2>
                  <p className="text-[10px] text-dim uppercase tracking-[0.5em] font-black opacity-30 mt-4">Interactive Domain Mastery & Gap Synthesis</p>
                </div>
                
                {/* Tab Navigation */}
                <div className="flex items-center gap-1 bg-white/5 backdrop-blur-3xl p-1.5 rounded-2xl border border-white/5 w-fit">
                  {[
                    { id: 'overview', label: 'Overview', icon: Layout },
                    { id: 'skills', label: 'Skill Mesh', icon: BrainCircuit },
                    { id: 'interview', label: 'Interview', icon: MessageSquareCode },
                    { id: 'learning', label: 'Learning Path', icon: BookOpen }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as Tab)}
                      className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[9px] uppercase tracking-[0.2em] font-black transition-all relative ${
                        activeTab === tab.id 
                          ? 'text-black z-10' 
                          : 'text-white/40 hover:text-white'
                      }`}
                    >
                      {activeTab === tab.id && (
                        <motion.div 
                          layoutId="activeTab"
                          className="absolute inset-0 bg-accent rounded-xl -z-10 shadow-[0_0_20px_rgba(var(--accent-rgb),0.4)]"
                          transition={{ type: "spring", bounce: 0.1, duration: 0.5 }}
                        />
                      )}
                      <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? 'text-black' : 'text-accent opacity-40'}`} />
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-16 pt-4 lg:pb-4 border-l border-white/5 pl-10">
                <div className="space-y-1">
                  <p className="text-7xl font-black flex items-baseline accent-glow">
                    {assessment.score}
                    <span className="text-2xl opacity-20 ml-1 font-medium">%</span>
                  </p>
                  <p className="text-[9px] uppercase tracking-[0.3em] opacity-30 font-black">Synaptic Match Rating</p>
                </div>
                <div className="space-y-1">
                  <p className="text-7xl font-black opacity-20">
                    {assessment.skills.filter(s => s.proficiency < 70).length.toString().padStart(2, '0')}
                  </p>
                  <p className="text-[9px] uppercase tracking-[0.3em] opacity-30 font-black">Critical Gaps</p>
                </div>
              </div>
            </div>

            {/* Content Container */}
            <div className="min-h-[500px]">
              <AnimatePresence mode="wait">
                {activeTab === 'overview' && (
                  <motion.div 
                    key="overview"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="grid grid-cols-1 md:grid-cols-3 gap-8"
                  >
                    <div className="md:col-span-2 space-y-8">
                      <div className="glass border-thin p-12 rounded-[3rem] space-y-8 relative overflow-hidden group shadow-2xl">
                        <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity">
                          <Cpu className="w-80 h-80 -mr-24 -mt-24" />
                        </div>
                        
                        <div className="space-y-4">
                          <h3 className="text-4xl font-black tracking-tighter uppercase">Executive Synthesis</h3>
                          <div className="w-20 h-1 bg-accent/20 rounded-full" />
                        </div>
                        
                        <p className="text-dim leading-relaxed text-xl max-w-2xl font-medium">
                          Profile congruence verified at <span className="text-white font-black underline decoration-accent underline-offset-8">{assessment.score}% capacity</span>. 
                          Neural Core detects <span className="text-white font-black">{assessment.skills.length} distinct competence nodes</span> requiring cross-domain validation and has proposed an optimal mitigation sequence.
                        </p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6">
                          <div className="bg-emerald-500/5 border border-emerald-500/10 p-8 rounded-[2rem] flex flex-col justify-between interactive-glow">
                            <div>
                              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-4">
                                <Trophy className="w-5 h-5 text-emerald-500" />
                              </div>
                              <p className="text-[9px] uppercase tracking-[0.3em] text-emerald-500 font-black mb-2">Core Domain Dominance</p>
                              <p className="text-2xl font-black tracking-tight uppercase">
                                {[...assessment.skills].sort((a,b) => b.proficiency - a.proficiency)[0]?.name}
                              </p>
                            </div>
                          </div>
                          <div className="bg-amber-500/5 border border-amber-500/10 p-8 rounded-[2rem] flex flex-col justify-between interactive-glow">
                            <div>
                              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center mb-4">
                                <AlertCircle className="w-5 h-5 text-amber-500" />
                              </div>
                              <p className="text-[9px] uppercase tracking-[0.3em] text-amber-500 font-black mb-2">Primary Evolutionary Gap</p>
                              <p className="text-2xl font-black tracking-tight uppercase">
                                {[...assessment.skills].sort((a,b) => a.proficiency - b.proficiency)[0]?.name}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                        <div className="glass border-thin p-10 rounded-[2.5rem] flex items-center gap-6 interactive-glow">
                          <div className="w-16 h-16 bg-accent/10 border border-accent/20 rounded-2xl flex items-center justify-center shadow-lg">
                            <Target className="w-8 h-8 accent-text" />
                          </div>
                          <div>
                            <p className="text-[9px] opacity-30 uppercase tracking-[0.3em] font-black mb-1">Session Integrity</p>
                            <p className="text-2xl font-black tracking-tight italic">LIVE_DECODE</p>
                          </div>
                        </div>
                        <div className="glass border-thin p-10 rounded-[2.5rem] flex items-center gap-6 interactive-glow">
                          <div className="w-16 h-16 bg-white/5 border border-white/5 rounded-2xl flex items-center justify-center">
                            <Cpu className="w-8 h-8 opacity-40 text-white" />
                          </div>
                          <div>
                            <p className="text-[9px] opacity-30 uppercase tracking-[0.3em] font-black mb-1">Engine Protocol</p>
                            <p className="text-2xl font-black tracking-tight italic">GEMINI_3F</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-8">
                      <div className="glass border-thin p-10 rounded-[3rem] space-y-10 shadow-2xl relative overflow-hidden h-full">
                        <div className="space-y-2">
                          <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-accent mb-6">Pipeline Commands</h3>
                          <div className="w-10 h-0.5 bg-accent/40 mb-10" />
                        </div>
                        
                        <div className="space-y-4">
                          <button 
                            onClick={() => setActiveTab('interview')}
                            className="w-full p-6 bg-accent text-black font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl hover:bg-white transition-all flex items-center justify-between group shadow-[0_20px_40px_rgba(var(--accent-rgb),0.3)] active:scale-95"
                          >
                            Enter Interview Terminal <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                          </button>
                          <button 
                            onClick={() => setActiveTab('learning')}
                            className="w-full p-6 bg-white/5 border border-white/5 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl hover:bg-white hover:text-black transition-all flex items-center justify-between active:scale-95"
                          >
                            Explore Learning Path <ArrowRight className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={handleDownloadReport}
                            className="w-full p-6 bg-black/40 border border-dashed border-white/10 text-white/40 font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl hover:text-accent hover:border-accent transition-all flex items-center justify-between active:scale-95"
                          >
                            Export Neural Report <Download className="w-4 h-4" />
                          </button>
                          
                          <div className="pt-10 mt-10 border-t border-white/5">
                            <button 
                              onClick={handleReset}
                              className="w-full p-4 text-[9px] uppercase tracking-[0.3em] text-dim hover:text-rose-500 transition-colors font-black"
                            >
                              Flush Neural Buffer [Reset]
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'skills' && (
                  <motion.div 
                    key="skills"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-12"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 border-b border-white/5 pb-10">
                      <div>
                        <h3 className="text-4xl font-black tracking-tighter uppercase">Skill Analysis <span className="text-accent underline decoration-accent/20 underline-offset-8">Gap</span></h3>
                        <p className="text-[10px] text-dim font-black uppercase tracking-[0.3em] mt-4 opacity-40">Synthesizing resume evidence & target domain parity</p>
                      </div>
                      <div className="flex gap-4 items-center">
                        <div className="relative w-72 group">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 group-focus-within:opacity-100 transition-opacity" />
                          <input 
                            type="text"
                            value={skillSearchQuery}
                            onChange={(e) => setSkillSearchQuery(e.target.value)}
                            placeholder="FILTER NEURAL NODES..."
                            className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-6 py-4 text-[10px] uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-accent transition-all placeholder:opacity-20 text-white"
                          />
                        </div>
                        <button 
                          onClick={() => setSortByGap(!sortByGap)}
                          className={`text-[9px] uppercase tracking-widest font-black px-6 py-4 rounded-2xl border transition-all flex items-center gap-3 active:scale-95 ${
                            sortByGap ? 'border-accent text-accent bg-accent/10 shadow-[0_0_20px_rgba(var(--accent-rgb),0.2)]' : 'border-white/10 text-white/40 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <Filter className="w-4 h-4" />
                          {sortByGap ? 'Fixating Critical Gaps' : 'Standard Priority'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-20">
                      {(() => {
                        let filtered = [...assessment.skills];
                        if (skillSearchQuery) {
                          filtered = filtered.filter(s => 
                            s.name.toLowerCase().includes(skillSearchQuery.toLowerCase())
                          );
                        }

                        const gapSkills = filtered.filter(s => s.proficiency < 70);
                        const matchedSkills = filtered.filter(s => s.proficiency >= 70);

                        const renderGroup = (skills: any[], title: string, colorClass: string, glowColor: string) => (
                          <div className="space-y-8">
                            <div className="flex items-center gap-6">
                              <div className={`w-2 h-6 rounded-full ${colorClass} shadow-[0_0_15px_${glowColor}]`} />
                              <h3 className="text-[11px] font-black uppercase tracking-[0.5em] opacity-40">{title}</h3>
                              <div className="flex-1 h-px bg-white/5" />
                              <div className="px-4 py-1.5 rounded-full bg-white/5 border border-white/10">
                                <span className="text-[10px] font-black uppercase tracking-widest opacity-60">
                                  {skills.length.toString().padStart(2, '0')} Nodes Detected
                                </span>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                              {skills.map((skill) => (
                                <motion.div 
                                  key={skill.name}
                                  layout
                                  onClick={() => setExpandedSkill(expandedSkill === skill.name ? null : skill.name)}
                                  className={`glass border-thin p-8 rounded-[2.5rem] relative overflow-hidden cursor-pointer hover:bg-white/5 transition-all group shadow-xl ${
                                    expandedSkill === skill.name ? 'ring-2 ring-accent lg:col-span-2' : ''
                                  }`}
                                >
                                  <div className="flex justify-between items-start mb-8">
                                    <div className="flex flex-col gap-3">
                                      <h4 className="font-bold text-2xl tracking-tight group-hover:text-accent transition-colors">{skill.name}</h4>
                                      {skill.isVerified && (
                                        <span className="flex items-center gap-2 w-fit text-[9px] bg-accent/20 text-accent px-3 py-1.5 rounded-full font-black uppercase tracking-[0.1em] shadow-lg shadow-accent/10 border border-accent/20">
                                          <BrainCircuit className="w-3.5 h-3.5" />Verified Node
                                        </span>
                                      )}
                                    </div>
                                    <div className={`p-4 rounded-2xl ${skill.proficiency >= 70 ? 'bg-emerald-500/10 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'bg-amber-500/10 text-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.1)]'}`}>
                                      {skill.proficiency >= 70 ? <CheckCircle2 className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
                                    </div>
                                  </div>

                                  <div className="space-y-2 text-right mb-8">
                                    <p className="text-6xl font-black tracking-tighter leading-none">{skill.proficiency}%</p>
                                    <p className="text-[10px] uppercase tracking-[0.4em] opacity-30 font-black">Neural Displacement</p>
                                  </div>

                                  <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden relative mb-3 p-0.5 border border-white/5">
                                    <motion.div 
                                      initial={{ width: 0 }}
                                      animate={{ width: `${skill.proficiency}%` }}
                                      className={`h-full rounded-full ${skill.proficiency >= 70 ? 'bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.4)]' : 'bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]'}`} 
                                    />
                                    {skill.industryBenchmark !== undefined && (
                                      <div 
                                        className="absolute top-0 w-1.5 h-full bg-accent z-10 shadow-[0_0_15px_var(--accent)]" 
                                        style={{ left: `${skill.industryBenchmark}%` }} 
                                      />
                                    )}
                                  </div>
                                  
                                  <div className="flex justify-between text-[9px] uppercase font-bold opacity-30 tracking-[0.2em] px-1">
                                    <span>Core Baseline</span>
                                    <span>Benchmark_{skill.industryBenchmark}%</span>
                                  </div>

                                  <AnimatePresence>
                                    {expandedSkill === skill.name && (
                                      <motion.div 
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="pt-10 space-y-8"
                                      >
                                        <div className="space-y-3 border-l-2 border-accent pl-6">
                                          <p className="text-[10px] uppercase font-black tracking-[0.3em] text-accent">Analysis Outcome</p>
                                          <p className="text-sm text-dim leading-relaxed font-medium italic">"{skill.resumeNotes}"</p>
                                        </div>
                                        <div className="space-y-3 border-l-2 border-amber-500 pl-6">
                                          <p className="text-[10px] uppercase font-black tracking-[0.3em] text-amber-500">Requirement Gaps</p>
                                          <p className="text-sm text-dim leading-relaxed font-medium">{skill.gapDescription}</p>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </motion.div>
                              ))}
                            </div>
                          </div>
                        );

                        return (
                          <div className="space-y-24">
                            {(gapSkills.length > 0 || !sortByGap) && renderGroup(gapSkills, "Critical Evolutionary Gaps", "bg-amber-500", "rgba(245,158,11,0.5)")}
                            {(matchedSkills.length > 0 || !sortByGap) && renderGroup(matchedSkills, "Verified Neural Assets", "bg-emerald-500", "rgba(16,185,129,0.5)")}
                          </div>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}

                {activeTab === 'interview' && (
                  <motion.div 
                    key="interview"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="h-[800px] flex flex-col gap-8"
                  >
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 glass border-thin p-8 rounded-[2.5rem] backdrop-blur-3xl shadow-2xl relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-full bg-accent/5 -z-10 blur-3xl" />
                      
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-accent border border-accent/20 rounded-[1.5rem] flex items-center justify-center text-black shadow-[0_0_30px_rgba(var(--accent-rgb),0.3)]">
                          <MessageSquareCode className="w-8 h-8" />
                        </div>
                        <div>
                          <h3 className="text-3xl font-black tracking-tighter uppercase italic">Neural_Verify <span className="text-accent underline decoration-accent/20 underline-offset-4">Terminal</span></h3>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                            <p className="text-[10px] uppercase tracking-[0.3em] text-accent font-black">Live Cognitive Validation Active</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-10 items-center px-10 border-l border-white/5 py-2">
                        <div className="text-right">
                          <p className="text-5xl font-black tracking-tighter leading-none italic accent-glow flex items-baseline gap-1">
                            {assessment.score}
                            <span className="text-xl opacity-20 font-medium">%</span>
                          </p>
                          <p className="text-[9px] uppercase tracking-[0.4em] opacity-40 font-black mt-3">Live Parity Status</p>
                        </div>
                        <BrainCircuit className="w-10 h-10 opacity-20 text-accent" />
                      </div>
                    </div>

                    <div className="flex-1 glass border-thin rounded-[3rem] flex flex-col overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.6)] relative bg-black/60">
                      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-accent/20 to-transparent blur-sm" />
                      
                      <div className="flex-1 overflow-y-auto p-12 space-y-12 scroll-smooth custom-scrollbar relative">
                        {/* Internal decorative grid */}
                        <div className="absolute inset-0 neural-grid opacity-[0.03] pointer-events-none" />
                        
                        {chatMessages.map((msg, index) => (
                          <motion.div 
                            initial={{ opacity: 0, y: 20, x: msg.role === 'user' ? 40 : -40 }}
                            animate={{ opacity: 1, y: 0, x: 0 }}
                            key={index} 
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div 
                              className={`max-w-[75%] px-10 py-7 rounded-[2.5rem] text-[16px] leading-relaxed shadow-3xl relative overflow-hidden ${
                                msg.role === 'user' 
                                  ? 'bg-white text-black font-semibold rounded-tr-none' 
                                  : 'bg-subtle/80 backdrop-blur-2xl border border-white/10 text-white rounded-tl-none ring-1 ring-white/5'
                              }`}
                            >
                              <div className={`flex items-center gap-3 mb-5 opacity-40 text-[10px] uppercase font-black tracking-[0.2em] ${msg.role === 'user' ? 'justify-end border-b border-black/10 pb-3' : 'border-b border-white/10 pb-3'}`}>
                                {msg.role === 'assistant' ? <BrainCircuit className="w-4 h-4 text-accent" /> : <User className="w-4 h-4" />}
                                {msg.role === 'assistant' ? 'Neural_Evaluator' : 'Root_User'}
                              </div>
                              <div className={`markdown-body ${msg.role === 'user' ? 'prose-invert italic' : ''}`}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {msg.content}
                                </ReactMarkdown>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                        {isTyping && (
                          <div className="flex justify-start">
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="bg-subtle/40 backdrop-blur-3xl border border-white/5 px-10 py-7 rounded-[2.5rem] rounded-tl-none flex flex-col gap-6 min-w-[350px] shadow-2xl"
                            >
                              <div className="flex items-center gap-5">
                                <div className="flex gap-2">
                                  {[0, 0.2, 0.4].map((delay, i) => (
                                    <motion.div 
                                      key={i}
                                      animate={{ opacity: [0.2, 1, 0.2], y: [0, -4, 0] }}
                                      transition={{ repeat: Infinity, duration: 1.2, delay }}
                                      className="w-2.5 h-2.5 bg-accent rounded-full shadow-[0_0_10px_var(--accent)]" 
                                    />
                                  ))}
                                </div>
                                <span className="text-[11px] uppercase font-black tracking-[0.3em] text-accent italic">Neural Synthesis Output...</span>
                              </div>
                              <div className="h-1.5 w-full bg-accent/5 rounded-full overflow-hidden border border-white/5">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: "100%" }}
                                  transition={{ duration: 8, ease: "linear" }}
                                  className="h-full bg-accent/30 shadow-[0_0_15px_var(--accent)]" 
                                />
                              </div>
                            </motion.div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>

                      <div className="p-10 bg-black/40 backdrop-blur-3xl border-t border-white/5">
                        <form 
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSendMessage();
                          }}
                          className="relative flex items-center gap-6"
                        >
                          <div className="relative flex-1 group">
                            <input 
                              type="text"
                              value={currentInput}
                              onChange={(e) => setCurrentInput(e.target.value)}
                              placeholder="Inject technical response or query..."
                              disabled={isTyping}
                              className="w-full bg-black/40 border border-white/10 rounded-2xl px-10 py-6 text-base font-medium focus:outline-none focus:ring-2 focus:ring-accent transition-all placeholder:opacity-30 text-white disabled:opacity-50 ring-1 ring-white/5 shadow-inner"
                            />
                            <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-20 group-focus-within:opacity-100 transition-opacity">
                              <Command className="w-6 h-6" />
                            </div>
                          </div>
                          <button 
                            type="submit"
                            disabled={isTyping || !currentInput.trim()}
                            className="bg-white text-black p-6 rounded-[1.5rem] hover:bg-accent transition-all disabled:opacity-50 active:scale-95 shadow-[0_20px_40px_rgba(0,0,0,0.4)] group border border-white/10"
                          >
                            <Send className="w-8 h-8 group-hover:translate-x-1.5 group-hover:-translate-y-1 transition-transform" />
                          </button>
                        </form>
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'learning' && (
                  <motion.div 
                    key="learning"
                    initial={{ opacity: 0, x: -40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 40 }}
                    className="space-y-12"
                  >
                      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-main pb-10">
                        <div>
                          <h3 className="text-5xl font-black tracking-tighter italic uppercase underline decoration-accent/20 underline-offset-10 text-primary">Learning <span className="text-accent underline decoration-accent underline-offset-10 italic">Path</span></h3>
                          <p className="text-[11px] text-dim font-black uppercase tracking-[0.4em] mt-5 italic opacity-40">Personalized strategic intelligence to close skill gaps</p>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                              <p className="text-[10px] uppercase font-black tracking-widest text-dim mb-1">Training Protocol</p>
                              <p className="text-2xl font-black tracking-widest uppercase text-primary">L_PATH_01</p>
                          </div>
                          <BookOpen className="w-14 h-14 text-accent opacity-20" />
                        </div>
                      </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                      {assessment.plan.map((step, idx) => (
                        <motion.div 
                          initial={{ opacity: 0, y: 30 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          key={idx} 
                          className="glass border-thin p-12 rounded-[3.5rem] space-y-8 hover:border-accent/50 transition-all group flex flex-col justify-between shadow-2xl relative overflow-hidden"
                        >
                          <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:opacity-[0.08] transition-all group-hover:scale-110">
                            <ArrowRight className="w-40 h-40 -mr-16 -mt-16" />
                          </div>
                          
                          <div className="space-y-8 relative">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <span className="text-[12px] font-black font-mono text-accent uppercase tracking-[0.3em]">Phase_0{idx + 1}</span>
                                <div className="h-4 w-px bg-white/10" />
                                <span className="text-[10px] text-white/30 font-black uppercase tracking-widest">Protocol Sync</span>
                              </div>
                              <div className="flex gap-3">
                                <span className={`px-4 py-1.5 border rounded-full text-[10px] uppercase font-black tracking-widest shadow-xl ${
                                    step.cost === 'Free' 
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 shadow-emerald-500/10' 
                                        : 'bg-accent/10 border-accent/30 text-accent shadow-accent/10'
                                }`}>
                                  {step.cost === 'Free' ? 'Open_Node' : 'LOCKED_ASSET'}
                                </span>
                              </div>
                            </div>
                            
                            <h4 className="text-3xl font-bold tracking-tight group-hover:text-accent transition-all leading-tight italic pr-10">{step.topic}</h4>
                            
                            <div className="space-y-6">
                              <div className="flex items-start gap-5 p-6 bg-white/5 border border-white/5 rounded-3xl group-hover:bg-accent/5 group-hover:border-accent/10 transition-all">
                                <div className="w-14 h-14 bg-black/40 border border-white/5 rounded-2xl flex items-center justify-center flex-shrink-0 group-hover:border-accent/40 shadow-inner">
                                  <BookOpen className="w-7 h-7 text-accent" />
                                </div>
                                <div className="space-y-1.5">
                                  <p className="text-base font-black tracking-tight leading-tight">{step.resource}</p>
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-3.5 h-3.5 opacity-30" />
                                    <p className="text-[11px] text-dim uppercase tracking-widest font-black opacity-60 italic">{step.estimate} Neural Allocation</p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-6 border-l-4 border-accent/20 pl-8 py-2">
                                <div className="space-y-2">
                                  <p className="text-[10px] uppercase font-black tracking-[0.3em] text-accent opacity-50">Pre-requisite_State</p>
                                  <p className="text-sm text-dim font-bold tracking-tight">{step.prerequisites || 'Direct access authorized'}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <a 
                            href={step.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="mt-12 flex items-center justify-between p-7 bg-white/5 border border-white/10 rounded-2xl hover:bg-white hover:text-black transition-all group/btn shadow-xl ring-1 ring-white/5"
                          >
                            <span className="text-[11px] uppercase font-black tracking-[0.4em]">Execute Neural Transfer</span>
                            <ExternalLink className="w-6 h-6 group-hover/btn:translate-x-1.5 group-hover/btn:-translate-y-1.5 transition-transform" />
                          </a>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </div>
        )}
      </main>

      {/* Architecture Info Section (Req 04) - Hidden if assessment active to focus UI */}
      {!assessment && (
        <section className="max-w-7xl mx-auto w-full mt-20 mb-10 px-4 md:px-0">
            <div className="glass border-thin p-10 rounded-3xl space-y-8">
            <div className="space-y-4">
                <h2 className="text-3xl font-bold tracking-tighter">AI Architecture & Scoring Logic</h2>
                <p className="text-dim max-w-3xl">
                Catalyst utilizes a multi-phase neural assessment engine powered by Gemini 3 Flash. 
                </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="space-y-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                    <Search className="w-5 h-5 text-emerald-500" />
                </div>
                <h3 className="font-bold text-sm uppercase tracking-wider">01. JD Extraction</h3>
                <p className="text-xs opacity-50 leading-relaxed">
                    The JD is processed to extract absolute technical requirements using structured JSON schemas, ensuring zero-loss requirement mapping.
                </p>
                </div>
                <div className="space-y-3">
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
                    <BrainCircuit className="w-5 h-5 accent-text" />
                </div>
                <h3 className="font-bold text-sm uppercase tracking-wider">02. Semantic Score</h3>
                <p className="text-xs opacity-50 leading-relaxed">
                    Resumes are semantically mapped against extracted skills using a deterministic Bayesian scoring rubric. We now compare results against real industry benchmarks and provide verified learning resources via live neural search.
                </p>
                </div>
                <div className="space-y-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                    <BookOpen className="w-5 h-5 text-amber-500" />
                </div>
                <h3 className="font-bold text-sm uppercase tracking-wider">03. Synthesis</h3>
                <p className="text-xs opacity-50 leading-relaxed">
                    Identified gaps trigger a secondary generation cycle to curate specific learning resources and realistic time-to-market estimates.
                </p>
                </div>
            </div>
            </div>
        </section>
      )}

      {/* Footer */}
      <footer className="mt-auto grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-main pt-8 pb-4">
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-widest opacity-40 font-bold">Submission Req 01</p>
          <p className="text-xs font-medium">Working Prototype URL</p>
        </div>
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-widest opacity-40 font-bold">Submission Req 02</p>
          <p className="text-xs font-medium">Public Github Repo / README</p>
        </div>
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-widest opacity-40 font-bold">Submission Req 03</p>
          <p className="text-xs font-medium">3–5 Minute Demo Video</p>
        </div>
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-widest opacity-40 font-bold">Submission Req 04</p>
          <p className="text-xs font-medium">Architecture & Logic Diagram</p>
        </div>
      </footer>
    </div>
  );
}

