(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))e(r);new MutationObserver(r=>{for(const s of r)if(s.type==="childList")for(const o of s.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&e(o)}).observe(document,{childList:!0,subtree:!0});function a(r){const s={};return r.integrity&&(s.integrity=r.integrity),r.referrerPolicy&&(s.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?s.credentials="include":r.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function e(r){if(r.ep)return;r.ep=!0;const s=a(r);fetch(r.href,s)}})();function H(n){return n.reduce((t,a)=>t+a,0)/n.length}function I(n){let t=0;for(let a=0;a<n.length;a+=16)t^=n[a];return t}function z(n=160){const t=new Uint32Array(16384),a=new Uint32Array(2*1024*1024);for(let o=0;o<t.length;o+=1)t[o]=o^43981;for(let o=0;o<a.length;o+=1)a[o]=o*2654435761>>>0;const e=[],r=[];let s=0;for(let o=0;o<n;o+=1){s^=I(t);const c=performance.now();for(let d=0;d<120;d+=1)s^=t[d*31&t.length-1];const h=performance.now();e.push(h-c),s^=I(a);const i=performance.now();for(let d=0;d<120;d+=1)s^=t[d*31&t.length-1];const m=performance.now();r.push(m-i)}return{cachedSamples:e,uncachedSamples:r,cachedMean:H(e),uncachedMean:H(r),l1EstimateNs:1,l2EstimateNs:4,l3EstimateNs:12,dramEstimateNs:80}}const G=new TextEncoder;function N(n){return Array.from(n).map(t=>t.toString(16).padStart(2,"0")).join("")}function X(n){const t=n.trim().toLowerCase();if(t.length===0||t.length%2!==0||/[^0-9a-f]/u.test(t))throw new Error("MAC must be valid lowercase or uppercase hex with even length.");const a=new Uint8Array(t.length/2);for(let e=0;e<a.length;e+=1)a[e]=Number.parseInt(t.slice(e*2,e*2+2),16);return a}function F(n,t){if(n.length!==t.length)return!1;for(let a=0;a<n.length;a+=1)if(n[a]!==t[a])return!1;return!0}function D(n,t){const a=Math.max(n.length,t.length);let e=n.length^t.length;for(let r=0;r<a;r+=1){const s=r<n.length?n[r]:0,o=r<t.length?t[r]:0;e|=s^o}return e===0}async function Y(){return crypto.subtle.importKey("raw",G.encode("crypto-lab-timing-oracle-demo-key"),{name:"HMAC",hash:"SHA-256"},!1,["sign","verify"])}async function J(n){const t=await Y(),a=await crypto.subtle.sign("HMAC",t,G.encode(n));return new Uint8Array(a)}function Q(n,t){const a=crypto.getRandomValues(new Uint8Array(n.length));for(let e=0;e<Math.min(t,n.length);e+=1)a[e]=n[e];return t<n.length&&(a[t]=n[t]^255),a}function U(n){return n.reduce((t,a)=>t+a,0)/n.length}async function Z(n,t,a=8e3){const e=await J(n),r=N(e);let s;try{s=X(t)}catch{s=new Uint8Array(e.length)}const o=performance.now();F(e,s);const c=performance.now(),h=performance.now();D(e,s);const i=performance.now(),m=[0,4,8,12,16],d=Math.max(1,Math.floor(a/m.length)),u=[],C=[],S=[];for(const x of m){const b=Q(e,x),M=[],f=[];for(let p=0;p<60;p+=1){const y=performance.now();for(let k=0;k<d;k+=1)F(e,b);const v=performance.now()-y;M.push(v),C.push(v)}for(let p=0;p<60;p+=1){const y=performance.now();for(let k=0;k<d;k+=1)D(e,b);const v=performance.now()-y;f.push(v),S.push(v)}u.push({prefixBytes:x,vulnerableMean:U(M),constantMean:U(f)})}return{points:u,vulnerableSeries:C,constantSeries:S,expectedMacHex:r,providedMacHex:N(s),vulnerableUserCheckMs:c-o,constantUserCheckMs:i-h}}function E(n,t,a){let e=1n,r=n%a;const s=t.toString(2).length;for(let o=s-1;o>=0;o-=1)e=e*e%a,(t>>BigInt(o)&1n)===1n&&(e=e*r%a);return e}function V(n,t,a){let e=1n,r=n%a;const s=t.toString(2).length;for(let o=s-1;o>=0;o-=1){const c=t>>BigInt(o)&1n,h=e*r%a,i=e*e%a,m=r*r%a,d=1n-c;e=(h*c+i*d)%a,r=(m*c+h*d)%a}return e}function B(n,t){let a=n,e=t;for(;e!==0n;){const r=e;e=a%e,a=r}return a}function K(n,t){if(t===0n)return[n,1n,0n];const[a,e,r]=K(t,n%t);return[a,r,e-n/t*r]}function ee(n,t){const[a,e]=K(n,t);if(a!==1n)throw new Error("No modular inverse");return(e%t+t)%t}function te(n){if(n<2n)return!1;if(n===2n||n===3n)return!0;if(n%2n===0n)return!1;for(let t=3n;t*t<=n;t+=2n)if(n%t===0n)return!1;return!0}function $(n=200n,t=500n){for(let a=0;a<5e3;a+=1){const e=BigInt(Math.floor(Math.random()*Number(t-n)))+n,r=e%2n===0n?e+1n:e;if(te(r))return r}throw new Error("Unable to generate prime for toy RSA")}function ne(){let n=$(),t=$();for(;t===n;)t=$();const a=n*t,e=(n-1n)*(t-1n);let r=65537n;if(B(r,e)!==1n&&(r=17n),B(r,e)!==1n&&(r=3n),B(r,e)!==1n)throw new Error("Could not choose RSA public exponent");const s=ee(r,e);return{n:a,e:r,d:s,p:n,q:t}}function A(n){return n.reduce((t,a)=>t+a,0)/n.length}async function ae(n=24){const t=await crypto.subtle.generateKey({name:"RSA-PSS",modulusLength:1024,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},!1,["sign","verify"]),a=new TextEncoder().encode("timing-oracle-rsa-webcrypto-sample"),e=[];for(let r=0;r<n;r+=1){const s=performance.now();await crypto.subtle.sign({name:"RSA-PSS",saltLength:32},t.privateKey,a);const o=performance.now();e.push(o-s)}return A(e)}async function re(n=140){const t=ne(),a=12345n%t.n,e=t.d.toString(2).length,r=Math.max(1,Math.min(8,e-2)),s=1n<<BigInt(r),o=t.d&~s,c=t.d|s,h=[],i=[],m=[],d=[],u=240;for(let M=0;M<n;M+=1){const f=performance.now();for(let w=0;w<u;w+=1)E(a,o,t.n);const p=performance.now();h.push(p-f);const y=performance.now();for(let w=0;w<u;w+=1)E(a,c,t.n);const g=performance.now();i.push(g-y);const v=performance.now();for(let w=0;w<u;w+=1)V(a,o,t.n);const k=performance.now();m.push(k-v);const P=performance.now();for(let w=0;w<u;w+=1)V(a,c,t.n);const R=performance.now();d.push(R-P)}const C=E(a,t.e,t.n),S=E(C,t.d,t.n),x=`Toy RSA key: p=${t.p}, q=${t.q}, n=${t.n}, e=${t.e}, d bits=${e}, decrypt check=${S}`,b=await ae();return{keyDescription:x,selectedBitIndex:r,naiveBit0Samples:h,naiveBit1Samples:i,ladderBit0Samples:m,ladderBit1Samples:d,naiveBit0Mean:A(h),naiveBit1Mean:A(i),ladderBit0Mean:A(m),ladderBit1Mean:A(d),webCryptoSignMeanMs:b}}function W(n,t){const a=[...n].sort((r,s)=>r-s);if(a.length===0)return 0;const e=Math.floor((a.length-1)*t);return a[e]}function q(n){const t=n.getBoundingClientRect(),a=Math.max(280,Math.floor(t.width)),e=220,r=Math.max(1,window.devicePixelRatio||1);n.width=Math.floor(a*r),n.height=Math.floor(e*r),n.style.height=`${e}px`;const s=n.getContext("2d");if(!s)throw new Error("2D context unavailable");return s.setTransform(r,0,0,r,0,0),s.clearRect(0,0,a,e),s}function L(n,t,a){const e=q(n),r=n.getBoundingClientRect(),s=Math.max(280,Math.floor(r.width)),o=220,c=44,h=s-12,i=20,m=o-30,d=t.flatMap(p=>p.values),u=W(d,.02),C=W(d,.98),S=Math.max(1e-4,C-u);e.fillStyle="#f3f6fb",e.fillRect(0,0,s,o),e.fillStyle="#111",e.font="600 13px 'Space Grotesk', sans-serif",e.fillText(a,c,14);const x=24,b=t.map(p=>{const y=new Array(x).fill(0);for(const g of p.values){const v=Math.max(0,Math.min(.99999,(g-u)/S));y[Math.floor(v*x)]+=1}return y}),M=Math.max(...b.flat(),1),f=(h-c)/x;e.strokeStyle="#6a7484",e.lineWidth=1,e.beginPath(),e.moveTo(c,m),e.lineTo(h,m),e.moveTo(c,i),e.lineTo(c,m),e.stroke();for(let p=0;p<b.length;p+=1){e.fillStyle=`${t[p].color}${Math.round(.52*255).toString(16).padStart(2,"0")}`;for(let g=0;g<x;g+=1){const k=b[p][g]/M*(m-i),P=c+g*f+p*((f-2)/b.length),R=m-k,w=Math.max(1,(f-3)/b.length);e.fillRect(P,R,w,k)}}e.fillStyle="#222",e.font="12px 'IBM Plex Sans', sans-serif",e.fillText(`${u.toFixed(4)} ms`,c,o-10),e.fillText(`${C.toFixed(4)} ms`,h-70,o-10)}function se(n,t,a){const e=q(n),r=Math.max(280,Math.floor(n.getBoundingClientRect().width)),s=220,o=44,c=r-18,h=20,i=s-36,m=t.flatMap(f=>f.points.map(p=>p.x)),d=t.flatMap(f=>f.points.map(p=>p.y)),u=Math.min(...m,0),C=Math.max(...m,1),S=Math.min(...d,0),x=Math.max(...d,.001),b=Math.max(1,C-u),M=Math.max(1e-4,x-S);e.fillStyle="#f3f6fb",e.fillRect(0,0,r,s),e.fillStyle="#111",e.font="600 13px 'Space Grotesk', sans-serif",e.fillText(a,o,14),e.strokeStyle="#6a7484",e.beginPath(),e.moveTo(o,i),e.lineTo(c,i),e.moveTo(o,h),e.lineTo(o,i),e.stroke();for(const f of t){e.strokeStyle=f.color,e.lineWidth=2,e.beginPath(),f.points.forEach((p,y)=>{const g=o+(p.x-u)/b*(c-o),v=i-(p.y-S)/M*(i-h);y===0?e.moveTo(g,v):e.lineTo(g,v)}),e.stroke();for(const p of f.points){const y=o+(p.x-u)/b*(c-o),g=i-(p.y-S)/M*(i-h);e.fillStyle=f.color,e.beginPath(),e.arc(y,g,3,0,Math.PI*2),e.fill()}}e.fillStyle="#1e2330",e.font="12px 'IBM Plex Sans', sans-serif",e.fillText(`${S.toFixed(4)} ms`,o,s-12),e.fillText(`${x.toFixed(4)} ms`,c-64,s-12)}function j(n,t){if(n.length===0)return 0;const a=n.reduce((e,r)=>e+(r-t)*(r-t),0)/n.length;return Math.sqrt(a)}function oe(n,t){if(n.length!==t.length)return!1;for(let a=0;a<n.length;a+=1)if(n.charCodeAt(a)!==t.charCodeAt(a))return!1;return!0}function ie(n,t){const a=Math.max(n.length,t.length);let e=n.length^t.length;for(let r=0;r<a;r+=1){const s=r<n.length?n.charCodeAt(r):0,o=r<t.length?t.charCodeAt(r):0;e|=s^o}return e===0}function ce(n,t){const a=Math.min(n.length,t.length);for(let e=0;e<a;e+=1)if(n.charCodeAt(e)!==t.charCodeAt(e))return e;return a}function le(n,t,a=1e4){const r=Math.max(1,Math.floor(a/200)),s=[],o=[];performance.mark("strcmp-vuln-start");for(let i=0;i<200;i+=1){const m=performance.now();for(let u=0;u<r;u+=1)oe(n,t);const d=performance.now();s.push(d-m)}performance.mark("strcmp-vuln-end"),performance.mark("strcmp-ct-start");for(let i=0;i<200;i+=1){const m=performance.now();for(let u=0;u<r;u+=1)ie(n,t);const d=performance.now();o.push(d-m)}performance.mark("strcmp-ct-end");const c=s.reduce((i,m)=>i+m,0)/s.length,h=o.reduce((i,m)=>i+m,0)/o.length;return{vulnerableSamples:s,constantSamples:o,vulnerableMean:c,constantMean:h,vulnerableStdDev:j(s,c),constantStdDev:j(o,h),prefixMatchLength:ce(n,t),iterationsPerMode:r*200}}function l(n){const t=document.getElementById(n);if(!t)throw new Error(`Missing required element: ${n}`);return t}function _(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}function O(n){document.documentElement.dataset.theme=n;const t=l("theme-toggle");t.setAttribute("aria-pressed",String(n==="dark")),t.textContent=n==="dark"?"Switch to light mode":"Switch to dark mode"}function me(){const n=l("app");n.innerHTML=`
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header class="hero" aria-label="Demo header">
      <div class="category-chip" aria-label="Category">Side-Channel Attacks</div>
      <h1>Timing Oracle</h1>
      <p class="subtitle">Browser-native timing side-channel lab: vulnerable vs constant-time implementations with real measurements.</p>
      <div class="chip-row" aria-label="Primitive chips">
        <span class="primitive-chip">Timing Attack</span>
        <span class="primitive-chip">Constant-Time</span>
        <span class="primitive-chip">HMAC</span>
        <span class="primitive-chip">RSA</span>
        <span class="primitive-chip">Cache-Timing</span>
      </div>
      <button id="theme-toggle" class="theme-toggle" aria-label="Toggle dark and light mode" aria-pressed="false" type="button">Switch to dark mode</button>
    </header>

    <main id="main-content" aria-label="Timing oracle demo panels">
      <section class="why" aria-labelledby="why-title">
        <h2 id="why-title">Why this matters</h2>
        <p>
          Correct algorithm choice is not enough: implementation timing leaks have broken RSA, AES, HMAC, and TLS in production systems.
          Constant-time programming is non-negotiable in cryptographic code.
        </p>
      </section>

      <section class="panel" aria-labelledby="panel1-title">
        <div class="panel-head">
          <h2 id="panel1-title">Panel 1 — String Comparison Timing Attack</h2>
          <div class="status-row" aria-label="Status chips">
            <span class="status bad">Vulnerable: AVOID</span>
            <span class="status good">Constant-Time: REQUIRED</span>
          </div>
        </div>
        <p class="panel-text">Naive string comparison exits on the first mismatch. Timing rises with longer correct prefixes and leaks secret bytes.</p>
        <div class="controls two-col">
          <label for="strcmp-target">Target secret string</label>
          <input id="strcmp-target" aria-label="Target secret string input" value="timing-oracle-demo-secret" />
          <label for="strcmp-guess">Attacker guess string</label>
          <input id="strcmp-guess" aria-label="Attacker guess string input" value="timing-oracle-demo-xxxxx" />
          <button id="strcmp-run" type="button" aria-label="Run string comparison timing benchmark">Run 10,000 iterations per mode</button>
        </div>
        <canvas id="strcmp-hist" aria-label="Histogram comparing vulnerable and constant-time string comparison timings" role="img"></canvas>
        <p id="strcmp-summary" class="chart-summary" aria-live="polite"></p>
      </section>

      <section class="panel" aria-labelledby="panel2-title">
        <div class="panel-head">
          <h2 id="panel2-title">Panel 2 — HMAC Verification Timing Leak</h2>
          <span class="status warn">Always use constant-time MAC verification</span>
        </div>
        <p class="panel-text">When MAC bytes are compared with early exit, response time reveals how many prefix bytes are correct.</p>
        <div class="controls two-col">
          <label for="hmac-message">Message</label>
          <input id="hmac-message" aria-label="Message for HMAC verification" value="POST /api/transfer?amount=1000" />
          <label for="hmac-forged">Forged MAC hex</label>
          <input id="hmac-forged" aria-label="Forged HMAC in hexadecimal" value="0000000000000000000000000000000000000000000000000000000000000000" />
          <button id="hmac-run" type="button" aria-label="Run HMAC timing benchmark">Measure MAC prefix timing</button>
        </div>
        <div id="hmac-error" class="error" role="status" aria-live="assertive"></div>
        <canvas id="hmac-line" aria-label="Line chart of HMAC timing by correct prefix length" role="img"></canvas>
        <p id="hmac-summary" class="chart-summary" aria-live="polite"></p>
        <p class="panel-note">Reference: Django timing attack CVEs and the history of constant-time comparison APIs such as Python <code>hmac.compare_digest</code>.</p>
      </section>

      <section class="panel" aria-labelledby="panel3-title">
        <div class="panel-head">
          <h2 id="panel3-title">Panel 3 — RSA Private Key Bit Leakage</h2>
          <span class="status warn">Always use constant-time exponentiation</span>
        </div>
        <p class="panel-text">Square-and-multiply uses a secret-dependent branch on each exponent bit. Montgomery ladder keeps operation count uniform.</p>
        <button id="rsa-run" type="button" aria-label="Run RSA bit leakage benchmark">Generate toy RSA key and measure bit leakage</button>
        <canvas id="rsa-hist" aria-label="Histogram of RSA timing under different private key bit patterns" role="img"></canvas>
        <p id="rsa-summary" class="chart-summary" aria-live="polite"></p>
        <p class="panel-note">Kocher, 1996: <em>Timing Attacks on Implementations of Diffie-Hellman, RSA, DSS, and Other Systems</em>.</p>
      </section>

      <section class="panel" aria-labelledby="panel4-title">
        <div class="panel-head">
          <h2 id="panel4-title">Panel 4 — Cache-Timing Attack</h2>
          <div class="status-row">
            <span class="status good">AES via WebCrypto: safer path</span>
            <span class="status bad">Pure-JS AES tables: vulnerable</span>
          </div>
        </div>
        <p class="panel-text">Cache hits and misses have different access latency. Secret-dependent table lookups can leak information via timing.</p>
        <button id="cache-run" type="button" aria-label="Run cache timing benchmark">Measure cached vs uncached memory access</button>
        <canvas id="cache-hist" aria-label="Histogram of cached and uncached memory access timings" role="img"></canvas>
        <div class="cache-grid" aria-label="Cache hierarchy timing diagram" role="img">
          <div><strong>L1</strong><span id="l1-v">~1 ns</span></div>
          <div><strong>L2</strong><span id="l2-v">~4 ns</span></div>
          <div><strong>L3</strong><span id="l3-v">~12 ns</span></div>
          <div><strong>DRAM</strong><span id="dram-v">~80 ns</span></div>
        </div>
        <p id="cache-summary" class="chart-summary" aria-live="polite"></p>
        <p class="panel-note">Bernstein, 2005: cache-timing attacks on AES table lookups; AES-NI avoids lookup-table leakage.</p>
      </section>

      <section class="panel" aria-labelledby="panel5-title">
        <h2 id="panel5-title">Panel 5 — Defense Patterns and Real-World Impact</h2>
        <ol class="rules" aria-label="Constant-time defense checklist">
          <li>No secret-dependent branches.</li>
          <li>No secret-dependent memory accesses.</li>
          <li>No secret-dependent loop counts.</li>
          <li>Always use constant-time comparison for MACs and passwords.</li>
          <li>Use hardware crypto (AES-NI, WebCrypto) over software table implementations.</li>
        </ol>
        <ul class="hall" aria-label="Timing attack hall of fame">
          <li>Kocher 1996 — RSA and Diffie-Hellman timing leakage.</li>
          <li>Bernstein 2005 — AES cache timing.</li>
          <li>Lucky Thirteen 2013 — TLS CBC timing.</li>
          <li>Multiple HMAC timing CVEs in web frameworks.</li>
        </ul>
        <p class="panel-note">Browser timers are intentionally coarser after Spectre mitigations. That reduces resolution, but repeated samples and statistical analysis can still reveal real leakage patterns.</p>
        <div class="links" aria-label="Related demos and categories">
          <a href="https://github.com/systemslibrarian/crypto-lab-aes-modes" target="_blank" rel="noreferrer">crypto-lab-aes-modes</a>
          <a href="https://github.com/systemslibrarian/crypto-lab-mac-race" target="_blank" rel="noreferrer">crypto-lab-mac-race</a>
          <a href="https://github.com/systemslibrarian/crypto-lab-rsa-forge" target="_blank" rel="noreferrer">crypto-lab-rsa-forge</a>
          <a href="https://github.com/systemslibrarian/crypto-compare" target="_blank" rel="noreferrer">crypto-compare (Symmetric + MAC)</a>
          <a href="https://github.com/systemslibrarian/crypto-lab" target="_blank" rel="noreferrer">crypto-lab landing page</a>
        </div>
      </section>
    </main>

    <footer class="footer" aria-label="Demo footer">
      <a class="github" href="https://github.com/systemslibrarian/crypto-lab-timing-oracle" target="_blank" rel="noreferrer" aria-label="GitHub repository link">GitHub</a>
      <p>So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31</p>
    </footer>
  `}function de(){const n=window.matchMedia("(prefers-color-scheme: dark)").matches;O(n?"dark":"light"),l("theme-toggle").addEventListener("click",()=>{const a=document.documentElement.dataset.theme==="dark"?"light":"dark";O(a)})}function pe(){const n=l("strcmp-run"),t=l("strcmp-target"),a=l("strcmp-guess"),e=l("strcmp-hist"),r=l("strcmp-summary");n.addEventListener("click",()=>{const s=le(t.value,a.value,1e4);L(e,[{label:"Vulnerable",values:s.vulnerableSamples,color:"#ce2f4f"},{label:"Constant-Time",values:s.constantSamples,color:"#1f7a48"}],"String comparison timing histogram"),r.textContent=`Prefix match length: ${s.prefixMatchLength} chars. Vulnerable mean: ${s.vulnerableMean.toFixed(4)} ms, sigma ${s.vulnerableStdDev.toFixed(4)} ms. Constant-time mean: ${s.constantMean.toFixed(4)} ms, sigma ${s.constantStdDev.toFixed(4)} ms. Each mode ran ${s.iterationsPerMode} real comparisons using performance.now().`}),n.click()}function he(){const n=l("hmac-run"),t=l("hmac-message"),a=l("hmac-forged"),e=l("hmac-error"),r=l("hmac-line"),s=l("hmac-summary");n.addEventListener("click",async()=>{e.textContent="";try{const o=await Z(t.value,a.value,8e3);se(r,[{label:"Vulnerable",points:o.points.map(i=>({x:i.prefixBytes,y:i.vulnerableMean})),color:"#ce2f4f"},{label:"Constant-Time",points:o.points.map(i=>({x:i.prefixBytes,y:i.constantMean})),color:"#1f7a48"}],"HMAC verification timing by matching prefix bytes");const c=o.points[o.points.length-1].vulnerableMean-o.points[0].vulnerableMean,h=o.points[o.points.length-1].constantMean-o.points[0].constantMean;s.textContent=`Expected MAC (first 16 hex): ${o.expectedMacHex.slice(0,16)}... Single-check vulnerable=${o.vulnerableUserCheckMs.toFixed(6)} ms, constant-time=${o.constantUserCheckMs.toFixed(6)} ms. Prefix slope vulnerable=${c.toFixed(4)} ms, constant-time=${h.toFixed(4)} ms.`}catch(o){const c=o instanceof Error?o.message:"HMAC benchmark failed.";e.textContent=c,s.textContent="HMAC timing run failed; adjust forged MAC hex and retry."}}),n.click()}function ue(){const n=l("rsa-run"),t=l("rsa-hist"),a=l("rsa-summary");n.addEventListener("click",async()=>{const e=await re(140);L(t,[{label:"Naive bit=0",values:e.naiveBit0Samples,color:"#d77a0a"},{label:"Naive bit=1",values:e.naiveBit1Samples,color:"#ce2f4f"},{label:"Ladder bit=0",values:e.ladderBit0Samples,color:"#195d9a"},{label:"Ladder bit=1",values:e.ladderBit1Samples,color:"#1f7a48"}],"RSA exponentiation timing distributions");const r=Math.abs(e.naiveBit1Mean-e.naiveBit0Mean),s=Math.abs(e.ladderBit1Mean-e.ladderBit0Mean);a.textContent=`${e.keyDescription}. Flipped private exponent bit index ${e.selectedBitIndex}. Naive gap=${r.toFixed(4)} ms, ladder gap=${s.toFixed(4)} ms over repeated measurements. WebCrypto RSA-PSS sign mean=${e.webCryptoSignMeanMs.toFixed(4)} ms.`}),n.click()}function fe(){const n=l("cache-run"),t=l("cache-hist"),a=l("cache-summary");n.addEventListener("click",()=>{const e=z(180);L(t,[{label:"Cached",values:e.cachedSamples,color:"#1f7a48"},{label:"Uncached",values:e.uncachedSamples,color:"#ce2f4f"}],"Cached vs uncached access timing"),l("l1-v").textContent=`~${e.l1EstimateNs} ns`,l("l2-v").textContent=`~${e.l2EstimateNs} ns`,l("l3-v").textContent=`~${e.l3EstimateNs} ns`,l("dram-v").textContent=`~${e.dramEstimateNs} ns`,a.textContent=`Measured cached mean=${e.cachedMean.toFixed(4)} ms, uncached mean=${e.uncachedMean.toFixed(4)} ms. Timing differs because cache-line residency changes memory latency. WebCrypto AES routes to hardened native implementations.`}),n.click()}function ge(){if(_())return;let n=0;window.addEventListener("resize",()=>{window.clearTimeout(n),n=window.setTimeout(()=>{l("strcmp-run").click(),l("hmac-run").click(),l("rsa-run").click(),l("cache-run").click()},180)})}function be(){me(),de(),pe(),he(),ue(),fe(),ge();const n=_()?"Reduced-motion mode detected: chart redraw animations are disabled.":"Reduced-motion mode not enabled: charts redraw on resize without decorative animation.";l("cache-summary").textContent=n,l("cache-run").click()}const T=new URLSearchParams(window.location.search).get("p");if(T){const n=T.startsWith("/")?T:`/${T}`;window.history.replaceState(null,"",n)}be();
