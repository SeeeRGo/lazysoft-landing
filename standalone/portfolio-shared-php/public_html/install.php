<?php
declare(strict_types=1);
// One-time browser installer for a new, dedicated MySQL database.
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('Cache-Control: no-store');
$private=dirname(__DIR__).'/private';
$setupFile=$private.'/setup.php';
$configFile=$private.'/config.php';
function page(string $title,string $body,int $status=200): never {
    http_response_code($status);header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'.htmlspecialchars($title).'</title><style>body{font:17px/1.45 Arial;max-width:680px;margin:40px auto;padding:0 20px;color:#173f3a}label{display:block;margin:18px 0 6px;font-weight:700}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #9eb2ad;border-radius:8px;font:inherit}button{margin-top:22px;padding:13px 22px;border:0;border-radius:8px;background:#218b81;color:white;font:700 16px Arial}.note{padding:14px;background:#fff2d5;border-radius:8px}.error{padding:14px;background:#f9e5e2;border-radius:8px}</style><h1>'.htmlspecialchars($title).'</h1>'.$body.'</html>';exit;
}
if (!is_file($setupFile) || is_file($configFile)) page('Установка закрыта','<p>Сайт уже установлен либо установочные файлы отсутствуют.</p>',409);
$https=($_SERVER['HTTPS']??'')==='on'||strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']??'')==='https';
if (!$https) page('Нужно защищённое соединение','<p class="error">Сначала включите бесплатный SSL-сертификат и откройте эту страницу по адресу, начинающемуся с <b>https://</b>.</p>',403);
$setup=require $setupFile;
if ($_SERVER['REQUEST_METHOD']==='GET') page('Установка портфолио','<p>Введите данные <b>новой пустой базы</b> из панели хостинга и ключ из файла INSTALL-KEY.txt.</p><p class="note">Эта страница удалится после успешной установки. Никому не пересылайте пароль базы и установочный ключ.</p><form method="post"><label>Сервер базы данных</label><input name="host" value="localhost" required maxlength="120"><label>Имя базы</label><input name="database" required maxlength="64"><label>Пользователь базы</label><input name="user" required maxlength="64"><label>Пароль базы</label><input name="password" type="password" required maxlength="200" autocomplete="new-password"><label>Ключ установки</label><input name="key" type="password" required minlength="43" maxlength="43" autocomplete="off"><button>Установить сайт</button></form>');
if ($_SERVER['REQUEST_METHOD']!=='POST') page('Метод не поддерживается','',405);
$key=$_POST['key']??'';$host=trim((string)($_POST['host']??''));$database=trim((string)($_POST['database']??''));$user=trim((string)($_POST['user']??''));$password=(string)($_POST['password']??'');
if (!is_string($key)||!preg_match('/^[A-Za-z0-9_-]{43}$/D',$key)||!hash_equals($setup['setup_key_hash']??'',hash('sha256',$key))) page('Не удалось установить','<p class="error">Неверный ключ установки.</p>',401);
if (!preg_match('/^[A-Za-z0-9._-]{1,120}$/D',$host)||!preg_match('/^[A-Za-z0-9_]{1,64}$/D',$database)||!preg_match('/^[A-Za-z0-9_]{1,64}$/D',$user)||$password===''||strlen($password)>200) page('Не удалось установить','<p class="error">Проверьте реквизиты базы данных.</p>',400);
$origin='https://'.($_SERVER['HTTP_HOST']??'');
if (!filter_var($origin,FILTER_VALIDATE_URL)) page('Не удалось установить','<p class="error">Некорректный адрес сайта.</p>',400);
try {
    $dsn='mysql:host='.$host.';dbname='.$database.';charset=utf8mb4';
    $db=new PDO($dsn,$user,$password,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);
    $existing=$db->query("SHOW TABLES LIKE 'pf_settings'")->fetchColumn();
    if ($existing) page('База не пустая','<p class="error">Выберите новую пустую базу. Существующие таблицы не изменены.</p>',409);
    $schema=file_get_contents($private.'/schema.sql');if ($schema===false) throw new RuntimeException('schema');
    $db->exec($schema);
    $config="<?php\nreturn ".var_export(['dsn'=>$dsn,'user'=>$user,'password'=>$password,'origin'=>$origin,'setup_key_hash'=>$setup['setup_key_hash']],true).";\n";
    if (file_put_contents($configFile,$config,LOCK_EX)===false) throw new RuntimeException('config');chmod($configFile,0600);
    require $private.'/app.php';require $private.'/install.php';
    installPortfolio($db,['origin'=>$origin,'setup_key_hash'=>$setup['setup_key_hash']],$key);
    @unlink($private.'/seed.json');@unlink($private.'/schema.sql');@unlink($setupFile);@unlink(dirname(__DIR__).'/INSTALL-KEY.txt');@unlink(__FILE__);
    page('Сайт установлен','<p>Готово. Установочная страница и ключ на сервере удалены.</p><p><a href="/admin.html">Открыть админку</a></p>');
} catch (Throwable $e) {
    page('Не удалось установить','<p class="error">Проверьте сервер, имя, пользователя и пароль базы. Если данные верны, сделайте снимок этой страницы и обратитесь к разработчику.</p>',503);
}
