import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import {
  Wallet, Plus, Trash2, RefreshCcw, BrainCircuit,
  Briefcase, ArrowUpRight, AlertCircle, TrendingDown,
  PieChart, LayoutGrid, X, Globe, ShieldAlert,
  ArrowRightLeft, Sparkles, Activity, ShieldCheck,
  TrendingUp, Edit2, ArrowDownUp, Filter, LogOut
} from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDsTa-TE41vy7JRD0NkwjG77Z6W2JPZuXc",
  authDomain: "myportfolio-tracker.firebaseapp.com",
  projectId: "myportfolio-tracker",
  storageBucket: "myportfolio-tracker.firebasestorage.app",
  messagingSenderId: "213503174907",
  appId: "1:213503174907:web:6f9466a33db39ec968a85e"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'portfolio-tracker-pro-v3';
const apiKey = "AIzaSyDyHv0arWlmi0IlAoA4t5XFS_3yWjOE6ak";

const App = () => {
  const [user, setUser] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [activeTab, setActiveTab] = useState('home'); // 'home', 'stats', 'ai'

  // Real-time Exchage Rate
  const [usdRate, setUsdRate] = useState(3.75);

  // AI State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiData, setAiData] = useState(null);
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
    symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART'
  });

  // State for Editing
  const [editingId, setEditingId] = useState(null);

  // Real Market Data
  const [marketData, setMarketData] = useState({});
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);

  // Sorting State
  const [sortBy, setSortBy] = useState('value-desc'); // 'value-desc', 'value-asc', 'profit-desc', 'sector', 'platform'
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);

  const sectors = ['שבבים', 'תוכנה', 'סייבר', 'פינטק', 'מדדים', 'אנרגיה', 'דאטה סנטרים', 'ביומד', 'פיננסים', 'אחר'];
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

  // 1. Init & Fetch Exchange Rate
  useEffect(() => {
    const initApp = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        }

        // Fetch Live USD/ILS Rate
        try {
          const res = await fetch('https://open.er-api.com/v6/latest/USD');
          const data = await res.json();
          if (data && data.rates && data.rates.ILS) {
            setUsdRate(data.rates.ILS);
          }
        } catch (e) {
          console.warn("Could not fetch live rate, using default.", e);
        }
      } catch (err) {
        setError("שגיאה בהתחברות הראשונית");
      }
    };
    initApp();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
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

  const handleLogout = async () => {
    await signOut(auth);
  };

  // 2. Data Fetching
  useEffect(() => {
    if (!user) return;
    const holdingsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'holdings');
    const unsubscribe = onSnapshot(holdingsCol,
      (snapshot) => {
        setHoldings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      () => { setError("שגיאה בטעינת הנתונים"); setLoading(false); }
    );
    return () => unsubscribe();
  }, [user]);

  // 2.5 Real Market Data Fetching (Yahoo Finance via Proxy)
  const fetchMarketPrices = async () => {
    if (holdings.length === 0) return;
    setIsRefreshingPrices(true);
    const newMarketData = { ...marketData };

    // Get unique symbols to avoid duplicate requests
    const uniqueHoldings = Array.from(new Map(holdings.map(h => [h.symbol, h])).values());

    for (const h of uniqueHoldings) {
      try {
        let ticker = h.symbol.toUpperCase();
        // Append .TA for Israeli stocks so Yahoo Finance recognizes them
        if (h.currency === 'ILS' && !ticker.includes('.')) {
          ticker += '.TA';
        }

        // Yahoo Finance v8 API via AllOrigins free CORS proxy (Added timestamp to bypass proxy cache)
        const timestamp = Date.now();
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&_ts=${timestamp}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error("API request failed");

        const data = await res.json();

        if (data?.chart?.result?.[0]) {
          const result = data.chart.result[0];
          const currentPrice = result.meta.regularMarketPrice;
          const prevClose = result.meta.chartPreviousClose || result.meta.previousClose;

          let normalizedCurrent = currentPrice;
          let normalizedPrev = prevClose;

          // Yahoo usually returns TASE (Israel) prices in Agorot. We convert to ILS.
          if (h.currency === 'ILS') {
            normalizedCurrent = currentPrice / 100;
            normalizedPrev = prevClose / 100;
          }

          const dailyChangePct = prevClose ? ((normalizedCurrent - normalizedPrev) / normalizedPrev) * 100 : 0;

          newMarketData[h.symbol] = {
            currentPrice: normalizedCurrent,
            dailyChangePct: dailyChangePct
          };
        }
      } catch (e) {
        console.warn(`Could not fetch data for ${h.symbol}`);
      }
    }

    setMarketData(newMarketData);
    setIsRefreshingPrices(false);
  };

  // Fetch prices automatically when holdings are loaded
  useEffect(() => {
    if (holdings.length > 0) {
      fetchMarketPrices();
    }
  }, [holdings.length]);

  // 3. Complex Calculations
  const stats = useMemo(() => {
    let totalInvestedILS = 0;
    let currentTotalILS = 0;
    let dailyChangeILS = 0;
    let currentTotalUSD = 0;
    let localILS = 0, foreignILS = 0;
    const sectorMap = {};

    holdings.forEach(h => {
      const isILS = h.currency === 'ILS';
      const avgPriceCalc = isILS ? h.avgPrice / 100 : h.avgPrice;

      const investedInCurrency = h.quantity * avgPriceCalc;
      const investedILS = isILS ? investedInCurrency : investedInCurrency * usdRate;
      totalInvestedILS += investedILS;

      // Get real current price or fallback to avg price
      const mData = marketData[h.symbol] || { currentPrice: avgPriceCalc, dailyChangePct: 0 };
      const currentInCurrency = h.quantity * mData.currentPrice;
      const currentILS = isILS ? currentInCurrency : currentInCurrency * usdRate;

      currentTotalILS += currentILS;
      currentTotalUSD += isILS ? currentInCurrency / usdRate : currentInCurrency;

      if (isILS) localILS += currentILS;
      else foreignILS += currentILS;

      // Trim to avoid duplicates caused by trailing spaces in older saved records
      const sectorName = (h.sector || 'אחר').trim();
      sectorMap[sectorName] = (sectorMap[sectorName] || 0) + currentILS;

      // Daily Change calc
      const dailyChangeRatio = mData.dailyChangePct / 100;
      const prevDayValueILS = currentILS / (1 + dailyChangeRatio);
      dailyChangeILS += (currentILS - prevDayValueILS);
    });

    const totalChangeILS = currentTotalILS - totalInvestedILS;
    const totalChangePct = totalInvestedILS > 0 ? (totalChangeILS / totalInvestedILS) * 100 : 0;
    const dailyChangePct = (currentTotalILS - dailyChangeILS) > 0 ? (dailyChangeILS / (currentTotalILS - dailyChangeILS)) * 100 : 0;

    const sectorStats = Object.keys(sectorMap).map((name, idx) => ({
      name,
      value: sectorMap[name],
      percentage: currentTotalILS > 0 ? (sectorMap[name] / currentTotalILS) * 100 : 0,
      color: colors[idx % colors.length]
    })).sort((a, b) => b.value - a.value);

    return {
      currentTotalUSD, currentTotalILS, totalChangeILS, totalChangePct, dailyChangeILS, dailyChangePct,
      sectorStats,
      geoLocal: currentTotalILS > 0 ? (localILS / currentTotalILS) * 100 : 0,
      geoForeign: currentTotalILS > 0 ? (foreignILS / currentTotalILS) * 100 : 0
    };
  }, [holdings, usdRate, marketData]);

  // Sorting Logic
  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      const priceCalcA = a.currency === 'ILS' ? a.avgPrice / 100 : a.avgPrice;
      const priceCalcB = b.currency === 'ILS' ? b.avgPrice / 100 : b.avgPrice;

      const mDataA = marketData[a.symbol] || { currentPrice: priceCalcA };
      const mDataB = marketData[b.symbol] || { currentPrice: priceCalcB };

      const valueA_ILS = a.currency === 'ILS' ? (a.quantity * mDataA.currentPrice) : (a.quantity * mDataA.currentPrice * usdRate);
      const valueB_ILS = b.currency === 'ILS' ? (b.quantity * mDataB.currentPrice) : (b.quantity * mDataB.currentPrice * usdRate);

      const profitA = priceCalcA > 0 ? ((mDataA.currentPrice - priceCalcA) / priceCalcA) : 0;
      const profitB = priceCalcB > 0 ? ((mDataB.currentPrice - priceCalcB) / priceCalcB) : 0;

      switch (sortBy) {
        case 'value-desc': return valueB_ILS - valueA_ILS;
        case 'value-asc': return valueA_ILS - valueB_ILS;
        case 'profit-desc': return profitB - profitA;
        case 'sector': return (a.sector || '').localeCompare(b.sector || '');
        case 'platform': return (a.platform || '').localeCompare(b.platform || '');
        default: return 0;
      }
    });
  }, [holdings, marketData, usdRate, sortBy]);

  // 4. Structured AI Insights (JSON format request)
  const fetchAiInsights = async () => {
    if (holdings.length === 0) return;
    setAiLoading(true);
    setAiData(null);

    const portfolioDesc = holdings.map(h => `${h.symbol} (${h.sector}) - ${h.quantity} units @ ${h.avgPrice} ${h.currency}`).join(', ');

    const systemInstruction = `You are a top-tier financial analyst. Analyze the user's portfolio and return a STRICT JSON object in Hebrew. Do NOT include markdown blocks like \`\`\`json. The JSON must have this exact structure:
    {
      "overview": "Short overall analysis",
      "riskLevel": "נמוך / בינוני / גבוה",
      "atRisk": [{"symbol": "TICKER", "reason": "Why it's risky right now"}],
      "toIncrease": [{"symbol": "TICKER", "reason": "Why it might be a good buy"}],
      "recommendations": ["Actionable tip 1", "Actionable tip 2"]
    }`;

    const prompt = `Here is my portfolio: ${portfolioDesc}. Current USD/ILS rate: ${usdRate}. Analyze this based on current market conditions.`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] }
        })
      });
      const result = await response.json();
      let rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

      // Clean potential markdown from the response
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

      const parsedData = JSON.parse(rawText);
      setAiData(parsedData);
    } catch (err) {
      console.error(err);
      setError("שגיאה בקבלת תובנות AI או בפענוח הנתונים. נסה שוב.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAddHolding = async (e) => {
    e.preventDefault();
    if (!user) return;
    try {
      const holdingData = {
        ...formData,
        quantity: parseFloat(formData.quantity),
        avgPrice: parseFloat(formData.avgPrice),
        createdAt: new Date().toISOString()
      };

      if (editingId) {
        // Update existing
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'holdings', editingId), holdingData);
        setEditingId(null);
      } else {
        // Add new
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'holdings', crypto.randomUUID()), holdingData);
      }

      setIsAdding(false);
      setFormData({ symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART' });
    } catch (err) { setError("שגיאה בשמירת הנכס"); }
  };

  const deleteHolding = async (id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'holdings', id));
    } catch (err) {
      setError("שגיאה במחיקת הנכס");
    }
  };

  const openEditModal = (holding) => {
    setFormData({
      symbol: holding.symbol,
      name: holding.name || '',
      quantity: holding.quantity,
      avgPrice: holding.avgPrice,
      currency: holding.currency,
      sector: holding.sector,
      platform: holding.platform
    });
    setEditingId(holding.id);
    setIsAdding(true);
  };

  const handleCloseModal = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART' });
  };

  // SVG Donut Chart Generator
  const renderDonutChart = () => {
    let cumulativePercent = 0;
    return (
      <svg viewBox="0 0 100 100" className="w-48 h-48 mx-auto drop-shadow-xl transform -rotate-90">
        {stats.sectorStats.map((s, idx) => {
          const dashArray = `${s.percentage} ${100 - s.percentage}`;
          const dashOffset = -cumulativePercent;
          cumulativePercent += s.percentage;
          return (
            <circle key={s.name} cx="50" cy="50" r="40" fill="transparent"
              stroke={s.color} strokeWidth="20" strokeDasharray={dashArray} strokeDashoffset={dashOffset}
              pathLength="100"
              className="transition-all duration-1000 ease-out" />
          );
        })}
        <circle cx="50" cy="50" r="30" fill="white" />
      </svg>
    );
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-slate-50"><RefreshCcw className="animate-spin text-blue-600" /></div>;

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center" dir="rtl">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-2xl">
          <Wallet size={40} className="text-white" />
        </div>
        <h1 className="text-4xl font-black text-white mb-4 tracking-tight">MyWealth Pro</h1>
        <p className="text-slate-400 mb-12">התחבר עם חשבון הגוגל שלך כדי לסנכרן את התיק בין כל המכשירים בצורה מאובטחת.</p>

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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-24" dir="rtl">

      {/* Top App Bar */}
      <header className="bg-white px-5 py-4 flex items-center justify-between shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-extrabold text-xl tracking-tight text-slate-800">MyWealth</h1>
            <p className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
              <ArrowRightLeft size={10} /> שער דולר רציף: ₪{usdRate.toFixed(3)}
            </p>
          </div>
          <button
            onClick={fetchMarketPrices}
            disabled={isRefreshingPrices}
            className="p-2 text-slate-400 hover:text-blue-600 transition-colors bg-slate-50 rounded-full disabled:opacity-50"
            title="רענן מחירי שוק"
          >
            <RefreshCcw size={16} className={isRefreshingPrices ? "animate-spin text-blue-500" : ""} />
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={handleLogout} className="bg-white text-slate-400 hover:text-red-500 border border-slate-100 w-10 h-10 rounded-full flex items-center justify-center shadow-sm transition-colors">
            <LogOut size={18} />
          </button>
          <button onClick={() => { setEditingId(null); setIsAdding(true); }} className="bg-slate-900 text-white w-10 h-10 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform">
            <Plus size={22} />
          </button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-md mx-auto">

        {/* --- TAB 1: HOME (PORTFOLIO) --- */}
        {activeTab === 'home' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Total Balance Card */}
            <div className="bg-slate-900 rounded-[28px] p-7 text-white shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 pointer-events-none"></div>
              <p className="text-slate-300 text-sm font-medium mb-2 opacity-80">שווי תיק נוכחי</p>
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-4xl font-black tracking-tight">₪{stats.currentTotalILS.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h2>
              </div>
              <p className="text-lg text-slate-400 font-medium mb-6">${stats.currentTotalUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>

              <div className="flex gap-4 border-t border-slate-700/50 pt-4">
                <div className="flex-1">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">תשואה כוללת</p>
                  <p className={`font-semibold text-sm flex items-center gap-1 ${stats.totalChangePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {stats.totalChangePct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    ₪{Math.abs(stats.totalChangeILS).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span className="text-xs ml-1 opacity-80" dir="ltr">({stats.totalChangePct > 0 ? '+' : ''}{stats.totalChangePct.toFixed(2)}%)</span>
                  </p>
                </div>
                <div className="flex-1 border-r border-slate-700/50 pr-4">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">שינוי יומי</p>
                  <p className={`font-semibold text-sm flex items-center gap-1 ${stats.dailyChangePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {stats.dailyChangePct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    ₪{Math.abs(stats.dailyChangeILS).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span className="text-xs ml-1 opacity-80" dir="ltr">({stats.dailyChangePct > 0 ? '+' : ''}{stats.dailyChangePct.toFixed(2)}%)</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Holdings List Header & Sort */}
            <div className="flex items-center justify-between px-1">
              <h3 className="font-bold text-slate-800 text-lg">האחזקות שלי</h3>
              <div className="relative">
                <button
                  onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
                  className="flex items-center gap-1 text-xs font-medium text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  <Filter size={14} />
                  <span>מיון</span>
                </button>

                {isSortMenuOpen && (
                  <div className="absolute left-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 z-10 py-2 animate-in fade-in zoom-in-95">
                    {[
                      { id: 'value-desc', label: 'שווי: מהגבוה לנמוך' },
                      { id: 'value-asc', label: 'שווי: מהנמוך לגבוה' },
                      { id: 'profit-desc', label: 'רווחיות' },
                      { id: 'sector', label: 'לפי סקטור' },
                      { id: 'platform', label: 'לפי פלטפורמה' }
                    ].map(option => (
                      <button
                        key={option.id}
                        onClick={() => { setSortBy(option.id); setIsSortMenuOpen(false); }}
                        className={`w-full text-right px-4 py-2 text-sm ${sortBy === option.id ? 'bg-blue-50 text-blue-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Holdings List */}
            {holdings.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 text-center shadow-sm border border-slate-100 mt-4">
                <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                  <Briefcase size={32} />
                </div>
                <p className="text-slate-500 font-medium mb-4">התיק שלך עדיין ריק.</p>
                <button onClick={() => setIsAdding(true)} className="text-blue-600 font-bold bg-blue-50 px-6 py-2 rounded-full">הוסף נכס ראשון</button>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedHoldings.map(h => {
                  const priceForCalc = h.currency === 'ILS' ? h.avgPrice / 100 : h.avgPrice;
                  const mData = marketData[h.symbol] || { currentPrice: priceForCalc, dailyChangePct: 0 };
                  const currentPrice = mData.currentPrice;
                  const totalChangePct = priceForCalc > 0 ? ((currentPrice - priceForCalc) / priceForCalc) * 100 : 0;
                  const isProfit = totalChangePct >= 0;
                  const symbolCurrency = h.currency === 'USD' ? '$' : '₪';
                  const totalValue = h.quantity * currentPrice;

                  return (
                    <div key={h.id} className="bg-white p-4 rounded-[20px] shadow-sm border border-slate-100 flex flex-col gap-3 transition-all hover:shadow-md">
                      {/* Top Row: Main Info */}
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center font-black text-slate-700 shadow-inner text-base shrink-0">
                            {h.symbol[0]}
                          </div>
                          <div>
                            <div className="font-extrabold text-slate-900 text-base leading-tight">{h.symbol}</div>
                            <div className="text-[10px] text-slate-400 font-medium flex items-center gap-1 mt-1">
                              <span>{h.sector}</span> • <span>{h.platform}</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-left flex flex-col items-end">
                           <div className="font-extrabold text-slate-900 text-base">
                             {symbolCurrency}{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                           </div>
                           <div className={`text-[11px] font-bold mt-1 px-1.5 py-0.5 rounded-md flex items-center gap-0.5 ${isProfit ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`} dir="ltr">
                              {isProfit ? '+' : ''}{totalChangePct.toFixed(1)}%
                           </div>
                        </div>
                      </div>

                      {/* Divider */}
                      <div className="h-px w-full bg-slate-50"></div>

                      {/* Bottom Row: Details & Actions */}
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <span className="text-slate-400">קניה</span>
                            <span className="font-bold text-slate-600">{symbolCurrency}{priceForCalc.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex flex-col border-r border-slate-100 pr-3">
                            <span className="text-slate-400">נוכחי</span>
                            <span className="font-bold text-slate-700">{symbolCurrency}{currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex flex-col border-r border-slate-100 pr-3">
                            <span className="text-slate-400">כמות</span>
                            <span className="font-bold text-slate-600">{h.quantity}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 bg-slate-50 p-0.5 rounded-lg border border-slate-100">
                           <button onClick={() => openEditModal(h)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded-md transition-all"><Edit2 size={14} /></button>
                           <button onClick={() => deleteHolding(h.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded-md transition-all"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* --- TAB 2: ANALYTICS (STATS) --- */}
        {activeTab === 'stats' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <h2 className="text-2xl font-black text-slate-800 mb-2">פילוח התיק</h2>

            {/* Donut Chart Card */}
            <div className="bg-white p-6 rounded-[28px] shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-600 mb-6 flex items-center gap-2"><PieChart size={18} /> פיזור סקטוריאלי</h3>

              {holdings.length > 0 ? (
                <>
                  <div className="relative">
                    {renderDonutChart()}
                    <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                      <span className="text-3xl font-black text-slate-800">{stats.sectorStats.length}</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">סקטורים</span>
                    </div>
                  </div>

                  <div className="mt-8 space-y-3">
                    {stats.sectorStats.map(s => (
                      <div key={s.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }}></div>
                          <span className="font-bold text-slate-700">{s.name}</span>
                        </div>
                        <div className="font-medium text-slate-500">
                          ₪{s.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-slate-300 mx-1">|</span> {s.percentage.toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-center text-slate-400 py-10">אין נתונים להצגה</p>
              )}
            </div>

            {/* Geo Distribution Card */}
            <div className="bg-white p-6 rounded-[28px] shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-600 mb-6 flex items-center gap-2"><Globe size={18} /> חשיפה גיאוגרפית</h3>

              <div className="h-4 w-full flex rounded-full overflow-hidden mb-4 shadow-inner bg-slate-100">
                <div style={{ width: `${stats.geoForeign}%` }} className="bg-blue-500 h-full transition-all"></div>
                <div style={{ width: `${stats.geoLocal}%` }} className="bg-orange-400 h-full transition-all"></div>
              </div>

              <div className="flex justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-1">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div> מניות חו"ל
                  </div>
                  <p className="text-xs text-slate-500">{stats.geoForeign.toFixed(1)}% מבוסס מט"ח</p>
                </div>
                <div className="text-left">
                  <div className="flex items-center justify-end gap-2 text-sm font-bold text-slate-800 mb-1">
                    ישראל <div className="w-2 h-2 rounded-full bg-orange-400"></div>
                  </div>
                  <p className="text-xs text-slate-500">{stats.geoLocal.toFixed(1)}% מבוסס שקלי</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 3: AI ADVISOR --- */}
        {activeTab === 'ai' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-[28px] p-6 text-white shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                  <BrainCircuit size={28} className="text-indigo-200" />
                </div>
                <div>
                  <h2 className="text-xl font-black">יועץ AI אישי</h2>
                  <p className="text-indigo-200 text-xs">מופעל ע"י Google Gemini</p>
                </div>
              </div>
              <p className="text-sm text-indigo-100 leading-relaxed mb-6">
                קבל ניתוח עומק של התיק שלך, זיהוי נקודות תורפה והמלצות להגדלת חשיפה בהתבסס על מצב השוק.
              </p>
              <button
                onClick={fetchAiInsights}
                disabled={aiLoading}
                className="w-full bg-white text-indigo-900 font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-70 shadow-lg"
              >
                {aiLoading ? <RefreshCcw className="animate-spin" size={18} /> : <Sparkles size={18} />}
                {aiLoading ? 'מנתח נתוני שוק...' : 'בצע ניתוח מעמיק לתיק'}
              </button>
            </div>

            {aiData && (
              <div className="space-y-4 animate-in slide-in-from-bottom-8 duration-500">
                {/* Overview */}
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Activity size={16} /> סקירה כללית
                  </h3>
                  <p className="text-slate-800 leading-relaxed text-sm font-medium">{aiData.overview}</p>
                </div>

                {/* Risk Level */}
                <div className="flex items-center justify-between bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck size={16} /> רמת סיכון נוכחית
                  </h3>
                  <span className={`px-4 py-1.5 rounded-full text-sm font-black ${aiData.riskLevel.includes('גבוה') ? 'bg-red-100 text-red-700' :
                      aiData.riskLevel.includes('נמוך') ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                    {aiData.riskLevel}
                  </span>
                </div>

                {/* At Risk */}
                {aiData.atRisk && aiData.atRisk.length > 0 && (
                  <div className="bg-red-50 p-5 rounded-3xl shadow-sm border border-red-100">
                    <h3 className="text-sm font-bold text-red-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <ShieldAlert size={16} /> מניות בסיכון גבוה
                    </h3>
                    <div className="space-y-3">
                      {aiData.atRisk.map((item, i) => (
                        <div key={i} className="bg-white p-3 rounded-2xl shadow-sm border border-red-50">
                          <span className="font-black text-red-600 block mb-1">{item.symbol}</span>
                          <span className="text-xs text-slate-600 leading-relaxed">{item.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* To Increase */}
                {aiData.toIncrease && aiData.toIncrease.length > 0 && (
                  <div className="bg-green-50 p-5 rounded-3xl shadow-sm border border-green-100">
                    <h3 className="text-sm font-bold text-green-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <ArrowUpRight size={16} /> מניות שכדאי לשקול הגדלה
                    </h3>
                    <div className="space-y-3">
                      {aiData.toIncrease.map((item, i) => (
                        <div key={i} className="bg-white p-3 rounded-2xl shadow-sm border border-green-50">
                          <span className="font-black text-green-600 block mb-1">{item.symbol}</span>
                          <span className="text-xs text-slate-600 leading-relaxed">{item.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* General Recommendations */}
                {aiData.recommendations && (
                  <div className="bg-blue-50 p-5 rounded-3xl shadow-sm border border-blue-100">
                    <h3 className="text-sm font-bold text-blue-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Sparkles size={16} /> המלצות נוספות לתיק
                    </h3>
                    <ul className="space-y-2">
                      {aiData.recommendations.map((rec, i) => (
                        <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                          <div className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></div>
                          <span className="leading-relaxed font-medium">{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* --- BOTTOM NAVIGATION BAR --- */}
      <nav className="fixed bottom-0 left-0 w-full bg-white/90 backdrop-blur-xl border-t border-slate-200 pb-safe pt-2 px-6 z-30">
        <div className="max-w-md mx-auto flex justify-between items-center pb-4">
          <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'home' ? 'text-blue-600' : 'text-slate-400'}`}>
            <Wallet size={24} className={activeTab === 'home' ? 'fill-blue-100' : ''} />
            <span className="text-[10px] font-bold">התיק שלי</span>
          </button>
          <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'stats' ? 'text-blue-600' : 'text-slate-400'}`}>
            <PieChart size={24} className={activeTab === 'stats' ? 'fill-blue-100' : ''} />
            <span className="text-[10px] font-bold">פילוחים</span>
          </button>
          <button onClick={() => setActiveTab('ai')} className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'ai' ? 'text-indigo-600' : 'text-slate-400'}`}>
            <BrainCircuit size={24} className={activeTab === 'ai' ? 'fill-indigo-100' : ''} />
            <span className="text-[10px] font-bold">ייעוץ חכם</span>
          </button>
        </div>
      </nav>

      {/* Add Holding Bottom Sheet */}
      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-end justify-center">
          <div className="bg-white w-full max-w-md rounded-t-[32px] p-6 shadow-2xl animate-in slide-in-from-bottom-full duration-300 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 py-2">
              <h3 className="text-xl font-extrabold text-slate-800">{editingId ? 'עריכת נכס' : 'הוספת נכס חדש'}</h3>
              <button onClick={handleCloseModal} className="p-2 bg-slate-100 rounded-full text-slate-500 active:scale-90"><X size={20} /></button>
            </div>

            <form onSubmit={handleAddHolding} className="space-y-5 pb-8">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">סימול מניה</label>
                  <input required placeholder="AAPL" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    value={formData.symbol} onChange={e => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">מטבע קניה</label>
                  <div className="flex bg-slate-100 rounded-2xl p-1">
                    {['USD', 'ILS'].map(curr => (
                      <button key={curr} type="button" onClick={() => setFormData({ ...formData, currency: curr })}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-black transition-all ${formData.currency === curr ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>
                        {curr === 'USD' ? '$ USD' : '₪ ILS'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">סקטור</label>
                <div className="flex flex-wrap gap-2">
                  {sectors.map(s => (
                    <button key={s} type="button" onClick={() => setFormData({ ...formData, sector: s })}
                      className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${formData.sector === s ? 'bg-slate-800 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-500'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">כמות</label>
                  <input required type="number" step="any" placeholder="0.00" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    value={formData.quantity} onChange={e => setFormData({ ...formData, quantity: e.target.value })} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">מחיר ממוצע {formData.currency === 'ILS' ? '(באגורות)' : ''}</label>
                  <input required type="number" step="any" placeholder="0.00" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                    value={formData.avgPrice} onChange={e => setFormData({ ...formData, avgPrice: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">פלטפורמה (ברוקר)</label>
                <select className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 outline-none font-bold text-slate-700"
                  value={formData.platform} onChange={e => setFormData({ ...formData, platform: e.target.value })}>
                  <option>IBI SMART</option>
                  <option>IBI Trade</option>
                  <option>OneZero</option>
                </select>
              </div>

              <button type="submit" className="w-full bg-blue-600 text-white font-black text-lg py-4 rounded-2xl shadow-xl shadow-blue-200 active:scale-95 transition-all mt-4">
                {editingId ? 'שמור שינויים' : 'הוסף נכס לתיק'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed top-20 left-4 right-4 bg-red-600 text-white p-4 rounded-2xl flex items-center gap-3 shadow-2xl z-50 animate-in slide-in-from-top-full">
          <AlertCircle size={20} />
          <p className="text-sm font-bold flex-1">{error}</p>
          <button onClick={() => setError(null)}><X size={20} /></button>
        </div>
      )}
    </div>
  );
};

export default App;
