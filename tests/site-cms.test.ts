import {expect,it} from 'vitest';
import {validateContent,validateSchema} from '../standalone/site-cms/model.mjs';
import {generationPrompt} from '../automation/worker.mjs';
const schema={format:'lazysoft-cms-v1',fields:[{key:'heading',label:'Заголовок',type:'text'}],collections:[{key:'products',label:'Товары',fields:[{key:'name',label:'Название',type:'text'},{key:'image',label:'Изображение',type:'image'}]}]};
it('supports arbitrary catalog counts and rejects unsafe content',()=>{
 const content={values:{heading:'Каталог'},items:{products:Array.from({length:1000},(_,i)=>({id:'item-'+i,name:'Товар '+i,image:''}))}};
 expect(Object.values(validateContent(schema,content).items)[0]).toHaveLength(1000);
 expect(Object.values(validateContent(schema,{...content,items:{products:[]}}).items)[0]).toHaveLength(0);
 for(const image of ['javascript:alert(1)','../private/key.png','https://unknown.example/image.png','data:text/html,script'])expect(()=>validateContent(schema,{...content,items:{products:[{id:'test',name:'Товар',image}]}})).toThrow();
 expect(()=>validateSchema({...schema,fields:[{key:'__proto__',label:'bad',type:'text'}]})).toThrow();
 expect(()=>validateContent(schema,{...content,items:{products:[{id:'same',name:'a',image:''},{id:'same',name:'b',image:''}]}})).toThrow();
});
it('loads the actual skill and CMS contract into the automatic generation prompt',()=>{
 const prompt=generationPrompt({kind:'initial',targetDemoId:'1',idea:'Магазин',instructions:''});
 expect(prompt).toContain('lazysoft-cms-v1');expect(prompt).toContain('CMS.load()');expect(prompt).toContain('Не генерируй три варианта сразу');expect(prompt).toContain('Боты уведомляют только владельца');
});
it('builds independent server packages and never overwrites an existing installation key',async()=>{
 const {mkdtemp,mkdir,writeFile,readFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {installDemoCms,buildPackages}=await import('../standalone/site-cms/package.mjs');
 const root=await mkdtemp(join(tmpdir(),'cms-package-test-')),site=join(root,'site'),out=join(root,'packages');await mkdir(site);
 await writeFile(join(site,'index.html'),'<html><title>CMS fixture</title><body></body></html>');
 await writeFile(join(site,'cms-schema.json'),JSON.stringify(schema));await writeFile(join(site,'cms-content.json'),JSON.stringify({values:{heading:'Каталог'},items:{products:[]}}));
 await installDemoCms(site);await buildPackages(site,out);
 const key=await readFile(join(out,'cloudflare/INSTALL-KEY.txt'),'utf8');
 expect(key.trim()).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(await readFile(join(out,'hostiman/INSTALL-KEY.txt'),'utf8')).not.toBe(key);
 await expect(readFile(join(out,'cloudflare/public/INSTALL-KEY.txt'))).rejects.toThrow();
 expect(await readFile(join(out,'cloudflare/public/cms-config.js'),'utf8')).toContain("mode:'server'");
 // Same complete admin UI in preview and both delivery packages; only storage/auth mode differs.
 expect(await readFile(join(site,'cms-config.js'),'utf8')).toContain("mode:'demo'");
 expect(await readFile(join(site,'index.html'),'utf8')).toContain('cms-fallback.js');
 expect(await readFile(join(site,'cms-fallback.js'),'utf8')).toContain('lazysoftCmsFallback');
 const admin=await readFile(join(site,'cms-admin.js'),'utf8');
 for(const folder of ['cloudflare/public','hostiman/public_html']){
  expect(await readFile(join(out,folder,'cms-config.js'),'utf8')).toContain("mode:'server'");
  expect(await readFile(join(out,folder,'cms-admin.js'),'utf8')).toBe(admin);
  expect(await readFile(join(out,folder,'cms-content.json'),'utf8')).toBe(await readFile(join(site,'cms-content.json'),'utf8'));
 }
 expect(await readFile(join(out,'cloudflare/src/worker.js'),'utf8')).toContain('validateCMS');
 expect(await readFile(join(out,'hostiman/private/app.php'),'utf8')).toContain('function validate(');
 await expect(buildPackages(site,out)).rejects.toThrow();expect(await readFile(join(out,'cloudflare/INSTALL-KEY.txt'),'utf8')).toBe(key);
});
