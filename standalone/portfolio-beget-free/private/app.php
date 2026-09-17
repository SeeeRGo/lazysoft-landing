<?php
declare(strict_types=1);

// Requires PHP 8.1+, PDO MySQL, InnoDB. No Composer, Node.js or external services.
const MAX_FILE = 8388608;
function reject(string $message, int $status = 400): never { throw new RuntimeException($message, $status); }
function stamp(): int { return (int)floor(microtime(true) * 1000); }
function token(): string { return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); }
function jsonEncode(mixed $v): string { return json_encode($v, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
function securityHeaders(): void {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    header('Cache-Control: no-store');
}
function respond(mixed $value, int $status = 200): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    echo jsonEncode($value); exit;
}
function config(): array {
    $c = require __DIR__.'/config.php';
    $u = parse_url($c['origin']);
    if (!$u || ($u['scheme'] ?? '') !== 'https' || empty($u['host']) || isset($u['path']) || isset($u['query']) || isset($u['fragment']) || isset($u['user'])) {
        throw new LogicException('Invalid configured HTTPS origin');
    }
    if (!preg_match('/^[a-f0-9]{64}$/D', $c['setup_key_hash'])) throw new LogicException('Installation key not configured');
    return $c;
}
function database(array $c): PDO {
    $db = new PDO($c['dsn'], $c['user'], $c['password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES=>false, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec('SET NAMES utf8mb4');
    return $db;
}
function query(PDO $db, string $sql, array $args = []): PDOStatement { $s=$db->prepare($sql); $s->execute($args); return $s; }
function atomic(PDO $db, callable $fn): mixed {
    $db->beginTransaction();
    try {
        // Serialize mutations, rate-limit buckets and revocation through one existing row.
        query($db, 'SELECT id FROM pf_settings WHERE id=1 FOR UPDATE')->fetch();
        $value=$fn(); $db->commit(); return $value;
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
}
function rate(PDO $db, string $name, int $capacity): void {
    $wait=atomic($db, function() use($db,$name,$capacity) {
        $now=stamp(); $old=query($db,'SELECT * FROM pf_limits WHERE name=?',[$name])->fetch();
        $n=$old ? min($capacity,(float)$old['tokens']+max(0,$now-(int)$old['updated'])*$capacity/60000) : $capacity;
        query($db,'INSERT INTO pf_limits(name,tokens,updated) VALUES(?,?,?) ON DUPLICATE KEY UPDATE tokens=VALUES(tokens),updated=VALUES(updated)',[$name,max(0,$n-($n>=1?1:0)),$now]);
        return $n>=1 ? 0 : max(1,(int)ceil((1-$n)*60/$capacity));
    });
    if ($wait) { header('Retry-After: '.$wait); reject('Слишком много запросов. Повторите позже.',429); }
}
function authorized(PDO $db, string $key): void {
    $s=strlen($key)<=100 ? query($db,'SELECT expires FROM pf_sessions WHERE hash=?',[hash('sha256',$key)])->fetch() : false;
    if (!$s || (int)$s['expires']<=stamp()) reject('Сессия истекла или отозвана. Войдите снова.',401);
}
function audit(PDO $db, string $event, ?int $version=null, mixed $content=null): void {
    query($db,'INSERT INTO pf_history(event,created,version,json) VALUES(?,?,?,?)',[$event,stamp(),$version,$content===null?null:jsonEncode($content)]);
}
function rawBody(int $max): string {
    if ((int)($_SERVER['CONTENT_LENGTH']??0)>$max) reject('Слишком большой запрос',413);
    $f=fopen('php://input','rb'); $b=stream_get_contents($f,$max+1); fclose($f);
    if (strlen($b)>$max) reject('Слишком большой запрос',413); return $b;
}
function payload(int $max=150000): array {
    $v=json_decode(rawBody($max),true,32,JSON_THROW_ON_ERROR);
    if (!is_array($v)) reject('Некорректный JSON'); return $v;
}
function fileValid(string $type, string $b): bool {
    if (!$b || strlen($b)>MAX_FILE) return false;
    return match($type) {
        'image/png'=>str_starts_with($b,"\x89PNG\r\n\x1a\n"),
        'image/jpeg'=>str_starts_with($b,"\xff\xd8\xff"),
        'image/webp'=>str_starts_with($b,'RIFF') && substr($b,8,4)==='WEBP',
        'application/pdf'=>str_starts_with($b,'%PDF-'), default=>false,
    };
}
function textValid(mixed $v, int $max): bool { return is_string($v) && preg_match('//u',$v) && preg_match_all('/./us',$v)<=$max; }
function identifier(mixed $v): bool { return is_string($v) && preg_match('/^[A-Za-z0-9_-]{1,80}$/D',$v)===1; }
function validate(PDO $db, mixed $c): array {
    if (!is_array($c)) reject('Проверьте содержимое');
    $result=[];
    foreach (['name'=>100,'headline'=>160,'about'=>3000,'email'=>254,'telegram'=>33,'prices'=>3000] as $field=>$max) {
        if (!textValid($c[$field]??null,$max)) reject('Проверьте поле '.$field); $result[$field]=$c[$field];
    }
    if (!trim($c['name']) || !trim($c['headline'])) reject('Укажите имя и заголовок');
    if ($c['email'] && !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/uD',$c['email'])) reject('Проверьте почту');
    if ($c['telegram'] && !preg_match('/^@?[A-Za-z0-9_]{5,32}$/D',$c['telegram'])) reject('Telegram: @username');
    if (!isset($c['works']) || !is_array($c['works']) || !array_is_list($c['works']) || count($c['works'])>40) reject('Максимум 40 работ');
    $ids=[]; $result['works']=[];
    foreach ($c['works'] as $w) {
        if (!is_array($w) || !identifier($w['id']??null) || isset($ids[$w['id']]) || !in_array($w['category']??null,['covers','spreads','magazines','logos'],true) || !textValid($w['title']??null,150) || !trim($w['title']) || !textValid($w['description']??null,2000)) reject('Проверьте поля работы');
        $ids[$w['id']]=true;
        foreach (['image','document'] as $field) {
            if ($field==='document' && !array_key_exists($field,$w)) continue;
            if (!identifier($w[$field]??null)) reject('Недопустимый файл');
            $a=query($db,'SELECT type FROM pf_assets WHERE id=?',[$w[$field]])->fetch();
            if (!$a || ($field==='document' ? $a['type']!=='application/pdf' : !str_starts_with($a['type'],'image/'))) reject('Файл не найден или имеет неверный тип');
        }
        $result['works'][]=array_intersect_key($w,array_flip(['id','category','title','description','image','document']));
    }
    return $result;
}
function assetUrl(string $id): string { return '/asset.php?id='.rawurlencode($id); }
function readContent(PDO $db): mixed {
    $r=query($db,'SELECT * FROM pf_content WHERE id=1')->fetch(); if (!$r) return null;
    $c=json_decode($r['json'],true,32,JSON_THROW_ON_ERROR);
    $works=array_map(fn($w)=>array_merge($w,['imageUrl'=>assetUrl($w['image']),'documentUrl'=>isset($w['document'])?assetUrl($w['document']):null]),$c['works']);
    return ['version'=>(int)$r['version'],'content'=>$c,'works'=>$works];
}
function runApi(PDO $db, array $config): never {
    if ($_SERVER['REQUEST_METHOD']==='GET') { rate($db,'read',120); respond(readContent($db)); }
    if ($_SERVER['REQUEST_METHOD']!=='POST') reject('Метод не поддерживается',405);
    if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN']!==$config['origin']) reject('Запрос с другого сайта запрещён',403);
    $key=preg_replace('/^Bearer /','',$_SERVER['HTTP_AUTHORIZATION']??$_SERVER['REDIRECT_HTTP_AUTHORIZATION']??'');
    $op=$_GET['op']??'';
    if ($op==='login') {
        rate($db,'login',5);
        $result=atomic($db,function() use($db,$key) {
            $expected=query($db,'SELECT key_hash FROM pf_settings WHERE id=1')->fetchColumn();
            if (!is_string($expected) || !preg_match('/^[A-Za-z0-9_-]{43}$/D',$key) || !hash_equals($expected,hash('sha256',$key))) reject('Неверный ключ доступа',401);
            $session=token(); $expires=stamp()+900000;
            query($db,'DELETE FROM pf_sessions WHERE expires<=?',[stamp()]);
            query($db,'INSERT INTO pf_sessions VALUES(?,?)',[hash('sha256',$session),$expires]); audit($db,'Вход в админку');
            return ['token'=>$session,'expiresAt'=>$expires];
        }); respond($result);
    }
    try { authorized($db,$key); } catch (RuntimeException $e) { rate($db,'invalid',30); throw $e; }
    rate($db,$op==='backup'?'backup':($op==='upload'?'upload':'admin'),$op==='backup'?2:($op==='upload'?10:60));
    if ($op==='backup') {
        $backup=atomic($db,function() use($db,$key) {
            authorized($db,$key);audit($db,'Скачана резервная копия');
            $r=query($db,'SELECT version,json FROM pf_content WHERE id=1')->fetch();
            return ['format'=>'lazysoft-portfolio-backup-v1','createdAt'=>gmdate('c'),'version'=>$r?(int)$r['version']:0,'content'=>$r?json_decode($r['json'],true,32,JSON_THROW_ON_ERROR):null,
                'assets'=>array_map(fn($a)=>['id'=>$a['id'],'type'=>$a['type'],'bytes'=>base64_encode($a['bytes'])],query($db,'SELECT id,type,bytes FROM pf_assets')->fetchAll()),
                'history'=>array_map(fn($h)=>['event'=>$h['event'],'created'=>(int)$h['created'],'version'=>$h['version']===null?null:(int)$h['version'],'content'=>$h['json']===null?null:json_decode($h['json'],true,32,JSON_THROW_ON_ERROR)],query($db,'SELECT event,created,version,json FROM pf_history ORDER BY id')->fetchAll())];
        });
        header('Content-Type: application/json; charset=utf-8');header('Content-Disposition: attachment; filename="portfolio-backup-'.gmdate('Y-m-d').'.json"');echo jsonEncode($backup);exit;
    }
    // Read bodies outside the database transaction; recheck authorization inside.
    $p=in_array($op,['save','revision','rotate'],true)?payload($op==='save'?150000:1000):[];
    $bytes=$op==='upload'?rawBody(MAX_FILE):'';
    $result=atomic($db,function() use($db,$key,$op,$p,$bytes) {
        authorized($db,$key);
        if ($op==='logout' || $op==='revoke') { query($db,'DELETE FROM pf_sessions'); audit($db,'Все сессии отозваны'); return ['ok'=>true]; }
        if ($op==='rotate') {
            if (!is_string($p['newKey']??null) || !preg_match('/^[A-Za-z0-9_-]{43}$/D',$p['newKey'])) reject('Неверный формат ключа');
            query($db,'UPDATE pf_settings SET key_hash=? WHERE id=1',[hash('sha256',$p['newKey'])]); query($db,'DELETE FROM pf_sessions'); audit($db,'Ключ заменён, все сессии отозваны'); return ['ok'=>true];
        }
        if ($op==='history') return array_map(function($r) { $r['createdAt']=(int)$r['createdAt']; if ($r['version']===null) unset($r['version']); else $r['version']=(int)$r['version']; return $r; },query($db,'SELECT event,created AS createdAt,version FROM pf_history ORDER BY id DESC LIMIT 50')->fetchAll());
        if ($op==='revision') {
            if (!is_int($p['version']??null)) reject('Неверная версия');
            $s=query($db,'SELECT json FROM pf_history WHERE version=?',[$p['version']])->fetchColumn(); return $s?json_decode($s,true,32,JSON_THROW_ON_ERROR):null;
        }
        if ($op==='upload') {
            $type=$_SERVER['CONTENT_TYPE']??''; if (!fileValid($type,$bytes)) reject('Разрешены JPG, PNG, WebP и PDF до 8 МБ; содержимое должно соответствовать формату');
            $q=query($db,'SELECT count(*) AS n,COALESCE(sum(OCTET_LENGTH(bytes)),0) AS size FROM pf_assets')->fetch();
            if ((int)$q['n']>=100 || (int)$q['size']+strlen($bytes)>104857600) reject('Лимит: 100 файлов / 100 МБ');
            $id=bin2hex(random_bytes(16)); query($db,'INSERT INTO pf_assets VALUES(?,?,?)',[$id,$type,$bytes]); return ['storageId'=>$id,'url'=>assetUrl($id)];
        }
        if ($op==='save') {
            $c=validate($db,$p['content']??null); $r=query($db,'SELECT * FROM pf_content WHERE id=1')->fetch();
            if (!is_int($p['version']??null) || $p['version']!==($r?(int)$r['version']:0)) reject('Версия изменилась в другой вкладке. Перезагрузите страницу.',409);
            if ($r && !query($db,'SELECT id FROM pf_history WHERE version=?',[$r['version']])->fetch()) audit($db,'Версия до включения истории',(int)$r['version'],json_decode($r['json'],true,32,JSON_THROW_ON_ERROR));
            $v=$p['version']+1; $previous=$r?json_decode($r['json'],true):[]; $changed=[];
            foreach ($c as $k=>$val) if ($val!==($previous[$k]??null)) $changed[]=$k;
            query($db,'INSERT INTO pf_content VALUES(1,?,?) ON DUPLICATE KEY UPDATE version=VALUES(version),json=VALUES(json)',[$v,jsonEncode($c)]); audit($db,'Публикация: '.implode(', ',$changed),$v,$c); return ['version'=>$v];
        }
        reject('Неизвестное действие');
    }); respond($result);
}
function serveAsset(PDO $db): never {
    if (!in_array($_SERVER['REQUEST_METHOD'],['GET','HEAD'],true)) reject('Метод не поддерживается',405);
    $id=$_GET['id']??null; if (!identifier($id)) reject('Файл не найден',404);
    $a=query($db,'SELECT * FROM pf_assets WHERE id=?',[$id])->fetch(); if (!$a) reject('Файл не найден',404);
    header('Content-Type: '.$a['type']); header('Content-Length: '.strlen($a['bytes'])); header('Cache-Control: public, max-age=86400');
    if ($a['type']==='application/pdf') header('Content-Disposition: attachment; filename="portfolio.pdf"');
    if ($_SERVER['REQUEST_METHOD']!=='HEAD') echo $a['bytes']; exit;
}
function boot(callable $fn): void {
    securityHeaders();
    try { $c=config(); $db=database($c); $fn($db,$c); }
    catch (Throwable $e) {
        // Never send DSN, SQL, credentials or filesystem paths to visitors/logs.
        $code=$e instanceof RuntimeException && !$e instanceof PDOException ? $e->getCode() : 0;
        if ($e instanceof JsonException) respond(['error'=>'Некорректный JSON'],400);
        if (!in_array($code,[400,401,403,404,405,409,413,429],true)) respond(['error'=>'Сервис временно недоступен. Проверьте настройку хостинга.'],503);
        respond(['error'=>$e->getMessage()],$code);
    }
}
