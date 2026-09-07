import { SignJWT, jwtVerify } from 'jose';
export const SESSION_MS=15*60_000;
const secret=()=>{const value=process.env.PORTFOLIO_SESSION_SECRET;if(!value||value.length<43)throw Error('Session signing unavailable');return new TextEncoder().encode(value)};
export async function issueSession(epoch:number){
 const expiresAt=Date.now()+SESSION_MS;
 const token=await new SignJWT({epoch}).setProtectedHeader({alg:'HS256'}).setIssuer('lazysoft-portfolio').setAudience('portfolio-03212396').setIssuedAt().setExpirationTime(Math.floor(expiresAt/1000)).sign(secret());
 return {token,expiresAt:Math.floor(expiresAt/1000)*1000};
}
export async function verifySession(token:string){
 const {payload}=await jwtVerify(token,secret(),{algorithms:['HS256'],issuer:'lazysoft-portfolio',audience:'portfolio-03212396',maxTokenAge:'15m'});
 if(!Number.isSafeInteger(payload.epoch)||typeof payload.exp!=='number')throw Error('Invalid session');
 return {epoch:payload.epoch as number,expiresAt:payload.exp*1000};
}
