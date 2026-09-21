// Knop "Naar boven" (wolven.html): verschijnt na 400 px scrollen.
(function(){
  var btn = document.getElementById('backToTop');
  if (!btn) return;
  var visible = false;
  function onScroll(){
    var shouldShow = window.scrollY > 400;
    if (shouldShow !== visible){
      visible = shouldShow;
      btn.classList.toggle('is-visible', visible);
    }
  }
  window.addEventListener('scroll', onScroll, { passive:true });
  onScroll();
  btn.addEventListener('click', function(){
    window.scrollTo({ top:0, behavior:'smooth' });
  });
})();
