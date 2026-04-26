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
  ThumbsUp,
  ThumbsDown,
  Filter,
  ExternalLink,
  Upload,
  X,
  Target,
  Share,
  Copy,
  Download,
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
  extractSkillsFromJD, 
  assessSkillProficiency, 
  generateLearningPlan, 
  chatWithAgent,
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
  const [parsingDetails, setParsingDetails] = useState({ current: 0, total: 0 });
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
    setParsingDetails({ current: 0, total: 0 });
    setAssessmentError(null);
    try {
      const text = await extractTextFromPdf(file, (progress, current, total) => {
        setParsingProgress(progress);
        setParsingDetails({ current, total });
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
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
    setIsLoading(true);
    setAssessmentError(null);
    try {
      const skillsList = await extractSkillsFromJD(jd);
      
      if (!skillsList || skillsList.length === 0) {
        setAssessmentError("Neural Core failed to extract skills from the provided Job Description. Please ensure it contains relevant technical requirements.");
        setIsLoading(false);
        return;
      }

      const skillsProficiency = await assessSkillProficiency(resume, skillsList);
      const gaps = skillsProficiency.filter(s => s.proficiency < 70);
      const learningPlan = await generateLearningPlan(gaps);
      
      const averageScore = Math.round(
        skillsProficiency.reduce((acc, curr) => acc + curr.proficiency, 0) / (skillsProficiency.length || 1)
      );

      const newAssessment = {
        skills: skillsProficiency,
        plan: learningPlan,
        score: averageScore || 0,
        userId: user ? user.uid : undefined
      };

      if (user) {
        const docRef = await addDoc(collection(db, 'assessments'), {
          skills: newAssessment.skills,
          plan: newAssessment.plan,
          score: newAssessment.score,
          userId: user.uid,
          jd,
          resume,
          createdAt: serverTimestamp()
        });

        // Add initial message
        const initialMessage = {
          role: 'assistant',
          content: `Assessment complete! You have a skill match score of ${averageScore}%. I've identified ${gaps.length} areas for growth. How can I help you prepare for this role?`,
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'assessments', docRef.id, 'messages'), initialMessage);
        
        setAssessment({ id: docRef.id, ...newAssessment });
      } else {
        setAssessment(newAssessment);
        setChatMessages([
          { 
            role: 'assistant', 
            content: `Assessment complete! You have a skill match score of ${averageScore}%. I've identified ${gaps.length} areas for growth. How can I help you prepare for this role?` 
          }
        ]);
      }
    } catch (error) {
      console.error(error);
      if (user) handleFirestoreError(error, 'create', 'assessments');
    } finally {
      setIsLoading(false);
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
        let updatedSkills = [...assessment.skills];
        let hasChanges = false;

        data.updates.forEach((update: any) => {
          const index = updatedSkills.findIndex(s => s.name === update.skillName);
          if (index !== -1) {
            updatedSkills[index] = {
              ...updatedSkills[index],
              proficiency: update.proficiency,
              resumeNotes: update.reason || updatedSkills[index].resumeNotes
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

  const handleRateStep = async (stepIndex: number, rating: 'helpful' | 'unhelpful') => {
    if (!assessment?.id || !user || user.uid !== (assessment as any).userId) return;

    try {
      const newPlan = assessment.plan.map((step, i) => 
        i === stepIndex ? { ...step, rating } : step
      );
      
      const assessmentRef = doc(db, 'assessments', assessment.id);
      await updateDoc(assessmentRef, { plan: newPlan });
      
      // Local state update happens via onSnapshot listener implicitly if set up correctly, 
      // but we should ensure the assessment state reflects it immediately if needed 
      // or just wait for snapshot. Since we use onSnapshot for history but maybe not for the current active assessment if it was just created.
      // Wait, let's check how current assessment state is managed.
      setAssessment(prev => prev ? { ...prev, plan: newPlan } : prev);
    } catch (error) {
      handleFirestoreError(error, 'update', `assessments/${assessment.id}`);
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
      {/* Header */}
      <header className="flex justify-between items-start z-10 mb-12">
        <div className="space-y-1">
          <p className="text-[10px] tracking-[0.4em] uppercase opacity-50">Catalyst AI / Skill Assessment Agent</p>
          <h1 className="text-4xl font-semibold tracking-tighter">CATALYST:v1</h1>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 glass border-thin rounded-lg hover:accent-text transition-colors"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
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
              onClick={signInWithGoogle}
              className="px-6 py-2 bg-white text-black font-bold text-xs uppercase tracking-widest hover:bg-accent transition-colors rounded-lg flex items-center gap-2"
            >
              <User className="w-4 h-4" /> Sign In
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
                onClick={() => {
                  setAssessment(null);
                  setJd('');
                  setJdInputMode('choice');
                  setResume('');
                  setUploadedFileName(null);
                  setUploadedJdFileName(null);
                  setResumeInputMode('choice');
                  setShowHistory(false);
                }}
                className="mt-6 w-full py-4 border border-main rounded-xl text-[10px] uppercase font-bold tracking-widest hover:bg-accent/5 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> New Assessment
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute -left-20 top-1/2 -translate-y-1/2 huge-text opacity-5 select-none pointer-events-none hidden lg:block">
          ASSESS
        </div>

        {!assessment ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start relative z-10 py-12">
            <div className="space-y-8">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-widest accent-text font-semibold flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4" /> Cognitive Analysis
                </p>
                <h2 className="text-6xl font-extrabold tracking-tighter leading-none">
                  Assess Real <br /> Proficiency.
                </h2>
                <p className="text-dim text-lg max-w-md pt-4">
                  Go beyond claims. Catalyst parses your resume against any job description to map your true capabilities and chart your path forward.
                </p>
                {!user && (
                    <p className="text-accent/60 text-xs font-bold uppercase tracking-widest pt-4">
                        Sign in to save your progress
                    </p>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-dim opacity-60 text-xs uppercase tracking-widest font-bold">
                  <span className="w-8 h-[1px] bg-border-color" /> Hardware Requirements
                </div>
                <div className="flex gap-4">
                  <div className="p-4 border-thin glass rounded-xl flex-1 space-y-2">
                    <Search className="w-5 h-5 opacity-40" />
                    <p className="text-xs font-semibold">JD Analysis</p>
                  </div>
                  <div className="p-4 border-thin glass rounded-xl flex-1 space-y-2">
                    <User className="w-5 h-5 opacity-40" />
                    <p className="text-xs font-semibold">Resume Map</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="glass border-thin p-8 rounded-2xl space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-end ml-1">
                    <label className="text-[10px] uppercase tracking-widest opacity-40 font-bold">Job Description</label>
                    {uploadedJdFileName && (
                      <button 
                        onClick={() => {
                          setUploadedJdFileName(null);
                          setJdInputMode('text');
                        }}
                        className="text-[10px] text-accent hover:opacity-80 flex items-center gap-1 font-bold uppercase tracking-widest mr-3"
                      >
                        <FileText className="w-3 h-3" /> Edit Text
                      </button>
                    )}
                    {jdInputMode !== 'choice' && (
                      <button 
                        onClick={() => {
                          setJd('');
                          setUploadedJdFileName(null);
                          setJdInputMode('choice');
                        }}
                        className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1 font-bold uppercase tracking-widest"
                      >
                        <X className="w-3 h-3" /> Reset Input
                      </button>
                    )}
                  </div>

                  {jdInputMode === 'choice' && (
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setJdInputMode('pdf')}
                        className="flex flex-col items-center justify-center gap-3 p-8 bg-subtle border border-main rounded-xl hover:bg-accent/5 hover:border-accent/30 transition-all group"
                      >
                        <div className="p-3 rounded-full bg-subtle group-hover:bg-accent/20 transition-colors">
                          <Upload className="w-6 h-6 opacity-40 group-hover:opacity-100" />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-widest">Upload PDF</span>
                      </button>
                      <button
                        onClick={() => setJdInputMode('text')}
                        className="flex flex-col items-center justify-center gap-3 p-8 bg-subtle border border-main rounded-xl hover:bg-accent/5 hover:border-accent/30 transition-all group"
                      >
                        <div className="p-3 rounded-full bg-subtle group-hover:bg-accent/20 transition-colors">
                          <FileText className="w-6 h-6 opacity-40 group-hover:opacity-100" />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-widest">Paste Text</span>
                      </button>
                    </div>
                  )}

                  {jdInputMode === 'pdf' && (
                    !uploadedJdFileName ? (
                      <div 
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDraggingJd(true);
                        }}
                        onDragEnter={() => setIsDraggingJd(true)}
                        onDragLeave={() => setIsDraggingJd(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingJd(false);
                          onDrop(e, 'jd');
                        }}
                        className={`relative group cursor-pointer transition-all ${
                          isParsingPdf ? 'opacity-50 pointer-events-none' : ''
                        }`}
                      >
                        <input 
                          type="file" 
                          ref={jdFileInputRef}
                          onChange={(e) => onFileChange(e, 'jd')}
                          accept=".pdf"
                          className="hidden"
                        />
                        <div 
                          onClick={() => jdFileInputRef.current?.click()}
                          className={`w-full bg-subtle border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-all text-center min-h-[160px] ${
                            isDraggingJd ? 'border-accent bg-accent/10' : 'border-main hover:border-accent/50 hover:bg-accent/5 group-hover:bg-accent/5'
                          }`}
                        >
                          {isParsingPdf ? (
                            <div className="w-full space-y-4 px-4">
                              <div className="flex justify-between items-center mb-1">
                                <div className="space-y-0.5">
                                  <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">Mapping Neural Pathways</p>
                                  <p className="text-[8px] font-bold text-accent uppercase tracking-tighter">
                                    Est. {Math.max(0, (parsingDetails.total - parsingDetails.current) * 0.3).toFixed(1)}s remaining
                                  </p>
                                </div>
                                <p className="text-xs font-mono text-accent">{parsingProgress}%</p>
                              </div>
                              <div className="h-1.5 w-full bg-border-color rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${parsingProgress}%` }}
                                  className="h-full bg-accent"
                                />
                              </div>
                              <div className="flex justify-between items-center text-[10px] opacity-60 font-semibold italic animate-pulse">
                                <span>Scanning JD requirements...</span>
                                <span>{parsingDetails.current} / {parsingDetails.total} pages</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className={`p-3 rounded-full transition-colors ${isDraggingJd ? 'bg-accent/30' : 'bg-subtle group-hover:bg-accent/20'}`}>
                                <Upload className={`w-6 h-6 transition-opacity ${isDraggingJd ? 'opacity-100 text-accent' : 'opacity-40 group-hover:opacity-100'}`} />
                              </div>
                              <div className="space-y-1">
                                <p className={`text-sm font-semibold ${isDraggingJd ? 'text-accent' : ''}`}>
                                  {isDraggingJd ? 'Release to Upload JD' : 'Upload JD PDF'}
                                </p>
                                <p className="text-[10px] opacity-40 uppercase tracking-widest font-bold">or drag and drop here</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full bg-subtle border border-main rounded-xl p-6 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center border border-accent/30">
                          <Target className="w-6 h-6 text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate text-accent">{uploadedJdFileName}</p>
                          <p className="text-[10px] opacity-50 uppercase tracking-widest font-bold">JD Vector Successfully Mapped</p>
                        </div>
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      </div>
                    )
                  )}

                  {jdInputMode === 'text' && (
                    <textarea 
                      value={jd}
                      onChange={(e) => setJd(e.target.value)}
                      placeholder="Paste the target Job Description details / role requirements here..."
                      className="w-full bg-subtle border border-main rounded-lg p-4 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-h-[150px] resize-none"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between items-end ml-1">
                    <label className="text-[10px] uppercase tracking-widest opacity-40 font-bold">Resume / CV</label>
                    {(uploadedFileName || resumeInputMode !== 'choice') && (
                      <div className="flex items-center gap-4">
                        {uploadedFileName && (
                          <button 
                            onClick={() => {
                              setUploadedFileName(null);
                              setResumeInputMode('text');
                            }}
                            className="text-[10px] text-accent hover:opacity-80 flex items-center gap-1 font-bold uppercase tracking-widest"
                          >
                            <FileText className="w-3 h-3" /> Edit Text
                          </button>
                        )}
                        <button 
                          onClick={() => {
                            setResume('');
                            setUploadedFileName(null);
                            setResumeInputMode('choice');
                          }}
                          className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1 font-bold uppercase tracking-widest"
                        >
                          <X className="w-3 h-3" /> Reset Input
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {resumeInputMode === 'choice' && (
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setResumeInputMode('pdf')}
                        className="flex flex-col items-center justify-center gap-3 p-8 bg-subtle border border-main rounded-xl hover:bg-accent/5 hover:border-accent/30 transition-all group"
                      >
                        <div className="p-3 rounded-full bg-subtle group-hover:bg-accent/20 transition-colors">
                          <Upload className="w-6 h-6 opacity-40 group-hover:opacity-100" />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-widest">Upload PDF</span>
                      </button>
                      <button
                        onClick={() => setResumeInputMode('text')}
                        className="flex flex-col items-center justify-center gap-3 p-8 bg-subtle border border-main rounded-xl hover:bg-accent/5 hover:border-accent/30 transition-all group"
                      >
                        <div className="p-3 rounded-full bg-subtle group-hover:bg-accent/20 transition-colors">
                          <FileText className="w-6 h-6 opacity-40 group-hover:opacity-100" />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-widest">Paste Text</span>
                      </button>
                    </div>
                  )}

                  {resumeInputMode === 'pdf' && (
                    !uploadedFileName ? (
                      <div 
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDraggingResume(true);
                        }}
                        onDragEnter={() => setIsDraggingResume(true)}
                        onDragLeave={() => setIsDraggingResume(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingResume(false);
                          onDrop(e, 'resume');
                        }}
                        className={`relative group cursor-pointer transition-all ${
                          isParsingPdf ? 'opacity-50 pointer-events-none' : ''
                        }`}
                      >
                        <input 
                          type="file" 
                          ref={fileInputRef}
                          onChange={(e) => onFileChange(e, 'resume')}
                          accept=".pdf"
                          className="hidden"
                        />
                        
                        <div 
                          onClick={() => fileInputRef.current?.click()}
                          className={`w-full bg-subtle border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-all text-center min-h-[160px] ${
                            isDraggingResume ? 'border-accent bg-accent/10' : 'border-main hover:border-accent/50 hover:bg-accent/5 group-hover:bg-accent/5'
                          }`}
                        >
                          {isParsingPdf ? (
                            <div className="w-full space-y-4 px-4">
                              <div className="flex justify-between items-center mb-1">
                                <div className="space-y-0.5">
                                  <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">Deconstructing Resume Vector</p>
                                  <p className="text-[8px] font-bold text-accent uppercase tracking-tighter">
                                    Est. {Math.max(0, (parsingDetails.total - parsingDetails.current) * 0.3).toFixed(1)}s remaining
                                  </p>
                                </div>
                                <p className="text-xs font-mono text-accent">{parsingProgress}%</p>
                              </div>
                              <div className="h-1.5 w-full bg-border-color rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${parsingProgress}%` }}
                                  className="h-full bg-accent"
                                />
                              </div>
                              <div className="flex justify-between items-center text-[10px] opacity-60 font-semibold italic animate-pulse">
                                <span>Synthesizing personal records...</span>
                                <span>{parsingDetails.current} / {parsingDetails.total} pages</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className={`p-3 rounded-full transition-colors ${isDraggingResume ? 'bg-accent/30' : 'bg-subtle group-hover:bg-accent/20'}`}>
                                <Upload className={`w-6 h-6 transition-opacity ${isDraggingResume ? 'opacity-100 text-accent' : 'opacity-40 group-hover:opacity-100'}`} />
                              </div>
                              <div className="space-y-1">
                                <p className={`text-sm font-semibold ${isDraggingResume ? 'text-accent' : ''}`}>
                                  {isDraggingResume ? 'Release to Upload Resume' : 'Upload Resume PDF'}
                                </p>
                                <p className="text-[10px] opacity-40 uppercase tracking-widest font-bold">or drag and drop here</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full bg-subtle border border-main rounded-xl p-6 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center border border-accent/30">
                          <FileText className="w-6 h-6 text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate text-accent">{uploadedFileName}</p>
                          <p className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Securely Cached for Analysis</p>
                        </div>
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      </div>
                    )
                  )}

                  {resumeInputMode === 'text' && (
                    <textarea 
                      value={resume}
                      onChange={(e) => setResume(e.target.value)}
                      placeholder="Paste your professional experience details manually here..."
                      className="w-full bg-subtle border border-main rounded-lg p-4 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-h-[120px] resize-none"
                    />
                  )}
                </div>
              </div>

              {assessmentError && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-lg flex gap-3 items-start"
                >
                  <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-200/80 leading-relaxed font-medium">
                    {assessmentError}
                  </p>
                </motion.div>
              )}

              <button 
                onClick={handleAssessment}
                disabled={isLoading || !jd || !resume}
                className="w-full py-4 bg-white text-black font-bold text-xs uppercase tracking-widest hover:bg-accent transition-colors disabled:opacity-50 disabled:hover:bg-white flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing Neural Map...
                  </>
                ) : (
                  <>
                    Initialize Assessment <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-8 items-start relative z-10 py-4">
            {/* Copy Toast */}
            <AnimatePresence>
              {showCopyToast && (
                <motion.div 
                  initial={{ opacity: 0, y: 20, x: '-50%' }}
                  animate={{ opacity: 1, y: 0, x: '-50%' }}
                  exit={{ opacity: 0, y: 20, x: '-50%' }}
                  className="fixed bottom-10 left-1/2 z-[100] px-6 py-3 bg-accent text-white dark:text-black font-bold text-xs uppercase tracking-widest rounded-full shadow-lg flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Share Link Copied
                </motion.div>
              )}
            </AnimatePresence>

            {/* Left Column: Dashboard */}
            <div className="col-span-12 lg:col-span-7 space-y-8">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <p className="text-xs uppercase tracking-widest accent-text font-semibold">
                      {isSharedMode ? 'Shared Assessment' : 'Assessment Results'}
                    </p>
                    {assessment.id && (
                      <div className="flex gap-2">
                        <button 
                          onClick={handleShare}
                          className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest px-2 py-1 bg-subtle border border-main rounded hover:bg-accent/10 transition-colors"
                          title="Copy shareable link"
                        >
                          <Share className="w-3 h-3 text-accent" /> Share
                        </button>
                        <button 
                          onClick={handleDownloadReport}
                          className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest px-2 py-1 bg-subtle border border-main rounded hover:bg-accent/10 transition-colors"
                          title="Download PDF Report"
                        >
                          <Download className="w-3 h-3 text-accent" /> Report
                        </button>
                      </div>
                    )}
                  </div>
                  <h2 className="text-6xl font-extrabold tracking-tighter leading-none">Proficiency Map</h2>
                </div>
                <div className="flex gap-12 pt-4">
                  <div className="space-y-1">
                    <p className="text-6xl font-bold flex items-baseline">
                      {assessment.score}
                      <span className="text-2xl opacity-50 ml-1">%</span>
                    </p>
                    <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold">Skill Match Score</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-6xl font-bold">
                      {assessment.skills.filter(s => s.proficiency < 70).length.toString().padStart(2, '0')}
                    </p>
                    <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold">Identified Gaps</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-8 mb-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-30" />
                  <input 
                    type="text"
                    value={skillSearchQuery}
                    onChange={(e) => setSkillSearchQuery(e.target.value)}
                    placeholder="Search identified skills..."
                    className="w-full bg-subtle border border-main rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-accent placeholder:opacity-30"
                  />
                  {skillSearchQuery && (
                    <button 
                      onClick={() => setSkillSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => setSortByGap(!sortByGap)}
                  className={`text-[10px] uppercase tracking-widest font-bold px-3 py-2 rounded-lg border transition-all flex items-center gap-2 ${
                    sortByGap ? 'border-accent text-accent bg-accent/10' : 'border-main text-dim hover:text-main'
                  }`}
                >
                  <Filter className="w-3 h-3" />
                  {sortByGap ? 'Prioritizing Critical Gaps' : 'Sort by Critical'}
                </button>
              </div>

              {/* Categorized Skill Matrix */}
              <div className="space-y-12">
                {(() => {
                  let filtered = [...assessment.skills];
                  if (skillSearchQuery) {
                    filtered = filtered.filter(s => 
                      s.name.toLowerCase().includes(skillSearchQuery.toLowerCase())
                    );
                  }

                  const gapSkills = filtered.filter(s => s.proficiency < 70);
                  const matchedSkills = filtered.filter(s => s.proficiency >= 70);

                  const renderGroup = (skills: any[], title: string, status: string, colorClass: string) => (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-1 h-3 rounded-full ${colorClass}`} />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40">{title}</h3>
                        <div className="flex-1 h-px bg-border-color" />
                        <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${colorClass}/20 ${colorClass.replace('bg-', 'text-')}`}>
                          {skills.length} FOUND
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {skills.map((skill, index) => {
                          const isExpanded = expandedSkill === skill.name;
                          return (
                            <motion.div 
                              key={skill.name}
                              layout
                              onClick={() => setExpandedSkill(isExpanded ? null : skill.name)}
                              className={`glass border-thin p-4 rounded-xl space-y-3 relative overflow-hidden cursor-pointer hover:bg-accent/5 transition-all ${
                                isExpanded ? 'col-span-full md:col-span-2 ring-1 ring-main' : ''
                              }`}
                            >
                              <div className="flex justify-between items-start">
                                <p className="font-semibold text-sm">{skill.name}</p>
                                {skill.proficiency >= 70 ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 text-amber-500/50" />
                                )}
                              </div>
                              <div className="space-y-1.5">
                                <div className="h-1.5 w-full bg-border-color rounded-full overflow-hidden relative">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${skill.proficiency}%` }}
                                    className={`h-full ${skill.proficiency >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} 
                                  />
                                  {skill.industryBenchmark !== undefined && (
                                    <div 
                                      className="absolute top-0 w-0.5 h-full bg-accent shadow-[0_0_8px_var(--accent)] z-10"
                                      style={{ left: `${skill.industryBenchmark}%` }}
                                      title={`Industry Benchmark: ${skill.industryBenchmark}%`}
                                    />
                                  )}
                                </div>
                                <div className="flex justify-between items-center text-[10px] opacity-40 font-mono">
                                  <span className="uppercase tracking-widest">
                                    {isExpanded ? 'Analysis Complete' : 'Readiness'}
                                    {skill.industryBenchmark !== undefined && (
                                      <span className="ml-2 text-accent font-bold">(Bench: {skill.industryBenchmark}%)</span>
                                    )}
                                  </span>
                                  <span>{skill.proficiency}% ATTAINED</span>
                                </div>
                              </div>

                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div 
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="pt-4 border-t border-main"
                                  >
                                    <div className="space-y-4">
                                      <div className="space-y-1">
                                        <p className="text-[10px] uppercase font-bold opacity-30">Analysis Outcome</p>
                                        <p className="text-xs text-main opacity-80 leading-relaxed italic">{skill.resumeNotes}</p>
                                      </div>
                                      {skill.gapDescription && (
                                        <div className="space-y-1">
                                          <p className="text-[10px] uppercase font-bold text-amber-500/70">Delta Required</p>
                                          <p className="text-xs text-dim leading-relaxed">{skill.gapDescription}</p>
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
                      </div>
                      {skills.length === 0 && (
                        <p className="text-[10px] opacity-20 italic py-2 text-center">No {title.toLowerCase()} identified in current mapping.</p>
                      )}
                    </div>
                  );

                  return (
                    <>
                      {renderGroup(gapSkills, "Critical Gaps", "GAP", "bg-amber-500")}
                      {renderGroup(matchedSkills, "Matched Assets", "MATCH", "bg-emerald-500")}
                    </>
                  );
                })()}
              </div>

              {/* Chat Assessment */}
              <div className="glass border-thin p-6 rounded-2xl flex flex-col h-[400px]">
                <div className="flex items-center gap-2 mb-4 border-b border-main pb-4">
                  <BrainCircuit className="w-5 h-5 accent-text" />
                  <h3 className="text-xs uppercase tracking-widest font-bold">Conversational Intelligence</h3>
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                        msg.role === 'user' 
                          ? 'bg-accent text-white dark:text-black font-medium' 
                          : 'bg-subtle border border-main text-main'
                      }`}>
                        {msg.role === 'user' ? (
                          msg.content
                        ) : (
                          <div className="markdown-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="bg-subtle border border-main text-main rounded-2xl px-5 py-4 min-w-[240px] space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="flex gap-1">
                            <motion.span 
                              animate={{ opacity: [0.4, 1, 0.4], y: [0, -2, 0] }} 
                              transition={{ repeat: Infinity, duration: 0.8, times: [0, 0.5, 1] }} 
                              className="w-1.5 h-1.5 bg-accent rounded-full" 
                            />
                            <motion.span 
                              animate={{ opacity: [0.4, 1, 0.4], y: [0, -2, 0] }} 
                              transition={{ repeat: Infinity, duration: 0.8, delay: 0.2, times: [0, 0.5, 1] }} 
                              className="w-1.5 h-1.5 bg-accent rounded-full" 
                            />
                            <motion.span 
                              animate={{ opacity: [0.4, 1, 0.4], y: [0, -2, 0] }} 
                              transition={{ repeat: Infinity, duration: 0.8, delay: 0.4, times: [0, 0.5, 1] }} 
                              className="w-1.5 h-1.5 bg-accent rounded-full" 
                            />
                          </div>
                          <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">Neural core analyzing...</p>
                        </div>
                        <div className="space-y-1.5">
                          <div className="h-1 w-full bg-accent/10 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: "100%" }}
                              transition={{ duration: 8, ease: "linear" }}
                              className="h-full bg-accent/30"
                            />
                          </div>
                          <div className="flex justify-between items-center text-[8px] opacity-30 font-bold uppercase tracking-tighter">
                            <span>Vector Search</span>
                            <span>Est. 5-8s</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder={user ? "Ask about a skill..." : "Sign in to chat"}
                    disabled={!user}
                    className="flex-1 bg-subtle border border-main rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                  <button 
                    onClick={handleSendMessage}
                    disabled={!user}
                    className="p-3 bg-white text-black rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Learning Path */}
            <div className="col-span-12 lg:col-span-5 glass border-thin p-8 rounded-2xl space-y-8 sticky top-10">
              <div className="flex items-center justify-between border-b border-main pb-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 accent-text" />
                  <h3 className="text-xs uppercase tracking-widest opacity-60 font-bold">Personalized Learning Path</h3>
                </div>
              </div>

              <div className="space-y-6 max-h-[500px] overflow-y-auto pr-2">
                {assessment.plan.map((step, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    key={i} 
                    className="space-y-2 group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold group-hover:accent-text transition-colors">{step.topic}</p>
                        <div className="flex flex-wrap items-center gap-3 opacity-60 text-[10px]">
                          <div className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            <span>{step.resource}</span>
                          </div>
                          <div className="flex items-center gap-1 text-accent">
                            <span className="font-bold">Cost:</span>
                            <span>{step.cost}</span>
                          </div>
                        </div>
                        {step.prerequisites && (
                          <p className="text-[10px] opacity-40 leading-relaxed italic">
                            <span className="font-bold uppercase tracking-tighter not-italic mr-1">Prereq:</span> 
                            {step.prerequisites}
                          </p>
                        )}
                        {step.url && (
                          <a 
                            href={step.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Access Course
                          </a>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="text-xs font-mono accent-text bg-subtle px-2 py-1 rounded whitespace-nowrap">{step.estimate}</p>
                        {user && (
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => handleRateStep(i, 'helpful')}
                              className={`p-1.5 rounded hover:bg-emerald-500/10 transition-colors ${step.rating === 'helpful' ? 'text-emerald-500' : 'text-dim opacity-30'}`}
                            >
                              <ThumbsUp className="w-3 h-3" />
                            </button>
                            <button 
                              onClick={() => handleRateStep(i, 'unhelpful')}
                              className={`p-1.5 rounded hover:bg-rose-500/10 transition-colors ${step.rating === 'unhelpful' ? 'text-rose-500' : 'text-dim opacity-30'}`}
                            >
                              <ThumbsDown className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
                {assessment.plan.length === 0 && (
                  <div className="text-center py-20 opacity-30">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
                    <p className="text-xs uppercase tracking-widest font-bold">No significant gaps detected</p>
                  </div>
                )}
              </div>

              <div className="pt-8 space-y-4">
                <button 
                  onClick={() => {
                    setAssessment(null);
                    setJd('');
                    setJdInputMode('choice');
                    setResume('');
                    setUploadedFileName(null);
                    setUploadedJdFileName(null);
                    setResumeInputMode('choice');
                    if (isSharedMode) {
                      window.history.replaceState({}, '', window.location.pathname);
                      setIsSharedMode(false);
                    }
                  }}
                  className="w-full py-4 border border-main text-dim font-bold text-xs uppercase tracking-widest hover:bg-accent/5 transition-colors"
                >
                  {isSharedMode ? 'Start Your Own Analysis' : 'New Analysis'}
                </button>
                <div className="text-[10px] text-center opacity-30 uppercase tracking-widest font-bold">
                  Curated via Gemini neural insights
                </div>
              </div>
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

