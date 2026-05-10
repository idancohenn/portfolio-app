import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut
} from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { 
  Wallet, Plus, Trash2, RefreshCcw, 
  PieChart, X, LogOut, Edit2
} from 'lucide-react';

// --- Firebase Configuration ---
// השתמש באובייקט שקיבלת מהמסוף של Firebase
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

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
  const [activeTab, setActiveTab] = useState('home');
  const [usdRate, setUsdRate] = useState(3.75);
  const [error, setError] = useState(null);
  const [marketData, setMarketData] = useState({});

  const [formData, setFormData] = useState({
    symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART'
  });
  const [editingId, setEditingId] = useState(null);

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
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError("התחברות לגוגל נכשלה. וודא שהפעלת את Google ב-Firebase Console.");
    }
  };

  const handleLogout = () => signOut(auth);

  useEffect(() => {
    if (!user || user.isAnonymous) return;
    const holdingsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'holdings');
    const unsubscribe = onSnapshot(holdingsCol, 
      (snapshot) => {
        setHoldings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      () => { setError("שגיאה בטעינת הנתונים"); }
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

  const handleAddHolding = async (e) => {
    e.preventDefault();
    if (!user) return;
    const id = editingId || crypto.randomUUID();
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
    setEditingId(null);
    setFormData({ symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART' });
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-slate-950"><RefreshCcw className="animate-spin text-blue-500" /></div>;

  if (!user || user.isAnonymous) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-center" dir="rtl">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-2xl">
          <Wallet size={40} className="text-white" />
        </div>
        <h1 className="text-4xl font-black text-white mb-4">MyWealth Pro</h1>
        <p className="text-slate-400 mb-12">התחבר עם גוגל כדי לסנכרן את התיק בין המחשב לנייד בצורה מאובטחת.</p>
        <button 
          onClick={handleGoogleLogin}
          className="w-full max-w-xs bg-white text-slate-900 font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-3 shadow-xl active:scale-95"
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
          <h1 className="font-black text-xl text-slate-800">MyWealth</h1>
          <span className="text-[10px] font-bold text-slate-400">שלום, {user.displayName}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500"><LogOut size={20}/></button>
          <button onClick={() => setIsAdding(true)} className="bg-blue-600 text-white w-10 h-10 rounded-full flex items-center justify-center shadow-lg"><Plus size={22} /></button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-md mx-auto">
        <div className="bg-slate-900 rounded-[32px] p-8 text-white shadow-2xl mb-8">
           <p className="text-slate-400 text-xs font-bold uppercase mb-2">שווי התיק שלך</p>
           <h2 className="text-4xl font-black mb-1">₪{stats.totalILS.toLocaleString(undefined, {maximumFractionDigits:0})}</h2>
           <p className={`text-sm font-black ${stats.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
             {stats.changePct >= 0 ? '+' : ''}{stats.changePct.toFixed(1)}% סה"כ
           </p>
        </div>

        <div className="space-y-3">
          <h3 className="font-black text-lg px-1">האחזקות שלי ({holdings.length})</h3>
          {holdings.map(h => {
            const isILS = h.currency === 'ILS';
            const mData = marketData[h.symbol] || { currentPrice: isILS ? h.avgPrice/100 : h.avgPrice };
            return (
              <div key={h.id} className="bg-white p-4 rounded-[24px] shadow-sm border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center font-black text-blue-600">{h.symbol[0]}</div>
                  <div>
                    <div className="font-black text-slate-800">{h.symbol}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">{h.platform}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-left">
                    <div className="font-black">{(h.quantity * mData.currentPrice).toLocaleString(undefined, {maximumFractionDigits:0})} {isILS ? '₪' : '$'}</div>
                  </div>
                  <button onClick={() => handleDelete(h.id)} className="text-slate-200 hover:text-red-500"><Trash2 size={16}/></button>
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end">
          <div className="bg-white w-full rounded-t-[40px] p-8 animate-in slide-in-from-bottom-full duration-300">
             <div className="flex justify-between mb-8">
                <h3 className="text-2xl font-black">הוספת נכס</h3>
                <button onClick={handleCloseModal} className="p-2 bg-slate-100 rounded-full"><X/></button>
             </div>
             <form onSubmit={handleAddHolding} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <input required placeholder="סימול (AAPL)" className="bg-slate-50 p-4 rounded-2xl font-bold" value={formData.symbol} onChange={e => setFormData({...formData, symbol: e.target.value.toUpperCase()})} />
                  <select className="bg-slate-50 p-4 rounded-2xl font-bold" value={formData.currency} onChange={e => setFormData({...formData, currency: e.target.value})}>
                    <option value="USD">$ USD</option>
                    <option value="ILS">₪ ILS</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <input required type="number" step="any" placeholder="כמות" className="bg-slate-50 p-4 rounded-2xl font-bold" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} />
                  <input required type="number" step="any" placeholder="מחיר ממוצע" className="bg-slate-50 p-4 rounded-2xl font-bold" value={formData.avgPrice} onChange={e => setFormData({...formData, avgPrice: e.target.value})} />
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl">שמור נכס בתיק</button>
             </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
