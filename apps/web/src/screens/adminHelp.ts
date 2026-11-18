// Tooltip text for every editable config field, in the panel's languages.
import type { AdminLang } from './adminText';

type Help = Record<AdminLang, string>;

export const FIELD_HELP: Record<string, Help> = {
  startingBalance: {
    en: 'Coins and gems a new account starts with. Existing players keep their wallet.',
    fa: 'سکه و الماسی که حساب جدید با آن شروع می‌کند. کیف پول بازیکنان فعلی تغییر نمی‌کند.',
    ar: 'العملات والجواهر التي يبدأ بها الحساب الجديد. لا تتغير محافظ اللاعبين الحاليين.',
  },
  tutorialReward: {
    en: 'Paid once when a player finishes the tutorial.',
    fa: 'یک بار پس از تمام کردن آموزش پرداخت می‌شود.',
    ar: 'تُدفع مرة واحدة عند إنهاء الدرس التعليمي.',
  },
  dailyRewards: {
    en: 'The daily reward cycle: one entry per day; after the last day it starts again.',
    fa: 'چرخهٔ جایزهٔ روزانه: هر خانه یک روز؛ بعد از روز آخر از اول شروع می‌شود.',
    ar: 'دورة المكافأة اليومية: عنصر لكل يوم، وبعد اليوم الأخير تبدأ من جديد.',
  },
  rewardedAd: {
    en: 'Coins for watching an ad, and how many times per day.',
    fa: 'سکهٔ دیدن تبلیغ و تعداد دفعات مجاز در روز.',
    ar: 'عملات مشاهدة إعلان، وعدد المرات المسموح بها يوميًا.',
  },
  coins: { en: 'Amount of coins.', fa: 'مقدار سکه.', ar: 'عدد العملات.' },
  gems: { en: 'Amount of gems.', fa: 'مقدار الماس.', ar: 'عدد الجواهر.' },
  dailyCap: {
    en: 'How many rewarded ads a player may watch per day.',
    fa: 'هر بازیکن روزی چند تبلیغ جایزه‌دار می‌تواند ببیند.',
    ar: 'عدد إعلانات المكافأة التي يمكن مشاهدتها يوميًا.',
  },
  enabled: {
    en: 'Turns this feature on or off for every player.',
    fa: 'این قابلیت را برای همهٔ بازیکنان روشن یا خاموش می‌کند.',
    ar: 'يشغّل هذه الميزة أو يوقفها لجميع اللاعبين.',
  },
  clubTeams: {
    en: 'Real club teams in the shop. Turning it off hides them.',
    fa: 'تیم‌های باشگاهی واقعی در فروشگاه. خاموش کردن، آن‌ها را پنهان می‌کند.',
    ar: 'فرق الأندية الحقيقية في المتجر. إيقافها يخفيها.',
  },
  houseCut: {
    en: 'Share of both entry fees the game keeps (0.05 = 5%). The winner gets the rest.',
    fa: 'سهمی از دو ورودی که بازی برمی‌دارد (0.05 یعنی ۵٪). بقیه به برنده می‌رسد.',
    ar: 'حصة اللعبة من رسوم الدخول (0.05 = 5٪). يحصل الفائز على الباقي.',
  },
  entryFee: {
    en: 'Coins each player pays to play a match in this arena.',
    fa: 'سکه‌ای که هر بازیکن برای مسابقه در این آرنا می‌پردازد.',
    ar: 'العملات التي يدفعها كل لاعب للعب في هذه الساحة.',
  },
  minLevel: {
    en: 'Lowest player level that unlocks this.',
    fa: 'کمترین سطح بازیکن برای باز شدن این مورد.',
    ar: 'أدنى مستوى للاعب لفتح هذا العنصر.',
  },
  xpMultiplier: {
    en: 'Match XP is multiplied by this in this arena.',
    fa: 'XP مسابقه در این آرنا در این عدد ضرب می‌شود.',
    ar: 'تُضرب خبرة المباراة في هذه الساحة بهذا الرقم.',
  },
  theme: {
    en: 'Built-in board look used for every part without an uploaded image.',
    fa: 'ظاهر داخلی زمین برای هر بخشی که تصویر آپلود نشده دارد.',
    ar: 'المظهر المدمج للملعب لكل جزء بلا صورة مرفوعة.',
  },
  maxLevel: { en: 'Highest level a player can reach.', fa: 'بالاترین سطح قابل رسیدن.', ar: 'أعلى مستوى يمكن بلوغه.' },
  base: {
    en: 'XP needed for level 2; later levels scale from it.',
    fa: 'XP لازم برای سطح ۲؛ سطح‌های بعدی بر اساس آن بزرگ می‌شوند.',
    ar: 'الخبرة اللازمة للمستوى 2؛ وتتدرج المستويات التالية منها.',
  },
  exponent: {
    en: 'How fast the XP needed grows per level (1 = linear).',
    fa: 'سرعت رشد XP لازم در هر سطح (۱ یعنی خطی).',
    ar: 'سرعة نمو الخبرة اللازمة لكل مستوى (1 = خطي).',
  },
  win: { en: 'XP for winning a match.', fa: 'XP برد مسابقه.', ar: 'خبرة الفوز بمباراة.' },
  loss: { en: 'XP for losing a match.', fa: 'XP باخت مسابقه.', ar: 'خبرة خسارة مباراة.' },
  perGoal: { en: 'Extra XP for each goal scored.', fa: 'XP اضافه برای هر گل.', ar: 'خبرة إضافية لكل هدف.' },
  coinsPerLevel: {
    en: 'Coins on level-up, multiplied by the new level.',
    fa: 'سکهٔ رسیدن به سطح جدید، ضرب در شمارهٔ سطح.',
    ar: 'عملات الترقية مضروبة في رقم المستوى الجديد.',
  },
  gemsEveryNLevels: {
    en: 'Gems are given on every Nth level.',
    fa: 'هر چند سطح یک بار الماس داده می‌شود.',
    ar: 'تُمنح الجواهر كل عدد معين من المستويات.',
  },
  gemsAmount: { en: 'Gems given on those levels.', fa: 'الماس آن سطح‌ها.', ar: 'عدد الجواهر في تلك المستويات.' },
  goalsToWin: { en: 'Goals needed to win a match.', fa: 'تعداد گل لازم برای برد.', ar: 'عدد الأهداف اللازمة للفوز.' },
  turnTimeMs: {
    en: 'Time for one turn in milliseconds (15000 = 15 s). Team “time” changes it per team.',
    fa: 'زمان هر نوبت به میلی‌ثانیه (15000 یعنی ۱۵ ثانیه). ویژگی «زمان» تیم آن را تغییر می‌دهد.',
    ar: 'وقت الدور بالملي ثانية (15000 = 15 ث). خاصية «الوقت» للفريق تغيّره.',
  },
  timeoutForfeitCount: {
    en: 'Missed turns in a row that lose the match.',
    fa: 'تعداد نوبت از دست رفتهٔ پشت سر هم که باعث باخت می‌شود.',
    ar: 'عدد الأدوار الفائتة المتتالية التي تسبب الخسارة.',
  },
  maxShots: {
    en: 'Shot limit; then the leader wins or it is a draw.',
    fa: 'حداکثر شوت؛ بعد از آن تیم جلوتر می‌برد یا مساوی می‌شود.',
    ar: 'حد التسديدات؛ بعده يفوز المتقدم أو يتعادلان.',
  },
  radius: {
    en: 'Size (radius in pitch units).',
    fa: 'اندازه (شعاع به واحد زمین).',
    ar: 'الحجم (نصف القطر بوحدات الملعب).',
  },
  density: {
    en: 'Weight per area. Heavier bodies push lighter ones further.',
    fa: 'وزن نسبت به اندازه. جسم سنگین‌تر سبک‌تر را دورتر هل می‌دهد.',
    ar: 'الوزن بالنسبة للحجم. الأثقل يدفع الأخف أبعد.',
  },
  linearDamping: {
    en: 'Friction: higher stops sooner, lower rolls further.',
    fa: 'اصطکاک: بیشتر یعنی زودتر می‌ایستد، کمتر یعنی دورتر می‌رود.',
    ar: 'الاحتكاك: الأعلى يتوقف أسرع، والأقل يتدحرج أبعد.',
  },
  restitution: {
    en: 'Bounce: 0 stops dead on impact, 1 keeps all its speed.',
    fa: 'جهش: ۰ یعنی با برخورد می‌ایستد، ۱ یعنی تمام سرعتش می‌ماند.',
    ar: 'الارتداد: 0 يتوقف عند الاصطدام، 1 يحتفظ بكل سرعته.',
  },
  goalHalfWidth: {
    en: 'Half the width of the goal mouth. Bigger goals are easier to score.',
    fa: 'نصف عرض دهانهٔ دروازه. دروازهٔ بزرگ‌تر گل‌زدن را آسان‌تر می‌کند.',
    ar: 'نصف عرض فتحة المرمى. المرمى الأكبر أسهل للتسجيل.',
  },
  goalDepth: { en: 'Depth of the goal pocket.', fa: 'عمق دروازه.', ar: 'عمق المرمى.' },
  wallRestitution: {
    en: 'How strongly the walls bounce bodies back.',
    fa: 'شدت برگشت اجسام از دیواره.',
    ar: 'قوة ارتداد الأجسام عن الجدران.',
  },
  stopSpeed: {
    en: 'Below this speed a body counts as stopped.',
    fa: 'زیر این سرعت جسم متوقف حساب می‌شود.',
    ar: 'تحت هذه السرعة يُعتبر الجسم متوقفًا.',
  },
  maxImpulse: { en: 'Strongest possible flick.', fa: 'قوی‌ترین ضربهٔ ممکن.', ar: 'أقوى ضربة ممكنة.' },
  minImpulse: {
    en: 'Weakest flick that counts as a shot.',
    fa: 'ضعیف‌ترین ضربه‌ای که شوت حساب می‌شود.',
    ar: 'أضعف ضربة تُحسب تسديدة.',
  },
  maxStepsPerShot: {
    en: 'Longest a shot may run (60 steps = 1 s).',
    fa: 'بیشترین مدت یک شوت (۶۰ گام = ۱ ثانیه).',
    ar: 'أطول مدة للتسديدة (60 خطوة = 1 ث).',
  },
  boundsMargin: {
    en: 'How far outside the walls a body may go before the shot is void.',
    fa: 'فاصلهٔ مجاز بیرون از دیواره قبل از باطل شدن شوت.',
    ar: 'المسافة المسموحة خارج الجدران قبل إلغاء التسديدة.',
  },
  maxSimulations: {
    en: 'Shots the bot tries in its head each turn. More is stronger and slower.',
    fa: 'تعداد شوتی که ربات در هر نوبت امتحان می‌کند. بیشتر یعنی قوی‌تر و کندتر.',
    ar: 'عدد التسديدات التي يجربها البوت في كل دور. الأكثر أقوى وأبطأ.',
  },
  powerSteps: {
    en: 'Shot strengths the bot tries, as a share of full power (0-1).',
    fa: 'قدرت‌هایی که ربات امتحان می‌کند، به نسبت قدرت کامل (۰ تا ۱).',
    ar: 'قوى التسديد التي يجربها البوت كنسبة من القوة الكاملة (0-1).',
  },
  angleOffsetsDeg: {
    en: 'Angle tweaks in degrees the bot tries around each aim.',
    fa: 'انحراف‌های زاویه (درجه) که ربات اطراف هر نشانه امتحان می‌کند.',
    ar: 'انحرافات الزاوية بالدرجات التي يجربها البوت حول كل تصويب.',
  },
  bankShots: {
    en: 'Whether the bot plays off the walls.',
    fa: 'آیا ربات به دیواره شوت می‌زند.',
    ar: 'هل يسدد البوت عبر الجدران.',
  },
  lookAhead: {
    en: 'Whether the bot considers your reply before shooting.',
    fa: 'آیا ربات پاسخ شما را قبل از شوت در نظر می‌گیرد.',
    ar: 'هل يأخذ البوت ردك في الحسبان قبل التسديد.',
  },
  aimErrorDeg: {
    en: 'Random aim error in degrees. Higher makes the bot weaker.',
    fa: 'خطای تصادفی نشانه‌گیری به درجه. بیشتر یعنی ربات ضعیف‌تر.',
    ar: 'خطأ تصويب عشوائي بالدرجات. الأعلى يجعل البوت أضعف.',
  },
  powerError: {
    en: 'Random power error (0.1 = up to 10%).',
    fa: 'خطای تصادفی قدرت (0.1 یعنی تا ۱۰٪).',
    ar: 'خطأ قوة عشوائي (0.1 = حتى 10٪).',
  },
  defensiveWeight: {
    en: 'How much the bot cares about defending its own goal.',
    fa: 'میزان اهمیت دفاع از دروازهٔ خودی برای ربات.',
    ar: 'مدى اهتمام البوت بالدفاع عن مرماه.',
  },
  riskTolerance: {
    en: 'Willingness to take risky shots.',
    fa: 'تمایل ربات به شوت‌های پرریسک.',
    ar: 'استعداد البوت للتسديدات الخطرة.',
  },
  thinkTimeMs: {
    en: 'Pause before the bot shoots, in milliseconds.',
    fa: 'مکث ربات قبل از شوت به میلی‌ثانیه.',
    ar: 'توقف البوت قبل التسديد بالملي ثانية.',
  },
  price: {
    en: 'Shop price. Free items are owned by everyone.',
    fa: 'قیمت فروشگاه. آیتم رایگان مال همه است.',
    ar: 'سعر المتجر. العناصر المجانية يملكها الجميع.',
  },
  grant: {
    en: 'Currency the player receives from this pack.',
    fa: 'ارزی که بازیکن از این بسته می‌گیرد.',
    ar: 'العملة التي يحصل عليها اللاعب من هذه الحزمة.',
  },
  oneTime: {
    en: 'The pack can be claimed only once per player.',
    fa: 'هر بازیکن فقط یک بار می‌تواند این بسته را بگیرد.',
    ar: 'يمكن لكل لاعب أخذ الحزمة مرة واحدة فقط.',
  },
  force: {
    en: 'Shot power of this team (1-10).',
    fa: 'قدرت شوت این تیم (۱ تا ۱۰).',
    ar: 'قوة تسديد هذا الفريق (1-10).',
  },
  time: {
    en: 'Turn time of this team (1-10); higher gives more time.',
    fa: 'زمان نوبت این تیم (۱ تا ۱۰)؛ بیشتر یعنی وقت بیشتر.',
    ar: 'وقت دور هذا الفريق (1-10)؛ الأعلى يعطي وقتًا أكثر.',
  },
  aim: {
    en: 'Length of the aim guide (1-10).',
    fa: 'طول خط راهنمای نشانه‌گیری (۱ تا ۱۰).',
    ar: 'طول دليل التصويب (1-10).',
  },
  positions: {
    en: 'Kickoff spots of the five discs.',
    fa: 'جای شروع پنج مهره.',
    ar: 'مواضع بداية الأقراص الخمسة.',
  },
};
