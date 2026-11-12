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
  // ---- submenu's in de menubalk (Wolven > Voorspelling): pijltje of (op een computer) zweven klapt ze uit ----
  var openItem = null, closeTimer = null;
  function setOpen(item, on){
    var toggle = item.querySelector('.nav-sub-toggle'), sub = item.querySelector('.nav-sub');
    if (!toggle || !sub) return;
    if (on){
      var r = item.getBoundingClientRect();
      sub.hidden = false;
      sub.style.top = Math.round(r.bottom - 2) + 'px';
      sub.style.left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - sub.offsetWidth - 8)) + 'px';
    } else {
      sub.hidden = true;
    }
    item.classList.toggle('open', on);
    toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
    openItem = on ? item : (openItem === item ? null : openItem);
  }
  function closeAll(){ if (openItem) setOpen(openItem, false); }
  var canHover = window.matchMedia && window.matchMedia('(hover:hover)').matches;
  Array.prototype.forEach.call(document.querySelectorAll('.nav-item.has-sub'), function(item){
    item.querySelector('.nav-sub-toggle').addEventListener('click', function(e){
      e.stopPropagation();
      var on = !item.classList.contains('open');
      closeAll();
      setOpen(item, on);
    });
    if (canHover){
      item.addEventListener('mouseenter', function(){ clearTimeout(closeTimer); if (!item.classList.contains('open')){ closeAll(); setOpen(item, true); } });
      item.addEventListener('mouseleave', function(){ closeTimer = setTimeout(function(){ setOpen(item, false); }, 180); });
      item.querySelector('.nav-sub').addEventListener('mouseenter', function(){ clearTimeout(closeTimer); });
      item.querySelector('.nav-sub').addEventListener('mouseleave', function(){ closeTimer = setTimeout(function(){ setOpen(item, false); }, 180); });
    }
  });
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && openItem){ var t = openItem.querySelector('.nav-sub-toggle'); closeAll(); t.focus(); }
  });
  window.addEventListener('resize', closeAll);
  window.addEventListener('scroll', closeAll, { passive:true });
})();
