(function(){
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  },{threshold:.16});
  document.querySelectorAll('.reveal:not(.in)').forEach(function(el){io.observe(el);});

  // the citrus disc grows as the Why section scrolls — the whole coming into focus
  var inner=document.querySelector('.gcx-inner');
  var vis=document.getElementById('gcvis');
  function tick(){
    if(!inner||!vis) return;
    var r=inner.getBoundingClientRect(), vh=window.innerHeight;
    var total=r.height-vh;
    var p=total>0?Math.min(1,Math.max(0,(-r.top)/total)):0;
    vis.style.setProperty('--p',p.toFixed(3));
  }
  window.addEventListener('scroll',tick,{passive:true});
  window.addEventListener('resize',tick);
  tick();
})();

  // ── Field-note modals: click a Golden Circle statement → the day-one working synthesis ──
  (function(){
    function openFn(id){var m=document.getElementById(id);if(!m)return;m.classList.add('open');document.body.style.overflow='hidden';var x=m.querySelector('.fnm-x');if(x)x.focus();}
    function closeAll(){document.querySelectorAll('.fnm.open').forEach(function(m){m.classList.remove('open');});document.body.style.overflow='';}
    document.querySelectorAll('.fn-open').forEach(function(b){b.addEventListener('click',function(){openFn('fnm-'+b.getAttribute('data-fn'));});});
    document.querySelectorAll('.fnm [data-close]').forEach(function(el){el.addEventListener('click',closeAll);});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeAll();});
  })();

  // ── section rail: position in the left margin, track active section + scroll progress ──
  (function(){
    var rail=document.getElementById('srail'); if(!rail) return;
    var fill=document.getElementById('srfill');
    var items=[].slice.call(rail.querySelectorAll('a')).map(function(a){
      return {a:a, el:document.getElementById(a.getAttribute('data-sec'))};
    }).filter(function(x){return x.el;});
    var hero=document.querySelector('.hero');
    function place(){
      var wrap=document.querySelector('.identity-view .wrap')||document.querySelector('.wrap');
      if(!wrap) return;
      var r=wrap.getBoundingClientRect(), pad=26, w=rail.offsetWidth;
      var railLeft=window.innerWidth-pad-w;              // anchor to the right margin
      rail.style.left=railLeft+'px';
      rail._clears=(railLeft > r.right+6);               // only when it clears the content column
    }
    function tick(){
      var d=document.documentElement;
      var p=(d.scrollTop||document.body.scrollTop)/(d.scrollHeight-window.innerHeight);
      if(fill) fill.style.height=(Math.min(1,Math.max(0,p))*100)+'%';
      var heroPassed=hero?hero.getBoundingClientRect().bottom<90:true;   // start below the hero illustration
      rail.classList.toggle('show', !!rail._clears && heroPassed);
      var y=window.innerHeight*0.35, cur=items[0];
      items.forEach(function(s){ if(s.el.getBoundingClientRect().top<=y) cur=s; });
      items.forEach(function(s){ s.a.classList.toggle('on', s===cur); });
    }
    items.forEach(function(s){ s.a.addEventListener('click', function(e){ e.preventDefault(); s.el.scrollIntoView({behavior:'smooth',block:'start'}); }); });
    window.addEventListener('scroll',tick,{passive:true});
    window.addEventListener('resize',function(){place();tick();});
    place(); tick();
  })();
