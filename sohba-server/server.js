const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const WEB_DIR = path.resolve(__dirname, '..', 'صحبه النسخه النهائيه');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      topups: Array.isArray(parsed.topups) ? parsed.topups : []
    };
  } catch (e) {
    return { users: [], trips: [], reports: [], topups: [] };
  }
}

const sseClients = new Set();

function broadcastUpdate(reason) {
  const payload = `data: ${JSON.stringify({ reason: reason || 'sync', at: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { sseClients.delete(res); }
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  broadcastUpdate('db');
}

function hasBlockedContactInfo(text) {
  if (!text) return false;
  const map = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };
  const norm = String(text).replace(/[٠-٩۰-۹]/g, ch => map[ch] || ch).replace(/[\s\-_.*()]/g, '');
  if (/01[0125]\d{8}/.test(norm) || /\d{8,}/.test(norm)) return true;
  if (/(واتس|واتساب|whatsapp|تليجرام|telegram|تواصل\s*خاص|ابعت\s*رقم|كلمني\s*على)/i.test(text)) return true;
  return false;
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
        reject(new Error('حجم الصورة أو البيانات كبير جداً (أقصى 15 ميجا)'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  try {
    // Real-time Server-Sent Events stream
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('data: {"reason":"connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // Health check
    if (req.method === 'GET' && pathname === '/api/health') {
      const db = readDB();
      return sendJSON(res, 200, { ok: true, usersCount: db.users.length, tripsCount: db.trips.length, serverTime: new Date().toISOString() });
    }

    // Real Image Upload (base64 dataUrl -> file in uploads/)
    if (req.method === 'POST' && pathname === '/api/upload') {
      const b = await parseBody(req);
      const dataUrl = String(b.dataUrl || '');
      const m = dataUrl.match(/^data:image\/([a-z0-9+.-]+);base64,(.+)$/i);
      if (!m) return sendJSON(res, 400, { error: 'يرجى اختيار ملف صورة صالح' });
      const rawExt = m[1].toLowerCase();
      const ext = rawExt === 'jpeg' ? 'jpg' : (rawExt.includes('png') ? 'png' : (rawExt.includes('webp') ? 'webp' : 'jpg'));
      const safeTag = String(b.tag || 'doc').replace(/[^a-z0-9_-]/gi, '');
      const fileName = `${safeTag}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
      const outPath = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(outPath, Buffer.from(m[2], 'base64'));
      return sendJSON(res, 201, { url: '/uploads/' + fileName, fileName });
    }

    // Serve uploaded files
    if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
      const safeName = path.basename(pathname);
      const imgPath = path.join(UPLOADS_DIR, safeName);
      if (!fs.existsSync(imgPath)) {
        res.writeHead(404); return res.end('Not Found');
      }
      const ext = path.extname(imgPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'image/jpeg',
        'Access-Control-Allow-Origin': '*'
      });
      return fs.createReadStream(imgPath).pipe(res);
    }

    // Register
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const b = await parseBody(req);
      const name = String(b.name || '').trim();
      const phone = String(b.phone || '').trim();
      const password = String(b.password || '').trim();
      const sos = String(b.sos || '').trim();
      const role = b.role === 'owner' ? 'owner' : 'passenger';
      const car = String(b.car || '').trim();
      const carColor = String(b.carColor || '').trim();
      const acWorking = b.acWorking !== false;
      const plate = String(b.plate || '').trim();
      const kycDocs = b.kycDocs && typeof b.kycDocs === 'object' ? {
        nidUrl: String(b.kycDocs.nidUrl || ''),
        selfieUrl: String(b.kycDocs.selfieUrl || ''),
        licenseUrl: String(b.kycDocs.licenseUrl || ''),
        carPhotoUrl: String(b.kycDocs.carPhotoUrl || '')
      } : { nidUrl: '', selfieUrl: '', licenseUrl: '', carPhotoUrl: '' };

      if (name.length < 3) return sendJSON(res, 400, { error: 'يرجى إدخال الاسم بالكامل' });
      if (!/^01[0125]\d{8}$/.test(phone)) return sendJSON(res, 400, { error: 'رقم الموبايل يجب أن يكون 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015' });
      if (password.length < 4) return sendJSON(res, 400, { error: 'كلمة المرور يجب أن تكون 4 أحرف/أرقام على الأقل' });
      if (role === 'owner') {
        if (!car || !plate || !carColor) return sendJSON(res, 400, { error: 'يرجى إدخال موديل السيارة ولونها ورقم اللوحة' });
        if (!kycDocs.nidUrl || !kycDocs.selfieUrl || !kycDocs.licenseUrl || !kycDocs.carPhotoUrl) {
          return sendJSON(res, 400, { error: 'يجب رفع صور البطاقة والسيلفي والرخصة وصورة السيارة باللوحة للمراجعة' });
        }
      }

      const db = readDB();
      if (db.users.find(u => u.phone === phone)) {
        return sendJSON(res, 409, { error: 'رقم الموبايل مسجل بالفعل — استخدم تسجيل الدخول' });
      }

      const hasAnyDoc = Boolean(kycDocs.nidUrl || kycDocs.selfieUrl || kycDocs.licenseUrl);
      const user = {
        id: Date.now(),
        name,
        phone,
        password,
        sos,
        role,
        car: role === 'owner' ? car : '',
        carColor: role === 'owner' ? carColor : '',
        acWorking: role === 'owner' ? acWorking : true,
        plate: role === 'owner' ? plate : '',
        kycDocs,
        kycStatus: hasAnyDoc ? 'pending' : 'phone_only', // phone_only | pending | approved | rejected
        verified: false,
        banned: false,
        adminNote: '',
        rating: 5.0,
        ridesCount: 0,
        completedRides: 0,
        hasSohbaPass: false,
        walletBalance: 0,
        usedPromos: [],
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      writeDB(db);
      const { password: _, ...safeUser } = user;
      return sendJSON(res, 201, { user: safeUser });
    }

    // Login
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const b = await parseBody(req);
      const phone = String(b.phone || '').trim();
      const password = String(b.password || '').trim();
      const db = readDB();
      const user = db.users.find(u => u.phone === phone && u.password === password);
      if (!user) return sendJSON(res, 401, { error: 'رقم الموبايل أو كلمة المرور غير صحيحة' });
      if (user.banned) return sendJSON(res, 403, { error: '🚫 تم إيقاف هذا الحساب من قبل الإدارة' });
      const { password: _, ...safeUser } = user;
      return sendJSON(res, 200, { user: safeUser });
    }

    // Get current user profile (for live KYC status sync)
    if (req.method === 'GET' && pathname === '/api/users/me') {
      const phone = String(urlObj.searchParams.get('phone') || '').trim();
      const db = readDB();
      const user = db.users.find(u => u.phone === phone);
      if (!user) return sendJSON(res, 404, { error: 'المستخدم غير موجود' });
      const { password: _, ...safeUser } = user;
      return sendJSON(res, 200, { user: safeUser });
    }

    // Submit KYC documents for Admin review (Passenger or Owner)
    if (req.method === 'POST' && pathname === '/api/users/kyc') {
      const b = await parseBody(req);
      const phone = String(b.phone || '').trim();
      const nidUrl = String(b.nidUrl || '').trim();
      const selfieUrl = String(b.selfieUrl || '').trim();
      const licenseUrl = String(b.licenseUrl || '').trim();
      const carPhotoUrl = String(b.carPhotoUrl || '').trim();
      const db = readDB();
      const user = db.users.find(u => u.phone === phone);
      if (!user) return sendJSON(res, 404, { error: 'المستخدم غير موجود' });
      if (!nidUrl || !selfieUrl || (user.role === 'owner' && (!licenseUrl || !carPhotoUrl))) {
        return sendJSON(res, 400, { error: user.role === 'owner' ? 'للسائق: يجب رفع صور البطاقة والسيلفي والرخصة وصورة السيارة باللوحة' : 'يجب رفع صورة البطاقة وصورة السيلفي لإرسال طلب التوثيق' });
      }
      if (user.role === 'owner') {
        if (b.car) user.car = String(b.car).trim();
        if (b.carColor) user.carColor = String(b.carColor).trim();
        if (b.plate) user.plate = String(b.plate).trim();
        if (typeof b.acWorking === 'boolean') user.acWorking = b.acWorking;
      }
      user.kycDocs = Object.assign({}, user.kycDocs || {}, { nidUrl, selfieUrl, ...(licenseUrl ? { licenseUrl } : {}), ...(carPhotoUrl ? { carPhotoUrl } : {}) });
      user.kycStatus = 'pending';
      user.verified = false;
      user.adminNote = '';
      writeDB(db);
      const { password: _, ...safeUser } = user;
      return sendJSON(res, 200, { user: safeUser });
    }

    // Wallet top-up request (0% gateway fee via InstaPay / Vodafone Cash)
    if (req.method === 'POST' && pathname === '/api/wallet/topup') {
      const b = await parseBody(req);
      const phone = String(b.phone || '').trim();
      const amount = Number(b.amount) || 0;
      const receiptUrl = String(b.receiptUrl || '').trim();
      if (amount < 20) return sendJSON(res, 400, { error: 'أقل مبلغ للشحن ٢٠ ج.م' });
      if (!receiptUrl) return sendJSON(res, 400, { error: 'يرجى رفع صورة إيصال التحويل' });
      const db = readDB();
      const user = db.users.find(u => u.phone === phone);
      if (!user) return sendJSON(res, 404, { error: 'المستخدم غير موجود' });
      const topup = {
        id: Date.now(),
        phone,
        name: user.name,
        amount,
        method: String(b.method || 'InstaPay'),
        receiptUrl,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      db.topups.unshift(topup);
      writeDB(db);
      return sendJSON(res, 201, { topup });
    }

    // Update SOS emergency phone
    if (req.method === 'POST' && pathname === '/api/users/sos') {
      const b = await parseBody(req);
      const phone = String(b.phone || '').trim();
      const sos = String(b.sos || '').trim();
      if (!/^01[0125]\d{8}$/.test(sos)) return sendJSON(res, 400, { error: 'يرجى إدخال رقم طوارئ مصري صحيح' });
      const db = readDB();
      const user = db.users.find(u => u.phone === phone);
      if (!user) return sendJSON(res, 404, { error: 'المستخدم غير موجود' });
      user.sos = sos;
      writeDB(db);
      const { password: _, ...safeUser } = user;
      return sendJSON(res, 200, { user: safeUser });
    }

    // Subscribe/toggle Sohba Pass (99 EGP/month - requires 99 EGP wallet balance!)
    if (req.method === 'POST' && pathname === '/api/users/sohba-pass') {
      const b = await parseBody(req);
      const phone = String(b.phone || '').trim();
      const db = readDB();
      const user = db.users.find(u => u.phone === phone);
      if (!user) return sendJSON(res, 404, { error: 'المستخدم غير موجود' });
      const wantActive = Boolean(b.active);
      if (wantActive && !user.hasSohbaPass) {
        const bal = Number(user.walletBalance) || 0;
        if (bal < 99) {
          return sendJSON(res, 400, { error: `❌ رصيد المحفظة غير كافٍ (مطلوب ٩٩ ج، رصيدك ${bal} ج) — اشحن المحفظة أولاً` });
        }
        user.walletBalance = bal - 99;
      }
      user.hasSohbaPass = wantActive;
      writeDB(db);
      const { password: _, ...safeUser } = user;
      return sendJSON(res, 200, { user: safeUser });
    }

    // Owner request car/plate change -> requires new license photo & Admin re-approval
    if (req.method === 'POST' && pathname === '/api/users/car-change') {
      const b = await parseBody(req);
      const phone = String(b.phone || '').trim();
      const car = String(b.car || '').trim();
      const plate = String(b.plate || '').trim();
      const licenseUrl = String(b.licenseUrl || '').trim();
      if (!car || !plate || !licenseUrl) {
        return sendJSON(res, 400, { error: 'مطلوب موديل السيارة الجديد ورقم اللوحة وصورة الرخصة الجديدة' });
      }
      const db = readDB();
      const user = db.users.find(u => u.phone === phone);
      if (!user) return sendJSON(res, 404, { error: 'المستخدم غير موجود' });
      user.car = car;
      user.plate = plate;
      user.kycDocs = Object.assign({}, user.kycDocs || {}, { licenseUrl });
      user.kycStatus = 'pending';
      user.verified = false;
      user.adminNote = 'طلب تغيير سيارة ورخصة';
      writeDB(db);
      const { password: _, ...safeUser } = user;
      return sendJSON(res, 200, { user: safeUser });
    }

    // Get all trips
    if (req.method === 'GET' && pathname === '/api/trips') {
      const db = readDB();
      return sendJSON(res, 200, { trips: db.trips });
    }

    // Publish new trip (owner) - strict verification required
    if (req.method === 'POST' && pathname === '/api/trips') {
      const b = await parseBody(req);
      const db = readDB();
      const owner = db.users.find(u => u.phone === b.driverPhone);
      if (!owner || !owner.verified || owner.kycStatus !== 'approved' || !owner.kycDocs || !owner.kycDocs.nidUrl || !owner.kycDocs.licenseUrl) {
        return sendJSON(res, 403, { error: '🔒 ممنوع نشر رحلة برقم التليفون فقط — لازم ترفع البطاقة والرخصة وتعتمدها الإدارة أولاً!' });
      }
      const trip = {
        id: Date.now(),
        driver: b.driverName || (owner ? owner.name : 'كابتن صُحبة'),
        driverPhone: b.driverPhone || '',
        car: b.car || (owner ? owner.car : 'سيارة خاصة'),
        carColor: owner ? (owner.carColor || '') : '',
        carPhotoUrl: owner && owner.kycDocs ? (owner.kycDocs.carPhotoUrl || '') : '',
        plate: b.plate || (owner ? owner.plate : 'غير محددة'),
        from: b.from || 'مرسى مطروح',
        to: b.to || 'القاهرة',
        date: b.date || new Date().toISOString().slice(0, 10),
        time: b.time || '09:00 ص',
        duration: b.duration || 'بعد ٥ ساعات',
        seats: Math.max(1, Number(b.seats) || 3),
        totalSeats: Math.max(1, Number(b.seats) || 3),
        price: Math.max(50, Number(b.price) || 350),
        depositFee: 40,
        pickup: b.pickup || 'نقطة التجمع المتفق عليها',
        ladiesOnly: Boolean(b.ladiesOnly),
        noSmoking: b.noSmoking !== false,
        ac: owner ? (owner.acWorking !== false) : (b.ac !== false),
        verified: owner ? Boolean(owner.verified) : false,
        rating: owner ? owner.rating : 5.0,
        rides: owner ? owner.ridesCount : 0,
        largeBagsUsed: 0,
        status: 'scheduled',
        gpsConfirmed: false,
        bookings: [],
        messages: [],
        createdAt: new Date().toISOString()
      };
      db.trips.unshift(trip);
      writeDB(db);
      return sendJSON(res, 201, { trip });
    }

    // Trip sub-routes: /api/trips/:id/:action
    const tripMatch = pathname.match(/^\/api\/trips\/(\d+)\/(book|checkin|mismatch|cancel|messages|rate|rate-passenger|docs|status|remove-passenger)$/);
    if (tripMatch && req.method === 'POST') {
      const tripId = Number(tripMatch[1]);
      const action = tripMatch[2];
      const b = await parseBody(req);
      const db = readDB();
      const trip = db.trips.find(t => t.id === tripId);
      if (!trip) return sendJSON(res, 404, { error: 'الرحلة غير موجودة' });

      if (action === 'status') {
        if (b.action === 'ready') {
          trip.status = 'ready';
          trip.gpsConfirmed = true;
        } else if (b.action === 'start') {
          trip.status = 'in_progress';
          trip.startedAt = new Date().toISOString();
        } else if (b.action === 'complete') {
          trip.status = 'completed';
          trip.completedAt = new Date().toISOString();
          const owner = db.users.find(u => u.phone === trip.driverPhone);
          if (owner) {
            owner.ridesCount = (owner.ridesCount || 0) + 1;
            trip.rides = owner.ridesCount;
          }
          (trip.bookings || []).forEach(bk => {
            if (bk.status === 'boarded') {
              const pu = db.users.find(u => u.phone === bk.passengerPhone);
              if (pu) pu.completedRides = (pu.completedRides || 0) + 1;
            }
          });
        } else if (b.action === 'update_time' && b.time) {
          trip.time = String(b.time);
        }
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }

      if (action === 'remove-passenger') {
        const bk = (trip.bookings || []).find(x => x.passengerPhone === b.passengerPhone && x.status !== 'cancelled');
        if (!bk) return sendJSON(res, 404, { error: 'الراكب غير موجود' });
        bk.status = 'cancelled';
        trip.seats += 1;
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }

      if (action === 'book') {
        const passengerPhone = String(b.passengerPhone || '').trim();
        const passengerName = String(b.passengerName || 'مسافر').trim();
        if (!passengerPhone) return sendJSON(res, 400, { error: 'بيانات المسافر مطلوبة' });
        if (trip.bookings.find(bk => bk.passengerPhone === passengerPhone && bk.status !== 'cancelled')) {
          return sendJSON(res, 400, { error: 'أنت حاجز بالفعل في هذه الرحلة' });
        }
        if (trip.seats <= 0) return sendJSON(res, 400, { error: 'لا توجد مقاعد متاحة' });
        const paxUser = db.users.find(u => u.phone === passengerPhone);
        if (trip.ladiesOnly && (!paxUser || !paxUser.verified || paxUser.kycStatus !== 'approved')) {
          return sendJSON(res, 403, { error: '👩🏻 رحلات «سيدات وعائلات» متاحة فقط للحسابات الموثقة بالبطاقة والسيلفي حفاظاً على الأمان!' });
        }
        const bagDesc = String(b.bagDesc || 'شنطة سفر متوسطة').trim();
        const isLargeBag = bagDesc.includes('كبيرة') || bagDesc.toLowerCase().includes('large');
        if (isLargeBag && (trip.largeBagsUsed || 0) >= 2) {
          return sendJSON(res, 400, { error: '⚠️ شنطة العربية مكتملة للشنط الكبيرة (الحد الأقصى ٢ شنطة كبيرة)' });
        }
        const promoCode = String(b.promoCode || '').trim().toUpperCase();
        const isFree5th = paxUser && ((paxUser.completedRides || 0) % 5 === 4);
        const hasPass = Boolean(paxUser && paxUser.hasSohbaPass);
        if (promoCode && !hasPass && !isFree5th) {
          if (paxUser && Array.isArray(paxUser.usedPromos) && paxUser.usedPromos.includes(promoCode)) {
            return sendJSON(res, 400, { error: '❌ تم استخدام هذا الكوبون من قبل (الاستخدام مرة واحدة فقط للحساب)!' });
          }
          if (paxUser) {
            paxUser.usedPromos = Array.isArray(paxUser.usedPromos) ? paxUser.usedPromos : [];
            paxUser.usedPromos.push(promoCode);
          }
        }
        const depositPaid = (hasPass || isFree5th) ? 0 : (promoCode ? Math.max(15, (trip.depositFee || 40) - 10) : (trip.depositFee || 40));
        const useWallet = b.payMethod === 'wallet' && !hasPass && !isFree5th;
        if (useWallet) {
          const bal = Number(paxUser && paxUser.walletBalance) || 0;
          if (bal < depositPaid) {
            return sendJSON(res, 400, { error: `❌ رصيد المحفظة غير كافٍ (${bal} ج) — اشحن المحفظة أو ادفع بإيصال` });
          }
          paxUser.walletBalance = bal - depositPaid;
        }
        trip.seats -= 1;
        if (isLargeBag) trip.largeBagsUsed = (trip.largeBagsUsed || 0) + 1;
        const boardingCode = String(Math.floor(1000 + Math.random() * 9000));
        trip.bookings.push({
          passengerPhone,
          passengerName,
          payMethod: (hasPass || isFree5th) ? (isFree5th ? 'مكافأة الرحلة 5 مجاناً' : 'باقة صُحبة') : (useWallet ? 'رصيد المحفظة' : (b.payMethod || 'InstaPay')),
          bagDesc,
          promoCode: promoCode || '',
          depositPaid,
          receiptUrl: String(b.receiptUrl || ''),
          receiptStatus: (hasPass || isFree5th || useWallet) ? 'approved' : (b.receiptUrl ? 'pending' : 'none'),
          bagPhotoUrl: String(b.bagPhotoUrl || ''),
          boardingCode,
          status: 'booked',
          bookedAt: new Date().toISOString()
        });
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }

      if (action === 'docs') {
        const bk = trip.bookings.find(x => x.passengerPhone === b.passengerPhone && x.status !== 'cancelled');
        if (!bk) return sendJSON(res, 404, { error: 'الحجز غير موجود' });
        if (b.receiptUrl) { bk.receiptUrl = String(b.receiptUrl); bk.receiptStatus = 'pending'; }
        if (b.bagPhotoUrl) { bk.bagPhotoUrl = String(b.bagPhotoUrl); }
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }

      if (action === 'checkin') {
        const bk = trip.bookings.find(x => x.passengerPhone === b.passengerPhone && x.status === 'booked');
        if (!bk) return sendJSON(res, 400, { error: 'الحجز غير موجود أو تم تأكيد الركوب مسبقاً' });
        const code = String(b.boardingCode || '').trim();
        if (b.verifiedByDriver && code !== String(bk.boardingCode)) {
          return sendJSON(res, 400, { error: '❌ كود الركوب غير صحيح — اطلب الكود المكون من 4 أرقام من المسافر' });
        }
        if (!b.verifiedByDriver && !code) {
          return sendJSON(res, 400, { error: '🔐 لتأكيد الركوب ومنع التلاعب: أعطِ كود تذكرتك (#SHB-' + bk.boardingCode + ') لصاحب العربية ليدخله عنده، أو أدخل رقم لوحة السيارة' });
        }
        if (!b.verifiedByDriver && code.replace(/\s+/g, '') !== String(trip.plate || '').replace(/\s+/g, '')) {
          return sendJSON(res, 400, { error: '❌ رقم اللوحة المدخل غير مطابق للوحة السيارة المسجلة!' });
        }
        bk.status = 'boarded';
        bk.boardedAt = new Date().toISOString();
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }

      if (action === 'mismatch') {
        const actualPlate = String(b.actualPlate || '').trim();
        const photoUrl = String(b.photoUrl || '').trim();
        if (!actualPlate || !photoUrl) {
          return sendJSON(res, 400, { error: 'مطلوب رقم اللوحة الفعلية وصورة حية مرفوعة لإثبات البلاغ' });
        }
        const bk = trip.bookings.find(x => x.passengerPhone === b.passengerPhone && x.status !== 'cancelled');
        if (bk) {
          bk.status = 'mismatch_pending';
          bk.reportedPlate = actualPlate;
          bk.reportedPhotoUrl = photoUrl;
        }
        trip.seats += 1;
        db.reports.push({
          id: Date.now(),
          tripId: trip.id,
          driverName: trip.driver,
          driverPhone: trip.driverPhone,
          passengerPhone: b.passengerPhone,
          passengerName: bk ? bk.passengerName : 'مسافر',
          expectedPlate: trip.plate,
          actualPlate,
          photoUrl,
          status: 'escrow_hold',
          createdAt: new Date().toISOString()
        });
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }

      if (action === 'cancel') {
        if (b.byOwner) {
          (trip.bookings || []).forEach(bk => {
            if (bk.status === 'booked') {
              const pu = db.users.find(u => u.phone === bk.passengerPhone);
              if (pu) pu.walletBalance = (pu.walletBalance || 0) + (bk.depositPaid || 0);
            }
          });
          db.trips = db.trips.filter(t => t.id !== tripId);
          writeDB(db);
          return sendJSON(res, 200, { deleted: true });
        }
        const bk = trip.bookings.find(x => x.passengerPhone === b.passengerPhone && x.status === 'booked');
        if (!bk) return sendJSON(res, 400, { error: 'لا يوجد حجز نشط لإلغائه' });
        bk.status = 'cancelled';
        trip.seats += 1;
        if ((bk.bagDesc || '').includes('كبيرة') && (trip.largeBagsUsed || 0) > 0) trip.largeBagsUsed -= 1;
        const refundAmt = b.lateCancel ? Math.round((bk.depositPaid || 0) * 0.5) : (bk.depositPaid || 0);
        const pu = db.users.find(u => u.phone === b.passengerPhone);
        if (pu) pu.walletBalance = (pu.walletBalance || 0) + refundAmt;
        writeDB(db);
        return sendJSON(res, 200, { trip, refundAmt });
      }

      if (action === 'messages') {
        const text = String(b.text || '').trim();
        if (!text) return sendJSON(res, 400, { error: 'الرسالة فارغة' });
        if (hasBlockedContactInfo(text)) {
          return sendJSON(res, 403, { error: '🛡️ ممنوع إرسال أرقام الهواتف أو روابط تواصل خارج التطبيق لحماية الأمان.' });
        }
        trip.messages.push({
          id: Date.now(),
          senderPhone: b.senderPhone || '',
          senderName: b.senderName || 'مستخدم',
          senderRole: b.senderRole === 'owner' ? 'owner' : 'passenger',
          text,
          at: new Date().toISOString()
        });
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }

      if (action === 'rate') {
        const rating = Math.min(5, Math.max(1, Number(b.rating) || 5));
        const bk = trip.bookings.find(x => x.passengerPhone === b.passengerPhone);
        if (!bk || bk.status !== 'boarded') {
          return sendJSON(res, 403, { error: '⚠️ التقييم متاح فقط بعد تأكيد ركوب الرحلة فعلياً' });
        }
        bk.userRating = rating;
        const owner = db.users.find(u => u.phone === trip.driverPhone);
        if (owner) {
          const allRatings = db.trips.filter(t => t.driverPhone === owner.phone).flatMap(t => (t.bookings || []).map(x => x.userRating).filter(Boolean));
          if (allRatings.length) owner.rating = Number((allRatings.reduce((a, c) => a + c, 0) / allRatings.length).toFixed(1));
        }
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }

      if (action === 'rate-passenger') {
        const rating = Math.min(5, Math.max(1, Number(b.rating) || 5));
        const bk = trip.bookings.find(x => x.passengerPhone === b.passengerPhone && x.status !== 'cancelled');
        if (!bk) return sendJSON(res, 404, { error: 'الراكب غير موجود' });
        bk.driverRating = rating;
        writeDB(db);
        return sendJSON(res, 200, { trip });
      }
    }

    // ==================== ADMIN API ====================
    if (req.method === 'GET' && pathname === '/api/admin/overview') {
      const db = readDB();
      const safeUsers = db.users.map(({ password, ...rest }) => rest);
      return sendJSON(res, 200, {
        users: safeUsers,
        trips: db.trips,
        reports: db.reports,
        topups: db.topups
      });
    }

    const adminTopupMatch = pathname.match(/^\/api\/admin\/topups\/(\d+)\/verify$/);
    if (adminTopupMatch && req.method === 'POST') {
      const tid = Number(adminTopupMatch[1]);
      const b = await parseBody(req);
      const db = readDB();
      const topup = db.topups.find(x => x.id === tid);
      if (!topup) return sendJSON(res, 404, { error: 'طلب الشحن غير موجود' });
      if (topup.status !== 'pending') return sendJSON(res, 400, { error: 'تمت مراجعة هذا الطلب مسبقاً' });
      if (b.action === 'approve') {
        topup.status = 'approved';
        const u = db.users.find(x => x.phone === topup.phone);
        if (u) u.walletBalance = (Number(u.walletBalance) || 0) + Number(topup.amount || 0);
      } else {
        topup.status = 'rejected';
      }
      writeDB(db);
      return sendJSON(res, 200, { ok: true, topup });
    }

    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/(verify|ban)$/);
    if (adminUserMatch && req.method === 'POST') {
      const uid = Number(adminUserMatch[1]);
      const act = adminUserMatch[2];
      const b = await parseBody(req);
      const db = readDB();
      const user = db.users.find(u => u.id === uid);
      if (!user) return sendJSON(res, 404, { error: 'المستخدم غير موجود' });
      if (act === 'verify') {
        const approve = b.action === 'approve';
        user.kycStatus = approve ? 'approved' : 'rejected';
        user.verified = approve;
        user.adminNote = String(b.note || '');
        db.trips.forEach(t => { if (t.driverPhone === user.phone) t.verified = approve; });
      } else if (act === 'ban') {
        user.banned = Boolean(b.banned);
      }
      writeDB(db);
      return sendJSON(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/admin/bookings/verify') {
      const b = await parseBody(req);
      const db = readDB();
      const trip = db.trips.find(t => t.id === Number(b.tripId));
      if (!trip) return sendJSON(res, 404, { error: 'الرحلة غير موجودة' });
      const bk = (trip.bookings || []).find(x => x.passengerPhone === b.passengerPhone && x.status !== 'cancelled');
      if (!bk) return sendJSON(res, 404, { error: 'الحجز غير موجود' });
      bk.receiptStatus = b.action === 'approve' ? 'approved' : 'rejected';
      writeDB(db);
      return sendJSON(res, 200, { ok: true });
    }

    const adminReportMatch = pathname.match(/^\/api\/admin\/reports\/(\d+)\/resolve$/);
    if (adminReportMatch && req.method === 'POST') {
      const rid = Number(adminReportMatch[1]);
      const b = await parseBody(req);
      const db = readDB();
      const rep = db.reports.find(r => r.id === rid);
      if (!rep) return sendJSON(res, 404, { error: 'البلاغ غير موجود' });
      rep.status = b.resolution === 'refund_passenger' ? 'refunded_to_passenger' : 'forfeited_to_driver';
      rep.resolvedAt = new Date().toISOString();
      writeDB(db);
      return sendJSON(res, 200, { ok: true });
    }

    // Serve static files from WEB_DIR
    let filePath = path.join(WEB_DIR, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    if (!filePath.startsWith(WEB_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    sendJSON(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sohba Local Server running on http://0.0.0.0:${PORT}`);
});
