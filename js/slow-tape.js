/* =====================================================================
   천천히 흐르는 실시간 시세 띠 (공개판 note3와 live 페이지가 함께 씀)
   ---------------------------------------------------------------------
   왜 만들었나요?
     TradingView의 '흐르는 띠(ticker-tape)' 위젯은 속도를 바꾸는 설정이 없어서
     종목이 너무 빨리 지나가요.
   어떻게 하나요?
     1) TradingView의 '움직이지 않는 시세 칸(Tickers)' 위젯을 여러 개 가로로 이어 붙여요.
        (Tickers 위젯 하나에는 종목을 15개까지 넣을 수 있어서, 56종목이면 4개를 붙여요.)
     2) 그 긴 줄을 우리 코드가 1초에 SPEED 픽셀씩 왼쪽으로 밀어요. → 속도를 우리가 정해요.
     3) 끝까지 가면 살짝 사라졌다가 처음부터 다시 흘러요.
     4) 손가락(또는 마우스)으로 띠를 밀면 그 자리에서 몇 초 멈췄다가 다시 흘러요.
        마우스를 띠 위에 올려 두면 멈춰요.
     5) 기기에 '동작 줄이기'가 켜져 있으면 자동으로 흐르지 않고 손으로만 밀어요.
   가격 자체는 TradingView 위젯 안에서 실시간으로 바뀌어요(우리 코드는 위치만 움직여요).
   ===================================================================== */
(function () {
  "use strict";

  /* ---- 바꾸기 쉬운 숫자들 ---- */
  var SPEED = 30;          // 1초에 몇 픽셀 흐를지. 작을수록 천천히 (예: 20 = 아주 천천히, 60 = 빠르게)
  var ITEM_W = 190;        // 종목 하나가 차지하는 폭(px). TradingView 칸은 대략 이 정도가 있어야 안 잘려요
  var PER_WIDGET = 15;     // Tickers 위젯 하나에 넣을 수 있는 최대 종목 수 (TradingView 제한)
  var PAUSE_AFTER_TOUCH = 4000;  // 손으로 민 뒤 다시 흐르기까지 기다리는 시간(밀리초 = 1/1000초)
  var HOLD_AT_START = 1500;      // 처음 위치에서 잠깐 쉬는 시간
  var SRC = "https://s3.tradingview.com/external-embedding/embed-widget-tickers.js";

  /* 스크롤 막대를 숨기는 모양(CSS)을 페이지에 한 번만 넣어요 */
  function addStyle() {
    if (document.getElementById("slowTapeStyle")) return;
    var st = document.createElement("style");
    st.id = "slowTapeStyle";
    st.textContent =
      ".st-view{overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;transition:opacity .5s}" +
      ".st-view::-webkit-scrollbar{display:none}" +
      ".st-track{display:flex;width:max-content}" +
      ".st-part{flex:none}" +
      ".st-part .tradingview-widget-copyright{display:none}";   // 출처는 페이지에 따로 표시해요
    document.head.appendChild(st);
  }

  /* 배열을 n개씩 자르기: [1..56] → [[1..15],[16..30],[31..45],[46..56]] */
  function chunk(list, n) {
    var out = [];
    for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
  }

  /* =====================================================================
     SlowTape.mount(box, 설정) → 띠를 그리고, 나중에 지울 때 쓸 { destroy } 를 돌려줘요.
       box      : 띠를 넣을 상자(HTML 요소). 안의 내용은 지우고 새로 그려요.
       설정.symbols : [{ proName: 'NASDAQ:AAPL', title: '애플' }, ...]
       설정.theme   : 'light' 또는 'dark'
       설정.onLoaded: 첫 위젯 화면이 생기면 불러요(‘불러오는 중’ 글자 숨기기용)
       설정.onError : TradingView에 연결하지 못하면 불러요
     ===================================================================== */
  function mount(box, opt) {
    addStyle();
    var symbols = opt.symbols || [];
    var view = document.createElement("div");   // 보이는 창 (가로로 밀 수 있음)
    view.className = "st-view";
    var track = document.createElement("div");  // 긴 줄 (위젯들이 나란히)
    track.className = "st-track";
    view.appendChild(track);

    var loadedOnce = false;
    chunk(symbols, PER_WIDGET).forEach(function (part) {
      var holder = document.createElement("div");
      holder.className = "st-part tradingview-widget-container";
      holder.style.width = part.length * ITEM_W + "px";      // 종목 수만큼 폭을 정해 줘야 칸이 안 빠져요
      var inner = document.createElement("div");
      inner.className = "tradingview-widget-container__widget";
      var s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.textContent = JSON.stringify({
        symbols: part.map(function (d) { return { proName: d.proName, title: d.title }; }),
        isTransparent: true, showSymbolLogo: true, colorTheme: opt.theme || "light", locale: "kr"
      });
      s.onerror = function () { if (opt.onError) opt.onError(); };
      // 위젯 화면(iframe)이 처음 생기면 알려 줘요
      var ob = new MutationObserver(function () {
        if (holder.querySelector("iframe")) {
          ob.disconnect();
          if (!loadedOnce) { loadedOnce = true; if (opt.onLoaded) opt.onLoaded(); }
        }
      });
      ob.observe(holder, { childList: true, subtree: true });
      holder.appendChild(inner);
      holder.appendChild(s);
      track.appendChild(holder);
    });
    box.appendChild(view);

    /* ---- 흐르게 하기 ----
       pos      : 지금 위치(소수점까지 기억해서, 느린 속도에서도 멈춘 듯 보이지 않게)
       pausedTo : 이 시각까지는 멈춤(손으로 민 뒤, 처음 위치에서 쉴 때)
       lastSet  : 우리 코드가 마지막으로 정한 위치. 이것과 다르면 '사람이 밀었다'고 봐요. */
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var pos = 0, lastSet = 0, pausedTo = Date.now() + HOLD_AT_START, hover = false, fading = false;
    var prevT = 0, raf = 0, alive = true;

    function frame(t) {
      if (!alive) return;
      var dt = prevT ? Math.min(t - prevT, 100) / 1000 : 0;   // 지난 그림 이후 지난 시간(초). 탭이 쉬다 오면 크게 튀지 않게 0.1초로 제한
      prevT = t;
      var max = track.scrollWidth - view.clientWidth;          // 끝 위치
      var moving = !reduce && !hover && !fading && !document.hidden && Date.now() >= pausedTo && max > 0;
      if (moving) {
        pos += SPEED * dt;
        if (pos >= max) {                                       // 끝까지 왔으면: 흐리게 → 처음으로 → 다시 보이기
          pos = max;
          fading = true;
          view.style.opacity = "0";
          setTimeout(function () {
            pos = 0; lastSet = 0; view.scrollLeft = 0;
            view.style.opacity = "1";
            fading = false;
            pausedTo = Date.now() + HOLD_AT_START;
          }, 600);
        }
        var p = Math.round(pos);
        if (p !== view.scrollLeft) { view.scrollLeft = p; lastSet = view.scrollLeft; }
      }
      raf = requestAnimationFrame(frame);
    }

    // 사람이 띠를 밀었는지 알아채기: 우리가 정한 위치와 2px 넘게 다르면 사람이 민 것
    view.addEventListener("scroll", function () {
      if (fading) return;
      if (Math.abs(view.scrollLeft - lastSet) > 2) {
        pos = lastSet = view.scrollLeft;
        pausedTo = Date.now() + PAUSE_AFTER_TOUCH;
      }
    }, { passive: true });
    view.addEventListener("mouseenter", function () { hover = true; });
    view.addEventListener("mouseleave", function () { hover = false; pausedTo = Math.max(pausedTo, Date.now() + 800); });
    view.addEventListener("touchstart", function () { pausedTo = Date.now() + PAUSE_AFTER_TOUCH; }, { passive: true });

    raf = requestAnimationFrame(frame);

    return {
      destroy: function () {
        alive = false;
        cancelAnimationFrame(raf);
        if (view.parentNode) view.parentNode.removeChild(view);
      }
    };
  }

  window.SlowTape = { mount: mount, SPEED: SPEED };
})();
