export const MUSIC_URL='./assets/pouring-music.mp3';
const preferenceKey='sugar-painting-music';
const volume=.14;

// One audio graph serves both quiet background playback and video exports.
// It is created and loaded only after a real interaction with the workbench.
export class StudioMusic {
  constructor(onChange=()=>{}) {
    this.onChange=onChange;this.enabled=true;this.active=false;this.unlocked=false;
    this.supported=!!(window.AudioContext||window.webkitAudioContext);
    this.context=null;this.gain=null;this.buffer=null;this.source=null;
    this.loading=null;this.failed=false;this.offset=0;this.startedAt=0;this.pauseTimer=null;this.recordings=0;
    try{this.enabled=localStorage.getItem(preferenceKey)!=='off';}catch{/* A blocked preference store does not block sound. */}
  }

  async unlock(retry=false) {
    this.unlocked=true;
    if(!this.enabled||!this.supported||document.hidden)return false;
    if(this.failed&&!retry)return false;
    try {
      if(!this.context){const AudioContext=window.AudioContext||window.webkitAudioContext;this.context=new AudioContext();this.gain=this.context.createGain();this.gain.gain.value=0;this.gain.connect(this.context.destination);}
      // Resume synchronously within the user gesture, before awaiting the asset.
      const resumed=this.context.resume();
      if(!this.buffer&&!this.loading){
        this.failed=false;
        this.loading=(async()=>{
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
          try{const response=await fetch(MUSIC_URL,{signal:controller.signal});if(!response.ok)throw Error('Music unavailable');this.buffer=await this.context.decodeAudioData(await response.arrayBuffer());}
          finally{clearTimeout(timer);}
        })();
        this.onChange();
      }
      await Promise.all([resumed,this.loading]);this.loading=null;this.failed=false;this.sync();return true;
    }catch{this.loading=null;this.failed=true;this.sync();return false;}
  }

  async toggle() {
    this.enabled=!this.enabled;
    try{localStorage.setItem(preferenceKey,this.enabled?'on':'off');}catch{/* Optional preference. */}
    this.sync();return this.enabled?this.unlock(true):true;
  }

  setActive(active) {if(this.active===active)return;this.active=active;this.sync();}

  stopSource() {
    if(!this.source)return;
    this.offset=(this.context.currentTime-this.startedAt)%this.buffer.duration;
    try{this.source.stop();}catch{/* A source may already have stopped. */}
    this.source.disconnect();this.source=null;
  }

  sync() {
    clearTimeout(this.pauseTimer);
    const playing=this.enabled&&this.unlocked&&!this.failed&&!!this.buffer&&this.active;
    if(this.context&&this.gain){
      const now=this.context.currentTime,param=this.gain.gain;
      param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);param.linearRampToValueAtTime(playing?volume:0,now+.4);
      if(playing){
        if(this.context.state==='suspended')this.context.resume().catch(()=>{});
        if(!this.source){this.source=this.context.createBufferSource();this.source.buffer=this.buffer;this.source.loop=true;this.source.connect(this.gain);this.startedAt=now-this.offset;this.source.start(0,this.offset);}
      }else if(this.source)this.pauseTimer=setTimeout(()=>this.stopSource(),450);
    }
    this.onChange();
  }

  async prepareRecording() {return this.enabled?this.unlock(true):false;}

  startRecording() {
    if(!this.enabled||!this.buffer||this.failed||!this.context)return null;
    const destination=this.context.createMediaStreamDestination(),track=destination.stream.getAudioTracks()[0];
    this.gain.connect(destination);this.stopSource();this.offset=0;this.recordings++;this.sync();
    let disposed=false;
    return {track,dispose:()=>{if(disposed)return;disposed=true;this.gain.disconnect(destination);track.stop();this.recordings--;this.sync();}};
  }

  stats() {
    return {supported:this.supported,enabled:this.enabled,unlocked:this.unlocked,active:this.active,loaded:!!this.buffer,loading:!!this.loading,failed:this.failed,playing:!!this.source,context:this.context?.state||null,volume:this.gain?.gain.value||0,duration:this.buffer?.duration||0,recordings:this.recordings};
  }
}
