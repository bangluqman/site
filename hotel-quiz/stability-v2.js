/* Hotel Bookings Quiz - Stability upgrade 2.0
   Uses the existing 25 questions and UI, with reconnect, stable per-tab identity,
   host-authoritative deduplication, heartbeat, cached host snapshots and answer ACK. */
(function(){
"use strict";
const prevHostForm=hostForm, prevHostPage=hostPage, prevJoinForm=joinForm;
const previousHome=home;
const SNAP="hb-quiz-host-v2";
const PEER_OPTIONS={debug:0,config:{iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun.cloudflare.com:3478"}]}};
let hostPresence=null,clientPing=null,answerRetry=null,reconnectTimer=null,joinTimeout=null;
let attempts=0,lastPong=0,pending=null,acknowledged=false,clientStep=-1,localUntil=0,clientFinished=false;
let studentToken="",sessionGeneration=0,alertedOffline=false;
const saved={
 get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},
 set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
};
function token(){
 const b=new Uint8Array(16);crypto.getRandomValues(b);
 return Array.from(b,n=>n.toString(16).padStart(2,"0")).join("");
}
function publicRank(n){
 return rank(n||99).map(p=>({name:p.name,score:p.score,good:p.good}));
}
function snapshot(){
 if(role!=="host")return;
 saved.set(SNAP,{v:2,room,title,maxQ,phase,step,until,answers,
   players:Object.values(players).map(p=>({id:p.id,name:p.name,score:p.score,good:p.good,history:p.history})),savedAt:Date.now()});
}
function hostHeartbeat(){
 clearInterval(hostPresence);
 hostPresence=setInterval(()=>{
  if(role!=="host")return;
  let change=false,now=Date.now();
  Object.values(players).forEach(p=>{
   if(p.online&&now-(p.lastSeen||0)>15000){p.online=false;change=true}
  });
  if(change){snapshot();hostPage()}
 },4000);
}
function sendSafe(c,m){if(c&&c.open)try{c.send(m);return true}catch(e){}return false}
function hostBind(){
 peer.on("open",()=>{
  role="host";attempts=0;
  if(phase==="question"&&Date.now()>=until)phase="reveal";
  hostHeartbeat();snapshot();hostPage();
  if(phase==="question"){
   stop();timer=setInterval(()=>{let el=document.getElementById("seconds");if(el)el.textContent=Math.max(0,Math.ceil((until-Date.now())/1000));if(Date.now()>=until)reveal()},200);
  }
 });
 peer.on("connection",c=>{
  others[c.peer]=c;
  c.on("data",m=>hostData(c,m));
  c.on("open",()=>sendSafe(c,{k:"hello"}));
  c.on("close",()=>hostLost(c));
  c.on("error",()=>hostLost(c));
 });
 peer.on("disconnected",()=>{if(peer&&!peer.destroyed&&peer.disconnected)setTimeout(()=>{try{peer.reconnect()}catch(e){}},1800)});
 peer.on("error",e=>{
  if(e.type==="unavailable-id"){
   alert("Kode ruang sedang digunakan. Tutup tab dosen lama, lalu coba pulihkan sesi.");
   role="hostform";hostForm();
  }else if(e.type==="network"||e.type==="socket-error"){
   // Existing data connections may remain alive while signalling reconnects.
   if(peer&&!peer.destroyed&&peer.disconnected)setTimeout(()=>{try{peer.reconnect()}catch(e){}},2400);
  }else{console.warn("Peer dosen:",e.type||e.message)}
 });
}
function hostLost(c){
 delete others[c.peer];
 const id=c.__player;
 const p=id&&players[id];
 if(p&&p.peer===c.peer){p.online=false;p.lastSeen=0;snapshot()}
 if(role==="host")hostPage();
}
makeHost=function(){
 if(typeof Peer!=="function"){alert("Pustaka koneksi belum dimuat. Muat ulang halaman saat internet stabil.");return}
 title=document.getElementById("title").value||"Hotel Bookings Quiz";
 maxQ=Number(document.getElementById("count").value);
 room="hb-"+Array.from(crypto.getRandomValues(new Uint8Array(5)),n=>n.toString(16).padStart(2,"0")).join("");
 players={};others={};answers={};step=-1;phase="lobby";until=0;
 let b=document.getElementById("make");if(b)b.disabled=true;
 const s=document.getElementById("state");if(s)s.textContent="Menyiapkan ruang...";
 role="host";
 peer=new Peer(room,PEER_OPTIONS);hostBind();
};
function restore(){
 const s=saved.get(SNAP);
 if(!s||s.v!==2)return;
 if(peer&&!peer.destroyed)try{peer.destroy()}catch(e){}
 room=s.room;title=s.title||"Hotel Bookings Quiz";maxQ=s.maxQ||25;
 phase=s.phase;step=s.step;until=s.until||0;answers=s.answers||{};
 players={};others={};
 (s.players||[]).forEach(p=>{if(p.id&&typeof p.id==="string")players[p.id]={...p,online:false,peer:null,lastSeen:0,history:p.history||[]}});
 role="host";peer=new Peer(room,PEER_OPTIONS);hostBind();
 html('<div class="card"><h2>Memulihkan sesi</h2><p>Membuka kembali ruang '+x(room)+'. Mahasiswa yang terputus akan tersambung kembali secara otomatis apabila halaman mereka masih terbuka.</p></div>');
}
hostForm=function(){
 prevHostForm();
 const s=saved.get(SNAP);
 if(s&&s.v===2&&s.phase!=="finished"&&Date.now()-s.savedAt<86400000){
  const e=document.querySelector("#state");
  if(e){
   e.insertAdjacentHTML("afterend",'<div class="info" style="margin-top:14px"><strong>Sesi sebelumnya ditemukan</strong><p style="margin:7px 0">Kode: '+x(s.room)+' · '+(s.step+1)+' / '+s.maxQ+' soal</p><button id="resume" class="btn alt">Pulihkan sesi sebelumnya</button></div>');
   click("resume",restore);
  }
 }
 click("make",makeHost);
};
hostData=function(c,m){
 if(!m||typeof m!=="object")return;
 if(m.k==="join"){
  let name=String(m.name||"").trim().slice(0,35);
  let id=String(m.id||"");
  if(!name||!/^[a-f0-9]{32}$/.test(id)){sendSafe(c,{k:"reject",reason:"Identitas atau nama tidak valid"});return}
  if(!players[id])players[id]={id,name,score:0,good:0,history:[],online:false,lastSeen:0,peer:null};
  let p=players[id];
  if(p.peer&&p.peer!==c.peer){
   let old=others[p.peer];if(old&&old!==c)try{old.close()}catch(e){}
  }
  c.__player=id;p.peer=c.peer;p.online=true;p.lastSeen=Date.now();
  // Keep the original name for consistent reports after a reconnect.
  sync(c);snapshot();hostPage();
  return;
 }
 if(m.k==="ping"){
  const p=c.__player&&players[c.__player];
  if(p&&p.peer===c.peer){let was=!p.online;p.online=true;p.lastSeen=Date.now();sendSafe(c,{k:"pong",t:m.t||0});if(was)hostPage()}
  return;
 }
 if(m.k==="answer"){
  const id=c.__player,p=id&&players[id],s=Number(m.step),a=Number(m.answer);
  if(!p||p.peer!==c.peer||!Number.isInteger(s)||!Number.isInteger(a)||a<0||a>3)return;
  p.lastSeen=Date.now();p.online=true;
  if(answers[id]&&answers[id].step===s){
   sendSafe(c,{k:"ack",step:s,score:p.score,points:answers[id].points});
   return;
  }
  if(phase!=="question"||s!==step||Date.now()>until+250){sendSafe(c,{k:"late",step:s});return}
  let good=a===Q[s][3],pts=good?Math.round(500+500*Math.max(0,(until-Date.now())/(Q[s][2]*1000))):0;
  answers[id]={step:s,points:pts};
  p.score+=pts;p.good+=good?1:0;p.history.push([s+1,a,good,pts]);
  sendSafe(c,{k:"ack",step:s,score:p.score,points:pts});
  snapshot();hostPage();
  let connected=Object.values(players).filter(p=>p.online).length;
  if(connected>0&&Object.keys(answers).length>=connected)setTimeout(()=>{if(phase==="question"&&step===s)reveal()},550);
 }
};
sync=function(c){
 if(!c.open)return;
 let p=players[c.__player];
 let question=phase==="question"?{text:Q[step][0],options:Q[step][1],time:Q[step][2],msLeft:Math.max(0,until-Date.now()),step}:null;
 sendSafe(c,{k:"sync",phase,step,maxQ,score:p?p.score:0,answered:!!(p&&answers[p.id]&&answers[p.id].step===step),
   leader:publicRank(10),q:question,correct:phase==="reveal"?Q[step][3]:null});
};
startQuestion=function(){
 stop();
 if(step+1>=maxQ){endHost();return}
 phase="question";step++;answers={};until=Date.now()+Q[step][2]*1000;
 let q={text:Q[step][0],options:Q[step][1],time:Q[step][2],msLeft:Q[step][2]*1000,step};
 sendAll({k:"question",step,maxQ,q});snapshot();hostPage();
 timer=setInterval(()=>{
  const e=document.getElementById("seconds");
  if(e)e.textContent=Math.max(0,Math.ceil((until-Date.now())/1000));
  if(Date.now()>=until)reveal();
 },180);
};
reveal=function(){
 if(phase!=="question")return;
 stop();phase="reveal";snapshot();
 sendAll({k:"reveal",step,correct:Q[step][3],leader:publicRank(10)});
 Object.values(others).forEach(c=>sync(c));
 hostPage();
};
endHost=function(){
 stop();phase="finished";snapshot();
 sendAll({k:"end",leader:publicRank(99)});
 Object.values(others).forEach(c=>sync(c));
 hostPage();
};
hostPage=function(){
 prevHostPage();
 if(role!=="host")return;
 app.insertAdjacentHTML("beforeend",'<div class="info">Koneksi kelas v2: identitas peserta tetap, sinkronisasi jawaban, pengiriman ulang otomatis, pemeriksaan jaringan, dan pemulihan sesi di browser dosen. Semua skor dihitung di laptop dosen. Untuk jaminan 30 HP lintas jaringan, gunakan backend server.</div>');
 if(phase==="finished")click("reset",()=>{
  Object.values(players).forEach(p=>{p.score=0;p.good=0;p.history=[]});
  step=-1;phase="lobby";answers={};snapshot();
  Object.values(others).forEach(c=>sync(c));hostPage();
 });
};
function clearClientTimers(){
 clearInterval(clientPing);clearInterval(answerRetry);clearTimeout(joinTimeout);
 clientPing=null;answerRetry=null;joinTimeout=null;
}
function studentNet(message,bad){
 const el=document.getElementById("netState")||document.getElementById("status");
 if(el){el.textContent=message;if(el.id==="netState")el.className="pill"+(bad?"":" ok")}
}
function retryStudent(){
 if(clientFinished||role==="home"||role==="demo"||role==="host")return;
 clearClientTimers();clearTimeout(reconnectTimer);
 attempts++;
 const delay=Math.min(9000,Math.round(800*Math.pow(1.6,Math.min(attempts,5)))+Math.floor(Math.random()*400));
 studentNet("Menghubungkan ulang...",true);
 reconnectTimer=setTimeout(openStudentPeer,delay);
}
function openStudentPeer(){
 if(clientFinished||!room)return;
 clearTimeout(reconnectTimer);
 const generation=++sessionGeneration;
 const old=peer;if(old&&!old.destroyed)try{old.destroy()}catch(e){}
 peer=new Peer(undefined,PEER_OPTIONS);
 peer.on("open",()=>{
  if(generation!==sessionGeneration)return;
  conn=peer.connect(room,{reliable:true,serialization:"json"});
  joinTimeout=setTimeout(()=>{if(generation===sessionGeneration&&(!conn||!conn.open))retryStudent()},10500);
  conn.on("open",()=>{
   if(generation!==sessionGeneration)return;
   clearTimeout(joinTimeout);attempts=0;alertedOffline=false;
   lastPong=Date.now();role="student";
   conn.send({k:"join",name:studName,id:studentToken});
   studentNet("Terhubung");
   clearInterval(clientPing);
   clientPing=setInterval(()=>{
    if(generation!==sessionGeneration)return;
    if(!conn||!conn.open||Date.now()-lastPong>15000){retryStudent();return}
    sendSafe(conn,{k:"ping",t:Date.now()});
   },4000);
  });
  conn.on("data",m=>{if(generation===sessionGeneration)studentData(m)});
  conn.on("close",()=>{if(generation===sessionGeneration)retryStudent()});
  conn.on("error",()=>{if(generation===sessionGeneration)retryStudent()});
 });
 peer.on("error",()=>{if(generation===sessionGeneration)retryStudent()});
}
joinHost=function(){
 studName=(document.getElementById("name")?.value||"").trim().slice(0,35);
 room=(document.getElementById("room")?.value||"").trim();
 if(!studName){alert("Isi nama mahasiswa terlebih dahulu.");return}
 if(!/^hb-[a-f0-9]{10}$/.test(room)){alert("Kode kelas tidak valid.");return}
 if(typeof Peer!=="function"){alert("Pustaka koneksi belum tersedia. Periksa internet.");return}
 try{
  let key="hb-quiz-token-"+room;
  studentToken=sessionStorage.getItem(key)||token();
  sessionStorage.setItem(key,studentToken);
 }catch(e){studentToken=token()}
 attempts=0;clientFinished=false;myAnswer=null;clientStep=-1;pending=null;acknowledged=false;role="student";
 html('<div class="card center"><h2>Menghubungkan ke ruang kelas</h2><p id="netState">Menghubungkan...</p><p>Kode '+x(room)+' · '+x(studName)+'</p></div>');
 openStudentPeer();
};
function resendAnswer(){
 clearInterval(answerRetry);
 if(!pending||acknowledged)return;
 const send=()=>{
  if(!pending||acknowledged||pending.step!==clientStep||Date.now()>localUntil+500)return;
  if(conn&&conn.open)sendSafe(conn,{k:"answer",step:pending.step,answer:pending.answer});
 };
 send();
 answerRetry=setInterval(send,850);
}
studentQuestion=function(q,max,already=false){
 stop();role="student";
 if(!q||!Array.isArray(q.options)||q.options.length!==4)return;
 const same=clientStep===q.step;
 if(!same){pending=null;acknowledged=false;myAnswer=null}
 clientStep=q.step;
 localUntil=Date.now()+Math.max(0,Number(q.msLeft||0));
 if(already){acknowledged=true;clearInterval(answerRetry)}
 if(pending&&pending.step===clientStep)myAnswer=pending.answer;
 html('<div class="between"><span id="netState" class="pill ok">Terhubung</span><b>Soal '+(q.step+1)+' / '+max+'</b></div><div class="card"><div class="between"><span class="muted">Pilih jawabanmu</span><span class="clock" id="seconds">'+Math.max(0,Math.ceil((localUntil-Date.now())/1000))+'</span></div><div class="big">'+x(q.text)+'</div><div id="choices">'+options(q.options,myAnswer!==null,myAnswer,null)+'</div></div><div class="between"><p id="status">'+(acknowledged?"Jawaban sudah dicatat ✓":myAnswer===null?"Belum menjawab":"Mengonfirmasi jawaban...")+'</p><strong>'+fmt(myScore)+' poin</strong></div>');
 app.querySelectorAll("[data-a]").forEach(e=>e.onclick=()=>{
  if(myAnswer!==null||Date.now()>localUntil)return;
  myAnswer=Number(e.dataset.a);pending={step:clientStep,answer:myAnswer};acknowledged=false;
  document.getElementById("choices").innerHTML=options(q.options,true,myAnswer,null);
  document.getElementById("status").textContent="Mengirim jawaban...";
  resendAnswer();
 });
 if(pending&&!acknowledged&&Date.now()<=localUntil)resendAnswer();
 timer=setInterval(()=>{
  let seconds=Math.max(0,Math.ceil((localUntil-Date.now())/1000));
  let e=document.getElementById("seconds");if(e)e.textContent=seconds;
  if(seconds===0){
   stop();if(myAnswer===null){
    document.getElementById("choices").innerHTML=options(q.options,true,null,null);
    document.getElementById("status").textContent="Waktu habis";
   }
  }
 },180);
};
studentReveal=function(s,correct,leaders){
 stop();clearInterval(answerRetry);pending=null;board=leaders||board;let q=Q[s];
 html('<div class="card"><span id="netState" class="pill ok">Pembahasan soal '+(s+1)+'</span><div class="big">'+x(q[0])+'</div>'+options(q[1],true,null,correct)+'<div class="info">Jawaban benar: <b>'+x(q[1][correct])+'</b></div><p>Menunggu soal berikutnya...</p></div><div class="card"><h2>Skor: '+fmt(myScore)+'</h2><h3>Leaderboard sementara</h3>'+boardHtml(board.slice(0,10))+'</div>');
};
studentEnd=function(leaders){
 stop();clearClientTimers();clientFinished=true;board=leaders||board;
 let at=board.findIndex(p=>p.name===studName)+1;
 let candidate=board.find(p=>p.name===studName);
 if(candidate&&candidate.score===myScore)at=board.indexOf(candidate)+1;
 html('<div class="card center"><div class="trophy">🏆</div><h1>Terima kasih, '+x(studName)+'!</h1><div class="total">'+fmt(myScore)+'</div><p>Peringkat (berdasarkan nama): '+(at||"—")+' dari '+board.length+' peserta</p></div><div class="card"><h2>Peringkat akhir</h2>'+boardHtml(board)+'</div>');
};
studentData=function(m){
 if(!m||typeof m!=="object")return;
 if(m.k==="pong"){lastPong=Date.now();return}
 if(m.k==="hello")return;
 if(m.k==="reject"){alert(m.reason||"Tidak dapat masuk ke kelas");return}
 if(m.k==="sync"){
  lastPong=Date.now();myScore=Number(m.score||0);board=m.leader||[];
  if(m.phase==="question"&&m.q)studentQuestion(m.q,m.maxQ,m.answered);
  else if(m.phase==="reveal"){if(Number.isInteger(m.step)&&m.step>=0)studentReveal(m.step,m.correct,m.leader)}
  else if(m.phase==="finished")studentEnd(m.leader);
  else waiting();
  return;
 }
 if(m.k==="question"){studentQuestion(m.q,m.maxQ,false);return}
 if(m.k==="ack"){
  if(m.step===clientStep){acknowledged=true;myScore=Number(m.score||0);clearInterval(answerRetry);
   const e=document.getElementById("status");if(e)e.textContent="Jawaban berhasil dicatat ✓";}
  return;
 }
 if(m.k==="late"){
  if(m.step===clientStep){clearInterval(answerRetry);const e=document.getElementById("status");if(e)e.textContent="Jawaban tidak diterima: waktu habis";}
  return;
 }
 if(m.k==="reveal"){studentReveal(m.step,m.correct,m.leader);return}
 if(m.k==="end"){studentEnd(m.leader);return}
};
joinForm=function(r){prevJoinForm(r);click("go",joinHost)};
window.addEventListener("online",()=>{if(room&&role==="student"&&(!conn||!conn.open))retryStudent()});
window.addEventListener("pagehide",snapshot);
window.addEventListener("beforeunload",snapshot);
if(new URLSearchParams(location.search).has("room"))joinForm(new URLSearchParams(location.search).get("room"));
else if(new URLSearchParams(location.search).has("host"))hostForm();
})();
