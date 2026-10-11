// Runs before hydration; language queries carry preference across auth hosts.
export const localeInitScript = `
(function() {
  try {
    var locale = new URLSearchParams(location.search).get('lang');
    if (locale !== 'en' && locale !== 'ar') {
      try { locale = localStorage.getItem('elite-locale'); } catch (e) {}
    }
    if (locale !== 'en' && locale !== 'ar') {
      var match = document.cookie.match(/(?:^|; )elite-locale=(en|ar)(?:;|$)/);
      locale = match ? match[1] : 'ar';
    }
    if (locale === 'en' || locale === 'ar') {
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
      try { localStorage.setItem('elite-locale', locale); } catch (e) {}
      document.cookie = 'elite-locale=' + locale + '; Path=/; Max-Age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    } else {
      document.documentElement.lang = 'ar';
      document.documentElement.dir = 'rtl';
    }
  } catch (e) {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }
})();
`
