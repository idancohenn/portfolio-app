import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut
} from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { 
  Wallet, Plus, Trash2, RefreshCcw, 
  PieChart, X, LogOut, Edit2, AlertCircle,
  BrainCircuit, Sparkles, Activity, TrendingUp
} from 'lucide-react';

// --- Firebase Configuration ---
// וודא שהחלפת את אלו בערכים האמיתיים שלך מה-Firebase Console!
const firebaseConfig = {
  apiKey: "AIzaSyDsTa-TE41vy7JRD0NkwjG77Z6W2JPZuXc",
  authDomain: "myportfolio-tracker.firebaseapp.com",
  projectId: "myportfolio-tracker",
  storageBucket: "myportfolio-tracker.firebasestorage.app",
  messagingSenderId: "213503174907",
  appId: "1:213503174907:web:6f9466a33db39ec968a85e"
};

// --- Gemini AI Configuration ---
// השג מפתח בחינם בכתובת: https://aistudio.google.com/
const geminiApiKey = "AIzaSyDyHv0arWlmi0IlAoA4t5XFS_3yWjOE6ak"; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'portfolio-tracker-pro-v3';

const App = () => {
  const [user, setUser] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [usdRate, setUsdRate] = useState(3.75);
  const [error, setError] = useState(null);
  const [marketData, setMarketData] = useState({});
  
  // AI States
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const [formData, setFormData] = useState({
    symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART'
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(res => res.json())
      .then(data => { if(data?.rates?.ILS) setUsdRate(data.rates.ILS); })
      .catch(() => {});

    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(`שגיאה בהתחברות: ${err.message}`);
    }
  };

  const handleLogout = () => signOut(auth);

  useEffect(() => {
    if (!user) return;
    const holdingsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'holdings');
    const unsubscribe = onSnapshot(holdingsCol, 
      (snapshot) => {
        setHoldings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      (err) => { setError("שגיאה בגישה למסד הנתונים"); }
    );
    return () => unsubscribe();
  }, [user]);

  const fetchMarketPrices = async () => {
    if (holdings.length === 0) return;
    const newMarketData = { ...marketData };
    const uniqueSymbols = Array.from(new Set(holdings.map(h => h.symbol)));

    for (const sym of uniqueSymbols) {
      try {
        const h = holdings.find(item => item.symbol === sym);
        let ticker = sym.toUpperCase();
        if (h.currency === 'ILS' && !ticker.includes('.')) ticker += '.TA';
        
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl);
        const data = await res.json();

        if (data?.chart?.result?.[0]) {
          const result = data.chart.result[0];
          let currentPrice = result.meta.regularMarketPrice;
          if (h.currency === 'ILS') currentPrice /= 100;
          
          newMarketData[sym] = {
            currentPrice,
            dailyChangePct: result.meta.chartPreviousClose ? ((currentPrice - result.meta.chartPreviousClose) / result.meta.chartPreviousClose) * 100 : 0
          };
        }
      } catch (e) {}
    }
    setMarketData(newMarketData);
  };

  useEffect(() => { if (holdings.length > 0) fetchMarketPrices(); }, [holdings.length]);

  const stats = useMemo(() => {
    let totalInvestedILS = 0, currentTotalILS = 0;
    holdings.forEach(h => {
      const isILS = h.currency === 'ILS';
      const avg = isILS ? h.avgPrice / 100 : h.avgPrice;
      const mData = marketData[h.symbol] || { currentPrice: avg };
      
      totalInvestedILS += h.quantity * (isILS ? avg : avg * usdRate);
      currentTotalILS += h.quantity * (isILS ? mData.currentPrice : mData.currentPrice * usdRate);
    });

    return {
      totalILS: currentTotalILS,
      totalUSD: currentTotalILS / usdRate,
      changePct: totalInvestedILS > 0 ? ((currentTotalILS - totalInvestedILS) / totalInvestedILS) * 100 : 0
    };
  }, [holdings, marketData, usdRate]);

  // AI Logic: Ask Gemini
  const askAiAdvisor = async () => {
    if (!geminiApiKey) {
      setError("נא להזין API Key של Gemini בקוד כדי להשתמש בבינה מלאכותית.");
      return;
    }
    
    setIsAiLoading(true);
    setShowAiModal(true);
    setAiResponse("");

    const portfolioSummary = holdings.map(h => {
        const mData = marketData[h.symbol] || { currentPrice: h.avgPrice };
        return `${h.symbol}: ${h.quantity} units, Current Value: ${h.quantity * mData.currentPrice} ${h.currency}`;
    }).join(", ");

    const prompt = `אתה יועץ השקעות מקצועי. זהו תיק ההשקעות שלי: ${portfolioSummary}. 
    אנא נתח את התיק בעברית. התייחס לפיזור נכסים, סיכונים אפשריים, והצע המלצות לשיפור. 
    כתוב בפורמט של נקודות קצרות וברורות. אל תיתן ייעוץ פיננסי מחייב, הוסף דיסקלימר.`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "לא הצלחתי לקבל ניתוח כרגע.";
      setAiResponse(text);
    } catch (err) {
      setAiResponse("שגיאה בחיבור לבינה המלאכותית.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAddHolding = async (e) => {
    e.preventDefault();
    if (!user) return;
    const id = crypto.randomUUID();
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'holdings', id), {
      ...formData,
      quantity: parseFloat(formData.quantity),
      avgPrice: parseFloat(formData.avgPrice),
      updatedAt: new Date().toISOString()
    });
    handleCloseModal();
  };

  const handleDelete = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'holdings', id));
  };

  const handleCloseModal = () => {
    setIsAdding(false);
    setFormData({ symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART' });
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <RefreshCcw className="animate-spin text-blue-500" />
    </div>
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center" dir="rtl">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(37,99,235,0.3)]">
          <Wallet size={40} className="text-white" />
        </div>
        <h1 className="text-4xl font-black text-white mb-4 tracking-tight">MyWealth Pro</h1>
        <p className="text-slate-400 mb-12">התחבר עם גוגל כדי לסנכרן את התיק ולקבל ניתוח AI.</p>
        <button 
          onClick={handleGoogleLogin}
          className="w-full max-w-xs bg-white text-slate-900 font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
          התחבר עם Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-24" dir="rtl">
      <header className="bg-white px-5 py-4 flex items-center justify-between shadow-sm sticky top-0 z-20">
        <div>
          <h1 className="font-black text-xl text-slate-800 tracking-tight">MyWealth</h1>
          <span className="text-[10px] font-bold text-slate-400">שלום, {user.displayName}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><LogOut size={20}/></button>
          <button onClick={() => setIsAdding(true)} className="bg-blue-600 text-white w-10 h-10 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all"><Plus size={22} /></button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-md mx-auto">
        {/* Balance Card */}
        <div className="bg-slate-900 rounded-[32px] p-8 text-white shadow-2xl mb-6 relative overflow-hidden">
           <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl"></div>
           <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2">שווי התיק הכולל</p>
           <h2 className="text-4xl font-black mb-1">₪{stats.totalILS.toLocaleString(undefined, {maximumFractionDigits:0})}</h2>
           <div className="flex items-center gap-2">
              <div className={`flex items-center text-xs font-black ${stats.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {stats.changePct >= 0 ? '+' : ''}{stats.changePct.toFixed(1)}%
              </div>
              <span className="text-slate-500 text-[10px]">סה"כ רווח/הפסד</span>
           </div>

           {/* AI Trigger Button */}
           <button 
             onClick={askAiAdvisor}
             className="mt-6 w-full bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/40 py-3 rounded-2xl flex items-center justify-center gap-2 text-blue-400 text-sm font-bold transition-all"
           >
             <BrainCircuit size={18} />
             קבל ניתוח AI חכם
           </button>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center px-1 mb-2">
            <h3 className="font-black text-lg text-slate-800">האחזקות שלי ({holdings.length})</h3>
            <button onClick={fetchMarketPrices} className="p-2 text-slate-400 active:rotate-180 transition-transform duration-500">
              <RefreshCcw size={16} />
            </button>
          </div>
          
          {holdings.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-[32px] border border-dashed border-slate-200">
              <PieChart size={40} className="mx-auto text-slate-200 mb-4" />
              <p className="text-slate-400 font-bold italic text-sm">התיק שלך ריק עדיין</p>
            </div>
          ) : (
            holdings.map(h => {
              const isILS = h.currency === 'ILS';
              const mData = marketData[h.symbol] || { currentPrice: isILS ? h.avgPrice/100 : h.avgPrice };
              const currentVal = h.quantity * mData.currentPrice;
              
              return (
                <div key={h.id} className="bg-white p-4 rounded-[24px] shadow-sm border border-slate-100 flex items-center justify-between active:scale-[0.98] transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center font-black text-blue-600 shadow-inner text-lg">
                      {h.symbol[0]}
                    </div>
                    <div>
                      <div className="font-black text-slate-800">{h.symbol}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{h.platform}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-left">
                      <div className="font-black text-slate-900">{currentVal.toLocaleString(undefined, {maximumFractionDigits:0})} {isILS ? '₪' : '$'}</div>
                      <div className="text-[9px] font-bold text-slate-400">{h.quantity} יחידות</div>
                    </div>
                    <button onClick={() => handleDelete(h.id)} className="p-2 text-slate-200 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </main>

      {/* AI Advice Modal */}
      {showAiModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[40px] max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="text-blue-600" size={20} />
                <h3 className="font-black text-xl">יועץ ה-AI שלך</h3>
              </div>
              <button onClick={() => setShowAiModal(false)} className="p-2 bg-slate-100 rounded-full"><X size={20}/></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
              {isAiLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Activity className="animate-pulse text-blue-500" size={40} />
                  <p className="text-slate-500 font-bold animate-bounce">מנתח את התיק שלך...</p>
                </div>
              ) : (
                <div className="prose prose-slate text-right" dir="rtl">
                  <div className="whitespace-pre-wrap text-slate-700 leading-relaxed text-sm font-medium">
                    {aiResponse}
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 bg-white rounded-b-[40px]">
              <button 
                onClick={() => setShowAiModal(false)}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-lg"
              >
                הבנתי, תודה!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end">
          <div className="bg-white w-full rounded-t-[40px] p-8 animate-in slide-in-from-bottom-full duration-300 shadow-2xl">
             <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-black text-slate-800">הוספת נכס לתיק</h3>
                <button onClick={handleCloseModal} className="p-2 bg-slate-100 rounded-full text-slate-500"><X/></button>
             </div>
             <form onSubmit={handleAddHolding} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <input required placeholder="סימול (AAPL)" className="w-full bg-slate-50 p-4 rounded-2xl font-bold border-none" value={formData.symbol} onChange={e => setFormData({...formData, symbol: e.target.value.toUpperCase()})} />
                  <select className="w-full bg-slate-50 p-4 rounded-2xl font-bold border-none" value={formData.currency} onChange={e => setFormData({...formData, currency: e.target.value})}>
                    <option value="USD">$ דולר (USD)</option>
                    <option value="ILS">₪ שקל (ILS)</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <input required type="number" step="any" placeholder="כמות" className="w-full bg-slate-50 p-4 rounded-2xl font-bold border-none" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} />
                  <input required type="number" step="any" placeholder="מחיר ממוצע" className="w-full bg-slate-50 p-4 rounded-2xl font-bold border-none" value={formData.avgPrice} onChange={e => setFormData({...formData, avgPrice: e.target.value})} />
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">שמור נכס בתיק</button>
             </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
