// Passenger loads CommonJS entry points. Keep the application itself ESM.
// Its first HTTP server listen() is intercepted by Passenger (no public TCP port).
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
async function boot(){
 const config=JSON.parse(readFileSync(join(__dirname,'hosting.json'),'utf8'));
 const origin=new URL(config.publicOrigin);
 if(origin.protocol!=='https:'||origin.origin!==config.publicOrigin)throw Error('hosting.json: specify an HTTPS origin without a trailing slash');
 const {start}=await import('./server.mjs');
 start({dataDir:join(__dirname,'data'),publicOrigin:config.publicOrigin});
}
boot().catch(()=>{console.error('Portfolio startup failed. Check hosting.json, Node version and private data directory permissions.');process.exit(1)});
