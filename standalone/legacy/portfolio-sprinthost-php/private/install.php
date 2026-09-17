<?php
// This installer reads ONLY a trusted local export, never uploaded paths or URLs.
function installPortfolio(PDO $db, array $c, string $key): void {
    rate($db,'setup',5);
    if (!preg_match('/^[A-Za-z0-9_-]{43}$/D',$key) || !hash_equals($c['setup_key_hash'],hash('sha256',$key))) reject('Неверный ключ установки',401);
    if ((int)query($db,'SELECT @@max_allowed_packet')->fetchColumn()<16777216) reject('Нужен max_allowed_packet не менее 16 МБ');
    atomic($db,function() use($db,$key) {
        if (query($db,'SELECT key_hash FROM pf_settings WHERE id=1')->fetchColumn()!==null || query($db,'SELECT id FROM pf_content LIMIT 1')->fetch()) reject('Установка уже выполнена',409);
        $file=__DIR__.'/seed.json';
        if (is_file($file)) {
            if (filesize($file)>150*1024*1024) reject('Слишком большой архив');
            $seed=json_decode(file_get_contents($file),true,32,JSON_THROW_ON_ERROR);
            if (!is_array($seed['assets']??null) || count($seed['assets'])>100) reject('Неверный архив файлов');
            $size=0;
            foreach ($seed['assets'] as $a) {
                if (!identifier($a['id']??null) || !is_string($a['bytes']??null) || !is_string($a['type']??null)) reject('Неверный архив');
                $b=base64_decode($a['bytes'],true);
                if ($b===false || !fileValid($a['type'],$b)) reject('Повреждённый файл в архиве');
                $size+=strlen($b); if ($size>104857600) reject('Слишком много файлов');
                query($db,'INSERT INTO pf_assets VALUES(?,?,?)',[$a['id'],$a['type'],$b]);
            }
            // Preserve historical versions, validating their asset references as well.
            foreach ($seed['history']??[] as $r) {
                if (!textValid($r['event']??null,255) || !is_int($r['created']??null)) reject('Неверная история');
                $version=$r['version']??null; $content=$r['content']??null;
                if ($version!==null && (!is_int($version) || $version<1)) reject('Неверная версия истории');
                if ($content!==null) $content=validate($db,$content);
                query($db,'INSERT INTO pf_history(event,created,version,json) VALUES(?,?,?,?)',[$r['event'],$r['created'],$version,$content===null?null:jsonEncode($content)]);
            }
            if (($seed['content']??null)!==null) {
                $content=validate($db,$seed['content']); $version=$seed['version']??null;
                if (!is_int($version) || $version<1) reject('Неверная версия');
                query($db,'INSERT INTO pf_content VALUES(1,?,?)',[$version,jsonEncode($content)]);
            }
        }
        query($db,'UPDATE pf_settings SET key_hash=? WHERE id=1',[hash('sha256',$key)]);
        query($db,'DELETE FROM pf_sessions'); audit($db,'Установка автономной PHP-версии');
    });
}
