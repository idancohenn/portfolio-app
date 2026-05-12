import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import {
  Wallet, Plus, Trash2, RefreshCcw, BrainCircuit,
  Briefcase, ArrowUpRight, AlertCircle, TrendingDown,
  PieChart, LayoutGrid, X, Globe, ShieldAlert,
  ArrowRightLeft, Sparkles, Activity, ShieldCheck,
  TrendingUp, Edit2, ArrowDownUp, Filter, LogOut, Copy, CheckCircle2, Settings
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

const App = () => {
  const [user, setUser] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [activeTab, setActiveTab] = useState('home');

  // Settings State (API Keys)
  const [settings, setSettings] = useState({ finnhubKey: '', fmpKey: '' });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Real-time Exchage Rate
  const [usdRate, setUsdRate] = useState(3.75);

  // AI Prompt State
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
    symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART', note: ''
  });

  // State for Editing
  const [editingId, setEditingId] = useState(null);
  
  // State for Expanding Holding Card Actions
  const [expandedHoldingId, setExpandedHoldingId] = useState(null);

  // Real Market Data
  const [marketData, setMarketData] = useState({});
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);

  // Sorting State
  const [sortBy, setSortBy] = useState('value-desc');
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

  // 1.5 Load Cached Market Data & User Settings
  useEffect(() => {
    if (!user) return;
    
    const fetchSettings = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'));
        if (docSnap.exists()) {
          setSettings(docSnap.data());
        }
      } catch(e) {}
    };
    
    const loadCache = async () => {
      try {
        const cacheSnap = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'cache', 'marketData'));
        if (cacheSnap.exists()) {
          setMarketData(prev => {
            if (Object.keys(prev).length === 0) return cacheSnap.data();
            return prev;
          });
        }
      } catch (e) {}
    };

    fetchSettings();
    loadCache();
  }, [user]);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    if (!user) return;
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), settings);
      setIsSettingsOpen(false);
      fetchMarketPrices(); 
    } catch(e) {
      setError("שגיאה בשמירת הגדרות API");
    }
  };

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

  // 2.5 Real Market Data Fetching (Smart Routing: USD -> Finnhub, ILS -> FMP)
  const fetchMarketPrices = async () => {
    if (holdings.length === 0) return;
    setIsRefreshingPrices(true);
    const newMarketData = { ...marketData };
    let cacheUpdated = false;

    const fetchWithTimeout = async (url, timeoutMs = 4500) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(id);
          return res;
      } catch(e) {
          clearTimeout(id);
          throw e;
      }
    };

    const fetchThroughProxy = async (targetUrl) => {
      const proxies = [
          { type: 'allorigins', url: `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}&_ts=${Date.now()}` },
          { type: 'corsproxy', url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}` },
          { type: 'codetabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}` }
      ];

      for (const proxy of proxies) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          try {
              const res = await fetch(proxy.url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (res.ok) {
                  if (proxy.type === 'allorigins') {
                      const data = await res.json();
                      if (data.contents) return data.contents;
                  } else {
                      return await res.text();
                  }
              }
          } catch(e) {
              clearTimeout(timeoutId);
          }
      }
      return null;
    };

    const uniqueHoldings = Array.from(new Map(holdings.map(h => [h.symbol.trim().toUpperCase(), h])).values());
    
    // חלוקה חכמה להורדת עומס והפרדת ספקי מידע:
    const usdHoldings = uniqueHoldings.filter(h => h.currency === 'USD');
    const ilsHoldings = uniqueHoldings.filter(h => h.currency === 'ILS');

    // --- 1. מניות ארה"ב (USD) נשלחות ל-Finnhub ---
    if (settings.finnhubKey && usdHoldings.length > 0) {
      const finnhubPromises = usdHoldings.map(async (h) => {
        let ticker = h.symbol.trim().toUpperCase();
        try {
          const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${settings.finnhubKey}`, 4000);
          if (res.ok) {
             const data = await res.json();
             if (data && !data.error && data.c && data.c > 0) {
                const currentPrice = data.c;
                const prevClose = data.pc;
                const dailyChangePct = prevClose && prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
                newMarketData[ticker] = { currentPrice, dailyChangePct };
                cacheUpdated = true;
             }
          }
        } catch(e) {}
      });
      await Promise.all(finnhubPromises);
    }

    // --- 2. מניות ותעודות סל ישראל (ILS) נשלחות ל-FMP ---
    if (settings.fmpKey && ilsHoldings.length > 0) {
      const fmpSymbols = ilsHoldings.map(h => {
        let t = h.symbol.trim().toUpperCase();
        return t.includes('.') ? t : `${t}.TA`; 
      }).join(',');

      try {
        const res = await fetchWithTimeout(`https://financialmodelingprep.com/api/v3/quote/${fmpSymbols}?apikey=${settings.fmpKey}`, 5000);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            data.forEach(item => {
              let originalSymbol = item.symbol.replace('.TA', '');
              const holding = ilsHoldings.find(h => 
                h.symbol.trim().toUpperCase() === originalSymbol || 
                h.symbol.trim().toUpperCase() === item.symbol
              );
              
              if (holding) {
                // FMP מחזיר תמיד אגורות עבור הבורסה הישראלית, נמיר הכל לשקלים
                let currentPrice = item.price / 100;
                let prevClose = item.previousClose ? item.previousClose / 100 : null;
                
                const dailyChangePct = prevClose && prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
                newMarketData[holding.symbol.trim().toUpperCase()] = { currentPrice, dailyChangePct };
                cacheUpdated = true;
              }
            });
          } else {
            console.warn("FMP returned an error:", data);
          }
        }
      } catch(e) {
        console.warn("FMP API fetch failed", e);
      }
    }

    // --- 3. טיפול במניות שעדיין חסרות (גיבויים וקריפטו) ---
    // מסננים החוצה כל מה שכבר קיבלנו מ-FMP או מ-Finnhub
    const missingHoldings = uniqueHoldings.filter(h => !newMarketData[h.symbol.trim().toUpperCase()]);

    if (missingHoldings.length > 0) {
      const fetchPromises = missingHoldings.map(async (h) => {
        let ticker = h.symbol.trim().toUpperCase();
        let currentPrice = null;
        let prevClose = null;

        // 3.1: קריפטו דרך Binance (עבור USD שלא נמצא ב-Finnhub)
        if (h.currency === 'USD') {
          try {
            const res = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${ticker}USDT`, 3000);
            if (res.ok) {
               const data = await res.json();
               if (data && data.lastPrice) {
                  currentPrice = parseFloat(data.lastPrice);
                  prevClose = parseFloat(data.prevClose);
               }
            }
          } catch(e) {}
        }

        // 3.2: מנועי סריקה כגיבוי לתעודות סל ומניות ישראליות (במידה ו-FMP לא הוגדר או נפל)
        if (currentPrice === null && h.currency === 'ILS') {
           const cleanTicker = ticker.replace('.TA', '');
           const isNumeric = /^\d+$/.test(cleanTicker);
           
           if (currentPrice === null && isNumeric) {
               try {
                   const content = await fetchThroughProxy(`https://gw.bizportal.co.il/api/quote/paper/${cleanTicker}`);
                   if (content) {
                       const data = typeof content === 'string' ? JSON.parse(content) : content;
                       if (data && data.lastRate > 0) {
                           currentPrice = parseFloat(data.lastRate) / 100;
                           prevClose = parseFloat(data.baseRate) / 100;
                       }
                   }
               } catch(e) {}
           }

           if (currentPrice === null) {
               try {
                   const content = await fetchThroughProxy(`https://www.google.com/finance/quote/${cleanTicker}:TLV`);
                   if (content) {
                       let match = content.match(/data-last-price="([0-9.]+)"/);
                       if (!match) match = content.match(/class="YMlKec fxKbKc"[^>]*>[^\d]*([0-9,.]+)/);
                       if (match && match[1]) {
                           currentPrice = parseFloat(match[1].replace(/,/g, ''));
                           if (currentPrice > 1000 && isNumeric) currentPrice /= 100;
                       }
                   }
               } catch(e) {}
           }

           if (currentPrice === null) {
               try {
                   let yahooTicker = ticker.includes('.') ? ticker : `${ticker}.TA`;
                   const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?interval=1d`;
                   const content = await fetchThroughProxy(url);
                   if (content) {
                       const data = typeof content === 'string' ? JSON.parse(content) : content;
                       if (data?.chart?.result?.[0]) {
                           currentPrice = data.chart.result[0].meta.regularMarketPrice / 100;
                           prevClose = data.chart.result[0].meta.chartPreviousClose / 100;
                       }
                   }
               } catch(e) {}
           }
        }

        // 3.3: מנועי סריקה כגיבוי למניות מארה"ב (במידה ו-Finnhub לא הוגדר או נפל)
        if (currentPrice === null && h.currency === 'USD') {
           try {
               const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d`;
               const content = await fetchThroughProxy(url);
               if (content) {
                   const data = typeof content === 'string' ? JSON.parse(content) : content;
                   if (data?.chart?.result?.[0]) {
                       currentPrice = data.chart.result[0].meta.regularMarketPrice;
                       prevClose = data.chart.result[0].meta.chartPreviousClose;
                   }
               }
           } catch(e) {}

           if (currentPrice === null) {
               const exchanges = ['NASDAQ', 'NYSE', 'AMEX', ''];
               for (let ex of exchanges) {
                   if (currentPrice !== null) break;
                   try {
                       const content = await fetchThroughProxy(`https://www.google.com/finance/quote/${ticker}${ex ? ':'+ex : ''}`);
                       if (content) {
                           let match = content.match(/data-last-price="([0-9.]+)"/);
                           if (!match) match = content.match(/class="YMlKec fxKbKc"[^>]*>[^\d]*([0-9,.]+)/);
                           if (match && match[1]) {
                               currentPrice = parseFloat(match[1].replace(/,/g, ''));
                           }
                       }
                   } catch(e) {}
               }
           }
        }

        if (currentPrice !== null && !isNaN(currentPrice) && currentPrice > 0) {
           const dailyChangePct = prevClose && prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
           return { symbol: ticker, currentPrice, dailyChangePct };
        }
        
        console.warn(`Could not update price for ${ticker}`);
        return null;
      });

      const results = await Promise.all(fetchPromises);
      
      results.forEach(res => {
        if (res) {
          newMarketData[res.symbol] = {
            currentPrice: res.currentPrice,
            dailyChangePct: res.dailyChangePct
          };
          cacheUpdated = true;
        }
      });
    }

    setMarketData(newMarketData);
    setIsRefreshingPrices(false);

    if (cacheUpdated && user) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'cache', 'marketData'), newMarketData);
      } catch (e) {}
    }
  };

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

      const mData = marketData[h.symbol.trim().toUpperCase()] || { currentPrice: avgPriceCalc, dailyChangePct: 0 };
      const currentInCurrency = h.quantity * mData.currentPrice;
      const currentILS = isILS ? currentInCurrency : currentInCurrency * usdRate;

      currentTotalILS += currentILS;
      currentTotalUSD += isILS ? currentInCurrency / usdRate : currentInCurrency;

      if (isILS) localILS += currentILS;
      else foreignILS += currentILS;

      const sectorName = (h.sector || 'אחר').trim();
      sectorMap[sectorName] = (sectorMap[sectorName] || 0) + currentILS;

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

      const mDataA = marketData[a.symbol.trim().toUpperCase()] || { currentPrice: priceCalcA };
      const mDataB = marketData[b.symbol.trim().toUpperCase()] || { currentPrice: priceCalcB };

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

  // 4. Generate AI Prompt Text
  const generateAiPrompt = () => {
    if (holdings.length === 0) return;
    
    let text = "שלום, אני מבקש שתשמש כיועץ השקעות מומחה ותנתח את תיק ההשקעות שלי. אלו הנתונים המעודכנים של האחזקות שלי:\n\n";
    
    const sortedForPrompt = [...holdings].sort((a, b) => a.symbol.localeCompare(b.symbol));
    sortedForPrompt.forEach(h => {
       const priceForCalc = h.currency === 'ILS' ? h.avgPrice / 100 : h.avgPrice;
       const mData = marketData[h.symbol.trim().toUpperCase()] || { currentPrice: priceForCalc };
       const currentPrice = mData.currentPrice;
       const symbolCurrency = h.currency === 'USD' ? '$' : '₪';
       const profitPct = priceForCalc > 0 ? ((currentPrice - priceForCalc) / priceForCalc) * 100 : 0;
       
       text += `- [${h.symbol}] סקטור: ${h.sector}. כמות: ${h.quantity}. מחיר קניה: ${symbolCurrency}${priceForCalc.toFixed(2)}, מחיר נוכחי: ${symbolCurrency}${currentPrice.toFixed(2)} (תשואה: ${profitPct > 0 ? '+' : ''}${profitPct.toFixed(1)}%).\n`;
    });
    
    text += `\nשער דולר רציף לעיונך בעת החישובים: ₪${usdRate.toFixed(3)}\n\n`;
    text += "משימות לניתוח:\n";
    text += "1. סקירה כללית: מה דעתך על הפיזור של התיק הנוכחי?\n";
    text += "2. רמת סיכון: הערך את רמת הסיכון של התיק (נמוכה/בינונית/גבוהה) והסבר בקצרה למה.\n";
    text += "3. חשיפה עודפת: האם יש מניות או סקטורים שאני חשוף אליהם יותר מדי וכדאי לי לשקול למכור/להקטין?\n";
    text += "4. הזדמנויות: בהתבסס על מצב השוק הנוכחי, אילו סקטורים או סוגי נכסים חסרים לי בתיק שכדאי לי לשקול להוסיף?\n";
    text += "5. סיכום: תן לי 3 המלצות פרקטיות וברורות להמשך דרכי.\n\n";
    text += "אנא ענה בעברית רהוטה וברורה. אני מבין שזהו אינו ייעוץ פיננסי מחייב אלא דעה מקצועית בלבד.";
    
    setGeneratedPrompt(text);
    setIsCopied(false);
  };

  const copyToClipboard = () => {
    const textArea = document.createElement("textarea");
    textArea.value = generatedPrompt;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy', err);
      setError('לא הצלחנו להעתיק אוטומטית, אנא העתק ידנית את הטקסט.');
    }
    document.body.removeChild(textArea);
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
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'holdings', editingId), holdingData);
        setEditingId(null);
      } else {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'holdings', crypto.randomUUID()), holdingData);
      }

      setIsAdding(false);
      setFormData({ symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART', note: '' });
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
      platform: holding.platform,
      note: holding.note || ''
    });
    setEditingId(holding.id);
    setIsAdding(true);
  };

  const handleCloseModal = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ symbol: '', name: '', quantity: '', avgPrice: '', currency: 'USD', sector: 'טכנולוגיה', platform: 'IBI SMART', note: '' });
  };

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

      <header className="bg-white px-5 py-4 flex items-center justify-between shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-extrabold text-xl tracking-tight text-slate-800">MyWealth</h1>
            <p className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
              <ArrowRightLeft size={10} /> שער דולר רציף: ₪{usdRate.toFixed(3)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 rounded-full"
              title="הגדרות API"
            >
              <Settings size={16} />
            </button>
            <button
              onClick={fetchMarketPrices}
              disabled={isRefreshingPrices}
              className="p-2 text-slate-400 hover:text-blue-600 transition-colors bg-slate-50 rounded-full disabled:opacity-50"
              title="רענן מחירי שוק"
            >
              <RefreshCcw size={16} className={isRefreshingPrices ? "animate-spin text-blue-500" : ""} />
            </button>
          </div>
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

        {activeTab === 'home' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-slate-900 rounded-[28px] p-7 text-white shadow-2xl relative overflow-hidden text-center">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 pointer-events-none"></div>
              <p className="text-slate-300 text-sm font-medium mb-2 opacity-80">שווי תיק נוכחי</p>
              <div className="flex justify-center items-baseline gap-2 mb-1">
                <h2 className="text-4xl font-black tracking-tight">₪{stats.currentTotalILS.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h2>
              </div>
              <p className="text-lg text-slate-400 font-medium mb-6">${stats.currentTotalUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>

              <div className="flex gap-4 border-t border-slate-700/50 pt-4">
                <div className="flex-1">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">תשואה כוללת</p>
                  <p className={`font-semibold text-sm flex justify-center items-center gap-1 ${stats.totalChangePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {stats.totalChangePct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    ₪{Math.abs(stats.totalChangeILS).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span className="text-xs ml-1 opacity-80" dir="ltr">({stats.totalChangePct > 0 ? '+' : ''}{stats.totalChangePct.toFixed(2)}%)</span>
                  </p>
                </div>
                <div className="flex-1 border-r border-slate-700/50 pr-4">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">שינוי יומי</p>
                  <p className={`font-semibold text-sm flex justify-center items-center gap-1 ${stats.dailyChangePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {stats.dailyChangePct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    ₪{Math.abs(stats.dailyChangeILS).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span className="text-xs ml-1 opacity-80" dir="ltr">({stats.dailyChangePct > 0 ? '+' : ''}{stats.dailyChangePct.toFixed(2)}%)</span>
                  </p>
                </div>
              </div>
            </div>

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

            {holdings.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 text-center shadow-sm border border-slate-100 mt-4">
                <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                  <Briefcase size={32} />
                </div>
                <p className="text-slate-500 font-medium mb-4">התיק שלך עדיין ריק.</p>
                <button onClick={() => setIsAdding(true)} className="text-blue-600 font-bold bg-blue-50 px-6 py-2 rounded-full">הוסף נכס ראשון</button>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedHoldings.map(h => {
                  const priceForCalc = h.currency === 'ILS' ? h.avgPrice / 100 : h.avgPrice;
                  const mData = marketData[h.symbol.trim().toUpperCase()] || { currentPrice: priceForCalc, dailyChangePct: 0 };
                  const currentPrice = mData.currentPrice;
                  const totalChangePct = priceForCalc > 0 ? ((currentPrice - priceForCalc) / priceForCalc) * 100 : 0;
                  const isProfit = totalChangePct >= 0;
                  const symbolCurrency = h.currency === 'USD' ? '$' : '₪';
                  const totalValueCurrency = h.quantity * currentPrice;
                  const totalValueILS = h.currency === 'USD' ? totalValueCurrency * usdRate : totalValueCurrency;
                  const isExpanded = expandedHoldingId === h.id;

                  return (
                    <div 
                      key={h.id} 
                      onClick={() => setExpandedHoldingId(isExpanded ? null : h.id)}
                      className="bg-white px-3 py-2.5 rounded-[16px] shadow-sm border border-slate-100 flex flex-col transition-all active:scale-[0.98] cursor-pointer select-none"
                    >
                      <div className="grid grid-cols-[18%_1fr_28%] gap-2 items-center w-full">
                        
                        <div className="flex flex-col overflow-hidden text-right w-full">
                          <span className="font-extrabold text-slate-900 text-base leading-tight truncate">{h.symbol}</span>
                          <span className="text-[8px] text-slate-400 font-bold truncate min-h-[12px]">{h.note || ''}</span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-1.5 rounded-[10px] w-full min-w-0">
                          <div className="flex flex-col items-center flex-1 min-w-0">
                            <span className="text-[8px] opacity-80 truncate">כמות</span>
                            <span className="font-bold text-slate-700 truncate w-full text-center">{h.quantity}</span>
                          </div>
                          <div className="w-px h-4 bg-slate-200 mx-1 shrink-0"></div>
                          <div className="flex flex-col items-center flex-1 min-w-0">
                            <span className="text-[8px] opacity-80 truncate">קניה</span>
                            <span className="font-bold text-slate-700 truncate w-full text-center" dir="ltr">{symbolCurrency}{priceForCalc.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="w-px h-4 bg-slate-200 mx-1 shrink-0"></div>
                          <div className="flex flex-col items-center flex-1 min-w-0">
                            <span className="text-[8px] opacity-80 truncate">נוכחי</span>
                            <span className="font-bold text-slate-700 truncate w-full text-center" dir="ltr">{symbolCurrency}{currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end overflow-hidden w-full text-left">
                           <span className="font-black text-slate-900 text-[13px] leading-tight truncate w-full text-left" dir="ltr">
                             ₪{totalValueILS.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                           </span>
                           <div className="flex items-center justify-end gap-1 mt-0.5 w-full flex-wrap">
                             {h.currency === 'USD' && (
                               <span className="text-[8.5px] font-bold text-slate-400 truncate">
                                 ${totalValueCurrency.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                               </span>
                             )}
                             <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${isProfit ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`} dir="ltr">
                                {isProfit ? '+' : ''}{totalChangePct.toFixed(1)}%
                             </span>
                           </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100 animate-in fade-in slide-in-from-top-1 duration-200">
                           <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5 uppercase bg-slate-50 px-2 py-1 rounded-md">
                             <Briefcase size={12} />
                             {h.platform}
                           </div>
                           <div className="flex items-center gap-2">
                             <button 
                               onClick={(e) => { e.stopPropagation(); openEditModal(h); setExpandedHoldingId(null); }} 
                               className="px-4 py-1.5 text-[11px] font-bold text-slate-500 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-lg flex items-center gap-1.5 transition-colors"
                             >
                               <Edit2 size={12} />
                               עריכה
                             </button>
                             <button 
                               onClick={(e) => { e.stopPropagation(); deleteHolding(h.id); }} 
                               className="px-4 py-1.5 text-[11px] font-bold text-slate-500 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg flex items-center gap-1.5 transition-colors"
                             >
                               <Trash2 size={12} />
                               מחיקה
                             </button>
                           </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <h2 className="text-2xl font-black text-slate-800 mb-2">פילוח התיק</h2>

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

        {activeTab === 'ai' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-[28px] p-6 text-white shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                  <BrainCircuit size={28} className="text-indigo-200" />
                </div>
                <div>
                  <h2 className="text-xl font-black">יועץ AI אישי</h2>
                  <p className="text-indigo-200 text-xs">יצירת פקודה להעתקה</p>
                </div>
              </div>
              <p className="text-sm text-indigo-100 leading-relaxed mb-6">
                במקום לנסות להתחבר בעצמנו, המערכת תייצר עבורך פקודה (Prompt) מושלמת המכילה את כל הנתונים של התיק שלך. פשוט צור את הפקודה, העתק אותה, והדבק ב-ChatGPT או ב-Gemini.
              </p>
              <button
                onClick={generateAiPrompt}
                disabled={holdings.length === 0}
                className="w-full bg-white text-indigo-900 font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-70 shadow-lg"
              >
                <Sparkles size={18} />
                צור פקודה לבינה מלאכותית
              </button>
            </div>

            {generatedPrompt && (
              <div className="space-y-4 animate-in slide-in-from-bottom-8 duration-500">
                <div className="bg-white p-5 rounded-[24px] shadow-sm border border-slate-200 relative">
                  <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <Edit2 size={16} className="text-indigo-500" /> הפקודה שלך מוכנה:
                    </h3>
                    <button 
                      onClick={copyToClipboard}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${isCopied ? 'bg-green-100 text-green-700' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
                    >
                      {isCopied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                      {isCopied ? 'הועתק בהצלחה!' : 'העתק טקסט'}
                    </button>
                  </div>
                  
                  <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 whitespace-pre-wrap font-medium leading-relaxed max-h-[40vh] overflow-y-auto" dir="rtl">
                    {generatedPrompt}
                  </div>
                  
                  <button 
                    onClick={copyToClipboard}
                    className={`w-full mt-4 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold transition-all ${isCopied ? 'bg-green-500 text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                  >
                    {isCopied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                    {isCopied ? 'הועתק ללוח!' : 'העתק והדבק ב-ChatGPT'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

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

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                <Settings size={24} className="text-blue-500" /> הגדרות API
              </h3>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-500 active:scale-90"><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-5 pb-2">
              
              <div>
                <label className="text-[12px] font-bold text-slate-800 uppercase tracking-wider mb-2 block text-blue-600">
                  חדש: מפתח למניות ארה״ב + ישראל (FMP) 🚀
                </label>
                <input 
                  placeholder="הדבק כאן מפתח של Financial Modeling Prep" 
                  className="w-full bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                  value={settings.fmpKey || ''} 
                  onChange={e => setSettings({ ...settings, fmpKey: e.target.value.trim() })} 
                />
                <p className="text-[11px] text-slate-500 mt-2 font-medium leading-relaxed">
                  הפתרון המומלץ והיציב ביותר שפותח את החסימות של בורסת תל אביב (ותעודות סל)! <br/>
                  <a href="https://site.financialmodelingprep.com/developer/docs" target="_blank" rel="noreferrer" className="text-blue-600 underline font-bold">הירשם בחינם כאן</a>, לחץ על "Get your free API Key", והדבק אותו למעלה.
                </p>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <label className="text-[12px] font-bold text-slate-800 uppercase tracking-wider mb-2 block text-slate-400">
                  מפתח למניות ארה״ב (Finnhub) - גיבוי
                </label>
                <input 
                  placeholder="הדבק כאן את מפתח ה-API של Finnhub" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-slate-400 font-bold text-sm text-slate-500"
                  value={settings.finnhubKey || ''} 
                  onChange={e => setSettings({ ...settings, finnhubKey: e.target.value.trim() })} 
                />
              </div>

              <button type="submit" className="w-full bg-slate-900 text-white font-black text-lg py-3.5 rounded-2xl shadow-xl active:scale-95 transition-all mt-4">
                שמור ועדכן מחירים
              </button>
            </form>
          </div>
        </div>
      )}

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

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">הערה (אופציונלי)</label>
                <input placeholder="לדוגמה: מחקה S&P 500" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                  value={formData.note || ''} onChange={e => setFormData({ ...formData, note: e.target.value })} />
              </div>

              <button type="submit" className="w-full bg-blue-600 text-white font-black text-lg py-4 rounded-2xl shadow-xl shadow-blue-200 active:scale-95 transition-all mt-4">
                {editingId ? 'שמור שינויים' : 'הוסף נכס לתיק'}
              </button>
            </form>
          </div>
        </div>
      )}

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
