/**
 * SohbaCore - Real Backend API Bridge, Shared State, Validation & Security Shield
 */
(function (global) {
  const KEYS = {
    USER: 'sohba_user_v2',
    TRIPS: 'sohba_trips_v2',
    PASS: 'sohba_pass_v1',
    DARK: 'sohba_dark_v1',
    LANG: 'sohba_lang_v1',
    SERVER_URL: 'sohba_server_url'
  };

  const DEFAULT_SERVER_URL = 'http://192.168.1.110:3000';

  function getApiBase() {
    try {
      const saved = global.localStorage ? global.localStorage.getItem(KEYS.SERVER_URL) : '';
      if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
      if (global.location && global.location.protocol.startsWith('http') && !/^(localhost|127\.0\.0\.1)$/i.test(global.location.hostname)) {
        return global.location.origin;
      }
    } catch (e) {}
    return DEFAULT_SERVER_URL;
  }

  function setApiBase(url) {
    try {
      const clean = String(url || '').trim().replace(/\/+$/, '');
      if (global.localStorage) {
        if (clean) global.localStorage.setItem(KEYS.SERVER_URL, clean);
        else global.localStorage.removeItem(KEYS.SERVER_URL);
      }
    } catch (e) {}
  }

  async function api(path, method, body) {
    const url = getApiBase() + path;
    const opts = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined && body !== null) {
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new Error('تعذر الاتصال بالسيرفر المحلي (' + getApiBase() + '). تأكد أن السيرفر يعمل وأن الجهازين على نفس شبكة الواي فاي.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || ('خطأ من السيرفر (' + res.status + ')'));
    }
    return data;
  }

  function safeRead(key, fallback) {
    try {
      const raw = global.localStorage ? global.localStorage.getItem(key) : null;
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function safeWrite(key, val) {
    try {
      if (global.localStorage) {
        if (val === null || val === undefined) global.localStorage.removeItem(key);
        else global.localStorage.setItem(key, JSON.stringify(val));
      }
    } catch (e) {}
  }

  function isValidEgyptianPhone(phone) {
    const p = String(phone || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
    return /^01[0125]\d{8}$/.test(p);
  }

  function normalizeDigits(phone) {
    return String(phone || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
  }

  function hasBlockedContactInfo(raw) {
    if (!raw || typeof raw !== 'string') return false;
    let s = raw.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[oO](?=\d)/g, '0').replace(/(\d)[oO]/g, '$10');
    if (/(واتس|واتساب|الواتس|whatsapp|whats\s*app|wa\.me|تليجرام|تيليجرام|تلجرام|telegram|t\.me|فيسبوك|فيس\s*بوك|facebook|fb\.com|انستا|انستجرام|instagram|ماسنجر|messenger)/i.test(s)) return true;
    if (/زيرو\s*(?:عشر[ةه]?|حد[اإ]شر|اتن[اإ]شر|خمسط[اإ]شر)|صفر\s*واحد\s*(?:صفر|واحد|اتنين|خمس[ةه])|\b01[0125]\b/i.test(s)) return true;
    let w = s.toLowerCase()
      .replace(/زيرو\s*عشر[ةه]?/g,'010').replace(/زيرو\s*حد[اإ]شر/g,'011').replace(/زيرو\s*اتن[اإ]شر/g,'012').replace(/زيرو\s*خمسط[اإ]شر/g,'015')
      .replace(/عشر[ةه]/g,'10').replace(/حد[اإ]شر/g,'11').replace(/اتن[اإ]شر/g,'12').replace(/تلات[اإ]شر/g,'13').replace(/أربعتاشر/g,'14').replace(/خمسط[اإ]شر/g,'15')
      .replace(/زيرو|صفر/g,'0').replace(/واحد/g,'1').replace(/اتنين|إثنين/g,'2').replace(/تلات[ةه]|ثلاث[ةه]/g,'3').replace(/اربع[ةه]|أربع[ةه]/g,'4')
      .replace(/خمس[ةه]/g,'5').replace(/ست[ةه]/g,'6').replace(/سبع[ةه]/g,'7').replace(/تَ?ماني[ةه]|تمنية/g,'8').replace(/تسع[ةه]/g,'9');
    const d1 = s.replace(/\D/g, ''), d2 = w.replace(/\D/g, '');
    if (/(?:01[0125]\d{2,}|201[0125]\d{2,})/.test(d1) || /(?:01[0125]\d{2,}|201[0125]\d{2,})/.test(d2)) return true;
    if (d1.length >= 5 || d2.length >= 5) return true;
    if (/(رقمي|نمرتي|موبايلي|فون|هات رقمك|ابعت رقمك|كلمنا فون|كلمني خاص|تواصل خاص)/i.test(s)) return true;
    return false;
  }

  function registerSW() {
    try {
      if (global.navigator && 'serviceWorker' in global.navigator && global.location && global.location.protocol.startsWith('http')) {
        global.navigator.serviceWorker.register('./sw.js').catch(() => {});
      }
    } catch (e) {}
  }

  function compressImageToDataUrl(file, maxDim) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('تعذر قراءة الصورة'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(reader.result);
        img.onload = () => {
          const limit = maxDim || 1200;
          let w = img.width, h = img.height;
          if (w > limit || h > limit) {
            if (w > h) { h = Math.round(h * limit / w); w = limit; }
            else { w = Math.round(w * limit / h); h = limit; }
          }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file, tag) {
    if (!file) throw new Error('لم يتم اختيار صورة');
    const dataUrl = await compressImageToDataUrl(file, 1200);
    const res = await api('/api/upload', 'POST', { tag: tag || 'doc', dataUrl });
    return res.url;
  }

  const ICO = {
    compass: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
    ticket: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>',
    settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
    plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    car: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>',
    bell: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    refresh: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
  };

  function subscribeEvents(onUpdate) {
    try {
      if (typeof EventSource === 'undefined') return null;
      const es = new EventSource(getApiBase() + '/api/events');
      es.onmessage = () => { if (typeof onUpdate === 'function') onUpdate(); };
      if (global.addEventListener) {
        global.addEventListener('pagehide', () => { try { es.close(); } catch (e) {} });
      }
      return es;
    } catch (e) { return null; }
  }

  function openGoogleMaps(pickup, city) {
    const q = encodeURIComponent([pickup || '', city || '', 'مصر'].filter(Boolean).join(' '));
    const url = 'https://www.google.com/maps/search/?api=1&query=' + q;
    if (global.open) global.open(url, '_blank');
    else if (global.location) global.location.href = url;
  }

  global.SohbaCore = {
    KEYS,
    ICO,
    DEFAULT_SERVER_URL,
    getApiBase,
    setApiBase,
    api,
    uploadImage,
    subscribeEvents,
    openGoogleMaps,
    getUser: () => safeRead(KEYS.USER, null),
    saveUser: (u) => { safeWrite(KEYS.USER, u); return u; },
    logout: () => { safeWrite(KEYS.USER, null); },
    getTrips: () => safeRead(KEYS.TRIPS, []),
    saveTrips: (list) => { safeWrite(KEYS.TRIPS, Array.isArray(list) ? list : []); return list; },
    isValidEgyptianPhone,
    normalizeDigits,
    hasBlockedContactInfo,
    registerSW
  };
})(typeof window !== 'undefined' ? window : globalThis);
