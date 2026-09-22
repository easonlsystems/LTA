// Public activation surfaces share one visual system. The rest of the server-rendered
// application keeps its existing account and Founder styles.
export const activationCss = `
body[data-path="/"],body[data-path="/connect"]{--a-ink:#101a1c;--a-soft:#dce8e2;--a-accent:#baf27a;--a-line:rgba(229,243,231,.16);background:#101a1c!important;color:#eef4ed}
body[data-path="/"] .wrap,body[data-path="/connect"] .wrap{max-width:none;padding:0}
body[data-path="/"] nav,body[data-path="/connect"] nav{position:relative;top:auto;left:auto;transform:none;width:auto;height:74px;max-width:1480px;margin:auto;padding:0 clamp(20px,4vw,64px);border-bottom:1px solid var(--a-line)!important;background:#101a1c!important;box-shadow:none!important;backdrop-filter:none!important}
body[data-path="/"] nav.scrolled,body[data-path="/connect"] nav.scrolled{background:#101a1c!important;box-shadow:none!important;backdrop-filter:none!important}
body[data-path="/"] .brand,body[data-path="/connect"] .brand{color:#f2f7f0;font-weight:800;letter-spacing:-.035em}
body[data-path="/"] .brand img,body[data-path="/connect"] .brand img{border:1px solid rgba(255,255,255,.2);box-shadow:none}
body[data-path="/"] .navlinks,body[data-path="/connect"] .navlinks{gap:27px}
body[data-path="/"] .navlinks>a:not(.btn),body[data-path="/connect"] .navlinks>a:not(.btn){color:#c5d3cb;font-size:13px;font-weight:600}
body[data-path="/"] .navlinks>a:not(.btn):hover,body[data-path="/connect"] .navlinks>a:not(.btn):hover{color:#fff}
body[data-path="/"] .navlinks .btn,body[data-path="/connect"] .navlinks .btn{background:var(--a-accent);border-color:var(--a-accent);color:#102016!important;box-shadow:none;padding:11px 17px;min-height:44px;font-weight:800}
body[data-path="/connect"] .navlinks .btn{display:none}
body[data-path="/"] footer,body[data-path="/connect"] footer{display:flex;max-width:1480px;margin:auto;padding:30px clamp(20px,4vw,64px) 42px;border-top:1px solid var(--a-line);color:#9cafa4;background:#101a1c!important;font-size:12px}
body[data-path="/"] footer a,body[data-path="/connect"] footer a{color:#cbd9cf}
body[data-path="/"] .mobile-menu summary,body[data-path="/connect"] .mobile-menu summary{background:#1a2828;border:1px solid var(--a-line);color:#f1f6ed;min-width:44px;min-height:44px;display:grid;place-items:center}
body[data-path="/"] .mobile-menu-panel,body[data-path="/connect"] .mobile-menu-panel{background:#1a2828;border-color:#405348;border-radius:12px;box-shadow:0 20px 45px rgba(0,0,0,.3)}
body[data-path="/"] .mobile-menu-panel a,body[data-path="/connect"] .mobile-menu-panel a{color:#edf4eb;min-height:44px;display:flex;align-items:center}
body[data-path="/"] .mobile-menu-panel a:hover,body[data-path="/connect"] .mobile-menu-panel a:hover{background:#2b3d35;color:#fff}
.activation-site,.activation-connect{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#eef4ed;background:#101a1c}
.activation-site a,.activation-connect a{text-underline-offset:3px}
.a-container{width:min(100% - 48px,1360px);margin:0 auto}
.a-primary{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:58px;padding:15px 23px;background:var(--a-accent);border:1px solid var(--a-accent);border-radius:10px;color:#102016!important;text-decoration:none;font-size:16px;font-weight:850;letter-spacing:-.015em;box-shadow:0 10px 25px rgba(4,14,8,.18);transition:transform 150ms cubic-bezier(.23,1,.32,1),background 150ms ease,box-shadow 150ms ease}
.a-primary:hover{background:#d1ffa0;transform:translateY(-2px);box-shadow:0 14px 30px rgba(4,14,8,.25)}
.a-primary:active{transform:scale(.98)}
.a-primary svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.a-text-link{color:#c8eab2;font-size:14px;font-weight:750;text-decoration-thickness:1px}
.a-hero{padding:clamp(54px,7vw,102px) 0 64px}
.a-hero-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(350px,.92fr);gap:clamp(34px,5vw,88px);align-items:center}
.a-overline{display:flex;align-items:center;gap:10px;margin:0 0 23px;color:#b9f184;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.a-overline:before{content:"";width:21px;height:2px;background:var(--a-accent)}
.a-hero h1{margin:0;max-width:11ch;color:#f2f6ef;font-size:clamp(56px,6vw,94px);font-weight:780;line-height:.99;letter-spacing:-.048em;text-wrap:balance}
.a-hero h1 span{color:var(--a-accent)}
.a-lede{max-width:57ch;margin:27px 0 0;color:#c4d3c9;font-size:clamp(17px,1.65vw,21px);line-height:1.55;letter-spacing:-.01em}
.a-hero-actions{display:flex;align-items:center;gap:23px;flex-wrap:wrap;margin-top:35px}
.a-hero-actions .a-text-link{color:#c3d7c6}
.a-assurance{display:flex;flex-wrap:wrap;gap:7px 19px;margin-top:21px;color:#a8bcae;font-size:12px;line-height:1.45}
.a-assurance span{display:inline-flex;align-items:center;gap:7px}
.a-assurance span:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--a-accent)}
.a-relay{border:1px solid #385044;background:#182724;border-radius:17px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.13)}
.a-relay-top{display:flex;justify-content:space-between;gap:15px;align-items:center;padding-bottom:15px;border-bottom:1px solid var(--a-line);color:#a6c2ae;font-size:11px;font-weight:750;letter-spacing:.11em;text-transform:uppercase}
.a-relay-top strong{color:#c8f49f;font-size:11px;font-weight:800}
.a-relay-row{display:grid;grid-template-columns:34px minmax(0,1fr);gap:12px;padding:17px 0;border-bottom:1px solid var(--a-line)}
.a-relay-row:last-of-type{border-bottom:0}
.a-relay-num{color:#86ac8e;font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;padding-top:3px}
.a-relay-label{display:block;margin-bottom:5px;color:#f1f6ee;font-size:15px;font-weight:800}
.a-relay-row p{margin:0;color:#aec4b3;font-size:13px;line-height:1.5}
.a-relay-code{display:block;margin-top:8px;color:#d3f7ad;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.a-relay-foot{margin:9px 0 0;padding-top:14px;border-top:1px solid var(--a-line);color:#8fab98;font-size:11px;line-height:1.5}
.a-how{border-top:1px solid var(--a-line);border-bottom:1px solid var(--a-line);padding:34px 0;background:#15211f}
.a-how-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0}
.a-how-item{display:grid;grid-template-columns:30px 1fr;gap:12px;padding:4px 28px 4px 0}
.a-how-item+.a-how-item{padding-left:28px;border-left:1px solid var(--a-line)}
.a-how-item b{color:var(--a-accent);font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace}
.a-how-item strong{display:block;color:#f1f6ed;font-size:14px}
.a-how-item p{margin:5px 0 0;color:#aac0b0;font-size:12px;line-height:1.55}
.a-section{padding:clamp(70px,8vw,116px) 0;border-bottom:1px solid var(--a-line)}
.a-section-head{display:grid;grid-template-columns:minmax(0,.72fr) minmax(0,1fr);gap:40px;align-items:end;margin-bottom:32px}
.a-section h2{margin:0;color:#f0f5ed;font-size:clamp(36px,4.3vw,62px);line-height:1.02;letter-spacing:-.04em}
.a-section-head p{margin:0;max-width:52ch;color:#afc3b2;font-size:16px;line-height:1.6}
.a-proof-source{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:16px 20px;border:1px solid #345044;background:#1b2c27;border-radius:12px;color:#d5e7d5;font-size:13px}
.a-proof-source strong{color:#c8f49f}
.a-proof-source a{color:#eef8e4;overflow-wrap:anywhere}
.activation-site .sim-shell{max-width:none;margin:17px 0 0;border:1px solid #3b5147;border-radius:14px;background:#1a2927;box-shadow:none}
.activation-site .sim-shell:before{display:none}
.activation-site .sim-tabs{padding:12px;border-bottom:1px solid var(--a-line);background:transparent}
.activation-site .sim-tab{color:#b9cabb;min-height:44px;border-radius:8px}
.activation-site .sim-tab:hover{background:#2b4035;color:#fff}
.activation-site .sim-tab.active{background:#baf27a;color:#102016;box-shadow:none}
.activation-site .sim-meta-simple{padding:20px}
.activation-site .sim-prompt-card>span{color:#b7d0b8}
.activation-site .sim-prompt-card>p{color:#f0f5ed}
.activation-site .sim-run{background:#baf27a;color:#112016;box-shadow:none;border-radius:8px;min-height:45px}
.activation-site .sim-run:hover{background:#d1ffa0}
.activation-site .sim-grid{padding:0 20px 20px}
.activation-site .sim-panel{border-radius:11px;border-color:#3d5148;background:#22302e}
.activation-site .sim-panel.with{background:#233a2e;border-color:#527d52;box-shadow:none}
.activation-site .sim-panel-title{color:#f0f6ee}
.activation-site .sim-panel-sub{color:#b0c5b3}
.activation-site .sim-conclusion{color:#b9ceb9}
.activation-site .sim-conclusion strong{color:#c8f49f}
.a-source-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border-top:1px solid var(--a-line)}
.a-source-list div{padding:23px 26px 23px 0;border-bottom:1px solid var(--a-line)}
.a-source-list div:nth-child(3n+2),.a-source-list div:nth-child(3n+3){padding-left:26px;border-left:1px solid var(--a-line)}
.a-source-list strong{display:block;color:#f0f5ec;font-size:17px}
.a-source-list span{display:block;margin-top:6px;color:#9fb5a4;font-size:12px;line-height:1.5}
.a-source-note{max-width:80ch;margin:24px 0 0;color:#a7bea9;font-size:13px;line-height:1.6}
.a-units{display:grid;grid-template-columns:minmax(0,.7fr) minmax(0,1.3fr);gap:50px;align-items:start}
.a-unit-lines{border-top:1px solid var(--a-line)}
.a-unit-line{display:grid;grid-template-columns:125px 1fr;gap:20px;padding:18px 0;border-bottom:1px solid var(--a-line);color:#b7cab8;font-size:14px;line-height:1.5}
.a-unit-line strong{color:#f1f6ed}
.a-unit-links{display:flex;gap:24px;flex-wrap:wrap;margin-top:23px}
.a-unit-links a{color:#c8eab2;font-size:14px;font-weight:750;text-decoration-thickness:1px}
.a-final{padding:80px 0 96px;background:#1a2a24}
.a-final-inner{display:flex;align-items:end;justify-content:space-between;gap:30px}
.a-final h2{max-width:16ch;margin:0 0 12px;color:#f3f7ef;font-size:clamp(38px,5vw,66px);line-height:1.03;letter-spacing:-.04em}
.a-final p{max-width:45ch;margin:0;color:#afc6b3;font-size:15px;line-height:1.55}
.a-final-actions{display:grid;gap:11px;justify-items:start}
.a-final-actions small{color:#aec3ad;font-size:12px}
/* The connection page acts as a handoff, with one task visible in each state. */
.activation-connect{min-height:calc(100svh - 74px)}
.a-connect-shell{width:min(100% - 48px,1040px);margin:0 auto;padding:clamp(55px,8vw,110px) 0 88px}
.a-connect-label{color:#baf27a;font-size:12px;font-weight:850;letter-spacing:.11em;text-transform:uppercase}
.a-connect-head{max-width:760px;margin:18px 0 36px}
.a-connect-head h1{margin:0;color:#f3f7ef;font-size:clamp(44px,6.3vw,80px);line-height:1.02;letter-spacing:-.045em}
.a-connect-head p{max-width:58ch;margin:18px 0 0;color:#b8caba;font-size:18px;line-height:1.55}
.a-progress{display:flex;gap:8px;margin:0 0 20px}
.a-progress span{flex:1;height:4px;border-radius:4px;background:#355143}
.a-progress span.active{background:#baf27a}
.a-connect-panel{border:1px solid #3d5949;border-radius:15px;background:#1a2b25;padding:clamp(22px,4vw,42px)}
.a-connect-panel h2{margin:0;color:#f1f6ed;font-size:clamp(28px,3vw,39px);letter-spacing:-.035em;line-height:1.1}
.a-connect-panel p{max-width:62ch;color:#b7c9ba;font-size:15px;line-height:1.6}
.a-connect-panel .a-primary{margin-top:14px}
.a-connect-panel .a-primary:disabled{opacity:.6;cursor:wait}
.a-connect-facts{display:flex;gap:8px;flex-wrap:wrap;margin:23px 0 0}
.a-connect-facts span{padding:8px 11px;border:1px solid #496450;border-radius:7px;color:#c9dcc8;font-size:12px}
.a-live-state{display:flex;gap:12px;align-items:flex-start;padding:15px 18px;margin-top:24px;border:1px solid #436249;border-radius:10px;background:#213c2c;color:#d9ebd4;font-size:14px;line-height:1.5}
.a-live-state:before{content:"";width:9px;height:9px;flex:none;border-radius:50%;background:#baf27a;margin-top:6px}
.a-connected{display:grid;gap:30px}
.a-connected-mark{width:45px;height:45px;display:grid;place-items:center;border-radius:50%;background:#baf27a;color:#14251a;font-size:23px;font-weight:800}
.a-connected .a-next{padding:24px;border-radius:11px;background:#263d30}
.a-connected .a-next strong{display:block;color:#f1f8ed;font-size:15px;margin-bottom:9px}
.a-connected .a-next .a-command{display:inline-block;color:#baf27a;font-size:clamp(20px,3vw,29px);font-weight:800;letter-spacing:-.025em}
.a-test{border-top:1px solid var(--a-line);padding-top:24px}
.a-test h3{margin:0 0 7px;color:#f1f6ed;font-size:19px}
.a-test p{margin:0 0 15px;font-size:14px}
.a-test-row{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-top:9px;padding:12px 14px;background:#101d1b;border:1px solid #405d4d;border-radius:9px}
.a-test-row code{color:#d5f3bd;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.a-test-row button{flex:none;border:1px solid #688968;border-radius:7px;background:#2b4830;color:#f0f7e8;font:700 12px inherit;min-width:70px;min-height:44px;cursor:pointer}
.a-test-row button:hover{background:#3d6341}
.a-success-hint{margin:15px 0 0;color:#a9c0aa;font-size:12px;line-height:1.6}
.a-fallback{margin-top:22px;border-top:1px solid var(--a-line);padding-top:16px}
.a-fallback summary{cursor:pointer;color:#bed6bd;font-size:14px;font-weight:700;min-height:44px;display:flex;align-items:center}
.a-fallback p,.a-fallback li{color:#a9c0ae;font-size:13px;line-height:1.6}
.a-fallback code{overflow-wrap:anywhere;color:#d2f2b7}
.a-fallback a{color:#d2f2b7}
.a-fallback details{border-top:1px solid var(--a-line)}
.a-fallback details:first-child{border-top:0}
.activation-connect [hidden]{display:none!important}
.activation-site :focus-visible,.activation-connect :focus-visible,body[data-path="/"] nav :focus-visible,body[data-path="/connect"] nav :focus-visible{outline:3px solid #baf27a;outline-offset:4px}
@media(max-width:960px){.a-hero-grid{grid-template-columns:1fr}.a-hero h1{max-width:14ch}.a-relay{max-width:720px}.a-section-head{grid-template-columns:1fr;gap:13px}.a-units{grid-template-columns:1fr;gap:30px}}
@media(max-width:700px){body[data-path="/"] nav,body[data-path="/connect"] nav{height:66px;padding:0 15px}.a-container,.a-connect-shell{width:min(100% - 30px,600px)}.a-hero{padding:49px 0 42px}.a-hero-grid{gap:34px}.a-hero h1{font-size:clamp(44px,10.6vw,62px);max-width:12ch}.a-lede{margin-top:19px;font-size:16px}.a-hero-actions{display:grid;gap:15px;margin-top:26px}.a-hero-actions .a-primary{width:100%}.a-assurance{gap:7px 14px;margin-top:17px}.a-relay{padding:17px}.a-how-grid{grid-template-columns:1fr}.a-how-item,.a-how-item+.a-how-item{padding:14px 0;border-left:0;border-top:1px solid var(--a-line)}.a-how-item:first-child{border-top:0}.a-section{padding:66px 0}.a-section h2{font-size:36px}.a-section-head p{font-size:14px}.a-source-list{grid-template-columns:1fr 1fr}.a-source-list div,.a-source-list div:nth-child(3n+2),.a-source-list div:nth-child(3n+3){padding:18px 12px 18px 0;border-left:0}.a-source-list div:nth-child(even){padding-left:14px;border-left:1px solid var(--a-line)}.a-final{padding:66px 0}.a-final-inner{display:grid}.a-final-actions .a-primary{width:100%}.a-connect-shell{padding:48px 0 70px}.a-connect-head{margin-bottom:27px}.a-connect-head h1{font-size:clamp(39px,10vw,54px)}.a-connect-head p{font-size:16px}.a-connect-panel{padding:21px}.a-test-row{align-items:flex-start;flex-direction:column}.a-test-row button{width:100%}}
@media(max-width:450px){body[data-path="/"] .navlinks,body[data-path="/connect"] .navlinks{gap:6px}body[data-path="/"] .navlinks .btn,body[data-path="/connect"] .navlinks .btn{font-size:11px;padding:8px 10px;min-height:44px}.a-source-list{grid-template-columns:1fr}.a-source-list div,.a-source-list div:nth-child(even){padding:17px 0;border-left:0}.a-unit-line{grid-template-columns:1fr;gap:2px}.a-assurance{display:grid;grid-template-columns:1fr 1fr}}
@media(prefers-reduced-motion:reduce){.a-primary{transition:none}.a-primary:hover,.a-primary:active{transform:none}}
`;
