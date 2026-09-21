// Licht/donker-knop (gedeeld door alle pagina's). De keuze wordt per bezoeker onthouden; de kleine inline-code in <head> van elke pagina zet hem
// bij het laden meteen, zodat er geen flits is.
(function(){
  // ---- theme toggle (light/dark), persisted per-viewer ----
  var THEME_KEY = 'wolvenkaart-theme';
  var themeToggle = document.getElementById('themeToggle');
  function currentTheme(){
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch(e){}
    themeToggle.setAttribute('aria-label', t === 'dark' ? 'Zet lichte modus aan' : 'Zet donkere modus aan');
  }
  if (themeToggle){
    // don't force an explicit attribute on load (that would stop the page from
    // following live OS theme changes) — only set one once the viewer actually toggles
    themeToggle.setAttribute('aria-label', currentTheme() === 'dark' ? 'Zet lichte modus aan' : 'Zet donkere modus aan');
    themeToggle.addEventListener('click', function(){
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  // ---- de actieve knop in het menu (de pagina waar je bent) scrolt naar boven ----
  var activeNav = document.querySelector('.nav-link.active');
  if (activeNav){
    activeNav.addEventListener('click', function(){
      window.scrollTo({ top:0, behavior:'smooth' });
    });
  }
})();
